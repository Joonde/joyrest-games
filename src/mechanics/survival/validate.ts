import type { ValidationError } from "../types";
import { acceptedAnswers, isWar, SURVIVAL_LIMITS, type SurvivalContent } from "./content";

export function validateSurvival(content: SurvivalContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.rounds.length < SURVIVAL_LIMITS.minRounds) errors.push({ path: "rounds", message: `Нужно хотя бы ${SURVIVAL_LIMITS.minRounds} раундов.` });
  content.rounds.forEach((r, i) => {
    const n = i + 1;
    const where = `Раунд ${n}`;
    if (!r.text.trim()) errors.push({ path: `rounds/${r.id}/text`, message: `${where}: напишите ${r.kind === "task" ? "задание" : "вопрос"}.` });
    if (isWar(content, n) && r.kind !== "choice") errors.push({ path: `rounds/${r.id}/kind`, message: `${where} — войнушка: нужен вопрос с вариантами (кто первый верно).` });
    if (r.kind === "choice" && r.options.some((o) => !o.trim())) errors.push({ path: `rounds/${r.id}/options`, message: `${where}: заполните все четыре варианта.` });
    if (r.kind === "open" && acceptedAnswers(r).length === 0) errors.push({ path: `rounds/${r.id}/answer`, message: `${where}: укажите верный ответ.` });
  });
  return errors;
}
