// «Кто хочет стать миллионером»: лестница из 12 или 15 вопросов (4 варианта, один верный), у каждой команды
// своя полоска на экране зала. Несгораемые ступени (по умолчанию 4-я и 8-я): ошибка роняет до
// последней пройденной. Подсказки — по одной каждого вида на команду за игру.
import { DEFAULT_SHOW_LOOK, parseShowLook, type ShowLook } from "../showLook";

/** Сколько ступеней может быть в лестнице: 12 (прежние игры) или 15 (новые и шаблон, решение владельца 14 октября 2026). */
export const LEVELS = 15;
export type LadderSize = 12 | 15;

/** Ступеней в этой игре. */
export function levelsOf(content: Pick<MillionaireContent, "ladder">): number {
  return (content.ladder?.length ?? 0) >= 15 ? 15 : 12;
}

export type LifelineId = "fifty" | "audience" | "call" | "mistake" | "swap" | "host";

export const LIFELINES: Array<{ id: LifelineId; title: string; short: string; icon: string; hint: string }> = [
  { id: "fifty", title: "50 на 50", short: "50:50", icon: "½", hint: "Убираются два неверных варианта" },
  { id: "audience", title: "Помощь зала", short: "Зал", icon: "👥", hint: "Гости голосуют телефонами и по QR на экране зала, проценты растут на глазах" },
  { id: "call", title: "Звонок другу", short: "Звонок", icon: "📞", hint: "Минута на разговор наедине с одним из команды" },
  { id: "mistake", title: "Право на ошибку", short: "Ошибка", icon: "🛡", hint: "Первая ошибка на этом вопросе не роняет вниз" },
  { id: "swap", title: "Замена вопроса", short: "Замена", icon: "🔄", hint: "Вопрос той же ступени меняется на запасной" },
  { id: "host", title: "Совет ведущего", short: "Совет", icon: "💡", hint: "Ведущий наводит на верные размышления — вслух или наводкой на экране" },
];

export const LIFELINE_IDS = LIFELINES.map((l) => l.id);

export function lifelineTitle(id: LifelineId): string {
  return LIFELINES.find((l) => l.id === id)?.title ?? id;
}

export interface MillionaireQuestion {
  id: string;
  /** Ступень 1–12. Вопросов на ступень может быть несколько: каждой команде — свой, плюс запасные. */
  level: number;
  text: string;
  options: string[];
  /** Номер верного варианта (0–3). */
  correct: number;
  /** Пояснение для ведущего (видит только пульт). */
  note: string;
  /** Наводка для «Совета ведущего»: ведущий читает её вслух или показывает на экране. */
  hint?: string;
}

export interface MillionaireContent {
  questions: MillionaireQuestion[];
  /** Очки ступеней 1–12. */
  ladder: number[];
  /** Несгораемые ступени (номера 1–11). */
  safe: number[];
  /** Какие подсказки есть в игре. */
  lifelines: LifelineId[];
  /** Сколько секунд на «Звонок другу» и на голосование зала. */
  callSeconds: number;
  audienceSeconds: number;
  /** Время на ответ, секунд (0 — без таймера, как раньше); последние 10 с тикают на экране зала (14 октября 2026). */
  answerSeconds: number;
  /** Играют все команды по очереди или одна (её выбирает ведущий перед началом). */
  players: "all" | "one";
  /** Оформление экрана зала (`../showLook.ts`). Старые игры без поля — «Классика». */
  look: ShowLook;
  /**
   * Сколько раз команда может продолжить после ошибки (0–3); null — без ограничения (прежние игры). Попытки кончились —
   * выбывает (ведущий может всё равно дать ещё попытку).
   */
  attempts: number | null;
}

export const DEFAULT_LADDER = [1000, 2000, 3000, 5000, 10000, 20000, 50000, 100000, 200000, 300000, 500000, 1000000];
export const DEFAULT_LADDER_15 = [500, 1000, 2000, 3000, 5000, 10000, 15000, 25000, 50000, 100000, 150000, 250000, 400000, 600000, 1000000];
export const DEFAULT_SAFE: Record<LadderSize, number[]> = { 12: [4, 8], 15: [5, 10] };
export const ATTEMPT_CHOICES = [0, 1, 2, 3] as const;

/** Время на ответ: 0 — без таймера. */
export const ANSWER_TIME_CHOICES = [0, 15, 30, 45, 60, 90, 120] as const;

export const MILLIONAIRE_LIMITS = { text: 300, option: 120, note: 200, hint: 200, maxQuestions: 240, maxPoints: 10_000_000, minSeconds: 10, maxSeconds: 180, minAudience: 90, maxAudience: 300 } as const;

function id(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "m" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newMillionaireQuestion(level = 1): MillionaireQuestion {
  return { id: id(), level, text: "", options: ["", "", "", ""], correct: 0, note: "", hint: "" };
}

export function createMillionaire(): MillionaireContent {
  return {
    questions: Array.from({ length: LEVELS }, (_, i) => newMillionaireQuestion(i + 1)),
    ladder: [...DEFAULT_LADDER_15],
    safe: [...DEFAULT_SAFE[15]],
    lifelines: [...LIFELINE_IDS],
    callSeconds: 60,
    audienceSeconds: 90,
    answerSeconds: 30,
    players: "all",
    look: DEFAULT_SHOW_LOOK,
    attempts: 2,
  };
}

/** Лестница на 12 или 15 ступеней: очки — по умолчанию для размера, несгораемые — 4 и 8 или 5 и 10. */
export function resizeLadder(content: MillionaireContent, size: LadderSize): MillionaireContent {
  if (levelsOf(content) === size) return content;
  return { ...content, ladder: [...(size === 15 ? DEFAULT_LADDER_15 : DEFAULT_LADDER)], safe: [...DEFAULT_SAFE[size]], questions: content.questions.map((q) => (q.level > size ? { ...q, level: size } : q)) };
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);

export function parseMillionaire(raw: unknown): MillionaireContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const questions = (Array.isArray(d.questions) ? d.questions : []).slice(0, MILLIONAIRE_LIMITS.maxQuestions).map((item, i) => {
    const q = rec(item);
    let qid = typeof q.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(q.id) ? q.id : `m${i + 1}`;
    while (seen.has(qid)) qid += "_";
    seen.add(qid);
    const options = Array.from({ length: 4 }, (_, k) => str(Array.isArray(q.options) ? q.options[k] : "", MILLIONAIRE_LIMITS.option));
    return { id: qid, level: int(q.level, 1, 1, Array.isArray(d.ladder) && d.ladder.length >= 15 ? 15 : 12), text: str(q.text, MILLIONAIRE_LIMITS.text), options, correct: int(q.correct, 0, 0, 3), note: str(q.note, MILLIONAIRE_LIMITS.note), hint: str(q.hint, MILLIONAIRE_LIMITS.hint) };
  });
  const rawLadder = Array.isArray(d.ladder) ? d.ladder : [];
  // Старые игры — 12 ступеней; лестница из 15 значений — 15.
  const size: LadderSize = rawLadder.length >= 15 ? 15 : 12;
  const ladder = (size === 15 ? DEFAULT_LADDER_15 : DEFAULT_LADDER).map((def, i) => int(rawLadder[i], def, 0, MILLIONAIRE_LIMITS.maxPoints));
  const safe = Array.isArray(d.safe) ? [...new Set(d.safe.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n < size))].sort((a, b) => a - b) : [...DEFAULT_SAFE[size]];
  const lifelines = Array.isArray(d.lifelines) ? LIFELINE_IDS.filter((l) => (d.lifelines as unknown[]).includes(l)) : [...LIFELINE_IDS];
  return {
    questions,
    ladder,
    safe,
    lifelines,
    callSeconds: int(d.callSeconds, 60, MILLIONAIRE_LIMITS.minSeconds, MILLIONAIRE_LIMITS.maxSeconds),
    // Помощь зала — не меньше полутора минут: гостям нужно время навести камеру и проголосовать (14 октября 2026).
    audienceSeconds: int(d.audienceSeconds, 90, MILLIONAIRE_LIMITS.minAudience, MILLIONAIRE_LIMITS.maxAudience),
    answerSeconds: typeof d.answerSeconds === "number" && (ANSWER_TIME_CHOICES as readonly number[]).includes(d.answerSeconds) ? d.answerSeconds : 0,
    players: d.players === "one" ? "one" : "all",
    look: parseShowLook(d.look),
    attempts: typeof d.attempts === "number" && Number.isInteger(d.attempts) && d.attempts >= 0 && d.attempts <= 3 ? d.attempts : null,
  };
}

/** Очки за пройденную ступень (0 — ничего не пройдено). */
export function pointsAt(content: MillionaireContent, level: number): number {
  return level <= 0 ? 0 : (content.ladder[Math.min(levelsOf(content), level) - 1] ?? 0);
}

/** Куда падает ошибившийся: последняя несгораемая ступень ниже текущей (или ноль). */
export function safeFloor(content: MillionaireContent, level: number): number {
  return content.safe.filter((s) => s <= level).reduce((a, b) => Math.max(a, b), 0);
}

/** Вопросы ступени по порядку конструктора. */
export function questionsOf(content: MillionaireContent, level: number): MillionaireQuestion[] {
  return content.questions.filter((q) => q.level === level);
}

export const LETTERS = ["A", "B", "C", "D"];

/**
 * Список: «Вопрос?» с новой строки, варианты «- …», верный — «* …», «# Ступень 5» — с какой ступени
 * дальше (по умолчанию каждая новая строка-вопрос — следующая ступень по кругу 1–12).
 */
export function parseMillionaireList(text: string, size: number = 12): MillionaireQuestion[] {
  const out: MillionaireQuestion[] = [];
  let level = 0;
  let current: MillionaireQuestion | null = null;
  let fixed: number | null = null;
  const flush = () => {
    if (current && current.text) out.push(current);
    current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^#\s*ступень\s*(\d{1,2})/i);
    if (head) {
      flush();
      fixed = Math.min(size, Math.max(1, Number(head[1])));
      continue;
    }
    const opt = line.match(/^([-*•])\s*(.+)$/);
    if (opt && current) {
      const cur: MillionaireQuestion = current;
      const filled = cur.options.findIndex((o) => !o);
      if (filled >= 0) {
        cur.options[filled] = (opt[2] ?? "").slice(0, MILLIONAIRE_LIMITS.option);
        if (opt[1] === "*") cur.correct = filled;
      }
      continue;
    }
    flush();
    level = fixed ?? (level % size) + 1;
    current = { ...newMillionaireQuestion(level), text: line.slice(0, MILLIONAIRE_LIMITS.text) };
  }
  flush();
  return out.slice(0, MILLIONAIRE_LIMITS.maxQuestions);
}
