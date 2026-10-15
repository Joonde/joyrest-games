import type { ValidationError } from "../types";
import { HUNDRED_LIMITS, ROUND_TITLES, type HundredContent } from "./content";

/** Что исправить перед запуском: путь `questions/<id вопроса>/<поле>` или `rounds` для игры целиком. */
export function validateHundred(content: HundredContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.rounds.length === 0) errors.push({ path: "rounds", message: "Добавьте хотя бы один раунд." });
  const bigs = content.rounds.filter((r) => r.kind === "big");
  if (content.rounds.length > 0 && bigs.length === content.rounds.length) errors.push({ path: "rounds", message: "Кроме «Большой игры» нужен хотя бы один обычный раунд — в нём набирают очки." });
  if (bigs.length > 1) errors.push({ path: "rounds", message: "«Большая игра» — только одна, в конце." });
  const bigAt = content.rounds.findIndex((r) => r.kind === "big");
  if (bigAt >= 0 && bigAt !== content.rounds.length - 1) errors.push({ path: "rounds", message: "«Большая игра» — финал: поставьте её последним раундом." });
  content.rounds.forEach((round, i) => {
    const where = `Раунд ${i + 1} («${ROUND_TITLES[round.kind]}»)`;
    const need = round.kind === "big" ? HUNDRED_LIMITS.bigQuestions : 1;
    if (round.questions.length !== need) errors.push({ path: `rounds/${round.id}`, message: round.kind === "big" ? `${where}: нужно ${need} вопросов.` : `${where}: нужен вопрос.` });
    round.questions.forEach((q, k) => {
      const qWhere = round.kind === "big" ? `${where}, вопрос ${k + 1}` : where;
      if (!q.text.trim()) errors.push({ path: `questions/${q.id}/text`, message: `${qWhere}: напишите вопрос.` });
      const filled = q.answers.filter((a) => a.text.trim());
      if (filled.length < HUNDRED_LIMITS.minAnswers || filled.length > HUNDRED_LIMITS.maxAnswers) {
        errors.push({ path: `questions/${q.id}/answers`, message: `${qWhere}: на табло ${HUNDRED_LIMITS.minAnswers}–${HUNDRED_LIMITS.maxAnswers} ответов (сейчас ${filled.length}).` });
      }
      if (filled.length !== q.answers.length) errors.push({ path: `questions/${q.id}/answers`, message: `${qWhere}: есть пустой ответ — заполните или уберите его.` });
      for (const a of filled) if (a.points < 1) errors.push({ path: `questions/${q.id}/points`, message: `${qWhere}: у ответа «${a.text.trim()}» нет очков.` });
      const sum = q.answers.reduce((s, a) => s + a.points, 0);
      if (sum > 100) errors.push({ path: `questions/${q.id}/points`, message: `${qWhere}: сумма очков ${sum} — больше 100 (очки — доля опрошенных).` });
      const keys = filled.map((a) => a.text.trim().toLocaleLowerCase("ru").replace(/ё/g, "е"));
      if (new Set(keys).size !== keys.length) errors.push({ path: `questions/${q.id}/answers`, message: `${qWhere}: два одинаковых ответа.` });
    });
  });
  return errors;
}
