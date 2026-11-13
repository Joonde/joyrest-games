/**
 * Загрузка чанка телефона с повтором (аудит 2b, круг 2, №2): обрыв сети на телефоне гостя — норма. Браузер запоминает
 * неудачный import() по адресу и второй раз его не скачивает, поэтому повтор идёт по тому же адресу с меткой `?retry=N`
 * (адрес — из текста ошибки: Chrome и Firefox его пишут). Адреса нет (Safari) — повтор тем же import(), а «Повторить» на
 * экране перезагружает страницу.
 */
export const CHUNK_TRIES = 3;
export const CHUNK_PAUSE_MS = 1500;

/** Адрес чанка из ошибки import(): «Failed to fetch dynamically imported module: https://…/PlayerView-1a2b.js». */
export function chunkUrlOf(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  const m = text.match(/(https?:\/\/[^\s"'<>]+?\.m?js)(?:\?[^\s"'<>]*)?(?=$|[\s"'<>])/);
  return m?.[1] ?? null;
}

export interface ChunkLoad<T> {
  /** Первый import() (как его переписал сборщик). */
  load: () => Promise<T>;
  /** import() по адресу с меткой — повтор мимо запомненной браузером неудачи. */
  again: (url: string, n: number) => Promise<T>;
}

export async function importWithRetry<T>(
  chunk: ChunkLoad<T>,
  state: { url: string | null; n: number },
  tries = CHUNK_TRIES,
  pauseMs = CHUNK_PAUSE_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      if (state.url === null) return await chunk.load();
      state.n += 1;
      return await chunk.again(state.url, state.n);
    } catch (error) {
      last = error;
      state.url ??= chunkUrlOf(error);
      if (i < tries - 1) await sleep(pauseMs * (i + 1));
    }
  }
  throw last instanceof Error ? last : new Error("чанк не загрузился");
}
