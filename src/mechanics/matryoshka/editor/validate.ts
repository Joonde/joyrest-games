/** Проверка настроек «Игр Матрёшки» перед запуском: неполные свои вопросы нельзя молча заменить встроенными. */
import type { ValidationError } from "../../types";
import { QUESTIONS_MAX, QUESTIONS_MIN } from "../rules/constants";
import { parseQuestion } from "../rules/content";
import type { MatContent } from "../rules/types";

export function validateMatryoshka(c: MatContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (new Set(c.shapes).size !== 4 || c.shapes.length !== 4) errors.push({ path: "shapes", message: "Для «Пряника» выберите ровно 4 разные фигуры." });
  if (c.questions.length > 0 && c.questions.length < QUESTIONS_MIN) errors.push({ path: "questions", message: `Своих вопросов должно быть не меньше ${QUESTIONS_MIN}; сейчас ${c.questions.length}. Добавьте ещё или верните встроенные.` });
  if (c.questions.length > QUESTIONS_MAX) errors.push({ path: "questions", message: `Своих вопросов может быть не больше ${QUESTIONS_MAX}.` });
  c.questions.forEach((q, i) => {
    if (parseQuestion(q) === null) errors.push({ path: `questions/${i}`, message: `Вопрос ${i + 1}: нужен текст, 2–4 непустых варианта и один отмеченный верный ответ.` });
  });
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  c.questions.forEach((q, i) => {
    const key = q.q.trim().toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ");
    if (!key) return;
    if (seen.has(key)) duplicates.add(i + 1);
    seen.add(key);
  });
  if (duplicates.size > 0) errors.push({ path: "questions", message: `Вопросы повторяются: ${[...duplicates].join(", ")}. Оставьте разные формулировки.` });
  return errors;
}
