/**
 * Показы ведущего (решение владельца 15 октября 2026): фото и страницы PDF на весь экран зала с пульта, листать ‹ ›.
 * Готовит устройство ведущего: фото — WebP до 1920 px, PDF — каждая страница картинкой (pdf.js); сервер файлы не
 * перекодирует. Общие правила для сервера и браузера.
 */
import type { DeckPage } from "../data/types";

export const DECK_LIMITS = {
  title: 80,
  pages: 60,
  decks: 30,
  /** Файл страницы (WebP/JPEG, до 1920 px). */
  pageBytes: 900 * 1024,
  side: 1920,
  /** Всего на ведущего. */
  totalBytes: 500 * 1024 * 1024,
} as const;

const SHA = /^[0-9a-f]{64}$/;

/** Страницы из данных: только понятные, не больше лимита. */
export function parseDeckPages(raw: unknown): DeckPage[] {
  if (!Array.isArray(raw)) return [];
  const int = (n: unknown, max: number) => (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= max ? n : null);
  const pages: DeckPage[] = [];
  for (const p of raw) {
    if (typeof p !== "object" || p === null) continue;
    const v = p as Record<string, unknown>;
    const w = int(v.w, 10_000);
    const h = int(v.h, 10_000);
    const size = int(v.size, DECK_LIMITS.pageBytes);
    if (typeof v.sha !== "string" || !SHA.test(v.sha) || w === null || h === null || size === null) continue;
    pages.push({ sha: v.sha, w, h, size });
    if (pages.length === DECK_LIMITS.pages) break;
  }
  return pages;
}

/** Название показа: без управляющих символов и лишних пробелов. */
export function cleanDeckTitle(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, DECK_LIMITS.title) : "";
}

/** Название по имени файла: «Меню банкета.pdf» → «Меню банкета». */
export function titleFromFile(name: string): string {
  return cleanDeckTitle(name.replace(/\.[A-Za-z0-9]{2,5}$/, "").replace(/[_]+/g, " ")) || "Показ";
}
