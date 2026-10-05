import { quiz } from "./quiz";
import { DEMO_QUIZ } from "./quiz/demo";
import type { AnyMechanic, Mechanic, Step, ValidationError } from "./types";

/**
 * Механика в реестре. Формат содержимого знает только сама механика, а ядро передаёт
 * ей то, что вернул её же `parse`, поэтому стирание типа здесь безопасно.
 */
function register<Content, AnswerValue, S extends Step>(mechanic: Mechanic<Content, AnswerValue, S>): AnyMechanic {
  return mechanic as unknown as AnyMechanic;
}

/** Реестр механик. Новая механика подключается одной строкой здесь. */
export const mechanics: AnyMechanic[] = [register(quiz)];

export function getMechanic(id: string | null): AnyMechanic | undefined {
  return id ? mechanics.find((m) => m.id === id) : undefined;
}

const HINTS: Record<string, string> = {
  quiz: "Варианты ответа, открытый ответ, на скорость, картинки.",
};

/** Механики, которые можно выбрать при создании игры. */
export const selectableMechanics: Array<{ id: string; title: string; hint: string }> = mechanics.map((m) => ({
  id: m.id,
  title: m.title,
  hint: HINTS[m.id] ?? "",
}));

export function mechanicTitle(id: string | null): string {
  if (!id) return "Без игры";
  return getMechanic(id)?.title ?? id;
}

/** Содержимое новой игры выбранной механики. */
export function newContent(mechanicId: string): unknown {
  return getMechanic(mechanicId)?.create() ?? null;
}

/** Число вопросов (шагов с приёмом ответов). */
export function countQuestions(mechanicId: string, content: unknown): number {
  const mechanic = getMechanic(mechanicId);
  if (!mechanic) return 0;
  return mechanic.steps(mechanic.parse(content)).filter((step) => step.answerable).length;
}

/** Ошибки игры: с ними игру нельзя запустить. Неизвестная механика — тоже ошибка. */
export function validateGame(mechanicId: string, content: unknown): ValidationError[] {
  const mechanic = getMechanic(mechanicId);
  if (!mechanic) return [{ path: "", message: "Эта механика пока не поддерживается." }];
  return mechanic.validate(mechanic.parse(content));
}

/** Картинки игры: копируются вместе с ней. */
export function gameMediaIds(mechanicId: string, content: unknown): string[] {
  const mechanic = getMechanic(mechanicId);
  return mechanic ? mechanic.mediaIds(mechanic.parse(content)) : [];
}

/** Готовые игры для «Библиотеки JoyRest»: admin добавляет их одной кнопкой. */
export const demoGames: Array<{ mechanic: string; title: string; content: unknown }> = [
  { mechanic: quiz.id, title: DEMO_QUIZ.title, content: DEMO_QUIZ.content },
];
