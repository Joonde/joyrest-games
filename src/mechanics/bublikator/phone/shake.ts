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

/** Датчик движения: спросить можно (iPhone, свежий Chrome), разрешён, отказан, нет совсем. */
export type MotionState = "need" | "granted" | "denied" | "none";
/** Гость сам выбрал «Буду тапать» (запоминается на устройстве) — датчик не слушаем и ничего не спрашиваем. */
export type ShakeChoice = "tap" | null;

/**
 * Как играть дождь и что предложить (решение владельца 6 ноября 2026: гость заранее видит выбор и ничего не включает
 * вслепую). `ask` — своя подсказка и две кнопки «Разрешить тряску» / «Буду тапать» до системного окна; `retry` — тряска
 * выключена (отказ в системном окне или «Буду тапать»), кнопка «Попробовать тряску снова»; null — предлагать нечего.
 */
export function shakeMode(state: MotionState, live: boolean, choice: ShakeChoice): { mode: "shake" | "tap"; offer: "ask" | "retry" | null } {
  if (choice === "tap") return { mode: "tap", offer: state === "none" ? null : "retry" };
  if (live) return { mode: "shake", offer: null };
  if (state === "need") return { mode: "tap", offer: "ask" };
  if (state === "denied") return { mode: "tap", offer: "retry" };
  return { mode: "tap", offer: null };
}
