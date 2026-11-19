/**
 * «Замри!» на телефоне — удержание большой зоны (решение владельца 14 ноября 2026, docs/matryoshka.md «3b — телефон»): держит —
 * бежит, отпустил — стоит. Любой сбой — «отпустил / стою», никогда не нечестная поимка: `pointercancel`, палец съехал с зоны,
 * прокрутка, уведомление, страница скрыта, сон, обрыв связи, пауза. Второй палец (ладонь) не в счёт: зону держит один палец —
 * первый; пока он на зоне, остальные касания ничего не меняют, поднял первый — «стою», даже если ладонь ещё лежит. После сбоя
 * палец, который лежал на зоне, «сгорел»: бежать снова — только новым касанием.
 *
 * Чистая логика без DOM: события указателя и сбои → «держу» / «отпустил». Её проверяют тесты (`hold.test.ts`) и стенд
 * (последовательности указателя в настоящем браузере).
 */

export type HoldGlitch =
  | "cancel"
  | "leave"
  | "scroll"
  | "hidden"
  | "blur"
  | "sleep"
  | "offline"
  | "pause"
  | "disabled"
  | "unmount";

export interface HoldState {
  /** Палец, который держит зону (`pointerId`), или null — «стою». */
  pointer: number | null;
  /** Пальцы, лежащие на зоне, но не держащие её (второй палец, ладонь, «сгоревший» после сбоя). */
  ignored: number[];
  /** Зону можно держать (идёт бег, не пауза, есть связь, не финишировал). */
  enabled: boolean;
}

export type HoldInput =
  | { type: "down"; id: number; primary?: boolean }
  | { type: "up"; id: number }
  | { type: "cancel"; id: number }
  | { type: "leave"; id: number }
  | { type: "glitch"; reason: HoldGlitch }
  | { type: "enable"; on: boolean };

export interface HoldStep {
  state: HoldState;
  /** Что сообщить комнате: true — «держу» (начал бежать), false — «отпустил», null — ничего. */
  send: boolean | null;
}

export function newHold(enabled = false): HoldState {
  return { pointer: null, ignored: [], enabled };
}

export function holding(s: HoldState): boolean {
  return s.pointer !== null;
}

function without(list: readonly number[], id: number): number[] {
  return list.filter((x) => x !== id);
}

/** Отпустить из-за сбоя: держащий палец «сгорает» (лежит дальше — не бежит, пока не поднимет и не коснётся снова). */
function release(s: HoldState, burn: boolean): HoldStep {
  if (s.pointer === null) return { state: s, send: null };
  const ignored = burn ? [...without(s.ignored, s.pointer), s.pointer] : s.ignored;
  return { state: { ...s, pointer: null, ignored }, send: false };
}

export function holdStep(s: HoldState, e: HoldInput): HoldStep {
  switch (e.type) {
    case "down": {
      // Уже держит другой палец — это второй палец или ладонь: не в счёт (пока он лежит).
      if (s.pointer !== null) return s.pointer === e.id ? { state: s, send: null } : { state: { ...s, ignored: [...without(s.ignored, e.id), e.id] }, send: null };
      if (!s.enabled) return { state: { ...s, ignored: [...without(s.ignored, e.id), e.id] }, send: null };
      // Палец, лежащий на зоне раньше (ладонь), касание «вниз» второй раз не присылает: новый — только чистый.
      if (s.ignored.includes(e.id)) return { state: s, send: null };
      return { state: { ...s, pointer: e.id }, send: true };
    }
    case "up":
    case "cancel":
    case "leave": {
      if (s.pointer === e.id) {
        const r = release(s, false);
        return { state: { ...r.state, ignored: without(r.state.ignored, e.id) }, send: r.send };
      }
      return { state: { ...s, ignored: without(s.ignored, e.id) }, send: null };
    }
    case "glitch":
      return release(s, true);
    case "enable": {
      if (e.on === s.enabled) return { state: s, send: null };
      if (e.on) return { state: { ...s, enabled: true }, send: null };
      const r = release(s, true);
      return { state: { ...r.state, enabled: false }, send: r.send };
    }
  }
}

/** Много шагов подряд (тесты и стенд): итог и что ушло бы в комнату. */
export function runHold(start: HoldState, inputs: readonly HoldInput[]): { state: HoldState; sent: boolean[] } {
  let s = start;
  const sent: boolean[] = [];
  for (const e of inputs) {
    const r = holdStep(s, e);
    s = r.state;
    if (r.send !== null) sent.push(r.send);
  }
  return { state: s, sent };
}

/** Между двумя «тиками» страницы прошло больше — телефон спал или вкладку душили: это сбой «сон». */
export const SLEEP_GAP_MS = 1200;
