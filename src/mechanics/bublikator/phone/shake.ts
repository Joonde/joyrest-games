/** Сводка тряски «Метеоритного дождя» с телефона: раз в 0,4 с, пока идёт дождь. */
export const SHAKE_EVERY_MS = 400;

export interface ShakeSent {
  /** Событие, для которого слали. */
  id: string | null;
  /** Наибольшая отправленная сила. */
  p: number;
}

/**
 * Что отправить на этом такте. Шлём силу каждый такт, пока она больше нуля, а не только когда выросла: сервер держит
 * наибольшую и сам ограничивает её временем дождя, а повтор переживает потерянную пачку. Новое событие — с нуля.
 */
export function shakeReport(prev: ShakeSent, eventId: string, peak: number): { next: ShakeSent; send: number | null } {
  const p = Number.isFinite(peak) ? Math.max(0, Math.min(100, Math.round(peak))) : 0;
  const base = prev.id === eventId ? prev.p : 0;
  const next = { id: eventId, p: Math.max(base, p) };
  return { next, send: next.p > 0 ? next.p : null };
}
