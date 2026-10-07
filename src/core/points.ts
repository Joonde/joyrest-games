/**
 * Баллы ведущего за проведённую игру (CLAUDE.md, «Квалификация, стаж и баллы»). Считает сервер
 * при «Завершить игру»; функция общая, чтобы правило было в одном месте и покрыто тестами.
 */

/** Сколько телефонов должно подключиться — больше этого числа. */
export const MIN_PHONES = 10;
/** Сколько минут должна идти игра (от «Начать игру» до «Завершить игру»). */
export const MIN_MINUTES = 40;
/** Телефон — настоящий игрок, если он (или его команда) ответил хотя бы на столько вопросов. */
export const MIN_ANSWERED_STEPS = 3;

/** 0 — игра не засчитана; иначе 1 балл до 20 телефонов и +0,5 за каждые полные следующие 5. */
export function gamePoints(phones: number, minutes: number): number {
  if (!Number.isFinite(phones) || !Number.isFinite(minutes)) return 0;
  if (phones <= MIN_PHONES || minutes < MIN_MINUTES) return 0;
  return 1 + 0.5 * Math.floor(Math.max(0, phones - 20) / 5);
}

/** Ручное начисление: шаг 0,5, не ноль, от −100 до 100. */
export function isValidManualPoints(points: number): boolean {
  return Number.isFinite(points) && points !== 0 && Math.abs(points) <= 100 && Number.isInteger(points * 2);
}

/** «1,5 балла», «−2 балла», «1 балл». */
export function pointsLabel(points: number): string {
  const text = (Math.round(points * 10) / 10).toLocaleString("ru-RU").replace("-", "−");
  if (!Number.isInteger(points)) return `${text} балла`;
  const n = Math.abs(points) % 100;
  const last = n % 10;
  if (n >= 11 && n <= 14) return `${text} баллов`;
  if (last === 1) return `${text} балл`;
  if (last >= 2 && last <= 4) return `${text} балла`;
  return `${text} баллов`;
}
