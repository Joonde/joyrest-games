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

/** Сглаженное ускорение ниже этого — телефон просто в руке или на столе, тряски нет (м/с²). */
export const SHAKE_FLOOR = 3;
/** Сглаженное ускорение от этого — энергичная тряска, полный вклад (м/с²). */
export const SHAKE_FULL = 12;
/** Столько секунд энергичной тряски дают силу 100 (как эталон дождя — 10 с). */
export const SHAKE_FULL_SECONDS = 10;
/** Одно показание датчика учитывается не дольше этого (мс): пропуск событий — не «тряска». */
const SHAKE_MAX_STEP_MS = 100;

/**
 * Сила тряски за событие — накопленная во времени (аудит 2b, круг 2, №1): каждое показание сглаженного ускорения выше
 * порога добавляет свою долю секунды; 10 с энергичной тряски = 100. Один рывок на четверть секунды даёт ~3, телефон на
 * столе — 0. Телефон шлёт накопленное каждые 0,4 с (`shakeReport`), сервер хранит наибольшее и режет эталоном по времени.
 */
export class ShakeMeter {
  private ema = 0;
  private last: number | null = null;
  private full = 0;

  /** Показание датчика: модуль ускорения без силы тяжести (м/с²) и время (мс). */
  add(magnitude: number, at: number): void {
    if (!Number.isFinite(magnitude) || !Number.isFinite(at)) return;
    const step = this.last === null ? 16 : Math.max(0, Math.min(SHAKE_MAX_STEP_MS, at - this.last));
    this.last = at;
    this.ema = this.ema * 0.8 + Math.abs(magnitude) * 0.2;
    const share = Math.max(0, Math.min(1, (this.ema - SHAKE_FLOOR) / (SHAKE_FULL - SHAKE_FLOOR)));
    this.full += share * step;
  }

  /** Сила 0–100. */
  get value(): number {
    return Math.min(100, (this.full / (SHAKE_FULL_SECONDS * 1000)) * 100);
  }

  reset(): void {
    this.ema = 0;
    this.last = null;
    this.full = 0;
  }
}
