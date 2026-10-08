import type { ValidationError } from "../types";
import { LIMITS, type QuizContent, type QuizQuestion } from "./content";
import { normalizeAnswer } from "./normalize";
import { levelProblems } from "../../core/supergame";

/** Путь ошибки вопроса: конструктор показывает её у нужного поля. */
export function questionPath(questionId: string, field: QuestionField): string {
  return `questions/${questionId}/${field}`;
}

export type QuestionField = "text" | "options" | "correct" | "answers" | "timeLimit" | "points" | "pictures" | "levels";

function duplicates(values: string[]): boolean {
  const seen = new Set<string>();
  for (const v of values.map(normalizeAnswer).filter(Boolean)) {
    if (seen.has(v)) return true;
    seen.add(v);
  }
  return false;
}

export function validateQuestion(q: QuizQuestion): ValidationError[] {
  const errors: ValidationError[] = [];
  const add = (field: QuestionField, message: string) => errors.push({ path: questionPath(q.id, field), message });

  if (!q.text.trim() && q.kind !== "pictures" && q.kind !== "super") add("text", "Напишите текст вопроса.");

  if (q.kind === "super") {
    for (const problem of levelProblems(q.levels ?? [])) add("levels", problem);
  } else if (q.kind === "open" || q.kind === "buzz") {
    const filled = q.answers.filter((a) => normalizeAnswer(a).length > 0);
    if (filled.length === 0) add("answers", q.kind === "buzz" ? "Напишите правильный ответ — его увидит ведущий." : "Добавьте хотя бы один верный ответ.");
  } else if (q.kind === "pictures") {
    const pics = q.pictures ?? [];
    if (pics.length < LIMITS.minPictures || pics.length > LIMITS.maxPictures) add("pictures", `Нужно от ${LIMITS.minPictures} до ${LIMITS.maxPictures} картинок.`);
    if (pics.some((p) => !p.imageId)) add("pictures", "Добавьте картинку в каждое поле или удалите пустое.");
    if (pics.some((p) => !p.answers.some((a) => normalizeAnswer(a).length > 0))) add("pictures", "Напишите верный ответ к каждой картинке.");
  } else {
    if (q.options.length < LIMITS.minOptions) add("options", `Нужно хотя бы ${LIMITS.minOptions} варианта ответа.`);
    if (q.options.length > LIMITS.maxOptions) add("options", `Не больше ${LIMITS.maxOptions} вариантов ответа.`);
    if (q.options.some((o) => !o.trim())) add("options", "Заполните все варианты или удалите пустые.");
    else if (duplicates(q.options)) add("options", "Два варианта совпадают — гости не поймут, какой выбрать.");
    if (q.correct < 0 || q.correct >= q.options.length) add("correct", "Отметьте правильный вариант.");
  }

  if (q.kind !== "buzz" && (!Number.isInteger(q.timeLimit) || q.timeLimit < LIMITS.minTime || q.timeLimit > LIMITS.maxTime)) {
    add("timeLimit", `Время — от ${LIMITS.minTime} до ${LIMITS.maxTime} секунд.`);
  }
  if (q.kind !== "super" && (!Number.isInteger(q.points) || q.points < LIMITS.minPoints || q.points > LIMITS.maxPoints)) {
    add("points", `Очки — от ${LIMITS.minPoints} до ${LIMITS.maxPoints}.`);
  }
  return errors;
}

export function validateContent(content: QuizContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.questions.length === 0) errors.push({ path: "questions", message: "Добавьте хотя бы один вопрос." });
  if (content.questions.length > LIMITS.questions) {
    errors.push({ path: "questions", message: `В игре не больше ${LIMITS.questions} вопросов.` });
  }
  for (const q of content.questions) errors.push(...validateQuestion(q));
  return errors;
}

/** Ошибки одного вопроса по полям. */
export function errorsFor(errors: ValidationError[], questionId: string, field?: QuestionField): ValidationError[] {
  const prefix = field ? questionPath(questionId, field) : `questions/${questionId}/`;
  return errors.filter((e) => (field ? e.path === prefix : e.path.startsWith(prefix)));
}
