/** Чистые помощники переноса из Firebase (importer.ts): пачки и список картинок. */
import type { Game } from "./types";

/** Картинки игры по её механике (реестр механик подставляет экран). */
export type MediaIdsOf = (mechanic: string, content: unknown) => string[];

/** Пачки не больше `max` штук и примерно `maxBytes` JSON (игры бывают крупными). */
export function chunks<T>(items: T[], max: number, maxBytes = Infinity): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const itemSize = maxBytes === Infinity ? 0 : JSON.stringify(item).length;
    if (current.length > 0 && (current.length >= max || size + itemSize > maxBytes)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) out.push(current);
  return out;
}

export interface MediaRef {
  game: string;
  media: string;
}

/** Картинки всех игр без повторов. Сломанная игра не мешает остальным. */
export function mediaRefs(games: Game[], mediaIdsOf: MediaIdsOf): MediaRef[] {
  const seen = new Set<string>();
  const refs: MediaRef[] = [];
  for (const game of games) {
    let ids: string[] = [];
    try {
      ids = mediaIdsOf(game.mechanic, game.content);
    } catch {
      ids = [];
    }
    for (const media of ids) {
      const key = `${game.id}/${media}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ game: game.id, media });
    }
  }
  return refs;
}

