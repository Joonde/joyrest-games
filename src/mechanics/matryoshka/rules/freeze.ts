/**
 * «Замри!» (docs/matryoshka.md, «1. Замри!»): расписание фраз и взглядов, путь по отрезкам удержания, окно поимки
 * `[T + 0,3 с; конец взгляда)`, откат 300, финиш, «держит без пачки» не дольше 2 с. Чистые функции: время — время игры.
 *
 * Учёт идёт с задержкой: глобально — до «сейчас − 1,5 с» (`FREEZE_SETTLE_MS`), у телефона — до его последнего события. Событие
 * не может переписать уже учтённое (его время не раньше `acc`), поэтому свежее «отпустил», пришедшее с пачкой позже, ложится
 * своим заявленным временем, а поимка объявляется, когда взгляд «устоялся».
 */
import {
  CATCH_FROM_MS,
  DECOY_BEFORE_MS,
  DECOY_SHARE,
  FIRST_PHRASE_MS,
  FREEZE_SETTLE_MS,
  GAZE_MAX_MS,
  GAZE_MIN_MS,
  HOLD_GRACE_MS,
  HOLD_SHARE,
  PHRASE_MAX_MS,
  PHRASE_MIN_MS,
  ROLLBACK,
  TRACK,
} from "./constants";
import type { FreezeState, Gaze, Runner } from "./types";

/** Расписание: фразы 4–9 с, в конце фразы — взгляд 2–4 с, обманка с вероятностью 25% (не позже чем за 1 с до поворота). */
export function freezeSchedule(rand: () => number, from: number, until: number): Gaze[] {
  const out: Gaze[] = [];
  let t = from;
  for (;;) {
    const phrase = PHRASE_MIN_MS + Math.floor(rand() * (PHRASE_MAX_MS - PHRASE_MIN_MS + 1));
    const gaze = GAZE_MIN_MS + Math.floor(rand() * (GAZE_MAX_MS - GAZE_MIN_MS + 1));
    const decoyRoll = rand();
    const decoyAt = rand();
    const a = t + phrase;
    const e = a + gaze;
    if (e > until) break;
    // Обманка — внутри фразы, с 1 с от начала и не позже чем за 1 с до поворота.
    const room = phrase - 2 * DECOY_BEFORE_MS;
    const d = decoyRoll < DECOY_SHARE && room > 0 ? t + DECOY_BEFORE_MS + Math.floor(decoyAt * room) : null;
    out.push({ ph: t, a, e, d });
    t = e;
  }
  return out;
}

export function newRunner(t: number): Runner {
  return { path: 0, holding: false, acc: t, heard: -Infinity, last: t, seen: t, finishedAt: null, pending: null, caught: 0, caughtAt: [], everHeld: false };
}

export function freezeStart(rand: () => number, t: number, duration: number, pids: readonly string[]): FreezeState {
  const runners: Record<string, Runner> = {};
  for (const pid of pids) runners[pid] = newRunner(t);
  return { kind: "freeze", base: duration, extra: 0, runEnds: t + duration, gazes: freezeSchedule(rand, t + FIRST_PHRASE_MS, t + duration), judged: 0, runners, lastCatch: null };
}

/** Делений за мс удержания: дорожка за `HOLD_SHARE` длительности (без продлений). */
export function speedOf(st: Pick<FreezeState, "base">): number {
  return TRACK / (HOLD_SHARE * st.base);
}

/**
 * Окно поимки взгляда: полуинтервал [T + 0,5 с; конец взгляда) — реакция 0,3 с и запас на часы экрана и телефона 0,2 с (L4,
 * второе ревью 3a). `T` — назначенный сервером момент поворота: и экран, и отметка телефона сверены с часами сервера.
 */
export function windowOf(g: Gaze): [number, number] {
  return [g.a + CATCH_FROM_MS, g.e];
}

/**
 * Учесть бегуна до `to`: путь растёт, пока держит вне окон; держал в окне — пойман этим взглядом (откат на конце взгляда);
 * после конца бега путь не растёт. Меняет `r` на месте.
 *
 * Держит — это **подтверждённое** удержание (второе ревью 3a, решение владельца 12 «любой сбой — стою»): до последнего события
 * телефона, пока он держал (`seen`). Пачек нет (обрыв связи) — дальше для игры «стоит»: путь не растёт, взгляд не ловит; для
 * вида «держит» ещё 2 с после последней пачки (`HOLD_GRACE_MS`), потом и вид «стоит» (L6). `optimistic` — только для вида
 * экрана «на сейчас»: путь и без подтверждения, до конца этих 2 с.
 */
export function advance(st: FreezeState, r: Runner, to: number, optimistic = false): void {
  if (to <= r.acc) return;
  const v = speedOf(st);
  const graceEnd = r.holding ? Math.max(r.acc, Math.min(to, r.heard + HOLD_GRACE_MS, st.runEnds)) : r.acc;
  const holdEnd = optimistic ? graceEnd : Math.max(r.acc, Math.min(graceEnd, r.seen));
  const cuts = new Set<number>([to]);
  if (holdEnd > r.acc && holdEnd < to) cuts.add(holdEnd);
  for (const g of st.gazes) {
    const [w0, w1] = windowOf(g);
    if (w0 > r.acc && w0 < to) cuts.add(w0);
    if (w1 > r.acc && w1 <= to) cuts.add(w1);
  }
  const points = [...cuts].sort((a, b) => a - b);
  let x = r.acc;
  for (const y of points) {
    if (y <= x) continue;
    const holding = x < holdEnd && r.finishedAt === null;
    const gi = st.gazes.findIndex((g) => {
      const [w0, w1] = windowOf(g);
      return w0 < w1 && x >= w0 && x < w1;
    });
    if (holding && gi >= 0) {
      r.pending = gi;
    } else if (holding) {
      const before = r.path;
      r.path += (y - x) * v;
      if (r.path >= TRACK) {
        r.finishedAt = x + (TRACK - before) / v;
        r.path = TRACK;
        r.pending = null;
      }
    }
    // Конец окна, в котором держал, — откат.
    if (r.pending !== null) {
      const g = st.gazes[r.pending];
      if (g && windowOf(g)[1] === y) {
        r.path = Math.max(0, r.path - ROLLBACK);
        r.caught += 1;
        r.caughtAt.push(r.pending);
        r.pending = null;
      }
    }
    x = y;
  }
  if (r.holding && (graceEnd < to || r.finishedAt !== null)) r.holding = false;
  r.acc = to;
}

/** Путь и финиш на «сейчас» без изменений (экран): копия бегуна, учтённая до `to`. */
export function project(st: FreezeState, r: Runner, to: number): { path: number; finished: boolean } {
  const copy: Runner = { ...r, caughtAt: [...r.caughtAt] };
  advance(st, copy, Math.min(to, st.runEnds), true);
  return { path: copy.path, finished: copy.finishedAt !== null };
}

/** До какого момента учтено у всех: «сейчас − 1,5 с», не дальше конца бега. */
export function settledAt(st: FreezeState, now: number): number {
  return Math.min(now - FREEZE_SETTLE_MS, st.runEnds);
}

/**
 * «Нажал» (`on`) или «отпустил» в момент `te` (уже время игры), пришло в `arrival`. Время не раньше учтённого и прошлого
 * события этого телефона, не позже конца бега. Событие, пока держал, подтверждает удержание до своего момента (`confirms`:
 * у события с отметкой или свежего; у повтора без отметки время — приход, оно удержание не продлевает). Ответ — принято ли
 * игровое действие.
 */
export function holdEvent(st: FreezeState, r: Runner, on: boolean, te: number, arrival: number, confirms = true): boolean {
  if (r.finishedAt !== null || arrival > st.runEnds) return false;
  const at = Math.min(st.runEnds, Math.max(te, r.acc, r.last));
  if (r.holding && confirms) r.seen = Math.max(r.seen, at);
  advance(st, r, at);
  r.last = at;
  if (r.finishedAt !== null) return true;
  if (on) {
    r.heard = arrival;
    if (!r.holding || confirms) r.seen = Math.max(r.seen, at);
    r.holding = true;
    r.everHeld = true;
  } else r.holding = false;
  return true;
}

/** Пауза: все «отпустили» в момент паузы (L7) — на паузе движок выбрасывает пачки, жать после «Продолжить» заново. */
export function freezePause(st: FreezeState, t: number): void {
  for (const r of Object.values(st.runners)) {
    advance(st, r, Math.min(t, st.runEnds));
    r.holding = false;
  }
}

/** «+10 секунд»: бег длиннее, расписание дописано фразами на добавленное время (скорость — от исходной длительности). */
export function freezeMore(st: FreezeState, rand: () => number, ms: number): void {
  const from = st.gazes.at(-1)?.e ?? st.runEnds - st.base;
  st.extra += ms;
  st.runEnds += ms;
  st.gazes.push(...freezeSchedule(rand, from, st.runEnds));
}

/** «Закончить сейчас»: бег кончается сейчас; будущие взгляды убраны, идущий — до «сейчас». */
export function freezeEndNow(st: FreezeState, t: number): void {
  st.runEnds = Math.min(st.runEnds, t);
  st.gazes = st.gazes.filter((g) => g.a < t).map((g) => (g.e > t ? { ...g, e: t } : g));
}

/** Порядок испытания: добежавшие по времени финиша, потом по пути (L8). Ключ — больше лучше. */
export function freezeKey(r: Runner | undefined): number[] {
  if (!r) return [0, 0];
  return r.finishedAt !== null ? [1, -r.finishedAt] : [0, r.path];
}
