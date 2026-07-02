import * as webCrypto from "./web-crypto";

let isTauri = false;
let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
let regionSelectActive = false;
let regionStartX = 0;
let regionStartY = 0;
let regionOverlay: HTMLDivElement | null = null;
let regionRect: HTMLDivElement | null = null;

async function detectPlatform() {
  try {
    const mod = await import("@tauri-apps/api/core");
    tauriInvoke = mod.invoke;
    isTauri = true;
    setStatus("Режим: Tauri (десктоп/Android)");
  } catch {
    isTauri = false;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
    setStatus("Режим: PWA (веб/iOS). Загрузите ключ для начала.");
  }
}

// State
let currentKey: string | null = null;
let selectedScanCode: string | null = null;

// Tabs
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    const tabId = (tab as HTMLElement).dataset.tab;
    document.getElementById(`tab-${tabId}`)?.classList.add("active");
  });
});

function setStatus(msg: string) {
  const el = document.getElementById("status-bar");
  if (el) el.textContent = msg;
}

function showError(msg: string) {
  setStatus(`Ошибка: ${msg}`);
}

// ===== KEY MANAGEMENT =====

document.getElementById("btn-gen-key")?.addEventListener("click", async () => {
  try {
    let key: string;
    if (isTauri && tauriInvoke) {
      key = await tauriInvoke<string>("generate_key");
    } else {
      key = await webCrypto.generateKey();
    }
    currentKey = key;
    const display = document.getElementById("new-key-display");
    const keyInput = document.getElementById("new-key") as HTMLTextAreaElement;
    if (display && keyInput) {
      keyInput.value = key;
      display.classList.remove("hidden");
    }
    updateKeyStatus(true);
    setStatus("Новый ключ сгенерирован. Сохраните его!");
  } catch (e) {
    showError(String(e));
  }
});

document.getElementById("btn-copy-key")?.addEventListener("click", async () => {
  const keyInput = document.getElementById("new-key") as HTMLTextAreaElement;
  if (keyInput?.value) {
    await navigator.clipboard.writeText(keyInput.value);
    setStatus("Ключ скопирован");
  }
});

document.getElementById("btn-load-key")?.addEventListener("click", async () => {
  const input = document.getElementById("load-key-input") as HTMLInputElement;
  const key = input?.value?.trim();
  if (!key) {
    showError("Введите ключ");
    return;
  }
  try {
    if (isTauri && tauriInvoke) {
      const result = await tauriInvoke<{ success: boolean; error?: string }>("set_key", { key });
      if (!(result as any).success) {
        showError((result as any).error || "Неверный ключ");
        return;
      }
    }
    currentKey = key;
    updateKeyStatus(true);
    setStatus("Ключ активирован");
  } catch (e) {
    showError(String(e));
  }
});

function updateKeyStatus(active: boolean) {
  const statusEl = document.getElementById("key-status");
  if (statusEl) {
    statusEl.className = active ? "status success" : "status error";
    statusEl.textContent = active ? "Ключ активирован" : "Ключ не установлен";
  }
}

document.getElementById("btn-export-key")?.addEventListener("click", async () => {
  try {
    let key: string | null = null;
    if (isTauri && tauriInvoke) {
      key = await tauriInvoke<string | null>("get_current_key");
    } else {
      key = currentKey;
    }
    if (!key) {
      showError("Нет активного ключа для экспорта");
      return;
    }

    if (isTauri) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        defaultPath: "qrtools-key.txt",
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (path) {
        await writeFile(path, new TextEncoder().encode(key));
        setStatus("Ключ экспортирован в файл");
      }
    } else {
      const blob = new Blob([key], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "qrtools-key.txt";
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Ключ скачан");
    }
  } catch (e) {
    showError(String(e));
  }
});

document.getElementById("btn-import-key")?.addEventListener("click", async () => {
  try {
    if (isTauri) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const files = await open({ multiple: false, filters: [{ name: "Text", extensions: ["txt"] }] });
      if (!files) return;
      const path = typeof files === "string" ? files : Array.isArray(files) ? files[0] : files;
      const content = await readFile(path as string);
      const key = new TextDecoder().decode(content).trim();
      const result = await tauriInvoke<{ success: boolean; error?: string }>("set_key", { key });
      if ((result as any).success) {
        currentKey = key;
        updateKeyStatus(true);
        setStatus("Ключ импортирован и активирован");
      } else {
        showError((result as any).error || "Неверный ключ");
      }
    } else {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".txt";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        currentKey = text.trim();
        updateKeyStatus(true);
        setStatus("Ключ импортирован");
      };
      input.click();
    }
  } catch (e) {
    showError(String(e));
  }
});

// ===== QR GENERATION =====

document.getElementById("btn-generate")?.addEventListener("click", async () => {
  const text = (document.getElementById("plain-text") as HTMLTextAreaElement)?.value?.trim();
  if (!text) {
    showError("Введите данные для шифрования");
    return;
  }
  if (!currentKey) {
    showError("Сначала сгенерируйте или загрузите ключ");
    return;
  }

  const size = parseInt((document.getElementById("qr-size") as HTMLInputElement)?.value || "400", 10);

  setStatus("Шифрование и генерация QR-кода...");
  try {
    let encryptedText: string;
    let qrDataUrl: string;

    if (isTauri && tauriInvoke) {
      const result = await tauriInvoke<{ success: boolean; data?: string; error?: string }>(
        "generate_encrypted_qr",
        { plaintext: text, size }
      );
      if (result.success && result.data) {
        qrDataUrl = result.data;
        encryptedText = await tauriInvoke<string>("encrypt_data", { plaintext: text }).then(
          (r: any) => r.data
        );
      } else {
        showError(result.error || "Ошибка генерации QR");
        return;
      }
    } else {
      encryptedText = await webCrypto.encrypt(currentKey, text);
      qrDataUrl = await webCrypto.generateQRDataURL(encryptedText, size);
    }

    const img = document.getElementById("qr-image") as HTMLImageElement;
    if (img) {
      img.src = qrDataUrl!;
      document.getElementById("qr-result")?.classList.remove("hidden");
    }
    const encDisplay = document.getElementById("encrypted-text") as HTMLTextAreaElement;
    if (encDisplay) {
      encDisplay.value = encryptedText!;
      document.getElementById("encrypted-text-display")?.classList.remove("hidden");
    }
    setStatus("QR-код сгенерирован");
  } catch (e) {
    showError(String(e));
  }
});

document.getElementById("btn-copy-encrypted")?.addEventListener("click", async () => {
  const encText = (document.getElementById("encrypted-text") as HTMLTextAreaElement)?.value;
  if (encText) {
    await navigator.clipboard.writeText(encText);
    setStatus("Зашифрованный текст скопирован");
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
        defaultPath: "qr-encrypted.png",
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
    a.download = "qr-encrypted.png";
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
    if (codes.length === 0) {
      codesList.innerHTML = '<p style="color: var(--text-dim);">Коды не найдены</p>';
    } else {
      codes.forEach((code, idx) => {
        const item = document.createElement("div");
        item.className = "scan-code-item";
        item.innerHTML = `
          <input type="radio" name="scan-code" id="code-${idx}" value="${idx}" ${idx === 0 ? "checked" : ""} />
          <label for="code-${idx}">${escapeHtml(code.substring(0, 200))}${code.length > 200 ? "..." : ""}</label>
        `;
        codesList.appendChild(item);
      });

      selectedScanCode = codes[0];

      codesList.addEventListener("change", (e) => {
        const target = e.target as HTMLInputElement;
        if (target.type === "radio") {
          selectedScanCode = codes[parseInt(target.value)];
        }
      });
    }
    resultsDiv.classList.remove("hidden");
    setStatus(`Найдено кодов: ${codes.length}`);
  }
}

document.getElementById("btn-decrypt")?.addEventListener("click", async () => {
  if (!selectedScanCode) {
    showError("Выберите код для расшифровки");
    return;
  }
  if (!currentKey) {
    showError("Сначала загрузите ключ");
    return;
  }

  setStatus("Расшифровка...");
  const decryptedArea = document.getElementById("decrypted-result");
  const decryptedText = document.getElementById("decrypted-text") as HTMLTextAreaElement;

  try {
    let result: string;
    if (isTauri && tauriInvoke) {
      const res = await tauriInvoke<{ success: boolean; data?: string; error?: string }>(
        "decrypt_data",
        { ciphertext: selectedScanCode }
      );
      if (res.success && res.data) {
        result = res.data;
      } else {
        result = res.error || "Не удалось расшифровать";
      }
    } else {
      result = await webCrypto.decrypt(currentKey, selectedScanCode);
    }

    if (decryptedText) decryptedText.value = result;
    decryptedArea?.classList.remove("hidden");
    setStatus("Данные расшифрованы");
  } catch (e) {
    if (decryptedText) decryptedText.value = "Ошибка: " + String(e);
    decryptedArea?.classList.remove("hidden");
    showError("Ошибка расшифровки: " + String(e));
  }
});

document.getElementById("btn-copy-decrypted")?.addEventListener("click", async () => {
  const text = (document.getElementById("decrypted-text") as HTMLTextAreaElement)?.value;
  if (text) {
    await navigator.clipboard.writeText(text);
    setStatus("Расшифрованный текст скопирован");
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

let currentImageElement: HTMLImageElement | null = null;

function setupRegionSelector() {
  const overlay = document.getElementById("region-overlay");
  const wrapper = document.getElementById("scan-image-wrapper");
  const selectBtn = document.getElementById("btn-select-region");

  if (!overlay || !wrapper || !selectBtn) return;

  selectBtn.addEventListener("click", () => {
    regionSelectActive = !regionSelectActive;
    if (regionSelectActive) {
      overlay.classList.remove("hidden");
      selectBtn.textContent = "Отменить выделение";
      selectBtn.classList.add("active-region");
      setStatus("Обведите область на изображении");
    } else {
      overlay.classList.add("hidden");
      selectBtn.textContent = "Выделить область";
      selectBtn.classList.remove("active-region");
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
    selectBtn.classList.remove("active-region");

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

  overlay.addEventListener("mouseleave", () => {
    if (regionSelectActive && regionRect) {
      const w = parseFloat(regionRect.style.width);
      const h = parseFloat(regionRect.style.height);
      if (w < 10 && h < 10) {
        regionRect.remove();
        regionRect = null;
      }
    }
  });
}

function showRegionButton() {
  const btn = document.getElementById("btn-select-region");
  if (btn) btn.classList.remove("hidden");
}

setupRegionSelector();

detectPlatform();
