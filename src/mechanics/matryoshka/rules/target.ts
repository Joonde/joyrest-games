/**
 * Цель «сколько останется», финалисты, порядок вылета, кто теряет сердечко, отсечка «Добивки» — чистые функции
 * (docs/matryoshka.md, «Сердечки и вылет»).
 */
import { FINALISTS_MIN } from "./constants";

/** Финалистов в игре: из настройки, но не больше половины зала на «Начать» и не меньше 2 (L22). */
export function finalistsFor(setting: number, startCount: number): number {
  return Math.max(FINALISTS_MIN, Math.min(setting, Math.floor(startCount / 2)));
}

/**
 * Сколько должно остаться после испытания: `max(F, ⌈A · (F ÷ A)^(1/k)⌉)`; `A ≤ F` или `k ≤ 0` — на посев (остаются все).
 * `k` — испытаний на вылет от текущего до последнего включительно.
 */
export function targetOf(A: number, F: number, k: number): number {
  if (A <= F || k <= 0) return A;
  const r = (F / A) ** (1 / k);
  return Math.min(A, Math.max(F, Math.ceil(A * r - 1e-9)));
}

/** Ключ сортировки: больше — лучше. Сравнение по ключам по порядку, потом жребий (меньше — выше). */
export type RankKey = number[];

/** Порядок лучший → худший: по ключам (больше — лучше), потом по жребию (меньше — выше). */
export function rankOrder(pids: readonly string[], key: (pid: string) => RankKey, lot: (pid: string) => number): string[] {
  const keys = new Map(pids.map((p) => [p, key(p)]));
  return [...pids].sort((a, b) => {
    const ka = keys.get(a) ?? [];
    const kb = keys.get(b) ?? [];
    for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
      const d = (kb[i] ?? 0) - (ka[i] ?? 0);
      if (d !== 0) return d;
    }
    return lot(a) - lot(b);
  });
}

/**
 * Кто теряет сердечко: последние `need` по порядку среди тех, кто «может проиграть» (`eligible`). Ответ — худший первым.
 * Может проиграть меньше `need` — недобор (переносится).
 */
export function losersOf(order: readonly string[], eligible: (pid: string) => boolean, need: number): string[] {
  const out: string[] = [];
  for (let i = order.length - 1; i >= 0 && out.length < need; i -= 1) {
    const pid = order[i] as string;
    if (eligible(pid)) out.push(pid);
  }
  return out;
}

/**
 * «Добивка»: кто выбывает. Упавшие — по порядку «упал раньше → меньше сердечек → больше сумма мест → меньше монет → жребий»
 * (худший первым), ровно `need`; упавших меньше — все упавшие и ещё не упавшие по «сердечки → сумма мест → монеты → жребий».
 */
export function dobivkaOut(
  alive: readonly string[],
  fallenRow: (pid: string) => number | null,
  info: (pid: string) => { hearts: number; placeSum: number; coins: number; lot: number },
  need: number,
): string[] {
  if (need <= 0) return [];
  const worse = (a: string, b: string): number => {
    const ia = info(a);
    const ib = info(b);
    return ia.hearts - ib.hearts || ib.placeSum - ia.placeSum || ia.coins - ib.coins || ib.lot - ia.lot;
  };
  const fallen = alive.filter((p) => fallenRow(p) !== null);
  // Худший первым: раньше упал (меньший номер ряда) — хуже.
  fallen.sort((a, b) => (fallenRow(a) ?? 0) - (fallenRow(b) ?? 0) || worse(a, b));
  if (fallen.length >= need) return fallen.slice(0, need);
  const rest = alive.filter((p) => fallenRow(p) === null).sort(worse);
  return [...fallen, ...rest.slice(0, need - fallen.length)];
}

/** Порядок прогнозов: самый близкий (все одинаково близкие) — `best`, остальные в пределах 10% (не меньше 1) — `near`. */
export function scoreGuesses(guesses: Readonly<Record<string, number>>, answer: number, share: number): { best: string[]; near: string[] } {
  const entries = Object.entries(guesses);
  if (entries.length === 0) return { best: [], near: [] };
  const diff = (n: number) => Math.abs(n - answer);
  const min = Math.min(...entries.map(([, n]) => diff(n)));
  const tol = Math.max(1, Math.ceil(share * answer));
  const best = entries.filter(([, n]) => diff(n) === min).map(([p]) => p);
  const near = entries.filter(([, n]) => diff(n) !== min && diff(n) <= tol).map(([p]) => p);
  return { best: best.sort(), near: near.sort() };
}
