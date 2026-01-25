import { resolveImageUrl } from "./r2Service";

export type InlineImageData = {
  mimeType: string;
  data: string; // base64 (no header)
};

export function isDataUrl(value: string): boolean {
  return /^data:/i.test(value);
}

export function isProbablyHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isProbablyBlobUrl(value: string): boolean {
  return /^blob:/i.test(value);
}

export function parseBase64DataUrl(value: string): InlineImageData {
  const commaIdx = value.indexOf(",");
  if (commaIdx === -1) throw new Error("Invalid data URL: missing comma");

  const header = value.slice(0, commaIdx);
  const data = value.slice(commaIdx + 1);

  const isBase64 = /;base64/i.test(header);
  if (!isBase64) {
    throw new Error("Unsupported data URL: expected base64 encoding");
  }

  const mimeMatch = header.match(/^data:([^;]+)/i);
  const mimeType = mimeMatch?.[1] || "application/octet-stream";

  if (!data) throw new Error("Invalid data URL: empty payload");
  return { mimeType, data };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function fetchImageBlob(
  imageRef: string,
): Promise<{ blob: Blob; mimeType: string }> {
  if (!imageRef) throw new Error("Empty image reference");

  // If it's a data URL, we can fetch it directly (browser supports fetch(data:...)).
  const url = resolveImageUrl(imageRef) || imageRef;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status})`);
  }

  const blob = await res.blob();
  const headerType = res.headers.get("Content-Type") || "";
  const mimeType = (headerType || blob.type || "image/jpeg").split(";")[0];

  return { blob, mimeType };
}

export async function imageRefToBlob(imageRef: string): Promise<Blob> {
  // Data URL -> decode locally to avoid fetch overhead and CORS surprises
  if (isDataUrl(imageRef)) {
    const { mimeType, data } = parseBase64DataUrl(imageRef);
    const binaryString = atob(data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }

  const { blob } = await fetchImageBlob(imageRef);
  return blob;
}

export async function imageRefToInlineImageData(
  imageRef: string,
): Promise<InlineImageData> {
  // If already a base64 data URL, keep it (fast path)
  if (isDataUrl(imageRef)) {
    return parseBase64DataUrl(imageRef);
  }

  const { blob, mimeType } = await fetchImageBlob(imageRef);
  const buffer = await blob.arrayBuffer();
  const data = arrayBufferToBase64(buffer);
  return { mimeType, data };
}

