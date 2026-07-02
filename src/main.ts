import "./style.css";

let isTauri = false;
let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
let currentScreenshotB64: string | null = null;
let currentScreenshotImg: HTMLImageElement | null = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragRect: HTMLDivElement | null = null;
let ocrWorker: any = null;

async function detectPlatform() {
  try {
    const mod = await import("@tauri-apps/api/core");
    tauriInvoke = mod.invoke;
    isTauri = true;
    setStatus("Режим: Tauri (десктоп)");
  } catch {
    isTauri = false;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    }
    document.getElementById("tab-capture")?.classList.add("hidden");
    setStatus("Режим: PWA (веб) — загрузите изображение для сканирования");
  }
}

function setStatus(msg: string) {
  const el = document.getElementById("status-bar");
  if (el) el.textContent = msg;
}

function showError(msg: string) {
  setStatus(`Ошибка: ${msg}`);
}

function showCaptureStatus(msg: string, type: "success" | "warning" | "error" | "info") {
  const el = document.getElementById("capture-status");
  if (!el) return;
  const colors = {
    success: "bg-green-900/40 border border-green-600/50 text-green-300",
    warning: "bg-amber-900/40 border border-amber-600/50 text-amber-300",
    error: "bg-red-900/40 border border-red-600/50 text-red-300",
    info: "bg-blue-900/40 border border-blue-600/50 text-blue-300",
  };
  el.className = `px-3 py-2 rounded-lg text-sm ${colors[type]}`;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideCaptureStatus() {
  document.getElementById("capture-status")?.classList.add("hidden");
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== TABS =====
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.remove("bg-blue-600", "text-white");
      t.classList.add("text-dark-400");
    });
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
    tab.classList.add("bg-blue-600", "text-white");
    tab.classList.remove("text-dark-400");
    const tabId = (tab as HTMLElement).dataset.tab;
    document.getElementById(`tab-${tabId}`)?.classList.remove("hidden");
  });
});

// ===== QR GENERATION =====
document.getElementById("btn-generate")?.addEventListener("click", async () => {
  const text = (document.getElementById("plain-text") as HTMLTextAreaElement)?.value?.trim();
  if (!text) { showError("Введите данные"); return; }
  const size = parseInt((document.getElementById("qr-size") as HTMLInputElement)?.value || "400", 10);

  setStatus("Генерация QR-кода...");
  try {
    let qrDataUrl: string;
    if (isTauri && tauriInvoke) {
      const r = await tauriInvoke<{ success: boolean; data?: string; error?: string }>("generate_qr", { plaintext: text, size });
      if (!r.success || !r.data) { showError(r.error || "Ошибка"); return; }
      qrDataUrl = r.data;
    } else {
      const { generateQRDataURL } = await import("./qr-protocol");
      qrDataUrl = await generateQRDataURL(text, size);
    }
    const img = document.getElementById("qr-image") as HTMLImageElement;
    if (img) { img.src = qrDataUrl; document.getElementById("qr-result")?.classList.remove("hidden"); }
    setStatus("QR-код сгенерирован");
  } catch (e) { showError(String(e)); }
});

document.getElementById("btn-copy-qr")?.addEventListener("click", async () => {
  const text = (document.getElementById("plain-text") as HTMLTextAreaElement)?.value?.trim();
  if (text) { await navigator.clipboard.writeText(text); setStatus("Текст скопирован"); }
});

document.getElementById("btn-save-qr")?.addEventListener("click", async () => {
  const img = document.getElementById("qr-image") as HTMLImageElement;
  if (!img?.src) return;
  const a = document.createElement("a");
  a.href = img.src;
  a.download = "qr-code.png";
  a.click();
  setStatus("QR-код скачан");
});

// ===== FILE/BUFFER SCANNING =====
document.getElementById("btn-open-image")?.addEventListener("click", async () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    await processImageForScan(file);
  };
  input.click();
});

document.getElementById("btn-paste-image")?.addEventListener("click", async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          const blob = await item.getType(type);
          await processImageForScan(blob);
          return;
        }
      }
    }
    showError("В буфере обмена нет изображения");
  } catch (e) { showError("Ошибка буфера: " + String(e)); }
});

async function processImageForScan(fileOrBlob: File | Blob) {
  setStatus("Сканирование...");
  const preview = document.getElementById("scan-preview");
  const scanImg = document.getElementById("scan-image") as HTMLImageElement;
  if (preview && scanImg) {
    scanImg.src = URL.createObjectURL(fileOrBlob);
    scanImg.onload = () => document.getElementById("btn-select-region")?.classList.remove("hidden");
    preview.classList.remove("hidden");
  }
  await scanImageFromBlob(fileOrBlob);
}

async function scanImageFromBlob(blob: Blob) {
  setStatus("Сканирование кодов...");
  try {
    const { Html5Qrcode } = await import("html5-qrcode");
    const container = ensureScanContainer();
    const scanner = new Html5Qrcode(container);
    const dataURL = await blobToDataURL(blob);
    const decoded = await scanner.scanFile(dataURL, true);
    scanner.clear();
    showScanResults([decoded]);
  } catch (e) {
    showScanResults([]);
    showError("Коды не найдены: " + String(e));
  }
}

function ensureScanContainer(): string {
  const id = "scan-temp-container";
  if (!document.getElementById(id)) {
    const div = document.createElement("div");
    div.id = id;
    div.style.display = "none";
    document.body.appendChild(div);
  }
  return id;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function showScanResults(codes: string[]) {
  const list = document.getElementById("scan-codes-list");
  const results = document.getElementById("scan-results");
  if (!list || !results) return;
  list.innerHTML = "";
  if (codes.length === 0) {
    list.innerHTML = '<p class="text-dark-500 text-sm">Коды не найдены</p>';
  } else {
    codes.forEach((code) => {
      const preview = code.length > 80 ? code.substring(0, 80) + "..." : code;
      const item = document.createElement("div");
      item.className = "px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-sm text-dark-300 cursor-pointer hover:bg-dark-700 transition-colors";
      item.textContent = preview;
      item.title = code;
      item.addEventListener("click", async () => {
        await navigator.clipboard.writeText(code);
        setStatus("Код скопирован");
      });
      list.appendChild(item);
    });
  }
  results.classList.remove("hidden");
  setStatus(`Найдено кодов: ${codes.length}`);
}

// ===== SYSTEM SCREEN CAPTURE =====
document.getElementById("btn-capture")?.addEventListener("click", async () => {
  if (!isTauri || !tauriInvoke) {
    showError("Захват экрана доступен только в десктопном приложении");
    return;
  }

  setStatus("Захват экрана...");
  showCaptureStatus("Делаем скриншот...", "info");

  try {
    const r = await tauriInvoke<{ success: boolean; data?: string; error?: string }>("capture_screen");
    if (!r.success || !r.data) {
      showCaptureStatus(r.error || "Ошибка захвата", "error");
      return;
    }
    currentScreenshotB64 = r.data;

    const preview = document.getElementById("capture-preview");
    const img = document.getElementById("capture-image") as HTMLImageElement;
    const overlay = document.getElementById("capture-overlay");
    const hint = document.getElementById("capture-hint");

    if (preview && img) {
      img.src = r.data;
      currentScreenshotImg = img;
      preview.classList.remove("hidden");
      overlay?.classList.remove("hidden");
      hint?.classList.remove("hidden");
      showCaptureStatus("Выделите область на скриншоте", "info");

      img.onload = () => {
        setupCaptureOverlay();
      };
    }
  } catch (e) {
    showCaptureStatus("Ошибка: " + String(e), "error");
  }
});

function setupCaptureOverlay() {
  const overlay = document.getElementById("capture-overlay");
  const img = currentScreenshotImg;
  if (!overlay || !img) return;

  overlay.innerHTML = "";
  dragRect = null;

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    isDragging = true;
    const rect = img.getBoundingClientRect();
    dragStartX = e.clientX - rect.left;
    dragStartY = e.clientY - rect.top;

    let box = overlay.querySelector(".drag-box") as HTMLDivElement;
    if (!box) {
      box = document.createElement("div");
      box.className = "drag-box";
      overlay.appendChild(box);
    }
    box.style.left = dragStartX + "px";
    box.style.top = dragStartY + "px";
    box.style.width = "0px";
    box.style.height = "0px";
    dragRect = box;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging || !dragRect) return;
    e.preventDefault();
    const rect = img.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const left = Math.min(dragStartX, x);
    const top = Math.min(dragStartY, y);
    dragRect.style.left = left + "px";
    dragRect.style.top = top + "px";
    dragRect.style.width = Math.abs(x - dragStartX) + "px";
    dragRect.style.height = Math.abs(y - dragStartY) + "px";
  };

  const onPointerUp = async (e: PointerEvent) => {
    if (!isDragging || !dragRect) return;
    isDragging = false;
    e.preventDefault();

    const rect = img.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const left = Math.min(dragStartX, x);
    const top = Math.min(dragStartY, y);
    const width = Math.abs(x - dragStartX);
    const height = Math.abs(y - dragStartY);

    if (width < 15 || height < 15) return;

    overlay.classList.add("hidden");
    document.getElementById("capture-hint")?.classList.add("hidden");
    showCaptureStatus("Обработка выделенной области...", "info");

    const displayW = img.clientWidth;
    const displayH = img.clientHeight;
    const scaleX = img.naturalWidth / displayW;
    const scaleY = img.naturalHeight / displayH;
    const cropX = Math.round(left * scaleX);
    const cropY = Math.round(top * scaleY);
    const cropW = Math.round(width * scaleX);
    const cropH = Math.round(height * scaleY);

    try {
      const r = await tauriInvoke<{ success: boolean; data?: string; error?: string }>(
        "crop_image", { imageData: dataURItoBytes(currentScreenshotB64!), x: cropX, y: cropY, w: cropW, h: cropH }
      );
      if (!r.success || !r.data) {
        showCaptureStatus(r.error || "Ошибка обрезки", "error");
        return;
      }
      const croppedBlob = dataURIToBlob(r.data);
      await processCroppedRegion(croppedBlob);
    } catch (e) {
      showCaptureStatus("Ошибка: " + String(e), "error");
    }
  };

  overlay.addEventListener("pointerdown", onPointerDown);
  overlay.addEventListener("pointermove", onPointerMove);
  overlay.addEventListener("pointerup", onPointerUp);
  overlay.addEventListener("pointerleave", () => { isDragging = false; });
}

async function processCroppedRegion(blob: Blob) {
  const codesResult = document.getElementById("capture-codes");
  const codesList = document.getElementById("capture-codes-list");
  const textResult = document.getElementById("capture-text");
  const ocrText = document.getElementById("capture-ocr-text") as HTMLTextAreaElement;
  const copyBtn = document.getElementById("btn-copy-capture");

  let foundCodes: string[] = [];
  let foundText = "";

  // QR/Barcode scan
  try {
    const { Html5Qrcode } = await import("html5-qrcode");
    const container = ensureScanContainer();
    const scanner = new Html5Qrcode(container);
    const dataURL = await blobToDataURL(blob);
    const decoded = await scanner.scanFile(dataURL, true);
    scanner.clear();
    foundCodes = [decoded];
  } catch {}

  // Also try Rust barcode scan
  if (isTauri && tauriInvoke && foundCodes.length === 0) {
    try {
      const bytes = dataURItoBytes(currentScreenshotB64!);
      const r = await tauriInvoke<{ success: boolean; data?: string }>("scan_barcodes", { imageData: Array.from(bytes) });
      if (r.success && r.data) {
        foundCodes = JSON.parse(r.data);
      }
    } catch {}
  }

  // OCR
  try {
    showCaptureStatus("Распознавание текста (OCR)...", "info");
    foundText = await runOCR(blob);
  } catch (e) {
    foundText = "OCR недоступен: " + String(e);
  }

  // Show results
  if (foundCodes.length > 0 && codesList) {
    codesList.innerHTML = "";
    foundCodes.forEach((code) => {
      const preview = code.length > 100 ? code.substring(0, 100) + "..." : code;
      const item = document.createElement("div");
      item.className = "px-3 py-2 rounded-lg bg-green-900/30 border border-green-600/40 text-sm text-green-300 cursor-pointer hover:bg-green-900/50 transition-colors";
      item.textContent = preview;
      item.title = code;
      item.addEventListener("click", async () => {
        await navigator.clipboard.writeText(code);
        setStatus("Код скопирован");
      });
      codesList.appendChild(item);
    });
    codesResult?.classList.remove("hidden");
  }

  if (foundText && ocrText) {
    ocrText.value = foundText;
    textResult?.classList.remove("hidden");
  }

  if (foundCodes.length > 0 || foundText) {
    const allText = foundText || foundCodes.join("\n");
    copyBtn?.classList.remove("hidden");
    copyBtn?.addEventListener("click", async () => {
      await navigator.clipboard.writeText(allText);
      setStatus("Результат скопирован");
    }, { once: true });
    showCaptureStatus(`Найдено: ${foundCodes.length > 0 ? foundCodes.length + " код(ов)" : ""}${foundCodes.length > 0 && foundText ? " + " : ""}${foundText ? "текст" : ""}`, "success");
  } else {
    showCaptureStatus("Ничего не найдено", "warning");
  }
}

async function runOCR(blob: Blob): Promise<string> {
  // Use Tesseract.js for OCR
  const Tesseract = await import("tesseract.js");
  const result = await Tesseract.recognize(blob, "rus+eng", {});
  return result.data.text.trim();
}

// ===== REGION SELECTOR (file scan tab) =====
let fileRegionActive = false;
let fileRegionStartX = 0;
let fileRegionStartY = 0;
let fileRegionRect: HTMLDivElement | null = null;

document.getElementById("btn-select-region")?.addEventListener("click", () => {
  const overlay = document.getElementById("region-overlay");
  if (!overlay) return;
  fileRegionActive = !fileRegionActive;
  if (fileRegionActive) {
    overlay.classList.remove("hidden");
    document.getElementById("btn-select-region")!.textContent = "Отменить";
    setStatus("Обведите область");
  } else {
    overlay.classList.add("hidden");
    document.getElementById("btn-select-region")!.textContent = "Выделить область";
    const box = overlay.querySelector(".drag-box");
    if (box) box.remove();
  }
});

document.getElementById("region-overlay")?.addEventListener("pointerdown", (e) => {
  if (!fileRegionActive) return;
  e.preventDefault();
  const overlay = document.getElementById("region-overlay")!;
  const rect = overlay.getBoundingClientRect();
  fileRegionStartX = e.clientX - rect.left;
  fileRegionStartY = e.clientY - rect.top;
  let box = overlay.querySelector(".drag-box") as HTMLDivElement;
  if (!box) { box = document.createElement("div"); box.className = "drag-box"; overlay.appendChild(box); }
  box.style.left = fileRegionStartX + "px";
  box.style.top = fileRegionStartY + "px";
  box.style.width = "0px";
  box.style.height = "0px";
  fileRegionRect = box;
});

document.getElementById("region-overlay")?.addEventListener("pointermove", (e) => {
  if (!fileRegionActive || !fileRegionRect) return;
  e.preventDefault();
  const rect = document.getElementById("region-overlay")!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  fileRegionRect.style.left = Math.min(fileRegionStartX, x) + "px";
  fileRegionRect.style.top = Math.min(fileRegionStartY, y) + "px";
  fileRegionRect.style.width = Math.abs(x - fileRegionStartX) + "px";
  fileRegionRect.style.height = Math.abs(y - fileRegionStartY) + "px";
});

document.getElementById("region-overlay")?.addEventListener("pointerup", async (e) => {
  if (!fileRegionActive || !fileRegionRect) return;
  e.preventDefault();
  const overlay = document.getElementById("region-overlay")!;
  const rect = overlay.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const left = Math.min(fileRegionStartX, x);
  const top = Math.min(fileRegionStartY, y);
  const width = Math.abs(x - fileRegionStartX);
  const height = Math.abs(y - fileRegionStartY);
  if (width < 15 || height < 15) return;

  fileRegionActive = false;
  overlay.classList.add("hidden");
  document.getElementById("btn-select-region")!.textContent = "Выделить область";
  setStatus("Сканирование области...");

  const img = document.getElementById("scan-image") as HTMLImageElement;
  if (!img || !img.naturalWidth) return;

  const canvas = document.createElement("canvas");
  const scaleX = img.naturalWidth / img.clientWidth;
  const scaleY = img.naturalHeight / img.clientHeight;
  canvas.width = Math.round(width * scaleX);
  canvas.height = Math.round(height * scaleY);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, left * scaleX, top * scaleY, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    await scanImageFromBlob(blob);
  }, "image/png");
});

// ===== HELPERS =====
function dataURItoBytes(dataURI: string): Uint8Array {
  const base64 = dataURI.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function dataURIToBlob(dataURI: string): Blob {
  const parts = dataURI.split(",");
  const mime = parts[0].match(/:(.*?);/)?.[1] || "image/png";
  const bytes = dataURItoBytes(dataURI);
  return new Blob([bytes], { type: mime });
}

detectPlatform();
