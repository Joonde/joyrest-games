import { FULL_IMAGE, fitSize, QUALITY_STEPS, SMALL_IMAGE } from "../../core/image";
import type { MediaUpload } from "../../data";

export class ImageError extends Error {}

type Source = ImageBitmap | HTMLImageElement;

/** Фото с телефона: поворот по EXIF учитывается. */
async function decode(file: Blob): Promise<Source> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Старый Safari не знает параметров — пробуем через <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sourceSize(source: Source): { width: number; height: number } {
  return source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

let webpSupport: boolean | null = null;

/** Safari на iPhone не умеет кодировать WebP — тогда сохраняем JPEG. */
async function encodeType(): Promise<string> {
  if (webpSupport === null) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const blob = await toBlob(canvas, "image/webp", 0.8);
    webpSupport = blob?.type === "image/webp";
  }
  return webpSupport ? "image/webp" : "image/jpeg";
}

function draw(source: Source, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("Браузер не смог обработать картинку.");
  // Прозрачный PNG в JPEG стал бы чёрным: подкладываем светлый фон.
  ctx.fillStyle = "#FBF6F1";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Подбирает качество (и при необходимости размер), пока картинка не станет легче цели. */
async function encode(
  source: Source,
  limits: { maxSide: number; targetBytes: number; maxBytes: number },
): Promise<{ blob: Blob; width: number; height: number }> {
  const type = await encodeType();
  const original = sourceSize(source);
  let size = fitSize(original.width, original.height, limits.maxSide);
  let best: { blob: Blob; width: number; height: number } | null = null;
  for (let round = 0; round < 4; round++) {
    const canvas = draw(source, size.width, size.height);
    for (const quality of QUALITY_STEPS) {
      const blob = await toBlob(canvas, type, quality);
      if (!blob) continue;
      if (!best || blob.size < best.blob.size) best = { blob, ...size };
      if (blob.size <= limits.targetBytes) return { blob, ...size };
    }
    // Даже на низком качестве тяжело (мелкие детали) — уменьшаем на 20%.
    size = fitSize(size.width, size.height, Math.round(Math.max(size.width, size.height) * 0.8));
  }
  if (!best || best.blob.size > limits.maxBytes) throw new ImageError("Картинка слишком сложная — выберите другую.");
  return best;
}

/**
 * Сжимает картинку на устройстве: полная — WebP до 1280 px и ~150 КБ для экрана зала,
 * уменьшенная — до 480 px для телефонов гостей в режиме «без экрана».
 */
export async function compressImage(file: File): Promise<MediaUpload> {
  if (!file.type.startsWith("image/")) throw new ImageError("Это не картинка. Выберите фото или рисунок.");
  let source: Source;
  try {
    source = await decode(file);
  } catch {
    throw new ImageError("Не получилось открыть картинку. Попробуйте JPEG или PNG.");
  }
  try {
    const full = await encode(source, FULL_IMAGE);
    const small = await encode(source, SMALL_IMAGE);
    return { full: full.blob, small: small.blob, width: full.width, height: full.height };
  } finally {
    if (!(source instanceof HTMLImageElement)) source.close();
  }
}
