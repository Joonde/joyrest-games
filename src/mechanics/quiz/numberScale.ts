// Подписи на шкале «Угадай число» (экран зала): точка — у каждого ответа, подпись с именем — только у лучших,
// и только там, где она ни на кого не наезжает. Много игроков — подписей меньше, чтобы на экране не было каши.

export interface ScaleGuess {
  pid: string;
  /** Место ответа на шкале, 0…1. */
  at: number;
  /** Место по близости (1 — ближе всех). */
  place: number;
}

export interface ScaleLabel {
  pid: string;
  /** Где стоит подпись: 0…1, отодвинута от краёв, чтобы не уходила за экран. */
  at: number;
  /** Ряд подписи над шкалой: 0 — нижний. */
  row: number;
}

/** Сколько подписей с именами: до 10 игроков — 6, больше — 3 (остальные — точками на шкале). */
export function scaleLabelLimit(players: number): number {
  return players > 10 ? 3 : 6;
}

/** Рядов подписей над шкалой. */
export const SCALE_ROWS = 3;
/** Подписи в одном ряду не ближе этой доли ширины шкалы — иначе наезжают друг на друга. */
export const SCALE_GAP = 0.27;
/** Подпись не ближе к краю шкалы: она стоит серединой на своём числе. */
export const SCALE_EDGE = 0.1;

/** Подписи лучших ответов: по местам, каждая — в нижний свободный ряд; не нашлось места — без подписи (точка остаётся). */
export function scaleLabels(guesses: ScaleGuess[], players = guesses.length): ScaleLabel[] {
  const limit = scaleLabelLimit(players);
  const best = [...guesses].sort((a, b) => a.place - b.place || a.at - b.at);
  const rows: number[][] = Array.from({ length: SCALE_ROWS }, () => []);
  const labels: ScaleLabel[] = [];
  for (const g of best) {
    if (labels.length >= limit) break;
    const at = Math.min(1 - SCALE_EDGE, Math.max(SCALE_EDGE, g.at));
    const row = rows.findIndex((taken) => taken.every((x) => Math.abs(x - at) >= SCALE_GAP));
    if (row < 0) continue;
    rows[row]?.push(at);
    labels.push({ pid: g.pid, at, row });
  }
  return labels;
}
