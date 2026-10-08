import type { ValidationError } from "../types";
import type { CheckersContent } from "./content";

export function validateCheckers(content: CheckersContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.questions.length === 0) errors.push({ path: "questions", message: "Добавьте вопросы: каждый верный ответ даёт ход на доске." });
  content.questions.forEach((q, i) => {
    const n = i + 1;
    if (!q.text.trim()) errors.push({ path: `questions/${q.id}/text`, message: `Вопрос ${n}: напишите текст вопроса.` });
    if (q.kind === "choice") {
      if (q.options.length < 2) errors.push({ path: `questions/${q.id}/options`, message: `Вопрос ${n}: нужно хотя бы 2 варианта.` });
      else if (q.options.some((o) => !o.trim())) errors.push({ path: `questions/${q.id}/options`, message: `Вопрос ${n}: заполните все варианты или уберите пустые.` });
      else if (!q.options[q.correct]?.trim()) errors.push({ path: `questions/${q.id}/correct`, message: `Вопрос ${n}: отметьте верный вариант.` });
    } else if (!q.answers.some((a) => a.trim())) errors.push({ path: `questions/${q.id}/answers`, message: `Вопрос ${n}: укажите верный ответ.` });
  });
  return errors;
}
