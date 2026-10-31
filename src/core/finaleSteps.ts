/**
 * Порядок дел гостя после игры (решение владельца 31 октября 2026, макет «Финальный экран гостя — новый порядок»):
 * 1 карточка для сторис → 2 оценка вечера → 3 чаевые → 4 канал. Шаги, которых нет (нет места в таблице, нет своего
 * сервера, нет ссылки на чаевые), просто пропускаются, номера идут подряд. Сделанный или пропущенный шаг сворачивается в
 * строку, подсвечен — первый несделанный. Все шаги доступны в любом порядке, подсветка только подсказывает.
 */

export type FinaleStepId = "card" | "review" | "tips" | "channel";
export type FinaleStepStatus = "done" | "skip";

export const FINALE_STEP_LABELS: Record<FinaleStepId, string> = {
  card: "Сторис",
  review: "Оценка",
  tips: "Чаевые",
  channel: "Канал",
};

const ORDER: readonly FinaleStepId[] = ["card", "review", "tips", "channel"];

/** Какие шаги есть у этого гостя, по порядку. Канал есть всегда. */
export function finaleSteps(has: { card: boolean; review: boolean; tips: boolean }): FinaleStepId[] {
  return ORDER.filter((id) => id === "channel" || has[id]);
}

/** Подсвеченный шаг — первый без отметки; всё сделано — null. */
export function activeStep(steps: readonly FinaleStepId[], marks: Partial<Record<FinaleStepId, FinaleStepStatus>>): FinaleStepId | null {
  return steps.find((id) => !marks[id]) ?? null;
}

/** «4 коротких шага · около минуты» (2–4 шага — «шага»; один — «шаг»). */
export function stepsHint(count: number): string {
  return `${count} ${count === 1 ? "короткий шаг" : count < 5 ? "коротких шага" : "коротких шагов"} · около минуты`;
}

/** Отметки читаются из сохранённого — только известные шаги и значения. */
export function parseMarks(raw: unknown): Partial<Record<FinaleStepId, FinaleStepStatus>> {
  const out: Partial<Record<FinaleStepId, FinaleStepStatus>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of ORDER) {
    const v = (raw as Record<string, unknown>)[id];
    if (v === "done" || v === "skip") out[id] = v;
  }
  return out;
}
