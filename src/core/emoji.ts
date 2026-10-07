/**
 * Смайлик к имени игрока или команды (CLAUDE.md, раздел 4): хранится в начале имени —
 * «🦊 Аня», поэтому виден везде, где есть имя (экран зала, таблица, пульт, итоги), без
 * изменения базы. Набор — простые одиночные символы без модификаторов: одинаково
 * выглядят на телефонах и телевизорах.
 */
import { NAME_MAX_LENGTH } from "./names";

export const EMOJIS = [
  "🦊", "🐻", "🐼", "🐯", "🦁", "🐸", "🐙", "🦄",
  "🐝", "🦋", "🐧", "🐢", "🌟", "🔥", "🚀", "🎉",
  "🎈", "🎯", "🎸", "🍕", "🍩", "🍓", "🌈", "👑",
] as const;

/** Случайный смайлик — по умолчанию, чтобы в зале было разнообразно. */
export function randomEmoji(random: () => number = Math.random): string {
  return EMOJIS[Math.floor(random() * EMOJIS.length) % EMOJIS.length] ?? EMOJIS[0];
}

/** «🦊 Аня»; имя укорачивается, чтобы вместе со смайликом влезть в NAME_MAX_LENGTH. */
export function withEmoji(emoji: string | null, name: string): string {
  if (!emoji) return name.slice(0, NAME_MAX_LENGTH);
  const room = NAME_MAX_LENGTH - emoji.length - 1;
  return `${emoji} ${name.slice(0, room).trim()}`;
}

/** Обратно: смайлик из набора в начале имени и само имя (для повторного входа). */
export function splitEmoji(full: string): { emoji: string | null; name: string } {
  for (const emoji of EMOJIS) {
    if (full.startsWith(`${emoji} `)) return { emoji, name: full.slice(emoji.length + 1) };
  }
  return { emoji: null, name: full };
}
