import "./style.css";
import { encode, decode, isOwnFormat, generateQRDataURL } from "./qr-protocol";

let isTauri = false;
let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
let regionSelectActive = false;
let regionStartX = 0;
let regionStartY = 0;
let regionRect: HTMLDivElement | null = null;

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
    setStatus("Режим: PWA (веб)");
  }
}

let selectedScanCode: string | null = null;

// Tabs
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

function setStatus(msg: string) {
  const el = document.getElementById("status-bar");
  if (el) el.textContent = msg;
}

function showError(msg: string) {
  setStatus(`Ошибка: ${msg}`);
}

function showStatusAlert(msg: string, type: "success" | "warning" | "error") {
  const el = document.getElementById("scan-status");
  if (!el) return;
  const colors = {
    success: "bg-green-900/40 border-green-600/50 text-green-300",
    warning: "bg-amber-900/40 border-amber-600/50 text-amber-300",
    error: "bg-red-900/40 border-red-600/50 text-red-300",
  };
  el.className = `px-3 py-2 rounded-lg text-sm border ${colors[type]}`;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideStatusAlert() {
  document.getElementById("scan-status")?.classList.add("hidden");
}

// ===== QR GENERATION =====

document.getElementById("btn-generate")?.addEventListener("click", async () => {
  const text = (document.getElementById("plain-text") as HTMLTextAreaElement)?.value?.trim();
  if (!text) {
    showError("Введите данные для генерации QR-кода");
    return;
  }

  const size = parseInt((document.getElementById("qr-size") as HTMLInputElement)?.value || "400", 10);

  setStatus("Генерация QR-кода...");
  try {
    const encoded = encode(text);
    const qrDataUrl = await generateQRDataURL(encoded, size);

    const img = document.getElementById("qr-image") as HTMLImageElement;
    if (img) {
      img.src = qrDataUrl;
      document.getElementById("qr-result")?.classList.remove("hidden");
    }
    setStatus("QR-код сгенерирован");
  } catch (e) {
    showError(String(e));
  }
});

document.getElementById("btn-copy-qr")?.addEventListener("click", async () => {
  const text = (document.getElementById("plain-text") as HTMLTextAreaElement)?.value?.trim();
  if (text) {
    await navigator.clipboard.writeText(text);
    setStatus("Текст скопирован");
  }
});

document.getElementById("btn-save-qr")?.addEventListener("click", async () => {
  const img = document.getElementById("qr-image") as HTMLImageElement;
  if (!img?.src) return;

  if (isTauri) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        defaultPath: "qr-code.png",
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      if (path) {
        const base64 = img.src.split(",")[1];
        const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        await writeFile(path, binary);
        setStatus("QR-код сохранён");
      }
    } catch (e) {
      showError(String(e));
    }
  } else {
    const a = document.createElement("a");
    a.href = img.src;
    a.download = "qr-code.png";
    a.click();
    setStatus("QR-код скачан");
  }
});

// ===== SCANNING =====

document.getElementById("btn-open-image")?.addEventListener("click", async () => {
  if (isTauri) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const files = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "bmp", "gif", "webp"] }],
      });
      if (!files) return;
      const path = typeof files === "string" ? files : Array.isArray(files) ? files[0] : files;
      const imageData = await readFile(path as string);
      await processScannedImageTauri(imageData);
    } catch (e) {
      showError(String(e));
    }
  } else {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await processScannedImageWeb(file);
    };
    input.click();
  }
});

document.getElementById("btn-paste-image")?.addEventListener("click", async () => {
  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          const blob = await item.getType(type);
          if (isTauri) {
            const buffer = await blob.arrayBuffer();
            await processScannedImageTauri(new Uint8Array(buffer));
          } else {
            await processScannedImageWeb(blob);
          }
          return;
        }
      }
    }
    showError("В буфере обмена нет изображения");
  } catch (e) {
    showError("Не удалось прочитать буфер обмена: " + String(e));
  }
});

async function processScannedImageTauri(imageData: Uint8Array) {
  setStatus("Сканирование кодов...");
  const preview = document.getElementById("scan-preview");
  const scanImg = document.getElementById("scan-image") as HTMLImageElement;
  if (preview && scanImg) {
    scanImg.src = URL.createObjectURL(new Blob([imageData]));
    scanImg.onload = () => showRegionButton();
    preview.classList.remove("hidden");
  }

  try {
    const result = await tauriInvoke<{ success: boolean; data?: string; error?: string }>(
      "scan_barcodes",
      { imageData: Array.from(imageData) }
    );
    if (result.success && result.data) {
      showScanResults(JSON.parse(result.data));
    } else {
      showError(result.error || "Ошибка сканирования");
    }
  } catch (e) {
    showError(String(e));
  }
}

async function processScannedImageWeb(fileOrBlob: File | Blob) {
  setStatus("Сканирование кодов...");

  const preview = document.getElementById("scan-preview");
  const scanImg = document.getElementById("scan-image") as HTMLImageElement;
  if (preview && scanImg) {
    scanImg.src = URL.createObjectURL(fileOrBlob);
    scanImg.onload = () => showRegionButton();
    preview.classList.remove("hidden");
  }

  try {
    const { Html5Qrcode } = await import("html5-qrcode");
    const container = document.getElementById("scan-temp-container");
    if (!container) return;

    const scanner = new Html5Qrcode("scan-temp-container");
    const dataURL = await blobToDataURL(fileOrBlob);
    const decoded = await scanner.scanFile(dataURL, true);
    scanner.clear();
    showScanResults([decoded]);
  } catch (e) {
    showError("Не удалось распознать код: " + String(e));
  }
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
  const codesList = document.getElementById("scan-codes-list");
  const resultsDiv = document.getElementById("scan-results");

  if (codesList && resultsDiv) {
    codesList.innerHTML = "";
    hideStatusAlert();

    if (codes.length === 0) {
      codesList.innerHTML = '<p class="text-dark-500 text-sm">Коды не найдены</p>';
    } else {
      codes.forEach((code, idx) => {
        const isOwn = isOwnFormat(code);
        const preview = code.length > 80 ? code.substring(0, 80) + "..." : code;
        const item = document.createElement("button");
        item.type = "button";
        item.className = `w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
          idx === 0
            ? "bg-blue-600/20 border-blue-500/50 text-blue-200"
            : "bg-dark-800 border-dark-700 text-dark-300 hover:bg-dark-700 hover:border-dark-600"
        }`;
        item.innerHTML = `
          <div class="flex items-center justify-between gap-2">
            <span class="truncate">${escapeHtml(preview)}</span>
            <span class="shrink-0 text-xs px-2 py-0.5 rounded-full ${isOwn ? "bg-green-900/50 text-green-400" : "bg-dark-700 text-dark-400"}">${isOwn ? "QRTools" : "Другой"}</span>
          </div>
        `;
        item.addEventListener("click", () => {
          codesList.querySelectorAll("button").forEach((el) => {
            el.className = el.className.replace("bg-blue-600/20 border-blue-500/50 text-blue-200", "bg-dark-800 border-dark-700 text-dark-300");
          });
          item.className = item.className.replace("bg-dark-800 border-dark-700 text-dark-300", "bg-blue-600/20 border-blue-500/50 text-blue-200");
          selectedScanCode = code;
          decodeSelected(code);
        });
        codesList.appendChild(item);
      });

      selectedScanCode = codes[0];
      decodeSelected(codes[0]);
    }
    resultsDiv.classList.remove("hidden");
    setStatus(`Найдено кодов: ${codes.length}`);
  }
}

function decodeSelected(code: string) {
  const resultArea = document.getElementById("decrypted-result");
  const resultText = document.getElementById("decrypted-text") as HTMLTextAreaElement;

  if (!isOwnFormat(code)) {
    resultArea?.classList.add("hidden");
    showStatusAlert("Этот QR-код создан другим приложением. Только QR-коды QRTools можно прочитать.", "warning");
    return;
  }

  hideStatusAlert();

  const decoded = decode(code);
  if (decoded) {
    if (resultText) resultText.value = decoded;
    resultArea?.classList.remove("hidden");
    setStatus("Данные прочитаны");
  } else {
    if (resultText) resultText.value = "Не удалось декодировать";
    resultArea?.classList.remove("hidden");
    showError("Ошибка декодирования");
  }
}

document.getElementById("btn-copy-decrypted")?.addEventListener("click", async () => {
  const text = (document.getElementById("decrypted-text") as HTMLTextAreaElement)?.value;
  if (text) {
    await navigator.clipboard.writeText(text);
    setStatus("Текст скопирован");
  }
});

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Hidden container for web scanning
const tempContainer = document.createElement("div");
tempContainer.id = "scan-temp-container";
tempContainer.style.display = "none";
document.body.appendChild(tempContainer);

// ===== REGION SELECTION =====

function showRegionButton() {
  const btn = document.getElementById("btn-select-region");
  if (btn) btn.classList.remove("hidden");
}

function setupRegionSelector() {
  const overlay = document.getElementById("region-overlay");
  const selectBtn = document.getElementById("btn-select-region");

  if (!overlay || !selectBtn) return;

  selectBtn.addEventListener("click", () => {
    regionSelectActive = !regionSelectActive;
    if (regionSelectActive) {
      overlay.classList.remove("hidden");
      selectBtn.textContent = "Отменить выделение";
      selectBtn.classList.remove("bg-amber-900/40", "border-amber-600/50", "text-amber-300");
      selectBtn.classList.add("bg-amber-600", "text-white", "border-amber-600");
      setStatus("Обведите область на изображении");
    } else {
      overlay.classList.add("hidden");
      selectBtn.textContent = "Выделить область";
      selectBtn.classList.remove("bg-amber-600", "text-white", "border-amber-600");
      selectBtn.classList.add("bg-amber-900/40", "border-amber-600/50", "text-amber-300");
      const box = overlay.querySelector(".region-box");
      if (box) box.remove();
    }
  });

  overlay.addEventListener("mousedown", (e) => {
    if (!regionSelectActive) return;
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    regionStartX = e.clientX - rect.left;
    regionStartY = e.clientY - rect.top;

    let box = overlay.querySelector(".region-box") as HTMLDivElement;
    if (!box) {
      box = document.createElement("div");
      box.className = "region-box";
      overlay.appendChild(box);
    }
    box.style.left = regionStartX + "px";
    box.style.top = regionStartY + "px";
    box.style.width = "0px";
    box.style.height = "0px";
    regionRect = box;
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!regionSelectActive || !regionRect) return;
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const left = Math.min(regionStartX, x);
    const top = Math.min(regionStartY, y);
    const width = Math.abs(x - regionStartX);
    const height = Math.abs(y - regionStartY);
    regionRect.style.left = left + "px";
    regionRect.style.top = top + "px";
    regionRect.style.width = width + "px";
    regionRect.style.height = height + "px";
  });

  overlay.addEventListener("mouseup", async (e) => {
    if (!regionSelectActive || !regionRect) return;
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const left = Math.min(regionStartX, x);
    const top = Math.min(regionStartY, y);
    const width = Math.abs(x - regionStartX);
    const height = Math.abs(y - regionStartY);

    if (width < 20 || height < 20) return;

    regionSelectActive = false;
    overlay.classList.add("hidden");
    selectBtn.textContent = "Выделить область";
    selectBtn.classList.remove("bg-amber-600", "text-white", "border-amber-600");
    selectBtn.classList.add("bg-amber-900/40", "border-amber-600/50", "text-amber-300");

    const img = document.getElementById("scan-image") as HTMLImageElement;
    if (!img || !img.naturalWidth) return;

    const displayW = img.clientWidth;
    const displayH = img.clientHeight;
    const scaleX = img.naturalWidth / displayW;
    const scaleY = img.naturalHeight / displayH;

    const cropX = left * scaleX;
    const cropY = top * scaleY;
    const cropW = width * scaleX;
    const cropH = height * scaleY;

    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      setStatus("Сканирование выделенной области...");
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode("scan-temp-container");
        const dataURL = canvas.toDataURL("image/png");
        const decoded = await scanner.scanFile(dataURL, true);
        scanner.clear();
        showScanResults([decoded]);
      } catch (err) {
        showError("Код не найден в выделенной области: " + String(err));
      }
    }, "image/png");
  });
}

setupRegionSelector();
detectPlatform();
