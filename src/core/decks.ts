/**
 * Показы ведущего (решение владельца 15 октября 2026): фото и страницы PDF на весь экран зала с пульта, листать ‹ ›.
 * Готовит устройство ведущего: фото — WebP до 1920 px, PDF — каждая страница картинкой (pdf.js); сервер файлы не
 * перекодирует. Общие правила для сервера и браузера.
 */
import type { Deck, DeckPage, SlideMedia } from "../data/types";

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

/**
 * Страницы из данных: только понятные, не больше лимита. `size` из запроса браузера — только подсказка: сервер при
 * сохранении показа ставит настоящий размер файла с диска (QA 22 октября 2026), лимит места считается по нему.
 */
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

/** Как часто пульт перечитывает список показов, если на экране показ, которого в нём нет. */
export const DECK_RELOAD_MS = 10_000;

/**
 * Нужно ли перечитать список показов (QA 22 октября 2026, M9): на экране страница показа, которого в списке нет
 * (его загрузили с другого пульта), или в списке у него меньше страниц, чем на экране (дозагрузили с другого пульта).
 */
export function needsDeckReload(decks: readonly Deck[] | null, media: SlideMedia | null | undefined): boolean {
  if (!decks || !media) return false;
  const deck = decks.find((d) => d.id === media.deck);
  return !deck || deck.pages.length < media.count;
}

/** Какая страница на экране — для «уже перечитывали, не нашли». */
export function deckReloadKey(media: SlideMedia): string {
  return `${media.deck}:${media.page}:${media.count}`;
}

/**
 * Перечитывать ли список ещё раз (третья проверка QA 22 октября 2026): список уже перечитали, а этой страницы в нём так и
 * нет (показ удалили, или он чужой) — больше не перечитываем каждые 10 с, ждём смены показа или страницы на экране.
 * `tried` — страницы (`deckReloadKey`), для которых перечитанный список пришёл без них.
 */
export function shouldReloadDecks(decks: readonly Deck[] | null, media: SlideMedia | null | undefined, tried: ReadonlySet<string>): boolean {
  return needsDeckReload(decks, media) && !!media && !tried.has(deckReloadKey(media));
}
