/**
 * Логотип заказчика на устройстве ведущего: уменьшаем до 800 px с сохранением прозрачности (WebP, где браузер не умеет —
 * PNG), чтобы файл был ≤ 600 КБ; и подсказываем фирменные цвета — два самых заметных насыщенных цвета логотипа.
 */
import { BRANDING_LIMITS } from "../../core/branding";
import { ImageError } from "./compressImage";

async function load(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // SVG и старый Safari — через <img>.
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
    // Картинка уже декодирована — ссылка больше не нужна.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function draw(source: ImageBitmap | HTMLImageElement, side: number): HTMLCanvasElement {
  const w = source.width || 512;
  const h = source.height || 512;
  const scale = Math.min(1, side / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Цвет #RRGGBB из каналов. */
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** Два самых частых заметных цвета (без прозрачного, белого, чёрного и серого); нет таких — пусто. */
export function dominantColors(data: Uint8ClampedArray): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += 16) {
    const [r, g, b, a] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 40 || max < 40) continue; // серое, белое, чёрное
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    buckets.set(key, { n: cur.n + 1, r: cur.r + r, g: cur.g + g, b: cur.b + b });
  }
  const top = [...buckets.values()].sort((x, y) => y.n - x.n).map((c) => [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)] as const);
  const result: Array<readonly [number, number, number]> = [];
  for (const c of top) {
    // Второй цвет — заметно другой, не оттенок первого.
    if (result.every((x) => Math.abs(x[0] - c[0]) + Math.abs(x[1] - c[1]) + Math.abs(x[2] - c[2]) > 90)) result.push(c);
    if (result.length === 2) break;
  }
  return result.map(([r, g, b]) => hex(r, g, b));
}

/** Готовый логотип и подсказка цветов. */
export async function prepareLogo(file: File): Promise<{ blob: Blob; colors: string[] }> {
  if (!file.type.startsWith("image/")) throw new ImageError("Это не картинка. Выберите логотип: PNG, JPEG, WebP или SVG.");
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await load(file);
  } catch {
    throw new ImageError("Не получилось открыть картинку. Попробуйте PNG или JPEG.");
  }
  try {
    let colors: string[] = [];
    for (const side of [BRANDING_LIMITS.logoSide, 600, 400]) {
      const canvas = draw(source, side);
      if (colors.length === 0) {
        try {
          colors = dominantColors(canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray());
        } catch {
          colors = [];
        }
      }
      // WebP хранит прозрачность и легче; Safari без WebP отдаёт PNG.
      let blob = await blobOf(canvas, "image/webp", 0.9);
      if (!blob || blob.type !== "image/webp") blob = await blobOf(canvas, "image/png");
      if (blob && blob.size <= BRANDING_LIMITS.logoBytes) return { blob, colors };
    }
    throw new ImageError("Логотип слишком тяжёлый. Сохраните его поменьше (PNG до 1 МБ) и попробуйте снова.");
  } finally {
    if (!(source instanceof HTMLImageElement)) source.close();
  }
}
