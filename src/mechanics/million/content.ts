// «Кто хочет стать миллионером»: все команды отвечают на один вопрос, у каждой своя лестница из
// 12 ступеней (несгораемые — 4-я и 8-я) и шесть подсказок — по одной на вопрос.

export type LifelineId = "fifty" | "swap" | "hall" | "call" | "second" | "host";

export const LIFELINES: Array<{ id: LifelineId; title: string; short: string; icon: string; hint: string }> = [
  { id: "fifty", title: "50 на 50", short: "50:50", icon: "½", hint: "Гаснут два неверных варианта" },
  { id: "swap", title: "Замена вопроса", short: "Замена", icon: "⇄", hint: "Запасной вопрос того же уровня" },
  { id: "hall", title: "Помощь зала", short: "Зал", icon: "👥", hint: "Гости голосуют 20 секунд" },
  { id: "call", title: "Звонок другу", short: "Звонок", icon: "📞", hint: "Минута наедине с одним из команды" },
  { id: "second", title: "Право на ошибку", short: "Ошибка", icon: "🛡", hint: "Ошибётесь — не упадёте" },
  { id: "host", title: "Совет ведущего", short: "Совет", icon: "🎤", hint: "Ведущий подскажет вслух" },
];

export const LIFELINE_IDS = LIFELINES.map((l) => l.id);

export function lifelineOf(id: string) {
  return LIFELINES.find((l) => l.id === id);
}

export interface MillionAsk {
  text: string;
  options: string[];
  /** Номер верного варианта (0–3). */
  correct: number;
}

export interface MillionQuestion extends MillionAsk {
  id: string;
  imageId: string | null;
  /** Запасной вопрос уровня — для «Замены вопроса». */
  spare: MillionAsk;
}

export interface MillionContent {
  questions: MillionQuestion[];
  /** Сумма на каждой ступени (по числу вопросов). */
  prizes: number[];
  /** Несгораемые ступени (номера с 1). */
  safe: number[];
  /** Какие подсказки есть в игре. */
  lifelines: LifelineId[];
  /** Секунд на ответ; null — без таймера (ведущий сам показывает ответ). */
  timeLimit: number | null;
  /** «Звонок другу», секунд. */
  callSeconds: number;
  /** «Помощь зала», секунд на голосование. */
  hallSeconds: number;
}

export const MILLION_LIMITS = { minQuestions: 3, maxQuestions: 15, text: 300, option: 120, maxPrize: 10_000_000, minTime: 10, maxTime: 300 } as const;

export const DEFAULT_PRIZES = [500, 1000, 2000, 3000, 5000, 10_000, 25_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];

function id(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "m" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

const emptyAsk = (): MillionAsk => ({ text: "", options: ["", "", "", ""], correct: 0 });

export function newMillionQuestion(): MillionQuestion {
  return { id: id(), ...emptyAsk(), imageId: null, spare: emptyAsk() };
}

export function createMillion(): MillionContent {
  return {
    questions: Array.from({ length: 12 }, newMillionQuestion),
    prizes: [...DEFAULT_PRIZES],
    safe: [4, 8],
    lifelines: [...LIFELINE_IDS],
    timeLimit: null,
    callSeconds: 60,
    hallSeconds: 20,
  };
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);

function parseAsk(v: unknown): MillionAsk {
  const d = rec(v);
  const raw = Array.isArray(d.options) ? d.options : [];
  const options = [0, 1, 2, 3].map((i) => str(raw[i], MILLION_LIMITS.option));
  return { text: str(d.text, MILLION_LIMITS.text), options, correct: int(d.correct, 0, 0, 3) };
}

/** Ступень выигрыша по умолчанию для n-го вопроса (если сумм меньше, чем вопросов). */
function defaultPrize(i: number): number {
  return DEFAULT_PRIZES[i] ?? (DEFAULT_PRIZES[DEFAULT_PRIZES.length - 1] as number) * (i - DEFAULT_PRIZES.length + 2);
}

export function parseMillion(raw: unknown): MillionContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const questions = (Array.isArray(d.questions) ? d.questions : []).slice(0, MILLION_LIMITS.maxQuestions).map((item, i) => {
    const q = rec(item);
    let qid = typeof q.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(q.id) ? q.id : `m${i + 1}`;
    while (seen.has(qid)) qid += "_";
    seen.add(qid);
    return {
      id: qid,
      ...parseAsk(q),
      imageId: typeof q.imageId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(q.imageId) ? q.imageId : null,
      spare: parseAsk(q.spare),
    };
  });
  const rawPrizes = Array.isArray(d.prizes) ? d.prizes : [];
  const prizes = questions.map((_, i) => int(rawPrizes[i], defaultPrize(i), 1, MILLION_LIMITS.maxPrize));
  // Суммы только растут: иначе «подняться» значило бы потерять очки.
  for (let i = 1; i < prizes.length; i++) if ((prizes[i] as number) <= (prizes[i - 1] as number)) prizes[i] = (prizes[i - 1] as number) + 1;
  const safe = [...new Set((Array.isArray(d.safe) ? d.safe : [4, 8]).filter((n): n is number => Number.isInteger(n) && n >= 1 && n < questions.length))].sort((a, b) => a - b).slice(0, 4);
  const lifelines = Array.isArray(d.lifelines) ? LIFELINE_IDS.filter((l) => (d.lifelines as unknown[]).includes(l)) : [...LIFELINE_IDS];
  return {
    questions,
    prizes,
    safe,
    lifelines,
    timeLimit: d.timeLimit === null || d.timeLimit === undefined ? null : int(d.timeLimit, 60, MILLION_LIMITS.minTime, MILLION_LIMITS.maxTime),
    callSeconds: int(d.callSeconds, 60, 15, 180),
    hallSeconds: int(d.hallSeconds, 20, 10, 60),
  };
}

export function millionMediaIds(content: MillionContent): string[] {
  return [...new Set(content.questions.flatMap((q) => (q.imageId ? [q.imageId] : [])))];
}

/** «1 000 000». */
export function prizeLabel(n: number): string {
  return n.toLocaleString("ru-RU").replace(/ /g, " ");
}
