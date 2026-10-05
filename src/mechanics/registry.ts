import type { Mechanic } from "./types";

/**
 * Реестр механик. Новая механика подключается одной строкой здесь.
 * Квиз появится на этапе 4.
 */
export const mechanics: Array<Mechanic<never, never>> = [];

export function getMechanic(id: string | null): Mechanic<never, never> | undefined {
  return id ? mechanics.find((m) => m.id === id) : undefined;
}

/**
 * Механики, которые можно выбрать при создании игры. Пока модуль механики не готов,
 * игру можно создать и запустить как пустую сессию (вход гостей и экран зала).
 */
export const selectableMechanics: Array<{ id: string; title: string; hint: string }> = [
  { id: "quiz", title: "Квиз", hint: "Варианты ответа, открытый ответ, на скорость, картинки и аудио." },
];

export function mechanicTitle(id: string | null): string {
  if (!id) return "Без игры";
  return getMechanic(id)?.title ?? selectableMechanics.find((m) => m.id === id)?.title ?? id;
}

/** Число вопросов (шагов с приёмом ответов); 0, пока модуль механики не подключён. */
export function countQuestions(mechanicId: string, content: unknown): number {
  const mechanic = getMechanic(mechanicId);
  if (!mechanic || content === null || content === undefined) return 0;
  try {
    // Формат содержимого знает только механика; некорректное содержимое она отбросит.
    return mechanic.steps(content as never).filter((step) => step.answerable).length;
  } catch {
    return 0;
  }
}
