/**
 * «Пряник» (docs/matryoshka.md, «2. Пряник»): коробки (фигуры — тайна до `unbox`), выбор коробки, кусочки обводки от
 * телефона (0–200), трещина, целый пряник. Порядок: целые по времени → недообведённые по кусочкам → треснувшие по кусочкам.
 */
import { BOXES, PIECES } from "./constants";
import { shuffle } from "./env";
import type { GingerRunner, GingerState, ShapeId } from "./types";

export function gingerStart(rand: () => number, t: number, shapes: readonly ShapeId[], pids: readonly string[], ms: { pick: number; unbox: number; trace: number }): GingerState {
  const runners: Record<string, GingerRunner> = {};
  for (const pid of pids) runners[pid] = { box: null, auto: false, c: 0, cracked: false, crackedAt: null, doneAt: null };
  const pickEnds = t + ms.pick;
  const unboxEnds = pickEnds + ms.unbox;
  return { kind: "ginger", boxes: shuffle(shapes, rand).slice(0, BOXES), pickEnds, unboxEnds, traceEnds: unboxEnds + ms.trace, extra: 0, runners };
}

export type GingerSub = "pick" | "unbox" | "trace" | "over";

export function gingerSub(st: GingerState, t: number): GingerSub {
  if (t < st.pickEnds) return "pick";
  if (t < st.unboxEnds) return "unbox";
  if (t < st.traceEnds) return "trace";
  return "over";
}

/** Не выбравшим коробку — по жребию (на входе в `unbox`). */
export function gingerAutoBoxes(st: GingerState, order: readonly string[], rand: () => number): void {
  for (const pid of order) {
    const r = st.runners[pid];
    if (r && r.box === null) {
      r.box = Math.floor(rand() * BOXES);
      r.auto = true;
    }
  }
}

/** Выбор коробки — только на `pick`, можно передумать. */
export function boxEvent(st: GingerState, r: GingerRunner, n: unknown, t: number): boolean {
  if (gingerSub(st, t) !== "pick" || typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= BOXES) return false;
  r.box = n;
  return true;
}

/**
 * Кусочки от телефона: `c` 0–200 (берём наибольшее), `crack` — трещина (дальше не растёт), 200 — целый (время — `te`).
 * Событие — во время `trace` (по заявленному времени, не позже конца обводки); пришедшее чуть позже конца — принимается,
 * пока идёт проверка (её срок ставит игра).
 */
export function pieceEvent(st: GingerState, r: GingerRunner, e: { c?: unknown; crack?: unknown }, te: number): boolean {
  if (r.cracked || r.doneAt !== null) return false;
  if (te < st.unboxEnds || te > st.traceEnds) return false;
  const c = typeof e.c === "number" && Number.isFinite(e.c) ? Math.max(0, Math.min(PIECES, Math.floor(e.c))) : null;
  let played = false;
  if (c !== null && c > r.c) {
    r.c = c;
    played = true;
  }
  if (e.crack === true) {
    r.cracked = true;
    r.crackedAt = te;
    return true;
  }
  if (r.c >= PIECES) {
    r.doneAt = te;
    played = true;
  }
  return played;
}

/** Ключ порядка (больше — лучше): целые (раньше — выше), недообведённые по кусочкам, треснувшие по кусочкам. */
export function gingerKey(r: GingerRunner | undefined): number[] {
  if (!r) return [0, 0];
  if (r.doneAt !== null) return [2, -r.doneAt];
  if (!r.cracked) return [1, r.c];
  return [0, r.c];
}

/** Сколько выбрали каждую коробку. */
export function boxCounts(st: GingerState): number[] {
  const out = Array.from({ length: BOXES }, () => 0);
  for (const r of Object.values(st.runners)) if (r.box !== null) out[r.box] = (out[r.box] ?? 0) + 1;
  return out;
}
