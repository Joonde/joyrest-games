/**
 * Время вечера (CLAUDE.md, «Время вечера»): начало — первый гость вошёл (или «Начать игру», если гостей
 * нет), конец — «Завершить игру». Перерывы — показы слайда «Перерыв» на экране зала: начало — когда
 * слайд показали, конец — когда его убрали или вышло время отсчёта (что раньше). Считает сервер.
 */
import { formatDuration } from "./format";

export interface BreakSpan {
  /** id показа слайда: повтор того же показа не создаёт новый перерыв. */
  id: string;
  /** Начало и конец по часам сервера, мс. Конец null — перерыв идёт, отсчёта нет. */
  start: number;
  end: number | null;
}

export const MAX_BREAKS = 50;

interface SlideLike {
  id: string;
  kind: string;
  endsAt: number | null;
}

function isBreak(slide: SlideLike | null | undefined): slide is SlideLike {
  return Boolean(slide && slide.kind === "break");
}

/** Перерывы после изменения слайда на экране: новый перерыв открывается, убранный — закрывается. */
export function trackBreaks(breaks: BreakSpan[], prev: SlideLike | null | undefined, next: SlideLike | null | undefined, now: number): BreakSpan[] {
  const prevId = isBreak(prev) ? prev.id : null;
  const nextId = isBreak(next) ? next.id : null;
  if (prevId === nextId) {
    // Тот же перерыв: ведущий мог поменять время отсчёта.
    if (!nextId || !isBreak(next)) return breaks;
    return breaks.map((b) => (b.id === nextId && b.end !== null && next.endsAt !== null && next.endsAt > now ? { ...b, end: next.endsAt } : b));
  }
  let out = breaks;
  if (prevId) out = out.map((b) => (b.id === prevId && (b.end === null || b.end > now) ? { ...b, end: Math.max(b.start, now) } : b));
  if (nextId && isBreak(next) && !out.some((b) => b.id === nextId)) {
    out = [...out, { id: nextId, start: now, end: next.endsAt !== null && next.endsAt > now ? next.endsAt : null }];
  }
  return out.slice(-MAX_BREAKS);
}

/** Сколько длились перерывы до `until` (идущий перерыв обрезается по нему). */
export function breakStats(breaks: BreakSpan[], until: number): { ms: number; count: number } {
  let ms = 0;
  let count = 0;
  for (const b of breaks) {
    const end = Math.min(b.end ?? until, until);
    if (end <= b.start) continue;
    ms += end - b.start;
    count += 1;
  }
  return { ms, count };
}

/** Разбор перерывов из базы: только корректные записи. */
export function parseBreaks(value: unknown): BreakSpan[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
    .map((b) => ({
      id: typeof b.id === "string" ? b.id.slice(0, 64) : "",
      start: typeof b.start === "number" && Number.isFinite(b.start) ? b.start : NaN,
      end: typeof b.end === "number" && Number.isFinite(b.end) ? b.end : null,
    }))
    .filter((b) => b.id && Number.isFinite(b.start))
    .slice(-MAX_BREAKS);
}

function times(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? "раза" : "раз";
}

/** «шла 2 ч 14 мин, из них перерывы 25 мин (2 раза)». */
export function durationLine(start: number, end: number, breaksMs = 0, breaksCount = 0): string {
  const main = `шла ${formatDuration(end - start)}`;
  if (breaksCount <= 0 || breaksMs < 60_000) return main;
  return `${main}, из них перерывы ${formatDuration(breaksMs)} (${breaksCount} ${times(breaksCount)})`;
}

/** Пульт: «Вечер идёт 1:12» (часы:минуты). */
export function elapsedClock(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
