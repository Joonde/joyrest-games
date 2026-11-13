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

/**
 * Игры в игровой комнате («Бубликатор», решение владельца 13 ноября 2026): вопросов там нет, поэтому телефон засчитывается, если
 * его пачки с событиями дошли до игры хотя бы в стольких разных раундах (перелётах). Пишет сервер сам (`room_play`), по своим
 * данным о настоящих нажатиях, а не по «на связи».
 */
export const MIN_PLAYED_ROUNDS = 2;

/** 0 — игра не засчитана; иначе 1 балл до 20 телефонов и +0,5 за каждые полные следующие 5. */
export function gamePoints(phones: number, minutes: number): number {
  if (!Number.isFinite(phones) || !Number.isFinite(minutes)) return 0;
  if (phones <= MIN_PHONES || minutes < MIN_MINUTES) return 0;
  return 1 + 0.5 * Math.floor(Math.max(0, phones - 20) / 5);
}

/**
 * Игры в игровой комнате, которые знают «сыграна до конца» («Бубликатор», решение владельца 13 ноября 2026): вместо «не меньше
 * 40 минут» — игра сыграна до конца (все перелёты и пьедестал; считает сервер по своему состоянию комнаты). Остальное — как у
 * всех: больше 10 телефонов, 1 балл до 20 и +0,5 за каждые полные следующие 5.
 */
export function roomGamePoints(phones: number, playedToEnd: boolean): number {
  if (!playedToEnd || !Number.isFinite(phones) || phones <= MIN_PHONES) return 0;
  return 1 + 0.5 * Math.floor(Math.max(0, phones - 20) / 5);
}

/**
 * Баллы ведущему за площадку, которую он привёл по своему QR-коду: начисляются один раз, когда
 * анкету заведения принимают в базу («Проверено» или «Работали»). Не начисляются, если ведущий
 * принял свою же анкету сам.
 */
export const VENUE_POINTS = 10;

/** Начислить ли баллы за площадку при смене статуса. */
export function venueEarnsPoints(input: { source: string; hostId: string | null; from: string; to: string; actorId: string }): boolean {
  if (input.source !== "form" || !input.hostId || input.hostId === input.actorId) return false;
  const accepted = (s: string) => s === "checked" || s === "worked";
  return !accepted(input.from) && accepted(input.to);
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
