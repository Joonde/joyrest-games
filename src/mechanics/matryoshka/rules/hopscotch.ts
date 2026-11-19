/**
 * «Классики» и «Добивка» (docs/matryoshka.md, «5. Классики», «Добивка»): ряды изо льда, одна клетка крепкая (тайна до
 * `crack`), смельчаки по реакции телефона (L19), остальные видят, **куда** прыгнули смельчаки, но не чем кончилось (решение
 * владельца 10), клетка не выбрана — по жребию, упавшие дальше не прыгают.
 */
import { BRAVE_COINS, BRAVE_MIN_RT, BRAVES, BRAVE_SETTLE_MS } from "./constants";
import type { DobRow, HopRow, HopState, Side } from "./types";

export function solidOf(rand: () => number): Side {
  return rand() < 0.5 ? "L" : "R";
}

export function newHopRow(rand: () => number, t: number, jumpers: string[], braveMs: number): HopRow {
  return { solid: solidOf(rand), braveAt: t, braveEnds: t + braveMs, braveTaps: {}, braves: null, jumpEnds: null, chooseAt: null, chooseEnds: null, crackEnds: null, picks: {}, auto: [], fell: null, jumpers };
}

export function hopStart(rand: () => number, t: number, pids: string[], braveMs: number): HopState {
  return { kind: "hopscotch", row: 0, rows: [newHopRow(rand, t, pids, braveMs)], fallen: {}, stop: false, over: false };
}

export type HopSub = "brave" | "jump" | "choose" | "crack" | "over";

export function hopSub(st: HopState, t: number): HopSub {
  const r = st.rows[st.row];
  if (st.over || !r) return "over";
  if (r.braves === null) return "brave";
  if (r.jumpEnds !== null && t < r.jumpEnds) return "jump";
  if (r.fell === null) return "choose";
  return "crack";
}

/** «Прыгаю первым!»: реакция телефона от появления кнопки, ≥ 150 мс, `delayed` не участвуют, только во время кнопки. */
export function braveEvent(r: HopRow, pid: string, rt: unknown, claimed: number, delayed: boolean): boolean {
  if (r.braves !== null || delayed || !r.jumpers.includes(pid) || r.braveTaps[pid] !== undefined) return false;
  if (typeof rt !== "number" || !Number.isFinite(rt) || rt < BRAVE_MIN_RT) return false;
  if (claimed < r.braveAt || claimed > r.braveEnds) return false;
  r.braveTaps[pid] = Math.round(rt);
  return true;
}

/** Подвести смельчаков: первые 3 по реакции (равные — жребий). Когда — через 0,5 с после конца кнопки. */
export function braveDue(r: HopRow, t: number): boolean {
  return r.braves === null && t >= r.braveEnds + BRAVE_SETTLE_MS;
}

export function pickBraves(r: HopRow, lot: (pid: string) => number): string[] {
  r.braves = Object.keys(r.braveTaps)
    .sort((a, b) => (r.braveTaps[a] ?? 0) - (r.braveTaps[b] ?? 0) || lot(a) - lot(b))
    .slice(0, BRAVES);
  return r.braves;
}

/** Выбор клетки: смельчак — во время `jump`, остальные — во время `choose` (можно передумать). */
export function cellEvent(st: HopState, r: HopRow, pid: string, side: unknown, t: number): boolean {
  if (side !== "L" && side !== "R") return false;
  if (!r.jumpers.includes(pid) || r.fell !== null) return false;
  const sub = hopSub(st, t);
  const brave = r.braves?.includes(pid) === true;
  if (brave ? sub !== "jump" : sub !== "choose") return false;
  r.picks[pid] = side;
  return true;
}

/** Раскрытие ряда: не выбравшим — по жребию; на тонком льду — упали. Смельчак на крепком — +3 монеты. */
export function crackRow(st: HopState, r: HopRow, rand: () => number, coins: (pid: string, n: number) => void): string[] {
  for (const pid of r.jumpers) {
    if (r.picks[pid] === undefined) {
      r.picks[pid] = rand() < 0.5 ? "L" : "R";
      r.auto.push(pid);
    }
  }
  r.fell = r.jumpers.filter((pid) => r.picks[pid] !== r.solid);
  for (const pid of r.fell) st.fallen[pid] = st.row;
  for (const pid of r.braves ?? []) if (r.picks[pid] === r.solid) coins(pid, BRAVE_COINS);
  return r.fell;
}

/** Ключ порядка: рядов пройдено (неупавшие — все сыгранные), потом монеты. */
export function hopKey(st: HopState, pid: string, coins: number): number[] {
  const fell = st.fallen[pid];
  const passed = fell === undefined ? st.rows.length : fell;
  return [passed, coins];
}

/** Доли «налево · направо» ряда (после раскрытия). */
export function sideShares(picks: Readonly<Record<string, Side>>): { L: number; R: number } {
  const all = Object.values(picks);
  if (all.length === 0) return { L: 0, R: 0 };
  const l = all.filter((s) => s === "L").length;
  return { L: Math.round((l / all.length) * 100), R: 100 - Math.round((l / all.length) * 100) };
}

// ------------------------------------------------------------ «Добивка»

export function newDobRow(rand: () => number, t: number, chooseMs: number, crackMs: number): DobRow {
  return { solid: solidOf(rand), chooseAt: t, chooseEnds: t + chooseMs, crackEnds: t + chooseMs + crackMs, picks: {}, auto: [], fell: null };
}

export function crackDobRow(r: DobRow, jumpers: readonly string[], rand: () => number): string[] {
  for (const pid of jumpers) {
    if (r.picks[pid] === undefined) {
      r.picks[pid] = rand() < 0.5 ? "L" : "R";
      r.auto.push(pid);
    }
  }
  r.fell = jumpers.filter((pid) => r.picks[pid] !== r.solid);
  return r.fell;
}
