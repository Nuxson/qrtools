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
document.querySelectorAll("#tabs .nav-link").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#tabs .nav-link").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((c) => {
      c.classList.remove("show", "active");
    });
    tab.classList.add("active");
    const tabId = (tab as HTMLElement).dataset.tab;
    const pane = document.getElementById(`tab-${tabId}`);
    if (pane) pane.classList.add("show", "active");
  });
});

function setStatus(msg: string) {
  const el = document.getElementById("status-bar");
  if (el) el.textContent = msg;
}

function showError(msg: string) {
  setStatus(`Ошибка: ${msg}`);
}

function showAlert(id: string, msg: string, type: string) {
  const el = document.getElementById(id);
  if (el) {
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    el.classList.remove("d-none");
  }
}

function hideAlert(id: string) {
  const el = document.getElementById(id);
  if (el) el.classList.add("d-none");
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
      document.getElementById("qr-result")?.classList.remove("d-none");
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
    preview.classList.remove("d-none");
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
    preview.classList.remove("d-none");
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
  const scanStatus = document.getElementById("scan-status");

  if (codesList && resultsDiv) {
    codesList.innerHTML = "";
    hideAlert("scan-status");

    if (codes.length === 0) {
      codesList.innerHTML = '<div class="list-group-item text-body-secondary">Коды не найдены</div>';
    } else {
      codes.forEach((code, idx) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = `list-group-item list-group-item-action ${idx === 0 ? "active" : ""}`;
        const isOwn = isOwnFormat(code);
        const preview = code.length > 100 ? code.substring(0, 100) + "..." : code;
        item.innerHTML = `
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-truncate" style="max-width: 80%;">${escapeHtml(preview)}</span>
            <span class="badge ${isOwn ? "bg-success" : "bg-secondary"}">${isOwn ? "QRTools" : "Другой формат"}</span>
          </div>
        `;
        item.addEventListener("click", () => {
          codesList.querySelectorAll(".list-group-item").forEach((el) => el.classList.remove("active"));
          item.classList.add("active");
          selectedScanCode = code;
          decodeSelected(code);
        });
        codesList.appendChild(item);
      });

      selectedScanCode = codes[0];
      decodeSelected(codes[0]);
    }
    resultsDiv.classList.remove("d-none");
    setStatus(`Найдено кодов: ${codes.length}`);
  }
}

function decodeSelected(code: string) {
  const resultArea = document.getElementById("decrypted-result");
  const resultText = document.getElementById("decrypted-text") as HTMLTextAreaElement;
  const scanStatus = document.getElementById("scan-status");

  if (!isOwnFormat(code)) {
    resultArea?.classList.add("d-none");
    if (scanStatus) {
      scanStatus.className = "alert alert-warning";
      scanStatus.textContent = "Этот QR-код создан другим приложением. Только QR-коды QRTools можно прочитать.";
      scanStatus.classList.remove("d-none");
    }
    return;
  }

  hideAlert("scan-status");

  const decoded = decode(code);
  if (decoded) {
    if (resultText) resultText.value = decoded;
    resultArea?.classList.remove("d-none");
    setStatus("Данные прочитаны");
  } else {
    if (resultText) resultText.value = "Не удалось декодировать";
    resultArea?.classList.remove("d-none");
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
  if (btn) btn.classList.remove("d-none");
}

function setupRegionSelector() {
  const overlay = document.getElementById("region-overlay");
  const selectBtn = document.getElementById("btn-select-region");

  if (!overlay || !selectBtn) return;

  selectBtn.addEventListener("click", () => {
    regionSelectActive = !regionSelectActive;
    if (regionSelectActive) {
      overlay.classList.remove("d-none");
      selectBtn.textContent = "Отменить выделение";
      selectBtn.classList.replace("btn-outline-warning", "btn-warning");
      setStatus("Обведите область на изображении");
    } else {
      overlay.classList.add("d-none");
      selectBtn.textContent = "Выделить область";
      selectBtn.classList.replace("btn-warning", "btn-outline-warning");
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
    overlay.classList.add("d-none");
    selectBtn.textContent = "Выделить область";
    selectBtn.classList.replace("btn-warning", "btn-outline-warning");

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
