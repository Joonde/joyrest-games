// Жеребьёвка «кто ходит первым» (решение владельца 11 октября 2026): ведущий нажимает «Жеребьёвка» на
// пульте — среди подключившихся участников пульт тянет жребий, на экране зала монетка перебирает имена,
// замедляется и останавливается на победителе. Это слайд `draw` поверх игры: title — победитель, text —
// все участники через перевод строки, endsAt — когда монетка остановится (по часам сервера). Механика
// может сделать победителя первым ходящим (`Mechanic.firstTurn`, «Ставка на знания» — право выбора клетки).
import type { SlideState } from "../data/types";

/** Сколько крутится монетка, мс. */
export const DRAW_MS = 5200;

/** Жребий: случайный участник (crypto, если есть). */
export function drawWinner<T>(pool: T[], random: () => number = cryptoRandom): T | null {
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? null;
}

function cryptoRandom(): number {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
  return Math.random();
}

/**
 * Подписи монетки (в `lines` слайда): пока крутится — надзаголовок и строка под монеткой, после — надзаголовок и
 * строка под именем. Без подписей — жеребьёвка «кто ходит первым».
 */
export interface DrawCaptions {
  spinEyebrow: string;
  spinText: string;
  doneEyebrow: string;
  doneText: string;
}

/** Слайд жеребьёвки; `serverNow` — часы сервера на пульте. */
export function drawSlide(id: string, names: string[], winner: string, serverNow: number, captions?: DrawCaptions): SlideState {
  const list = names.map((n) => n.replace(/\n/g, " ").trim()).filter(Boolean);
  // Текст слайда ограничен — длинный список обрезаем, победитель всегда в списке (и в заголовке).
  const lines: string[] = [];
  let size = 0;
  for (const n of [winner, ...list.filter((x) => x !== winner)]) {
    if (size + n.length + 1 > 390) break;
    lines.push(n);
    size += n.length + 1;
  }
  const caps = captions ? [captions.spinEyebrow, captions.spinText, captions.doneEyebrow, captions.doneText].map((c) => c.replace(/\n/g, " ").slice(0, 140) || " ") : [];
  return { id, kind: "draw", title: winner.slice(0, 120), text: lines.join("\n"), lines: caps, endsAt: serverNow + DRAW_MS };
}

/** Подписи слайда жеребьёвки (свои — у «Аукциона», иначе «кто ходит первым»). */
export function drawCaptionsOf(slide: Pick<SlideState, "lines">): DrawCaptions {
  const [a, b, c, d] = slide.lines.map((l) => l.trim());
  if (a && b && c && d) return { spinEyebrow: a, spinText: b, doneEyebrow: c, doneText: d };
  return { spinEyebrow: "Жеребьёвка", spinText: "Монетка решит, кто начинает", doneEyebrow: "Первым ходит", doneText: "" };
}

/** Все, между кем жребий (по алфавиту — порядок не выдаёт победителя). */
export function drawPool(slide: Pick<SlideState, "title" | "text">): string[] {
  const names = slide.text.split("\n").map((n) => n.trim()).filter(Boolean);
  return (names.length ? names : [slide.title]).slice().sort((x, y) => x.localeCompare(y, "ru"));
}

/** Имена на монетке по порядку (победитель — не первым, чтобы не выдать заранее). */
export function drawNames(slide: Pick<SlideState, "title" | "text">): string[] {
  const names = slide.text.split("\n").map((n) => n.trim()).filter(Boolean);
  if (names.length <= 1) return names.length ? names : [slide.title];
  return [...names.slice(1), names[0] as string];
}

/**
 * Какое имя на монетке в момент `left` мс до остановки: смена всё реже (раз в 70 мс → раз в ~600 мс),
 * последним выпадает победитель. Номер смены детерминирован — все экраны крутят одинаково.
 */
export function drawFrame(names: string[], left: number): { index: number; flips: number } {
  const n = Math.max(1, names.length);
  if (left <= 0) return { index: n - 1, flips: totalFlips() };
  const passed = DRAW_MS - Math.min(DRAW_MS, left);
  let t = 0;
  let flips = 0;
  while (true) {
    const step = 70 + 530 * (t / DRAW_MS) ** 2;
    if (t + step > passed) break;
    t += step;
    flips++;
  }
  const total = totalFlips();
  // Последняя смена — на победителя: считаем от конца.
  const index = (((n - 1 - (total - flips)) % n) + n) % n;
  return { index, flips };
}

let cachedTotal = 0;
function totalFlips(): number {
  if (cachedTotal) return cachedTotal;
  let t = 0;
  let flips = 0;
  while (true) {
    const step = 70 + 530 * (t / DRAW_MS) ** 2;
    if (t + step > DRAW_MS) break;
    t += step;
    flips++;
  }
  cachedTotal = flips;
  return flips;
}
