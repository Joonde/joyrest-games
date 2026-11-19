/**
 * «Канат» (docs/matryoshka.md, «4. Канат»): две стороны поровну, до 3 попыток по 15 с до двух побед, узел раз в 200 мс.
 * Сила — по доле (L15): нажатия игроков стороны на человека на связи + 0,5 × нажатия болельщиков на тапавшего за 3 с (L16).
 * Сдвиг = k × (A − B) ÷ ((A + B) ÷ 2). Сердечко теряют только проигравшие (L17).
 */
import { FAN_ACTIVE_MS, FAN_WEIGHT, ROPE_ATTEMPTS, ROPE_END, ROPE_K, ROPE_TICK_MS, ROPE_WINDOW_MS, ROPE_WINS, TAPS_BURST, TAPS_PER_SECOND } from "./constants";
import { shuffle } from "./env";
import type { RopeState, Taps } from "./types";

export function newTaps(t: number): Taps {
  return { total: 0, attempts: Array.from({ length: ROPE_ATTEMPTS }, () => 0), recent: [], last: -Infinity, bucket: { tokens: TAPS_BURST, at: t } };
}

/** Стороны: игроки случайно и поровну (разница ≤ 1), болельщики — по очереди номеров. */
export function ropeStart(rand: () => number, t: number, players: string[], fans: string[], ms: { split: number }): RopeState {
  const sides: Record<string, 0 | 1> = {};
  shuffle(players, rand).forEach((pid, i) => {
    sides[pid] = (i % 2) as 0 | 1;
  });
  const fanSides: Record<string, 0 | 1> = {};
  fans.forEach((pid, i) => {
    fanSides[pid] = (i % 2) as 0 | 1;
  });
  const taps: Record<string, Taps> = {};
  for (const pid of [...players, ...fans]) taps[pid] = newTaps(t);
  const splitEnds = t + ms.split;
  return { kind: "rope", sides, fanSides, splitEnds, attempt: -1, attemptAt: splitEnds, attemptEnds: splitEnds, restEnds: null, knot: 0, wins: [0, 0], results: [], taps, lastStep: splitEnds, over: false, power: [0, 0] };
}

/** Новый болельщик (выбыл раньше или опоздал) — в меньшую болельщицкую сторону. */
export function ropeAddFan(st: RopeState, pid: string, t: number): void {
  if (st.fanSides[pid] !== undefined || st.sides[pid] !== undefined) return;
  let a = 0;
  let b = 0;
  for (const s of Object.values(st.fanSides)) s === 0 ? (a += 1) : (b += 1);
  st.fanSides[pid] = a <= b ? 0 : 1;
  st.taps[pid] = newTaps(t);
}

export type RopeSub = "split" | "pull" | "rest" | "over";

export function ropeSub(st: RopeState, t: number): RopeSub {
  if (st.over) return "over";
  if (st.attempt < 0) return "split";
  if (st.restEnds !== null) return "rest";
  return t < st.attemptEnds ? "pull" : "rest";
}

/** Нажатия: сводка `n` в момент `te`; не больше 15 в секунду (запас 30). Только во время попытки. */
export function tapEvent(st: RopeState, pid: string, n: unknown, te: number): boolean {
  const taps = st.taps[pid];
  if (!taps || st.over || st.attempt < 0 || st.restEnds !== null) return false;
  if (te < st.attemptAt || te > st.attemptEnds) return false;
  const want = typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const b = taps.bucket;
  if (te > b.at) {
    b.tokens = Math.min(TAPS_BURST, b.tokens + ((te - b.at) / 1000) * TAPS_PER_SECOND);
    b.at = te;
  }
  const got = Math.max(0, Math.min(want, Math.floor(b.tokens)));
  b.tokens -= got;
  if (got === 0) return false;
  taps.total += got;
  taps.attempts[st.attempt] = (taps.attempts[st.attempt] ?? 0) + got;
  taps.recent.push([te, got]);
  taps.last = Math.max(taps.last, te);
  return true;
}

function windowTaps(t: Taps, at: number): number {
  let n = 0;
  for (const [time, k] of t.recent) if (time > at - ROPE_WINDOW_MS && time <= at) n += k;
  return n;
}

/** Сила стороны в момент `at`: игроки на связи — на человека, болельщики — прибавка на тапавшего за 3 с. */
export function sidePower(st: RopeState, side: 0 | 1, at: number, online: (pid: string) => boolean): number {
  const per = ROPE_WINDOW_MS / 1000;
  let players = 0;
  let pTaps = 0;
  for (const [pid, s] of Object.entries(st.sides)) {
    if (s !== side) continue;
    const t = st.taps[pid];
    const tapped = t !== undefined && windowTaps(t, at) > 0;
    if (online(pid) || tapped) players += 1;
    if (t) pTaps += windowTaps(t, at);
  }
  let fans = 0;
  let fTaps = 0;
  for (const [pid, s] of Object.entries(st.fanSides)) {
    if (s !== side) continue;
    const t = st.taps[pid];
    if (!t || t.last <= at - FAN_ACTIVE_MS) continue;
    fans += 1;
    fTaps += windowTaps(t, at);
  }
  const p = players > 0 ? pTaps / per / players : 0;
  const f = fans > 0 ? (FAN_WEIGHT * fTaps) / per / fans : 0;
  return p + f;
}

/** Сдвиг узла за тик: k × (A − B) ÷ ((A + B) ÷ 2); никто не тапает — 0. */
export function knotStep(a: number, b: number): number {
  const mean = (a + b) / 2;
  return mean > 0 ? (ROPE_K * (a - b)) / mean : 0;
}

/** Нажатия игроков стороны за попытку (ничья по узлу). */
function attemptTaps(st: RopeState, side: 0 | 1, attempt: number): number {
  let n = 0;
  for (const [pid, s] of Object.entries(st.sides)) if (s === side) n += st.taps[pid]?.attempts[attempt] ?? 0;
  return n;
}

function finishAttempt(st: RopeState, t: number, early: boolean, lot: () => number, rest: number): void {
  let winner: 0 | 1;
  if (st.knot > 0) winner = 0;
  else if (st.knot < 0) winner = 1;
  else {
    const a = attemptTaps(st, 0, st.attempt);
    const b = attemptTaps(st, 1, st.attempt);
    winner = a > b ? 0 : b > a ? 1 : lot() < 0.5 ? 0 : 1;
  }
  st.results.push({ winner, knot: st.knot, early });
  st.wins[winner] += 1;
  st.attemptEnds = Math.min(st.attemptEnds, t);
  if (st.wins[winner] >= ROPE_WINS || st.attempt + 1 >= ROPE_ATTEMPTS) st.over = true;
  else st.restEnds = t + rest;
}

/**
 * Ход «Каната» до момента `t`: тики 200 мс (узел), конец попытки (досрочно — у черты), передышка, следующая попытка.
 * Положительный узел — к коралловой стороне (0).
 */
export function ropeTick(st: RopeState, t: number, online: (pid: string) => boolean, lot: () => number, ms: { attempt: number; rest: number }): boolean {
  let changed = false;
  if (st.over) return false;
  if (st.attempt < 0) {
    if (t < st.splitEnds) return false;
    st.attempt = 0;
    st.attemptAt = st.splitEnds;
    st.attemptEnds = st.attemptAt + ms.attempt;
    st.lastStep = st.attemptAt;
    st.knot = 0;
    changed = true;
  }
  if (st.restEnds !== null) {
    if (t < st.restEnds) return changed;
    st.attempt += 1;
    st.attemptAt = st.restEnds;
    st.attemptEnds = st.attemptAt + ms.attempt;
    st.restEnds = null;
    st.lastStep = st.attemptAt;
    st.knot = 0;
    changed = true;
  }
  while (!st.over && st.restEnds === null && st.lastStep + ROPE_TICK_MS <= Math.min(t, st.attemptEnds)) {
    st.lastStep += ROPE_TICK_MS;
    const a = sidePower(st, 0, st.lastStep, online);
    const b = sidePower(st, 1, st.lastStep, online);
    st.power = [a, b];
    st.knot = Math.max(-ROPE_END, Math.min(ROPE_END, st.knot + knotStep(a, b)));
    changed = true;
    if (Math.abs(st.knot) >= ROPE_END) finishAttempt(st, st.lastStep, true, lot, ms.rest);
  }
  if (!st.over && st.restEnds === null && t >= st.attemptEnds) {
    finishAttempt(st, st.attemptEnds, false, lot, ms.rest);
    changed = true;
  }
  // Старые нажатия — вон (окно 2 с и «активен» 3 с).
  for (const taps of Object.values(st.taps)) if (taps.recent.length > 0 && taps.recent[0] && taps.recent[0][0] < t - FAN_ACTIVE_MS) taps.recent = taps.recent.filter(([time]) => time >= t - FAN_ACTIVE_MS);
  return changed;
}

/** «Закончить сейчас»: идущая попытка — по правилу «время вышло», и «Канат» кончается. */
export function ropeEndNow(st: RopeState, t: number, lot: () => number): void {
  if (st.over) return;
  if (st.attempt >= 0 && st.restEnds === null) finishAttempt(st, t, false, lot, 0);
  st.over = true;
  st.restEnds = null;
}

/** Победившая сторона: больше побед; поровну — по узлу последней попытки, потом по нажатиям, потом жребий. */
export function ropeWinner(st: RopeState, lot: () => number): 0 | 1 {
  if (st.wins[0] !== st.wins[1]) return st.wins[0] > st.wins[1] ? 0 : 1;
  const last = st.results.at(-1);
  if (last && last.knot !== 0) return last.knot > 0 ? 0 : 1;
  let a = 0;
  let b = 0;
  for (const [pid, s] of Object.entries(st.sides)) (s === 0 ? (a += st.taps[pid]?.total ?? 0) : (b += st.taps[pid]?.total ?? 0));
  if (a !== b) return a > b ? 0 : 1;
  return lot() < 0.5 ? 0 : 1;
}

/** Нажатий в секунду за все сыгранные попытки. */
export function tapRate(st: RopeState, pid: string, attemptMs: number): number {
  const n = st.results.length || 1;
  return (st.taps[pid]?.total ?? 0) / ((n * attemptMs) / 1000);
}
