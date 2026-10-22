// «Назад» с заставки (новый ход, раунд, задание, бой): снимок прошлого этапа целиком — итоги шага и этап, на котором
// он стоял (QA 22 октября 2026). Заставка очков не начисляет, поэтому «Назад» с неё только возвращает прошлый этап:
// шаг − 1, тот же `stage`, прежний `state.result`. Снимок кладётся в итоги шага под ключом `before`; внутри него —
// снимок ещё более раннего этапа (цепочка), не глубже `depth` и не больше `maxChars` знаков JSON, чтобы итог шага
// не рос всю игру. Время шага (`startedAt`) вернуть нельзя: сервер ставит только своё «сейчас» или null — прошлый
// этап возвращается без отсчёта (как «Назад» с выбора в других механиках).

import type { SessionChange } from "../data/types";

export type BeforeStage = "question" | "reveal";

export interface Before {
  /** На каком этапе стоял прошлый шаг. */
  stage: BeforeStage;
  /** Его `state.result` целиком (со своим `before` — ещё шагом раньше). */
  result: Record<string, unknown>;
  /** Счётчик ответов прошлого шага. */
  answered: number;
}

export const BEFORE_DEPTH = 5;
export const BEFORE_MAX_CHARS = 24_000;

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Разбор снимка из итогов шага; битый — null (кнопка «Назад» гаснет). */
export function parseBefore(raw: unknown): Before | null {
  const d = rec(raw);
  if (!d) return null;
  const result = rec(d.result);
  if (!result || (d.stage !== "question" && d.stage !== "reveal")) return null;
  const answered = typeof d.answered === "number" && Number.isInteger(d.answered) && d.answered >= 0 ? d.answered : 0;
  return { stage: d.stage, result, answered };
}

function trim(before: unknown, depth: number): Before | null {
  const b = parseBefore(before);
  if (!b || depth <= 0) return null;
  return { ...b, result: { ...b.result, before: trim(b.result.before, depth - 1) } };
}

/** Снимок прошлого этапа: `result` — его итоги шага (их `before` обрезается по глубине и размеру). */
export function makeBefore(stage: BeforeStage, result: Record<string, unknown>, answered = 0, depth = BEFORE_DEPTH, maxChars = BEFORE_MAX_CHARS): Before {
  for (let d = depth; d > 1; d--) {
    const snap: Before = { stage, answered, result: { ...result, before: trim(result.before, d - 1) } };
    if (JSON.stringify(snap).length <= maxChars) return snap;
  }
  return { stage, answered, result: { ...result, before: null } };
}

/** Изменение «Назад» с заставки к прошлому этапу (очки не трогаются: заставка их не начисляла). */
export function beforeChange(step: number, before: Before): SessionChange {
  return {
    state: { step: step - 1, stage: before.stage, revealed: before.stage === "reveal", startedAt: null, timeLimit: null, answered: before.answered, result: before.result },
  };
}
