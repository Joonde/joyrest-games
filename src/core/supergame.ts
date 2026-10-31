// Суперигра — общая для всех форматов часть блока: 4 уровня (бронза, серебро, золото, бриллиант),
// у каждого свои очки и вопрос любого формата (решение владельца 25 октября 2026): свой ответ, варианты,
// «Расставь по порядку» или «Угадай число», с картинкой и треком. Капитан (или игрок) выбирает уровень на
// телефоне и отвечает; «Показать ответы» — верно: + очки уровня, ошибка — по правилу блока. Здесь только
// данные и счёт: ход шага (заставка → выбор и ответ → ответы → таблица) ведёт формат, сейчас — квиз.
import { normalizeAnswer } from "./normalize";

export type SuperStyle = "chests" | "keys" | "crowns" | "cups";

/** Правило ошибки: без штрафа, −половина на золоте и бриллианте, −половина везде, −всё везде. */
export type SuperPenalty = "none" | "halfTop" | "halfAll" | "fullAll";

/** Формат вопроса уровня: свой ответ, варианты, по порядку, число. Нет поля (игры до 25 октября 2026) — свой ответ. */
export type SuperKind = "open" | "choice" | "order" | "number";

export const SUPER_KINDS: readonly SuperKind[] = ["open", "choice", "order", "number"];

export const SUPER_KIND_TITLES: Record<SuperKind, string> = {
  open: "Свой ответ",
  choice: "Варианты",
  order: "По порядку",
  number: "Угадай число",
};

export const SUPER_KIND_HINTS: Record<SuperKind, string> = {
  open: "Гость пишет ответ сам. Впишите все верные ответы — засчитается любой (регистр, ё/е и знаки не важны).",
  choice: "2–6 вариантов, отметьте верный (можно несколько). Гость касается варианта на телефоне.",
  order: "3–6 карточек — впишите в верном порядке. Гость увидит их вперемешку и расставит.",
  number: "Ответ — число. Верно, если гость попал точно или в пределах допуска.",
};

export interface SuperLevel {
  points: number;
  text: string;
  /** Верные ответы на свой ответ: подходит любой (регистр, ё/е, пробелы и знаки не важны). */
  answers: string[];
  imageId: string | null;
  /** Формат вопроса уровня; нет — свой ответ. */
  kind?: SuperKind;
  /** Варианты (`choice`) или карточки в верном порядке (`order`). */
  options?: string[];
  /** Номера верных вариантов (`choice`). */
  correct?: number[];
  /** «Угадай число»: верное число, единица и допуск (± столько засчитывается). */
  number?: number | null;
  unit?: string;
  tolerance?: number;
  /** Трек уровня: ведущий включает его на экране зала с пульта. */
  trackId?: string | null;
  trackStart?: number;
  trackLength?: number;
  fadeIn?: number;
  fadeOut?: number;
  /**
   * Уровня нет в этой суперигре (решение владельца 31 октября 2026: от двух уровней — «Бронза и Серебро», «Бронза,
   * Серебро и Бриллиант»). Номер уровня — всегда его медаль: картинки, названия и штраф «на золоте» не сдвигаются.
   */
  off?: boolean;
}

/** Формат уровня (старые уровни — свой ответ). */
export function levelKind(level: Pick<SuperLevel, "kind"> | undefined): SuperKind {
  return level?.kind ?? "open";
}

export const SUPER_LEVELS = 4;

/** Сколько уровней должно быть в суперигре хотя бы. */
export const SUPER_MIN_LEVELS = 2;

/** Номера уровней, которые есть в суперигре (по возрастанию). */
export function activeLevels(levels: Array<Pick<SuperLevel, "off">> | undefined): number[] {
  return (levels ?? []).flatMap((l, i) => (l.off ? [] : [i]));
}

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
  minOptions: 2,
  maxOptions: 6,
  minOrder: 3,
  unit: 20,
  maxNumber: 1_000_000_000_000,
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

function parseKind(value: unknown): SuperKind {
  return value === "choice" || value === "order" || value === "number" ? value : "open";
}

const TRACK_ID = /^[A-Za-z0-9_-]{1,64}$/;

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

/** Уровни из базы: всегда ровно четыре, мусор — значениями по умолчанию. */
export function parseLevels(value: unknown): SuperLevel[] {
  const list = Array.isArray(value) ? value : [];
  return DEFAULT_LEVEL_POINTS.map((fallback, i) => {
    const d = record(list[i]);
    const points = typeof d.points === "number" && Number.isFinite(d.points) ? Math.round(d.points) : fallback;
    const kind = parseKind(d.kind);
    const options = Array.isArray(d.options) ? d.options.slice(0, SUPER_LIMITS.maxOptions).map((o) => (typeof o === "string" ? o.slice(0, SUPER_LIMITS.answer) : "")) : [];
    const correct = Array.isArray(d.correct)
      ? [...new Set(d.correct.filter((c): c is number => Number.isInteger(c) && c >= 0 && c < options.length))].sort((a, b) => a - b)
      : [];
    const trackId = typeof d.trackId === "string" && TRACK_ID.test(d.trackId) ? d.trackId : null;
    const level: SuperLevel = {
      points: Math.min(SUPER_LIMITS.maxPoints, Math.max(SUPER_LIMITS.minPoints, points)),
      text: typeof d.text === "string" ? d.text.slice(0, SUPER_LIMITS.text) : "",
      answers: Array.isArray(d.answers) ? d.answers.slice(0, SUPER_LIMITS.answers).map((a) => (typeof a === "string" ? a.slice(0, SUPER_LIMITS.answer) : "")) : [""],
      imageId: typeof d.imageId === "string" && d.imageId.length > 0 ? d.imageId.slice(0, 64) : null,
    };
    if (kind !== "open") level.kind = kind;
    if (kind === "choice" || kind === "order") level.options = options;
    if (kind === "choice") level.correct = correct;
    if (kind === "number") {
      const n = d.number;
      level.number = typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= SUPER_LIMITS.maxNumber ? Math.round(n * 1000) / 1000 : null;
      level.unit = typeof d.unit === "string" ? d.unit.slice(0, SUPER_LIMITS.unit).trim() : "";
      level.tolerance = typeof d.tolerance === "number" && Number.isFinite(d.tolerance) && d.tolerance > 0 ? Math.min(SUPER_LIMITS.maxNumber, Math.round(d.tolerance * 1000) / 1000) : 0;
    }
    if (d.off === true) level.off = true;
    if (trackId) {
      level.trackId = trackId;
      level.trackStart = num(d.trackStart, 0, 0, 3600);
      level.trackLength = num(d.trackLength, 15, 3, 120);
      level.fadeIn = num(d.fadeIn, 0, 0, 10);
      level.fadeOut = num(d.fadeOut, 3, 0, 10);
    }
    return level;
  });
}

/** Сменить формат уровня: вопрос, картинка, трек и очки остаются, поля нового формата — по умолчанию. */
export function withLevelKind(level: SuperLevel, kind: SuperKind): SuperLevel {
  if (levelKind(level) === kind) return level;
  const next: SuperLevel = { ...level, kind };
  if (kind === "open") {
    delete next.kind;
    if (next.answers.length === 0) next.answers = [""];
  }
  if (kind === "choice") {
    const have = next.options ?? [];
    next.options = have.length >= SUPER_LIMITS.minOptions ? have : [...have, "", ""].slice(0, Math.max(SUPER_LIMITS.minOptions, have.length));
    next.correct = (next.correct ?? []).filter((c) => c < next.options!.length);
  }
  if (kind === "order") {
    const have = next.options ?? [];
    next.options = have.length >= SUPER_LIMITS.minOrder ? have : [...have, "", "", ""].slice(0, Math.max(SUPER_LIMITS.minOrder, have.length));
  }
  if (kind === "number") {
    next.number = next.number ?? null;
    next.unit = next.unit ?? "";
    next.tolerance = next.tolerance ?? 0;
  }
  return next;
}

/** Как лежат карточки «По порядку» на телефонах: перемешанные одинаково везде (по уровню и тексту), не в верном порядке. */
export function superOrderShown(level: Pick<SuperLevel, "options" | "text">, index: number): number[] {
  const n = (level.options ?? []).length;
  const list = Array.from({ length: n }, (_, i) => i);
  let seed = 2166136261;
  const key = `${index}:${level.text}:${(level.options ?? []).join("|")}`;
  for (let i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 16777619);
  seed = seed >>> 0 || 1;
  for (let i = n - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const j = seed % (i + 1);
    [list[i], list[j]] = [list[j] as number, list[i] as number];
  }
  if (n > 1 && list.every((v, i) => v === i)) list.push(list.shift() as number);
  return list;
}

/** Число по-русски: «1 665», дробь через запятую. */
function numberText(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 3 }).replace(/\u00a0/g, " ");
}

/** Верный ответ уровня строкой (экран, телефон, пульт). */
export function levelAnswerText(level: SuperLevel | undefined): string {
  if (!level) return "—";
  const kind = levelKind(level);
  const options = level.options ?? [];
  if (kind === "choice") return (level.correct ?? []).map((c) => options[c]).filter((o): o is string => Boolean(o && o.trim())).join(" / ") || "—";
  if (kind === "order") return options.filter((o) => o.trim()).join(" → ") || "—";
  if (kind === "number") {
    if (level.number === null || level.number === undefined) return "—";
    const unit = level.unit ? ` ${level.unit}` : "";
    return `${numberText(level.number)}${unit}${level.tolerance ? ` (± ${numberText(level.tolerance)})` : ""}`;
  }
  return level.answers.find((a) => a.trim()) ?? "—";
}

/** Треки уровней (экран зала качает их заранее; копия игры и общая музыка). */
export function superTrackIds(levels: SuperLevel[] | undefined): string[] {
  return (levels ?? []).map((l) => l.trackId).filter((id): id is string => Boolean(id));
}

/** Сколько снимается за ошибку на этом уровне. */
export function penaltyFor(rule: SuperPenalty, level: number, points: number): number {
  if (rule === "none") return 0;
  if (rule === "fullAll") return points;
  if (rule === "halfTop" && level < 2) return 0;
  return Math.round(points / 2);
}

/** Ответ телефона в суперигре: уровень и ответ в формате уровня (текст, вариант, порядок или число). */
export interface SuperAnswer {
  level: number;
  text: string;
  /** Номер варианта («Варианты»). */
  choice?: number;
  /** Номера карточек по местам («По порядку»). */
  order?: number[];
  /** Число («Угадай число»). */
  guess?: number;
}

export function parseSuperAnswer(value: unknown): SuperAnswer | null {
  const d = record(value);
  const level = d.level;
  if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level >= SUPER_LEVELS) return null;
  const out: SuperAnswer = { level, text: typeof d.text === "string" ? d.text.slice(0, SUPER_LIMITS.answer) : "" };
  if (typeof d.choice === "number" && Number.isInteger(d.choice) && d.choice >= 0 && d.choice < SUPER_LIMITS.maxOptions) out.choice = d.choice;
  if (Array.isArray(d.order) && d.order.length <= SUPER_LIMITS.maxOptions && d.order.every((v) => Number.isInteger(v) && v >= 0 && v < SUPER_LIMITS.maxOptions)) {
    out.order = d.order as number[];
  }
  if (typeof d.guess === "number" && Number.isFinite(d.guess) && Math.abs(d.guess) <= SUPER_LIMITS.maxNumber) out.guess = d.guess;
  return out;
}

/** Что ответил гость — строкой (экран после ответов, телефон, пульт). */
export function superAnswerText(levels: SuperLevel[], answer: SuperAnswer): string {
  const level = levels[answer.level];
  const kind = levelKind(level);
  const options = level?.options ?? [];
  if (kind === "choice") return answer.choice !== undefined ? (options[answer.choice] ?? "—") : "—";
  if (kind === "order") return answer.order ? answer.order.map((i) => options[i] ?? "?").join(" → ") : "—";
  if (kind === "number") return answer.guess !== undefined ? `${numberText(answer.guess)}${level?.unit ? ` ${level.unit}` : ""}` : "—";
  return answer.text;
}

/** Ключ «засчитано ведущим»: уровень и ответ без регистра и знаков. */
export function acceptKey(level: number, text: string): string {
  return `${level}:${normalizeAnswer(text)}`;
}

/** Верен ли ответ: по формату уровня; свой ответ — совпал с одним из ответов уровня или засчитан ведущим. */
export function superRight(levels: SuperLevel[], answer: SuperAnswer, accepted: string[] = []): boolean {
  const level = levels[answer.level];
  if (!level) return false;
  const kind = levelKind(level);
  if (kind === "choice") return answer.choice !== undefined && (level.correct ?? []).includes(answer.choice);
  if (kind === "order") {
    const n = (level.options ?? []).length;
    const order = answer.order;
    return n > 0 && order !== undefined && order.length === n && new Set(order).size === n && order.every((v, i) => v === i);
  }
  if (kind === "number") {
    if (answer.guess === undefined || level.number === null || level.number === undefined) return false;
    return Math.abs(answer.guess - level.number) <= (level.tolerance ?? 0) + 1e-9;
  }
  const key = normalizeAnswer(answer.text);
  if (!key) return false;
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
  /** Уровни, ответы на которые считаются (уровни игры или один выбранный залом); нет — все включённые. */
  allowed: number[] = activeLevels(levels),
): Record<string, SuperVerdict> {
  const out: Record<string, SuperVerdict> = {};
  for (const a of answers) {
    const answer = parseSuperAnswer(a.value);
    if (!answer || !allowed.includes(answer.level)) continue;
    const points = levels[answer.level]?.points ?? 0;
    const right = superRight(levels, answer, accepted);
    const text = superAnswerText(levels, answer).slice(0, SUPER_LIMITS.answer * 3);
    out[a.pid] = { level: answer.level, text, right, delta: right ? points : 0 - penaltyFor(rule, answer.level, points) };
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
      text: typeof d.text === "string" ? d.text.slice(0, SUPER_LIMITS.answer * 3) : "",
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
    const map = groups[answer.level];
    if (!map) continue;
    const level = levels[answer.level];
    if (levelKind(level) !== "open") {
      // Варианты, порядок, число: засчитывать нечего — ответ верен или нет.
      const text = superAnswerText(levels, answer);
      const key = `${answer.level}#${text}`;
      const found = map.get(key);
      if (found) found.count++;
      else map.set(key, { key, text, count: 1, status: superRight(levels, answer) ? "correct" : "wrong" });
      continue;
    }
    const norm = normalizeAnswer(answer.text);
    if (!norm) continue;
    const key = acceptKey(answer.level, answer.text);
    const found = map.get(key);
    if (found) found.count++;
    else {
      const correct = (level?.answers ?? []).some((x) => normalizeAnswer(x) === norm);
      map.set(key, { key, text: answer.text.trim(), count: 1, status: correct ? "correct" : accepted.includes(key) ? "accepted" : "wrong" });
    }
  }
  return groups.map((m) => [...m.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "ru")));
}

/** Ошибки заполнения уровней (для проверки игры перед запуском). */
export function levelProblems(levels: SuperLevel[]): string[] {
  const problems: string[] = [];
  if (levels.length !== SUPER_LEVELS) problems.push("Нужно четыре уровня.");
  if (activeLevels(levels).length < SUPER_MIN_LEVELS) problems.push(`Включите хотя бы ${SUPER_MIN_LEVELS} уровня.`);
  levels.forEach((l, i) => {
    if (l.off) return;
    const name = LEVEL_NAMES[i] ?? `Уровень ${i + 1}`;
    const kind = levelKind(l);
    const options = l.options ?? [];
    if (!l.text.trim() && !l.imageId && !l.trackId) problems.push(`${name}: напишите вопрос, добавьте картинку или трек.`);
    if (kind === "open" && !l.answers.some((a) => normalizeAnswer(a).length > 0)) problems.push(`${name}: добавьте верный ответ.`);
    if (kind === "choice") {
      if (options.length < SUPER_LIMITS.minOptions || options.some((o) => !o.trim())) problems.push(`${name}: заполните варианты — от ${SUPER_LIMITS.minOptions} до ${SUPER_LIMITS.maxOptions}.`);
      if ((l.correct ?? []).length === 0) problems.push(`${name}: отметьте верный вариант.`);
    }
    if (kind === "order" && (options.length < SUPER_LIMITS.minOrder || options.some((o) => !o.trim()))) {
      problems.push(`${name}: заполните карточки — от ${SUPER_LIMITS.minOrder} до ${SUPER_LIMITS.maxOptions}.`);
    }
    if (kind === "number" && (l.number === null || l.number === undefined)) problems.push(`${name}: впишите верное число.`);
    if (!Number.isInteger(l.points) || l.points < SUPER_LIMITS.minPoints || l.points > SUPER_LIMITS.maxPoints) {
      problems.push(`${name}: очки — от ${SUPER_LIMITS.minPoints} до ${SUPER_LIMITS.maxPoints}.`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------- голосование «Играем суперигру?»

/**
 * Голосование перед суперигрой (решение владельца 25 октября 2026): суперигра может стоить очков раунда, поэтому
 * сначала зал решает, играть ли её. Голосует каждый телефон («Голосовать за» / «Против», до итога можно передумать),
 * экран показывает, сколько проголосовало, после «Подвести итог» — проценты. Играем, если «за» больше половины голосов.
 */
export interface SuperVote {
  phase: "open" | "done";
  yes: number;
  no: number;
  /** После итога: играем ли (ведущий может решить иначе — «Всё равно играть» / «Всё равно пропустить»). */
  passed?: boolean;
  /** Голоса разделились поровну: решает монетка на экране зала или ведущий (решение владельца 31 октября 2026). */
  tie?: boolean;
  /** Решила монетка (а не голоса и не ведущий). */
  coin?: boolean;
}

/** Секунд на голосование по умолчанию и границы. */
export const VOTE_TIME = { def: 20, min: 10, max: 90 } as const;

export function parseSuperVote(raw: unknown): SuperVote | undefined {
  const d = record(raw);
  if (d.phase !== "open" && d.phase !== "done") return undefined;
  const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
  const out: SuperVote = { phase: d.phase, yes: count(d.yes), no: count(d.no) };
  if (typeof d.passed === "boolean") out.passed = d.passed;
  if (d.tie === true) out.tie = true;
  if (d.coin === true) out.coin = true;
  return out;
}

/** Голос телефона: «за» или «против»; иначе null. */
export function parseVoteAnswer(value: unknown): "yes" | "no" | null {
  const v = record(value).vote;
  return v === "yes" || v === "no" ? v : null;
}

/** Подсчёт голосов: по одному на телефон (последний ответ), только поданные после открытия голосования. */
export function tallySuperVote(answers: Array<{ pid: string; value: unknown; submittedAt?: number | null }>, since: number | null): { yes: number; no: number } {
  const byPid = new Map<string, { vote: "yes" | "no"; at: number }>();
  for (const a of answers) {
    const vote = parseVoteAnswer(a.value);
    if (!vote) continue;
    const at = a.submittedAt ?? 0;
    if (since !== null && a.submittedAt !== null && a.submittedAt !== undefined && at < since) continue;
    const prev = byPid.get(a.pid);
    if (!prev || at >= prev.at) byPid.set(a.pid, { vote, at });
  }
  let yes = 0;
  let no = 0;
  for (const { vote } of byPid.values()) {
    if (vote === "yes") yes++;
    else no++;
  }
  return { yes, no };
}

/** Играем, если «за» больше половины поданных голосов (никто не голосовал — не играем; поровну — см. `voteTied`). */
export function votePassed(yes: number, no: number): boolean {
  return yes > no;
}

/** Голоса разделились поровну (и кто-то голосовал): решает монетка или ведущий. */
export function voteTied(yes: number, no: number): boolean {
  return yes === no && yes > 0;
}

/** Ничья, а решения ещё нет — ждём монетку или ведущего. */
export function voteUndecided(vote: SuperVote | undefined): boolean {
  return vote?.phase === "done" && vote.tie === true && vote.passed === undefined;
}

/** Доля «за» в процентах (0, если голосов нет). */
export function votePercent(yes: number, no: number): number {
  const total = yes + no;
  return total === 0 ? 0 : Math.round((yes * 100) / total);
}

// ---------------------------------------------------------------- как выбирают уровень

/**
 * Как выбирают уровень (решение владельца 31 октября 2026): `vote` — весь зал голосует на телефонах, играем один уровень,
 * на экране — одна картинка и её вопрос (по умолчанию, и у игр без поля); `each` — каждая команда (игрок) выбирает свой
 * уровень, как было до этого.
 */
export type SuperPickMode = "vote" | "each";

export const PICK_MODE_TITLES: Record<SuperPickMode, string> = {
  vote: "Весь зал голосует — играем один уровень",
  each: "Каждый выбирает свой уровень",
};

export function parsePickMode(value: unknown): SuperPickMode {
  return value === "each" ? "each" : "vote";
}

/** Голосование «какой уровень играем»: голоса по уровням (номер — медаль), после итога — выбранный уровень. */
export interface LevelVote {
  phase: "open" | "done";
  /** Голосов за каждый из четырёх уровней. */
  counts: number[];
  /** После итога: какой уровень играем. */
  level?: number;
  /** Голоса разделились: между какими уровнями тянули жребий. */
  tie?: number[];
  /** Уровень поменял ведущий. */
  host?: boolean;
}

function isLevel(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < SUPER_LEVELS;
}

export function parseLevelVote(raw: unknown): LevelVote | undefined {
  const d = record(raw);
  if (d.phase !== "open" && d.phase !== "done") return undefined;
  const list = Array.isArray(d.counts) ? d.counts : [];
  const counts = Array.from({ length: SUPER_LEVELS }, (_, i) => {
    const v = list[i];
    return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
  });
  const out: LevelVote = { phase: d.phase, counts };
  if (isLevel(d.level)) out.level = d.level;
  if (Array.isArray(d.tie)) {
    const tie = [...new Set(d.tie.filter(isLevel))].sort((a, b) => a - b);
    if (tie.length > 1) out.tie = tie;
  }
  if (d.host === true) out.host = true;
  return out;
}

/** Голос телефона за уровень: номер уровня; иначе null. */
export function parseLevelVoteAnswer(value: unknown): number | null {
  const v = record(value).levelVote;
  return isLevel(v) ? v : null;
}

/** Голоса за уровни: по одному на телефон (последний), только после открытия и только за уровни игры. */
export function tallyLevelVote(answers: Array<{ pid: string; value: unknown; submittedAt?: number | null }>, since: number | null, allowed: number[]): number[] {
  const byPid = new Map<string, { level: number; at: number }>();
  for (const a of answers) {
    const level = parseLevelVoteAnswer(a.value);
    if (level === null || !allowed.includes(level)) continue;
    const at = a.submittedAt ?? 0;
    if (since !== null && a.submittedAt !== null && a.submittedAt !== undefined && at < since) continue;
    const prev = byPid.get(a.pid);
    if (!prev || at >= prev.at) byPid.set(a.pid, { level, at });
  }
  const counts = Array.from({ length: SUPER_LEVELS }, () => 0);
  for (const { level } of byPid.values()) counts[level] = (counts[level] ?? 0) + 1;
  return counts;
}

/** Уровни с наибольшим числом голосов (никто не голосовал — все уровни игры: решит жребий). */
export function levelVoteLeaders(counts: number[], allowed: number[]): number[] {
  const best = Math.max(0, ...allowed.map((i) => counts[i] ?? 0));
  return allowed.filter((i) => (counts[i] ?? 0) === best);
}
