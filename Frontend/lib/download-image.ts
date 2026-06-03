/** Trigger a browser download for an image URL (data URL or remote). */
export async function downloadImageAsPng(
  url: string,
  filename: string,
): Promise<void> {
  if (!url) throw new Error("Missing image URL");

  const safeName = sanitizePngFilename(filename);

  let blob: Blob;
  if (url.startsWith("data:")) {
    const res = await fetch(url);
    blob = await res.blob();
  } else {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
    blob = await res.blob();
  }

  const type = blob.type.startsWith("image/") ? blob.type : "image/png";
  const file = type === blob.type ? blob : new Blob([blob], { type: "image/png" });

  const objectUrl = URL.createObjectURL(file);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = safeName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function sanitizePngFilename(name: string, fallback = "design"): string {
  const base = (name || fallback).replace(/[\\/:*?"<>|]/g, "_").replace(/\.[^.]+$/i, "");
  return `${base || fallback}.png`;
}

export function sanitizeDownloadBasename(name: string, fallback = "logo"): string {
  return (name || fallback).replace(/[\\/:*?"<>|]/g, "_").replace(/\.[^.]+$/i, "") || fallback;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

export async function drawImageToCanvas(
  url: string,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  const img = await loadImageElement(url);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/** Build a single-size Windows ICO (32-bit BGRA) from a square canvas. */
export function canvasToIcoBlob(canvas: HTMLCanvasElement): Blob {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  const { data } = ctx.getImageData(0, 0, w, h);

  const dibHeaderSize = 40;
  const xorSize = w * h * 4;
  const andRowBytes = Math.ceil(w / 32) * 4;
  const andSize = andRowBytes * h;
  const imageSize = dibHeaderSize + xorSize + andSize;
  const headerSize = 6 + 16;
  const total = headerSize + imageSize;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);

  view.setUint8(6, w >= 256 ? 0 : w);
  view.setUint8(7, h >= 256 ? 0 : h);
  view.setUint16(10, 1, true);
  view.setUint16(12, 32, true);
  view.setUint32(14, imageSize, true);
  view.setUint32(18, headerSize, true);

  let offset = headerSize;
  view.setUint32(offset + 0, dibHeaderSize, true);
  view.setUint32(offset + 4, w, true);
  view.setUint32(offset + 8, h * 2, true);
  view.setUint16(offset + 12, 1, true);
  view.setUint16(offset + 14, 32, true);
  view.setUint32(offset + 20, xorSize + andSize, true);
  offset += dibHeaderSize;

  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[offset++] = data[i + 2];
      buf[offset++] = data[i + 1];
      buf[offset++] = data[i];
      buf[offset++] = data[i + 3];
    }
  }
  return new Blob([buf], { type: "image/x-icon" });
}

/** Favicon export: `.ico` (binary) or `.fav` (32px PNG, common in design tools). */
export async function downloadImageAsFavicon(
  url: string,
  basename: string,
  format: "ico" | "fav",
  size = 32,
): Promise<void> {
  const safeBase = sanitizeDownloadBasename(basename, "logo");
  const canvas = await drawImageToCanvas(url, size, size);

  if (format === "ico") {
    triggerBlobDownload(canvasToIcoBlob(canvas), `${safeBase}.ico`);
    return;
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode favicon"))), "image/png");
  });
  triggerBlobDownload(blob, `${safeBase}.fav`);
}
