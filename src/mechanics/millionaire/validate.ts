import type { ValidationError } from "../types";
import { LEVELS, questionsOf, type MillionaireContent } from "./content";

export function validateMillionaire(content: MillionaireContent): ValidationError[] {
  const errors: ValidationError[] = [];
  for (let level = 1; level <= LEVELS; level++) {
    if (questionsOf(content, level).length === 0) errors.push({ path: "questions", message: `Ступень ${level}: добавьте хотя бы один вопрос.` });
  }
  content.questions.forEach((q) => {
    const where = `Ступень ${q.level}`;
    if (!q.text.trim()) errors.push({ path: `questions/${q.id}/text`, message: `${where}: напишите вопрос.` });
    if (q.options.some((o) => !o.trim())) errors.push({ path: `questions/${q.id}/options`, message: `${where}: заполните все четыре варианта.` });
    else if (new Set(q.options.map((o) => o.trim().toLowerCase())).size < 4) errors.push({ path: `questions/${q.id}/options`, message: `${where}: варианты не должны повторяться.` });
  });
  for (let i = 1; i < content.ladder.length; i++) {
    if ((content.ladder[i] ?? 0) <= (content.ladder[i - 1] ?? 0)) {
      errors.push({ path: "ladder", message: `Лестница: ступень ${i + 1} должна стоить больше ступени ${i}.` });
      break;
    }
  }
  return errors;
}

/** На сколько команд хватит вопросов (без замен): самая «бедная» ступень. */
export function teamsCovered(content: MillionaireContent): number {
  let min = Infinity;
  for (let level = 1; level <= LEVELS; level++) min = Math.min(min, questionsOf(content, level).filter((q) => q.text.trim()).length);
  return Number.isFinite(min) ? min : 0;
}
