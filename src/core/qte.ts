/**
 * QTE — быстрые события с телефона гостя («Бой с драконом»: удар катаной, уворот от луча, добивание;
 * план — документ проекта «Бой с драконом — план внедрения QTE и проверка (5 ноября 2026)»).
 *
 * Чистые функции без сети и часов. Старт общий для всех — по часам сервера с отсчётом «3-2-1»
 * (`QTE_COUNTDOWN_MS`), а реакцию меряет сам телефон от своего старта: задержка сети у разных
 * телефонов на точность не влияет. Сервер принимает ответ до `startedAt + timeLimit + 3 с`,
 * поэтому шаг QTE открывается с `timeLimit` из `qteTimeLimit`.
 *
 * Ответ телефона — одна запись на шаг:
 * - кольцо `{ qte: "ring", acc, ms }` — точность 0–100 и на сколько мс раньше (−) или позже (+) золота;
 * - уворот `{ qte: "swipe", dir, ms }` — куда смахнул и через сколько мс после старта;
 * - добивание `{ qte: "mash", taps }` — сколько раз нажал за всё время.
 * Значения обрезает `parseQteAnswer`: подделка с телефона даёт максимум «Идеально», не больше.
 */

export type QteKind = "ring" | "swipe" | "mash";
export type QteLevel = "easy" | "normal" | "hard";
export type QteGrade = "perfect" | "good" | "weak";
export type QteDir = "left" | "right";

export type QteAnswer =
  | { kind: "ring"; acc: number; ms: number | null }
  | { kind: "swipe"; dir: QteDir; ms: number }
  | { kind: "mash"; taps: number };

/** Отсчёт «3-2-1» до старта: телефон с медленной сетью успевает получить сигнал. */
export const QTE_COUNTDOWN_MS = 3000;
/** Кольцо сжимается от края до золотой зоны за это время. */
export const QTE_RING_TRAVEL_MS = 1600;
/** Добивание длится 10 секунд. */
export const QTE_MASH_MS = 10_000;
/** Больше 15 нажатий в секунду пальцами не бывает — лишнее отбрасываем. */
export const QTE_MASH_MAX_RATE = 15;
export const QTE_MASH_MAX = Math.round((QTE_MASH_MS / 1000) * QTE_MASH_MAX_RATE);
/** Разброс времени в ответе, который ещё имеет смысл хранить (мс). */
const MS_LIMIT = 10_000;

export const QTE_LEVELS: QteLevel[] = ["easy", "normal", "hard"];
export const QTE_LEVEL_TITLES: Record<QteLevel, string> = { easy: "Легко", normal: "Норма", hard: "Сложно" };

/**
 * Полуширина зоны «Хорошо» вокруг золота (мс): Легко ±0,4 с, Норма ±0,25 с, Сложно ±0,15 с —
 * вся зона 0,8 / 0,5 / 0,3 с. «Идеально» — ближе 40% от неё.
 */
const RING_HALF: Record<QteLevel, number> = { easy: 400, normal: 250, hard: 150 };
const PERFECT_SHARE = 0.4;
/** Ловкость героя (0–3) расширяет окно на 10% за очко. */
const AGILITY_STEP = 0.1;
/** Сколько секунд даётся на уворот после старта. */
const DODGE_MS: Record<QteLevel, number> = { easy: 3000, normal: 2500, hard: 1800 };

export const QTE_GRADE_TITLES: Record<QteGrade, string> = { perfect: "Идеально", good: "Хорошо", weak: "Слабо" };
/** Во сколько раз QTE меняет урон: промаха нет, «Слабо» тоже бьёт. */
export const QTE_POWER: Record<QteGrade, number> = { perfect: 2, good: 1.5, weak: 0.5 };

export function parseQteLevel(value: unknown): QteLevel {
  return value === "easy" || value === "hard" ? value : "normal";
}

function clampAgility(agility: number): number {
  return Number.isFinite(agility) ? Math.min(3, Math.max(0, Math.floor(agility))) : 0;
}

/** Полуширина зоны «Хорошо» (мс) с учётом Ловкости героя. */
export function ringHalfWindow(level: QteLevel, agility = 0): number {
  return Math.round(RING_HALF[level] * (1 + AGILITY_STEP * clampAgility(agility)));
}

/** Сколько мс даётся на уворот (Ловкость тоже помогает). */
export function dodgeWindow(level: QteLevel, agility = 0): number {
  return Math.round(DODGE_MS[level] * (1 + AGILITY_STEP * clampAgility(agility)));
}

/** Момент старта (часы сервера): шаг открыли в `startedAt`, дальше — отсчёт. */
export function qteGoAt(startedAt: number): number {
  return startedAt + QTE_COUNTDOWN_MS;
}

/** Момент золота у кольца (часы сервера). */
export function ringTargetAt(startedAt: number): number {
  return qteGoAt(startedAt) + QTE_RING_TRAVEL_MS;
}

/**
 * Время шага в секундах для сервера (`state.timeLimit`): отсчёт, само событие и запас на отправку.
 * Сервер добавит ещё 3 с (`ANSWER_GRACE_MS`).
 */
export function qteTimeLimit(kind: QteKind, level: QteLevel, agility = 3): number {
  const event = kind === "ring" ? QTE_RING_TRAVEL_MS + 2 * ringHalfWindow(level, agility) : kind === "swipe" ? dodgeWindow(level, agility) : QTE_MASH_MS;
  return Math.ceil((QTE_COUNTDOWN_MS + event + 2000) / 1000);
}

/** Точность 0–100 по ошибке нажатия: в золото — 100, на краю «Хорошо» — 50, дальше двух окон — 0. */
export function ringAccuracy(errorMs: number, half: number): number {
  if (!Number.isFinite(errorMs) || half <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - Math.abs(errorMs) / (2 * half)))));
}

/** Оценка по точности: от 80 — «Идеально» (ближе 40% окна), от 50 — «Хорошо», иначе «Слабо». */
export function gradeOf(accuracy: number): QteGrade {
  if (!Number.isFinite(accuracy)) return "weak";
  if (accuracy >= 100 * (1 - PERFECT_SHARE / 2)) return "perfect";
  if (accuracy >= 50) return "good";
  return "weak";
}

/** Итог команды: средняя точность нажавших; не нажал никто — «Слабо». */
export function teamRing(accuracies: number[]): { grade: QteGrade; acc: number; pressed: number } {
  const pressed = accuracies.filter((a) => Number.isFinite(a));
  if (pressed.length === 0) return { grade: "weak", acc: 0, pressed: 0 };
  const acc = Math.round(pressed.reduce((s, a) => s + Math.max(0, Math.min(100, a)), 0) / pressed.length);
  return { grade: gradeOf(acc), acc, pressed: pressed.length };
}

/** Куда смахнуть этому телефону: своя стрелка у каждого (по шагу и игроку), пульт считает так же. */
export function arrowFor(seed: string): QteDir {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Перемешиваем биты, иначе соседние семена дают одну сторону подряд.
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h & 1) === 0 ? "left" : "right";
}

/** Увернулся ли этот телефон: верная сторона и успел. */
export function swipeOk(answer: QteAnswer | null, expected: QteDir, window: number): boolean {
  return answer !== null && answer.kind === "swipe" && answer.dir === expected && answer.ms >= 0 && answer.ms <= window;
}

/** Команда увернулась, если успело больше половины телефонов на связи. */
export function teamDodged(succeeded: number, phones: number): boolean {
  return phones > 0 && succeeded * 2 > phones;
}

/** Добивание: в среднем ударов на телефон (маленькая команда не проигрывает из-за размера). */
export function mashAverage(taps: number[], phones: number): number {
  if (phones <= 0) return 0;
  const total = taps.reduce((s, t) => s + Math.max(0, Math.min(QTE_MASH_MAX, Number.isFinite(t) ? Math.floor(t) : 0)), 0);
  return Math.round((total / phones) * 10) / 10;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;

/** Ответ телефона → формат QTE с обрезанными значениями; не QTE — null. */
export function parseQteAnswer(raw: unknown): QteAnswer | null {
  if (!isRecord(raw)) return null;
  if (raw.qte === "ring") {
    const acc = intIn(raw.acc, 0, 100);
    if (acc === null) return null;
    return { kind: "ring", acc, ms: intIn(raw.ms, -MS_LIMIT, MS_LIMIT) };
  }
  if (raw.qte === "swipe") {
    if (raw.dir !== "left" && raw.dir !== "right") return null;
    const ms = intIn(raw.ms, 0, MS_LIMIT);
    if (ms === null) return null;
    return { kind: "swipe", dir: raw.dir, ms };
  }
  if (raw.qte === "mash") {
    const taps = intIn(raw.taps, 0, QTE_MASH_MAX);
    if (taps === null) return null;
    return { kind: "mash", taps };
  }
  return null;
}

/** Ответ для отправки (тот же формат, что читает `parseQteAnswer`). */
export function qteValue(answer: QteAnswer): Record<string, unknown> {
  if (answer.kind === "ring") return { qte: "ring", acc: answer.acc, ms: answer.ms };
  if (answer.kind === "swipe") return { qte: "swipe", dir: answer.dir, ms: answer.ms };
  return { qte: "mash", taps: answer.taps };
}

/**
 * Размер кольца в долях золотого (1 — ровно на золоте): от края (2,4) к золоту за `QTE_RING_TRAVEL_MS`
 * и дальше внутрь, пока не выйдет время. До старта — у края.
 */
export function ringScale(sinceGo: number): number {
  const start = 2.4;
  const t = Math.max(0, sinceGo) / QTE_RING_TRAVEL_MS;
  return Math.max(0.15, start - (start - 1) * t);
}

/** Цифра отсчёта на экране (3, 2, 1) или null после старта. */
export function countdownDigit(sinceGo: number): number | null {
  if (sinceGo >= 0) return null;
  return Math.min(3, Math.ceil(-sinceGo / 1000));
}
