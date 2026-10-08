// Суперигра — общая для всех форматов часть блока: 4 уровня (бронза, серебро, золото, бриллиант),
// у каждого свои очки и вопрос. Капитан (или игрок) выбирает уровень на телефоне и пишет ответ;
// «Показать ответы» — верно: + очки уровня, ошибка — по правилу блока. Здесь только данные и счёт:
// ход шага (заставка → выбор и ответ → ответы → таблица) ведёт формат, сейчас — квиз.
import { normalizeAnswer } from "./normalize";

export type SuperStyle = "chests" | "keys" | "crowns" | "cups";

/** Правило ошибки: без штрафа, −половина на золоте и бриллианте, −половина везде, −всё везде. */
export type SuperPenalty = "none" | "halfTop" | "halfAll" | "fullAll";

export interface SuperLevel {
  points: number;
  text: string;
  /** Верные ответы: подходит любой (регистр, ё/е, пробелы и знаки не важны). */
  answers: string[];
  imageId: string | null;
}

export const SUPER_LEVELS = 4;

export const LEVEL_NAMES = ["Бронза", "Серебро", "Золото", "Бриллиант"] as const;

export const DEFAULT_LEVEL_POINTS = [100, 200, 300, 500] as const;

export const STYLE_TITLES: Record<SuperStyle, string> = {
  chests: "Сундуки",
  keys: "Ключи",
  crowns: "Короны",
  cups: "Кубки",
};

/** Картинка уровня в оформлении (на экране, телефоне и в конструкторе). */
export const STYLE_ICONS: Record<SuperStyle, string> = {
  chests: "🧰",
  keys: "🗝️",
  crowns: "👑",
  cups: "🏆",
};

export const PENALTY_TITLES: Record<SuperPenalty, string> = {
  none: "Ошибка без штрафа",
  halfTop: "Ошибка на золоте и бриллианте — минус половина",
  halfAll: "Ошибка на любом уровне — минус половина",
  fullAll: "Ошибка на любом уровне — минус всё",
};

export const SUPER_LIMITS = {
  minPoints: 1,
  maxPoints: 5000,
  text: 300,
  answers: 10,
  answer: 100,
} as const;

export function newLevels(): SuperLevel[] {
  return DEFAULT_LEVEL_POINTS.map((points) => ({ points, text: "", answers: [""], imageId: null }));
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function parseStyle(value: unknown): SuperStyle {
  return value === "keys" || value === "crowns" || value === "cups" ? value : "chests";
}

export function parsePenalty(value: unknown): SuperPenalty {
  return value === "none" || value === "halfAll" || value === "fullAll" ? value : "halfTop";
}

/** Уровни из базы: всегда ровно четыре, мусор — значениями по умолчанию. */
export function parseLevels(value: unknown): SuperLevel[] {
  const list = Array.isArray(value) ? value : [];
  return DEFAULT_LEVEL_POINTS.map((fallback, i) => {
    const d = record(list[i]);
    const points = typeof d.points === "number" && Number.isFinite(d.points) ? Math.round(d.points) : fallback;
    return {
      points: Math.min(SUPER_LIMITS.maxPoints, Math.max(SUPER_LIMITS.minPoints, points)),
      text: typeof d.text === "string" ? d.text.slice(0, SUPER_LIMITS.text) : "",
      answers: Array.isArray(d.answers) ? d.answers.slice(0, SUPER_LIMITS.answers).map((a) => (typeof a === "string" ? a.slice(0, SUPER_LIMITS.answer) : "")) : [""],
      imageId: typeof d.imageId === "string" && d.imageId.length > 0 ? d.imageId.slice(0, 64) : null,
    };
  });
}

/** Сколько снимается за ошибку на этом уровне. */
export function penaltyFor(rule: SuperPenalty, level: number, points: number): number {
  if (rule === "none") return 0;
  if (rule === "fullAll") return points;
  if (rule === "halfTop" && level < 2) return 0;
  return Math.round(points / 2);
}

/** Ответ телефона в суперигре: уровень и текст. */
export interface SuperAnswer {
  level: number;
  text: string;
}

export function parseSuperAnswer(value: unknown): SuperAnswer | null {
  const d = record(value);
  const level = d.level;
  if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level >= SUPER_LEVELS) return null;
  return { level, text: typeof d.text === "string" ? d.text.slice(0, SUPER_LIMITS.answer) : "" };
}

/** Ключ «засчитано ведущим»: уровень и ответ без регистра и знаков. */
export function acceptKey(level: number, text: string): string {
  return `${level}:${normalizeAnswer(text)}`;
}

/** Верен ли ответ: совпал с одним из ответов уровня или засчитан ведущим. */
export function superRight(levels: SuperLevel[], answer: SuperAnswer, accepted: string[] = []): boolean {
  const key = normalizeAnswer(answer.text);
  if (!key) return false;
  const level = levels[answer.level];
  if (!level) return false;
  return level.answers.some((a) => normalizeAnswer(a) === key) || accepted.includes(acceptKey(answer.level, answer.text));
}

/** Итог участника: уровень, ответ, верно ли и сколько прибавилось (минус — штраф). */
export interface SuperVerdict {
  level: number;
  text: string;
  right: boolean;
  delta: number;
}

/** Итоги суперигры по ответам: у каждого участника — его уровень и прибавка. */
export function superVerdicts(
  levels: SuperLevel[],
  rule: SuperPenalty,
  answers: Array<{ pid: string; value: unknown }>,
  accepted: string[] = [],
): Record<string, SuperVerdict> {
  const out: Record<string, SuperVerdict> = {};
  for (const a of answers) {
    const answer = parseSuperAnswer(a.value);
    if (!answer) continue;
    const points = levels[answer.level]?.points ?? 0;
    const right = superRight(levels, answer, accepted);
    out[a.pid] = { level: answer.level, text: answer.text, right, delta: right ? points : 0 - penaltyFor(rule, answer.level, points) };
  }
  return out;
}

/** Кто какой уровень выбрал (для экрана во время выбора — без текста ответов). */
export function superPicks(answers: Array<{ pid: string; value: unknown }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of answers) {
    const answer = parseSuperAnswer(a.value);
    if (answer) out[a.pid] = answer.level;
  }
  return out;
}

export function parsePicks(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [pid, level] of Object.entries(record(value))) {
    if (typeof level === "number" && Number.isInteger(level) && level >= 0 && level < SUPER_LEVELS) out[pid] = level;
  }
  return out;
}

export function parseVerdicts(value: unknown): Record<string, SuperVerdict> {
  const out: Record<string, SuperVerdict> = {};
  for (const [pid, raw] of Object.entries(record(value))) {
    const d = record(raw);
    const level = d.level;
    if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level >= SUPER_LEVELS) continue;
    out[pid] = {
      level,
      text: typeof d.text === "string" ? d.text.slice(0, SUPER_LIMITS.answer) : "",
      right: d.right === true,
      delta: typeof d.delta === "number" && Number.isFinite(d.delta) ? Math.round(d.delta) : 0,
    };
  }
  return out;
}

/** Ответы для пульта по уровням: одинаковые после сравнения — одной строкой, частые — сверху. */
export interface SuperGroup {
  key: string;
  text: string;
  count: number;
  status: "correct" | "accepted" | "wrong";
}

export function superGroups(levels: SuperLevel[], answers: Array<{ value: unknown }>, accepted: string[]): SuperGroup[][] {
  const groups: Array<Map<string, SuperGroup>> = levels.map(() => new Map());
  for (const a of answers) {
    const answer = parseSuperAnswer(a.value);
    if (!answer) continue;
    const norm = normalizeAnswer(answer.text);
    if (!norm) continue;
    const key = acceptKey(answer.level, answer.text);
    const map = groups[answer.level];
    if (!map) continue;
    const found = map.get(key);
    if (found) found.count++;
    else {
      const correct = (levels[answer.level]?.answers ?? []).some((x) => normalizeAnswer(x) === norm);
      map.set(key, { key, text: answer.text.trim(), count: 1, status: correct ? "correct" : accepted.includes(key) ? "accepted" : "wrong" });
    }
  }
  return groups.map((m) => [...m.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "ru")));
}

/** Ошибки заполнения уровней (для проверки игры перед запуском). */
export function levelProblems(levels: SuperLevel[]): string[] {
  const problems: string[] = [];
  if (levels.length !== SUPER_LEVELS) problems.push("Нужно четыре уровня.");
  levels.forEach((l, i) => {
    const name = LEVEL_NAMES[i] ?? `Уровень ${i + 1}`;
    if (!l.text.trim() && !l.imageId) problems.push(`${name}: напишите вопрос или добавьте картинку.`);
    if (!l.answers.some((a) => normalizeAnswer(a).length > 0)) problems.push(`${name}: добавьте верный ответ.`);
    if (!Number.isInteger(l.points) || l.points < SUPER_LIMITS.minPoints || l.points > SUPER_LIMITS.maxPoints) {
      problems.push(`${name}: очки — от ${SUPER_LIMITS.minPoints} до ${SUPER_LIMITS.maxPoints}.`);
    }
  });
  return problems;
}
