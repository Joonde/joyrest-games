// Раунды квиза в конструкторе — отдельные блоки в списке вопросов (решение владельца 21 октября 2026).
// Хранение не меняется: название раунда лежит у первого вопроса раунда (`round`), остальные вопросы — `null`.
// Поэтому блок раунда держится за место в списке, а не за вопрос: вопрос, перенесённый через блок, переходит
// в соседний раунд, а блок остаётся там, где был.
import { moveItem, quizRounds, type QuizContent, type QuizQuestion } from "./content";

/** Порядок вопросов меняется, блоки раундов остаются на своих местах. */
export function moveKeepingRounds(questions: QuizQuestion[], from: number, to: number): QuizQuestion[] {
  const moved = moveItem(questions, from, to);
  if (moved === questions) return questions;
  const places = questions.map((q) => q.round);
  return moved.map((q, i) => (q.round === (places[i] ?? null) ? q : { ...q, round: places[i] ?? null }));
}

/** Удалить вопрос; если с него начинался раунд — раунд начнётся со следующего вопроса (если там не свой раунд). */
export function removeKeepingRound(questions: QuizQuestion[], id: string): QuizQuestion[] {
  const index = questions.findIndex((q) => q.id === id);
  if (index < 0) return questions;
  const gone = questions[index];
  const next = questions[index + 1];
  const out = questions.filter((q) => q.id !== id);
  if (gone?.round && next && next.round === null) return out.map((q) => (q.id === next.id ? { ...q, round: gone.round } : q));
  return out;
}

/** Название для нового раунда: «Раунд N», где N — его номер по счёту. */
export function nextRoundTitle(questions: QuizQuestion[], at: number): string {
  const before = quizRounds({ questions: questions.slice(0, at) } as QuizContent).length;
  // Раундов выше нет: вопросы выше станут «Раундом 1», а новый — вторым (с первого вопроса — первым).
  const n = before > 0 ? before + 1 : at > 0 ? 2 : 1;
  return `Раунд ${n}`;
}

/** С вопроса `index` начинается раунд с этим названием (пусто — «Раунд N»). */
export function startRoundAt(questions: QuizQuestion[], index: number, title?: string): QuizQuestion[] {
  const name = (title ?? "").trim() || nextRoundTitle(questions, index);
  return questions.map((q, i) => (i === index ? { ...q, round: name } : q));
}

/** Убрать блок раунда: его вопросы входят в раунд выше (или игра без раундов). */
export function removeRoundAt(questions: QuizQuestion[], index: number): QuizQuestion[] {
  return questions.map((q, i) => (i === index ? { ...q, round: null } : q));
}

/** Вставить вопрос после `index` (-1 — в начало); он входит в тот же раунд, если сам не начинает новый. */
export function insertAfter(questions: QuizQuestion[], index: number, question: QuizQuestion): QuizQuestion[] {
  return [...questions.slice(0, index + 1), question, ...questions.slice(index + 1)];
}
