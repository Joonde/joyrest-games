/**
 * Страницы показа на устройстве ведущего (`src/core/decks.ts`): фото — WebP до 1920 px (~700 КБ), PDF — каждая страница
 * картинкой через pdf.js (грузится только здесь, отдельным чанком). На сервер уходят только готовые картинки.
 */
import { DECK_LIMITS } from "../../core/decks";
import { ImageError, shrinkImage } from "./compressImage";

export interface PreparedPage {
  blob: Blob;
  w: number;
  h: number;
}

const LIMITS = { maxSide: DECK_LIMITS.side, targetBytes: 700 * 1024, maxBytes: DECK_LIMITS.pageBytes - 20 * 1024 };

async function sizeOf(blob: Blob): Promise<{ w: number; h: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { w: 1920, h: 1080 };
  }
}

export const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** Страницы PDF по одной (pdf.js), каждая — картинкой до 1920 px по длинной стороне. */
async function* pdfPages(file: File, maxPages: number): AsyncGenerator<PreparedPage> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch {
    throw new ImageError("Не получилось открыть PDF. Проверьте файл (без пароля) и попробуйте снова.");
  }
  try {
    const count = Math.min(doc.numPages, maxPages);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = DECK_LIMITS.side / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ImageError("Браузер не смог нарисовать страницу PDF.");
      // Белый лист под прозрачными страницами.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport } as Parameters<typeof page.render>[0]).promise;
      page.cleanup();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
      const file = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!file) throw new ImageError("Не получилось сохранить страницу PDF.");
      // Тяжёлая страница (фото на весь лист) — дожимаем как фото.
      const ready = file.size > LIMITS.maxBytes ? await shrinkImage(new File([file], `p${n}.jpg`, { type: file.type }), LIMITS) : file;
      yield { blob: ready, w: canvas.width, h: canvas.height };
    }
  } finally {
    void doc.destroy();
  }
}

/**
 * Файлы ведущего по порядку → готовые страницы. `room` — сколько страниц ещё помещается в показ.
 * `onPage` вызывается на каждую готовую страницу (её сразу можно отправлять на сервер).
 */
export async function prepareDeckFiles(files: File[], room: number, onPage: (page: PreparedPage, label: string) => Promise<void>): Promise<number> {
  let made = 0;
  for (const file of files) {
    if (made >= room) break;
    if (isPdf(file)) {
      for await (const page of pdfPages(file, room - made)) {
        made += 1;
        await onPage(page, `${file.name}: страница ${made}`);
      }
    } else {
      const blob = await shrinkImage(file, LIMITS);
      made += 1;
      await onPage({ blob, ...(await sizeOf(blob)) }, file.name);
    }
  }
  return made;
}
