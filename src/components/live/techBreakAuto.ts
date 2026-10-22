/**
 * Конец технического перерыва по времени (QA 22 октября 2026, M3): чистые правила, без React.
 * Пульт убирает перерыв сам на любой вкладке, но только тот же самый слайд — второй пульт за это время
 * мог показать другой слайд, его трогать нельзя.
 */
import type { SlideState } from "../../data/types";

/** id перерыва, время которого вышло; null — убирать нечего (не перерыв, без времени или время не вышло). */
export function techBreakDue(slide: SlideState | null | undefined, now: number): string | null {
  if (!slide || slide.kind !== "tech" || slide.endsAt === null) return null;
  return now >= slide.endsAt ? slide.id : null;
}

/** Убирать ли перерыв `id`: на экране по-прежнему он, и этот пульт его ещё не убирал. */
export function shouldCloseTechBreak(id: string, current: SlideState | null | undefined, closed: string | null): boolean {
  return closed !== id && current?.kind === "tech" && current.id === id;
}
