// «Гонка на выживание»: до 30 раундов из любых заданий, никто не выбывает — гонка по очкам. Каждый
// 5-й раунд — «Войнушка»: ставки (не меньше половины своего счёта), вопрос «кто первый верно» —
// победитель забирает банк (ставки + приз, растущий 100, 200, 300…). После второй войнушки в раундах,
// которые отметил ведущий (до 3), — аукцион «билета освобождения»: билет позволяет один раз пропустить
// войнушку без ставки.

export type SurvivalKind = "choice" | "open" | "task";

export interface SurvivalRound {
  id: string;
  kind: SurvivalKind;
  /** Вопрос или задание. */
  text: string;
  /** Варианты (вопрос с вариантами и вопрос войнушки). */
  options: string[];
  correct: number;
  /** Ответ для открытого вопроса (через «|» — несколько верных) или подсказка ведущему к заданию. */
  answer: string;
  points: number;
  /** Время на ответ, секунд (задание — без таймера). */
  seconds: number;
}

export interface SurvivalContent {
  rounds: SurvivalRound[];
  /** Каждый какой раунд — войнушка (5). */
  warEvery: number;
  /** Приз первой войнушки; дальше — ×2, ×3… */
  warPrize: number;
  /** Раунды (номера с 1), перед которыми идёт аукцион билета; только после второй войнушки, до 3. */
  tickets: number[];
  betSeconds: number;
  auctionSeconds: number;
}

export const SURVIVAL_LIMITS = { minRounds: 5, maxRounds: 30, text: 300, option: 120, answer: 200, maxPoints: 10_000, maxTickets: 3, minSeconds: 5, maxSeconds: 180 } as const;

export const KIND_TITLES: Record<SurvivalKind, string> = { choice: "Вопрос с вариантами", open: "Открытый вопрос", task: "Задание" };

export const LETTERS = ["A", "B", "C", "D"];

function id(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "r" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newSurvivalRound(kind: SurvivalKind = "choice"): SurvivalRound {
  return { id: id(), kind, text: "", options: ["", "", "", ""], correct: 0, answer: "", points: 100, seconds: kind === "task" ? 0 : 30 };
}

/** Войнушка ли раунд (номер с 1). */
export function isWar(content: Pick<SurvivalContent, "warEvery">, number: number): boolean {
  return content.warEvery > 0 && number % content.warEvery === 0;
}

/** Номер войнушки (1, 2, …) для раунда-войнушки. */
export function warIndex(content: Pick<SurvivalContent, "warEvery">, number: number): number {
  return content.warEvery > 0 ? Math.floor(number / content.warEvery) : 0;
}

/** Где можно поставить аукцион: после второй войнушки и не в раунд войнушки. */
export function ticketAllowed(content: Pick<SurvivalContent, "warEvery" | "rounds">, number: number): boolean {
  return number > content.warEvery * 2 && number <= content.rounds.length && !isWar(content, number);
}

export function createSurvival(): SurvivalContent {
  const rounds = Array.from({ length: 30 }, (_, i) => newSurvivalRound((i + 1) % 5 === 0 ? "choice" : i % 3 === 2 ? "task" : "choice"));
  return { rounds, warEvery: 5, warPrize: 100, tickets: [13, 18, 23], betSeconds: 30, auctionSeconds: 30 };
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);

export function parseSurvival(raw: unknown): SurvivalContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const rounds = (Array.isArray(d.rounds) ? d.rounds : []).slice(0, SURVIVAL_LIMITS.maxRounds).map((item, i) => {
    const r = rec(item);
    let rid = typeof r.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : `r${i + 1}`;
    while (seen.has(rid)) rid += "_";
    seen.add(rid);
    const kind: SurvivalKind = r.kind === "open" || r.kind === "task" ? r.kind : "choice";
    return {
      id: rid,
      kind,
      text: str(r.text, SURVIVAL_LIMITS.text),
      options: Array.from({ length: 4 }, (_, k) => str(Array.isArray(r.options) ? r.options[k] : "", SURVIVAL_LIMITS.option)),
      correct: int(r.correct, 0, 0, 3),
      answer: str(r.answer, SURVIVAL_LIMITS.answer),
      points: int(r.points, 100, 0, SURVIVAL_LIMITS.maxPoints),
      seconds: int(r.seconds, kind === "task" ? 0 : 30, 0, SURVIVAL_LIMITS.maxSeconds),
    };
  });
  const warEvery = int(d.warEvery, 5, 2, 10);
  const base = { rounds, warEvery };
  const tickets = Array.isArray(d.tickets)
    ? [...new Set(d.tickets.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && ticketAllowed(base, n)))].sort((a, b) => a - b).slice(0, SURVIVAL_LIMITS.maxTickets)
    : [];
  return {
    rounds,
    warEvery,
    warPrize: int(d.warPrize, 100, 0, SURVIVAL_LIMITS.maxPoints),
    tickets,
    betSeconds: int(d.betSeconds, 30, SURVIVAL_LIMITS.minSeconds, SURVIVAL_LIMITS.maxSeconds),
    auctionSeconds: int(d.auctionSeconds, 30, SURVIVAL_LIMITS.minSeconds, SURVIVAL_LIMITS.maxSeconds),
  };
}

/** Верные ответы открытого вопроса. */
export function acceptedAnswers(round: SurvivalRound): string[] {
  return round.answer
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * Список: строка — раунд по порядку. «Вопрос?» и строки «- вариант», «* верный» — вопрос с вариантами;
 * «Вопрос? = ответ | ответ2» — открытый; «Задание: …» — задание. «(150)» в конце — очки.
 */
export function parseSurvivalList(text: string): SurvivalRound[] {
  const out: SurvivalRound[] = [];
  let current: SurvivalRound | null = null;
  const flush = () => {
    if (current && current.text) out.push(current);
    current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const opt = line.match(/^([-*•])\s*(.+)$/);
    if (opt && current && (current as SurvivalRound).kind === "choice") {
      const cur = current as SurvivalRound;
      const free = cur.options.findIndex((o) => !o);
      if (free >= 0) {
        cur.options[free] = (opt[2] ?? "").slice(0, SURVIVAL_LIMITS.option);
        if (opt[1] === "*") cur.correct = free;
      }
      continue;
    }
    flush();
    const pts = line.match(/\((\d{1,5})\)\s*$/);
    const body = (pts ? line.slice(0, pts.index) : line).trim();
    const points = pts ? Math.min(SURVIVAL_LIMITS.maxPoints, Number(pts[1])) : 100;
    if (/^задание\s*[:.]/i.test(body)) {
      current = { ...newSurvivalRound("task"), text: body.replace(/^задание\s*[:.]\s*/i, "").slice(0, SURVIVAL_LIMITS.text), points };
    } else if (body.includes("=")) {
      const [q, a] = body.split("=");
      current = { ...newSurvivalRound("open"), text: (q ?? "").trim().slice(0, SURVIVAL_LIMITS.text), answer: (a ?? "").trim().slice(0, SURVIVAL_LIMITS.answer), points };
    } else {
      current = { ...newSurvivalRound("choice"), text: body.slice(0, SURVIVAL_LIMITS.text), points };
    }
  }
  flush();
  return out.slice(0, SURVIVAL_LIMITS.maxRounds);
}
