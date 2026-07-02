const MAGIC = "QRTOOL";
const VERSION = 1;

export function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const header = new Uint8Array(8);
  header[0] = 0x51; // Q
  header[1] = 0x52; // R
  header[2] = 0x54; // T
  header[3] = 0x4F; // O
  header[4] = 0x4F; // O
  header[5] = 0x4C; // L
  header[6] = VERSION;
  header[7] = bytes.length >> 8;
  header[8] = bytes.length & 0xff;
  const combined = new Uint8Array(9 + bytes.length);
  combined.set(header.subarray(0, 9), 0);
  combined.set(bytes, 9);
  return bytesToBase64(combined);
}

export function decode(data: string): string | null {
  try {
    const raw = base64ToBytes(data);
    if (raw.length < 9) return null;
    if (raw[0] !== 0x51 || raw[1] !== 0x52 || raw[2] !== 0x54 || raw[3] !== 0x4F || raw[4] !== 0x4F || raw[5] !== 0x4C) return null;
    const version = raw[6];
    if (version > VERSION) return null;
    const len = (raw[7] << 8) | raw[8];
    if (9 + len > raw.length) return null;
    return new TextDecoder().decode(raw.slice(9, 9 + len));
  } catch {
    return null;
  }
}

export function isOwnFormat(data: string): boolean {
  try {
    const raw = base64ToBytes(data);
    return raw.length >= 9 && raw[0] === 0x51 && raw[1] === 0x52 && raw[2] === 0x54 && raw[3] === 0x4F && raw[4] === 0x4F && raw[5] === 0x4C;
  } catch {
    return false;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function generateQRDataURL(text: string, size = 400): Promise<string> {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
