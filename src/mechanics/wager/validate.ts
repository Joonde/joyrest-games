import type { ValidationError } from "../types";
import type { WagerContent } from "./content";

export function validateWager(content: WagerContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.questions.length === 0) errors.push({ path: "questions", message: "Добавьте хотя бы один вопрос." });
  content.questions.forEach((q, i) => {
    if (!q.text.trim()) errors.push({ path: `questions/${q.id}/text`, message: `Вопрос ${i + 1}: напишите вопрос — ответ на него должен быть числом.` });
  });
  return errors;
}
