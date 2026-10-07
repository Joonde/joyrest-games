import { lotto } from "./lotto";
import { DEMO_LOTTO } from "./lotto/demo";
import { quiz } from "./quiz";
import { DEMO_MELODY, DEMO_QUIZ } from "./quiz/demo";
import { questionsLabel } from "../core/results";
import type { AnyMechanic, Mechanic, Step, ValidationError } from "./types";

/**
 * Механика в реестре. Формат содержимого знает только сама механика, а ядро передаёт
 * ей то, что вернул её же `parse`, поэтому стирание типа здесь безопасно.
 */
function register<Content, AnswerValue, S extends Step>(mechanic: Mechanic<Content, AnswerValue, S>): AnyMechanic {
  return mechanic as unknown as AnyMechanic;
}

/** Реестр механик. Новая механика подключается одной строкой здесь. */
export const mechanics: AnyMechanic[] = [register(quiz), register(lotto)];

export function getMechanic(id: string | null): AnyMechanic | undefined {
  return id ? mechanics.find((m) => m.id === id) : undefined;
}

const HINTS: Record<string, string> = {
  quiz: "Варианты ответа, открытый ответ, на скорость, картинки и музыка («Угадай мелодию»).",
  lotto: "Карточки песен у гостей, музыка на экране зала, «Лото!» — кто первым соберёт линию.",
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
export const demoGames: Array<{ mechanic: string; title: string; hint: string; content: unknown }> = [
  { mechanic: quiz.id, title: DEMO_QUIZ.title, hint: "8 вопросов всех типов: варианты, открытый ответ, на скорость.", content: DEMO_QUIZ.content },
  {
    mechanic: quiz.id,
    title: DEMO_MELODY.title,
    hint: "8 вопросов в трёх раундах: на экране звучит фрагмент, гости выбирают песню. Треки добавьте в копии игры или включайте со своего плеера.",
    content: DEMO_MELODY.content,
  },
  {
    mechanic: lotto.id,
    title: DEMO_LOTTO.title,
    hint: "28 песен, карточки 4×4, побеждает первая линия. Треки добавьте в копии игры или включайте со своего плеера.",
    content: DEMO_LOTTO.content,
  },
];

/** «8 вопросов» или «28 песен» — смотря какая игра. */
export function stepsLabel(mechanicId: string, content: unknown): string {
  const n = countQuestions(mechanicId, content);
  if (mechanicId === lotto.id) {
    const d10 = n % 10;
    const d100 = n % 100;
    const word = d10 === 1 && d100 !== 11 ? "песня" : d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14) ? "песни" : "песен";
    return `${n} ${word}`;
  }
  return questionsLabel(n);
}
