/**
 * «Стулья» (docs/matryoshka.md, «3. Стулья»): три захода, в заход идут только севшие (L13), стульев c₁ = round(A·q),
 * c₂ = round(n₂·(T ÷ n₂)^(1/2)), c₃ = ровно min(T, n₃). Реакцию мерит телефон (L14), сажает комната по реакции, равные — жребий.
 */
import {
  APPEAR_MAX_MS,
  APPEAR_MIN_MS,
  CHAIR_ROUNDS,
  CHAIRS_DECOY_EDGE_MS,
  CHAIRS_DECOY_SHARE,
  CHAIRS_LATE_RT,
  MUSIC_MAX_MS,
  MUSIC_MIN_MS,
  SEAT_SHOW_MS,
  SIT_EARLY_MS,
  SIT_MIN_RT,
  SIT_SETTLE_MS,
  SIT_WINDOW_MS,
} from "./constants";
import type { ChairRound, ChairsState } from "./types";

/** Стульев в заходе `round` (0–2) при `n` играющих, цели `T` и `A` на старте испытания. */
export function chairsFor(round: number, n: number, T: number, A: number): number {
  if (n <= T) return n;
  if (round >= CHAIR_ROUNDS - 1) return Math.min(T, n);
  const left = CHAIR_ROUNDS - round;
  const q = round === 0 ? (T / A) ** (1 / CHAIR_ROUNDS) : (T / n) ** (1 / left);
  const base = round === 0 ? A : n;
  return Math.max(T, Math.min(n, Math.round(base * q)));
}

/** Заход: музыка 12–30 с (с темпом), обманка 30% (не у краёв), стулья через 0,3–1,5 с после остановки. */
export function newRound(rand: () => number, t: number, players: string[], chairs: number, musicMs: (ms: number) => number): ChairRound {
  const music = musicMs(MUSIC_MIN_MS + Math.floor(rand() * (MUSIC_MAX_MS - MUSIC_MIN_MS + 1)));
  const stopAt = t + music;
  const appearAt = stopAt + APPEAR_MIN_MS + Math.floor(rand() * (APPEAR_MAX_MS - APPEAR_MIN_MS + 1));
  const room = music - 2 * CHAIRS_DECOY_EDGE_MS;
  const decoyRoll = rand();
  const decoyPos = rand();
  const decoyAt = decoyRoll < CHAIRS_DECOY_SHARE && room > 0 ? t + CHAIRS_DECOY_EDGE_MS + Math.floor(decoyPos * room) : null;
  const closeAt = appearAt + SIT_WINDOW_MS;
  const settleAt = closeAt + SIT_SETTLE_MS;
  return { players, chairs, musicAt: t, stopAt, appearAt, decoyAt, closeAt, settleAt, seatEnds: settleAt + SEAT_SHOW_MS, sits: {}, seated: null };
}

export function chairsStart(rand: () => number, t: number, pids: string[], T: number, musicMs: (ms: number) => number): ChairsState {
  const stats: ChairsState["stats"] = {};
  for (const pid of pids) stats[pid] = { rounds: 0, rtSum: 0, first: null };
  return { kind: "chairs", round: 0, rounds: [newRound(rand, t, pids, chairsFor(0, pids.length, T, pids.length), musicMs)], stats, over: false };
}

export type ChairsSub = "music" | "stop" | "seat";

export function chairsSub(r: ChairRound, t: number): ChairsSub {
  if (t < r.stopAt) return "music";
  if (r.seated === null) return "stop";
  return "seat";
}

/**
 * Касание стула: реакция `rt` от появления (телефон), 150–3 000 мс; заявленное время — не раньше появления − 0,3 с;
 * пришло (`arrival`) — не позже конца окна + 1,5 с. Повтор не меняет. Ответ — принято ли.
 */
export function sitEvent(r: ChairRound, pid: string, rt: unknown, claimed: number, arrival: number): boolean {
  if (r.seated !== null || !r.players.includes(pid) || r.sits[pid] !== undefined) return false;
  if (typeof rt !== "number" || !Number.isFinite(rt) || rt < SIT_MIN_RT || rt > SIT_WINDOW_MS) return false;
  if (claimed < r.appearAt - SIT_EARLY_MS || arrival > r.settleAt) return false;
  r.sits[pid] = Math.round(rt);
  return true;
}

/** Рассадка: по реакции (меньше — раньше), равные — жребий, пока есть стулья. */
export function seatRound(st: ChairsState, r: ChairRound, lot: (pid: string) => number): string[] {
  const sitters = Object.keys(r.sits).sort((a, b) => (r.sits[a] ?? 0) - (r.sits[b] ?? 0) || lot(a) - lot(b));
  r.seated = sitters.slice(0, r.chairs);
  for (const pid of r.seated) {
    const s = st.stats[pid];
    if (!s) continue;
    s.rounds += 1;
    s.rtSum += r.sits[pid] ?? 0;
  }
  if (st.round === 0) for (const pid of r.players) {
    const s = st.stats[pid];
    if (s) s.first = r.seated.includes(pid) ? (r.sits[pid] ?? null) : null;
  }
  return r.seated;
}

/** Ключ порядка: число заходов со стулом, потом средняя реакция (меньше — лучше). */
export function chairsKey(st: ChairsState, pid: string): number[] {
  const s = st.stats[pid];
  if (!s || s.rounds === 0) return [0, 0];
  return [s.rounds, -(s.rtSum / s.rounds)];
}

/** «Прозевали» в 1-м заходе: сели позже 1 с или не сели (для прогноза болельщиков). */
export function chairsFails(st: ChairsState): number {
  const first = st.rounds[0];
  if (!first) return 0;
  return first.players.filter((pid) => {
    const f = st.stats[pid]?.first ?? null;
    return f === null || f > CHAIRS_LATE_RT;
  }).length;
}
