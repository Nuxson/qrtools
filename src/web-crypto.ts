const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function generateKey() {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(keyBytes);
}

async function importKey(b64) {
  const raw = base64ToBytes(b64);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(keyB64, plaintext) {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return bytesToBase64(combined);
}

export async function decrypt(keyB64, ciphertext) {
  const key = await importKey(keyB64);
  const data = base64ToBytes(ciphertext);
  if (data.length < 12) throw new Error("Ciphertext too short");
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return decoder.decode(pt);
}

export async function generateQRDataURL(text, size = 400) {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    color: { dark: "#1a1b26", light: "#ffffff" },
  });
}

export async function scanFromDataURL(dataURL) {
  const { Html5Qrcode } = await import("html5-qrcode");
  return new Promise((resolve, reject) => {
    const scanner = new Html5Qrcode("scan-temp-container");
    scanner
      .scanFile(dataURL, true)
      .then((decoded) => {
        scanner.clear();
        resolve(decoded);
      })
      .catch((err) => {
        scanner.clear();
        reject(err);
      });
  });
}
