import { EMPTY_BUZZ, parseBuzz, type BuzzState } from "../../core/buzz";
import { parsePenalty, parsePicks, parseVerdicts, superRight, superVerdicts, parseSuperAnswer, type SuperVerdict } from "../../core/supergame";
import type { Answer } from "../../data/types";
import type { ScoreContext, ScoreDelta, Step } from "../types";
import { correctSet, usesAnswers, type QuizContent, type QuizQuestion } from "./content";
import { normalizeAnswer } from "./normalize";

/** Шаг квиза — один вопрос. Показ, ответ и таблица — этапы шага (state.stage). */
export interface QuizStep extends Step {
  question: QuizQuestion;
}

export function steps(content: QuizContent): QuizStep[] {
  return content.questions.map((question) => ({ id: question.id, answerable: true, question }));
}

/**
 * Итоги шага в state.result: распределение ответов для экрана и открытые ответы,
 * которые ведущий засчитал вручную (опечатки). Видны экрану и телефонам.
 */
export interface QuizResult {
  /** Сколько гостей выбрали каждый вариант. */
  counts: number[];
  /** Сколько ответили верно. */
  correct: number;
  /** Сколько ответили всего. */
  total: number;
  /** Засчитанные ведущим открытые ответы (в нормализованном виде; у картинок — «номер:ответ»). */
  accepted: string[];
  /** Гонка: кнопка — порядок нажатий, у кого слово, «мимо», победитель. */
  buzz?: BuzzState;
  /** Несколько картинок: сколько угадали каждую. */
  right?: number[];
  /** Суперигра, пока идёт выбор: кто какой уровень выбрал (пишет пульт, без текста ответов). */
  picks?: Record<string, number>;
  /** Суперигра после «Показать ответы»: уровень, ответ, верно ли и прибавка каждого. */
  verdicts?: Record<string, SuperVerdict>;
  /** «Угадай число» после показа ответа: чьё какое число (экран ставит фишки на шкалу). */
  guesses?: Record<string, number>;
  /** «Аукцион»: этап, ставки, кто отвечает (пишет пульт). */
  auction?: AuctionState;
  /** Суперигра: ведущий включил трек уровня на экране зала (новый `n` — сыграть заново). */
  superPlay?: { level: number; n: number };
  /** Гонка: на этом шаге участник первым дошёл до финиша и получил бонус. */
  raceFinish?: { pid: string; bonus: number };
}

/**
 * «Аукцион» в итогах шага. `bets` — ставки во время ставок (кто поставил — `placed`, суммы пульт видит сам; на экран —
 * после «Ставки сделаны»), `answer` — отвечает `who` за `bet` (равные ставки — `tie`, жребий на экране), `all` — ставок
 * не было, отвечают все за очки вопроса.
 */
export interface AuctionState {
  phase: "bets" | "answer" | "all";
  /** Кто уже поставил (без сумм) — на экран во время ставок. */
  placed: string[];
  /** Ставки, принятые при «Ставки сделаны» (участник → очки); «Назад» к ставкам их возвращает. */
  bets: Record<string, number>;
  who: string | null;
  bet: number;
  /** Самая большая ставка была у нескольких — между ними жребий. */
  tie: string[];
}

export function parseAuction(raw: unknown): AuctionState | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const bets: Record<string, number> = {};
  if (typeof r.bets === "object" && r.bets !== null && !Array.isArray(r.bets)) {
    for (const [pid, v] of Object.entries(r.bets as Record<string, unknown>)) if (typeof v === "number" && Number.isInteger(v) && v > 0) bets[pid] = v;
  }
  return {
    phase: r.phase === "answer" || r.phase === "all" ? r.phase : "bets",
    placed: ids(r.placed),
    bets,
    who: typeof r.who === "string" ? r.who : null,
    bet: typeof r.bet === "number" && Number.isFinite(r.bet) ? Math.max(0, Math.round(r.bet)) : 0,
    tie: ids(r.tie),
  };
}

export function emptyResult(): QuizResult {
  return { counts: [], correct: 0, total: 0, accepted: [] };
}

/** Начальный итог шага: у гонки — пустая кнопка. */
export function startResult(q: QuizQuestion | undefined): QuizResult {
  return q?.kind === "buzz" ? { ...emptyResult(), buzz: EMPTY_BUZZ } : emptyResult();
}

export function parseResult(raw: unknown): QuizResult {
  if (typeof raw !== "object" || raw === null) return emptyResult();
  const r = raw as Record<string, unknown>;
  const nums = (v: unknown) => (Array.isArray(v) ? v.map((n) => (typeof n === "number" ? n : 0)) : []);
  const result: QuizResult = {
    counts: nums(r.counts),
    correct: typeof r.correct === "number" ? r.correct : 0,
    total: typeof r.total === "number" ? r.total : 0,
    accepted: Array.isArray(r.accepted) ? r.accepted.filter((a): a is string => typeof a === "string") : [],
  };
  if (r.buzz !== undefined) result.buzz = parseBuzz(r.buzz);
  if (Array.isArray(r.right)) result.right = nums(r.right);
  if (r.picks !== undefined) result.picks = parsePicks(r.picks);
  const auction = parseAuction(r.auction);
  if (auction) result.auction = auction;
  if (r.verdicts !== undefined) result.verdicts = parseVerdicts(r.verdicts);
  if (typeof r.superPlay === "object" && r.superPlay !== null && !Array.isArray(r.superPlay)) {
    const p = r.superPlay as Record<string, unknown>;
    if (typeof p.level === "number" && Number.isInteger(p.level) && p.level >= 0 && p.level < 4 && typeof p.n === "number") result.superPlay = { level: p.level, n: p.n };
  }
  if (typeof r.raceFinish === "object" && r.raceFinish !== null && !Array.isArray(r.raceFinish)) {
    const f = r.raceFinish as Record<string, unknown>;
    if (typeof f.pid === "string" && typeof f.bonus === "number" && Number.isFinite(f.bonus)) result.raceFinish = { pid: f.pid, bonus: f.bonus };
  }
  if (typeof r.guesses === "object" && r.guesses !== null && !Array.isArray(r.guesses)) {
    const guesses: Record<string, number> = {};
    for (const [pid, v] of Object.entries(r.guesses as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v)) guesses[pid] = v;
    result.guesses = guesses;
  }
  return result;
}

/** Совпадает ли текст с одним из верных ответов (или засчитан ведущим под этим ключом). */
function textMatches(answers: string[], value: unknown, accepted: string[], prefix = ""): boolean {
  if (typeof value !== "string") return false;
  const key = normalizeAnswer(value);
  return key.length > 0 && (answers.some((a) => normalizeAnswer(a) === key) || accepted.includes(prefix + key));
}

/** Несколько картинок: какие из ответов гостя верны (по номеру картинки). */
export function picturesRight(q: QuizQuestion, value: unknown, accepted: string[] = []): boolean[] {
  const list = Array.isArray(value) ? value : [];
  return (q.pictures ?? []).map((p, i) => textMatches(p.answers, list[i], accepted, `${i}:`));
}

// ---------------------------------------------------------------- «Расставь по порядку»

/** Простое число из строки (id вопроса) — одинаковое на экране, телефонах и пульте. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Как карточки лежат на экране и телефонах: перемешанные номера верного порядка (одинаково везде, зависит от id
 * вопроса). Никогда не совпадает с верным порядком — иначе отвечать нечего.
 */
export function orderShown(q: Pick<QuizQuestion, "id" | "options">): number[] {
  const n = q.options.length;
  const list = Array.from({ length: n }, (_, i) => i);
  let seed = seedOf(q.id) || 1;
  for (let i = n - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const j = seed % (i + 1);
    [list[i], list[j]] = [list[j] as number, list[i] as number];
  }
  if (n > 1 && list.every((v, i) => v === i)) list.push(list.shift() as number);
  return list;
}

/** Ответ «по порядку» от телефона: перестановка номеров карточек (номер — место в верном порядке). */
export function parseOrder(value: unknown, n: number): number[] | null {
  const raw = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>).order : null;
  if (!Array.isArray(raw) || raw.length !== n) return null;
  if (!raw.every((v) => Number.isInteger(v) && v >= 0 && v < n)) return null;
  return new Set(raw).size === n ? (raw as number[]) : null;
}

/** Сколько карточек стоят на своём месте (0, если ответа нет). */
export function orderHits(q: QuizQuestion, value: unknown): number {
  const order = parseOrder(value, q.options.length);
  return order ? order.filter((v, i) => v === i).length : 0;
}

// ---------------------------------------------------------------- «Угадай число»

/** Ответ «число» от телефона. */
export function parseGuess(value: unknown): number | null {
  const raw = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>).guess : null;
  return typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) <= 1e12 ? raw : null;
}

/** Доля очков по местам близости: 1-е (все одинаково близкие) — 100%, 2-е — 60%, 3-е — 30%. */
export const NUMBER_SHARES = [1, 0.6, 0.3] as const;

/**
 * Очки «Угадай число»: места по расстоянию до верного (одинаково близкие — одно место). «Только ближайший» — очки
 * лишь первому месту; «по близости» — 100/60/30%. Точно в цель — ещё +50%.
 */
export function numberDeltas(q: QuizQuestion, answers: Answer[]): Array<{ pid: string; delta: number; place: number; diff: number; guess: number }> {
  const target = q.number;
  if (target === null || target === undefined) return [];
  const guesses = answers.flatMap((a) => {
    const g = parseGuess(a.value);
    return g === null ? [] : [{ pid: a.pid, guess: g, diff: Math.abs(g - target) }];
  });
  const distinct = [...new Set(guesses.map((g) => g.diff))].sort((a, b) => a - b);
  const shares = q.scoring === "closest" ? [1] : [...NUMBER_SHARES];
  return guesses.map((g) => {
    const place = distinct.indexOf(g.diff);
    const share = shares[place] ?? 0;
    const exact = g.diff === 0 ? 1.5 : 1;
    return { pid: g.pid, guess: g.guess, diff: g.diff, place: place + 1, delta: Math.round(q.points * share * exact) };
  });
}

/** Верен ли ответ: номер варианта или открытый ответ (в том числе засчитанный ведущим). */
export function isCorrect(question: QuizQuestion, value: unknown, accepted: string[] = []): boolean {
  if (question.kind === "open") return textMatches(question.answers, value, accepted);
  if (question.kind === "auction") {
    if (usesAnswers(question)) return textMatches(question.answers, value, accepted);
    return typeof value === "number" && correctSet(question).includes(value);
  }
  // Картинки: верно, если угаданы все (для «Верно!» на телефоне; очки — за каждую).
  if (question.kind === "pictures") {
    const right = picturesRight(question, value, accepted);
    return right.length > 0 && right.every(Boolean);
  }
  if (question.kind === "buzz") return false;
  if (question.kind === "order") return question.options.length > 0 && orderHits(question, value) === question.options.length;
  // Число: «верно» — точно в цель; очки по близости телефон берёт из таблицы.
  if (question.kind === "number") return parseGuess(value) !== null && parseGuess(value) === question.number;
  if (question.kind === "super") {
    const answer = parseSuperAnswer(value);
    return answer !== null && superRight(question.levels ?? [], answer, accepted);
  }
  return typeof value === "number" && correctSet(question).includes(value);
}

/** Время ответа по часам сервера; без отметки — как ответ в последнюю секунду. */
function answerTime(answer: Answer, startedAt: number | null, limitMs: number): number {
  if (answer.submittedAt === null || startedAt === null) return limitMs;
  return Math.min(limitMs, Math.max(0, answer.submittedAt - startedAt));
}

/**
 * Очки за шаг. Обычный вопрос: верный ответ — очки вопроса. На скорость: самый быстрый
 * верный ответ получает максимум, ответ в последнюю секунду — половину, между ними — по
 * прямой. Время ответа = submittedAt − startedAt, оба значения ставит сервер.
 */
export function score(step: QuizStep, answers: Answer[], { state }: ScoreContext): ScoreDelta[] {
  const q = step.question;
  const result = parseResult(state.result);
  const accepted = result.accepted;
  // Аукцион: отвечает выигравший ставку — верно +ставка, неверно или молчит −ставка; ставок не было — как обычный вопрос.
  if (q.kind === "auction") {
    const auction = result.auction;
    const fresh = auctionAnswers(answers, state.startedAt);
    if (auction?.phase === "answer" && auction.who) {
      const mine = fresh.find((a) => a.pid === auction.who);
      const right = mine !== undefined && isCorrect(q, mine.value, accepted);
      return auction.bet > 0 ? [{ pid: auction.who, delta: right ? auction.bet : -auction.bet }] : [];
    }
    if (auction?.phase === "all") return fresh.filter((a) => isCorrect(q, a.value, accepted)).map((a) => ({ pid: a.pid, delta: q.points }));
    return [];
  }
  // Гонка: очки только тому, кому ведущий сказал «Верно».
  if (q.kind === "buzz") {
    const winner = (result.buzz ?? EMPTY_BUZZ).winner;
    return winner ? [{ pid: winner, delta: q.points }] : [];
  }
  // Суперигра: верно — очки выбранного уровня, ошибка — минус по правилу.
  if (q.kind === "super") {
    const verdicts = superVerdicts(q.levels ?? [], parsePenalty(q.penalty), answers, accepted);
    return Object.entries(verdicts)
      .filter(([, v]) => v.delta !== 0)
      .map(([pid, v]) => ({ pid, delta: v.delta }));
  }
  // Картинки: доля очков за каждую угаданную.
  if (q.kind === "pictures") {
    const n = (q.pictures ?? []).length;
    if (n === 0) return [];
    return answers.flatMap((a) => {
      const k = picturesRight(q, a.value, accepted).filter(Boolean).length;
      return k > 0 ? [{ pid: a.pid, delta: Math.round((q.points * k) / n) }] : [];
    });
  }
  // По порядку: всё верно — очки вопроса; частично — доля за каждую карточку на своём месте.
  if (q.kind === "order") {
    const n = q.options.length;
    if (n === 0) return [];
    return answers.flatMap((a) => {
      const k = orderHits(q, a.value);
      const delta = k === n ? q.points : q.partial === false ? 0 : Math.round((q.points * k) / n);
      return delta > 0 ? [{ pid: a.pid, delta }] : [];
    });
  }
  if (q.kind === "number") return numberDeltas(q, answers).filter((d) => d.delta > 0).map(({ pid, delta }) => ({ pid, delta }));
  const right = answers.filter((a) => isCorrect(q, a.value, accepted));
  if (q.kind !== "speed") return right.map((a) => ({ pid: a.pid, delta: q.points }));

  const limitMs = (state.timeLimit ?? q.timeLimit) * 1000;
  const times = right.map((a) => answerTime(a, state.startedAt, limitMs));
  const fastest = Math.min(...times);
  return right.map((a, i) => {
    const t = times[i] ?? limitMs;
    const share = limitMs > fastest ? (t - fastest) / (limitMs - fastest) : 0;
    return { pid: a.pid, delta: Math.round(q.points * (1 - 0.5 * share)) };
  });
}

/**
 * Ответы «Аукциона» на вопрос: только после старта ответа (ставки этого же шага — ответы того же участника раньше —
 * не ответ на вопрос; сервер заменяет их ответом).
 */
export function auctionAnswers(answers: Answer[], startedAt: number | null): Answer[] {
  return answers.filter((a) => startedAt === null || a.submittedAt === null || a.submittedAt >= startedAt).filter((a) => typeof a.value === "number" || typeof a.value === "string");
}

/** Распределение ответов для экрана зала. */
export function resultOf(q: QuizQuestion, answers: Answer[], accepted: string[], buzz?: BuzzState): QuizResult {
  if (q.kind === "buzz") {
    const b = buzz ?? EMPTY_BUZZ;
    return { counts: [], correct: b.winner ? 1 : 0, total: b.order.length, accepted, buzz: b };
  }
  if (q.kind === "super") {
    const verdicts = superVerdicts(q.levels ?? [], parsePenalty(q.penalty), answers, accepted);
    const list = Object.values(verdicts);
    return { counts: [], correct: list.filter((v) => v.right).length, total: list.length, accepted, verdicts };
  }
  if (q.kind === "pictures") {
    const per = answers.map((a) => picturesRight(q, a.value, accepted));
    const right = (q.pictures ?? []).map((_, i) => per.filter((r) => r[i]).length);
    return { counts: [], correct: per.filter((r) => r.length > 0 && r.every(Boolean)).length, total: answers.length, accepted, right };
  }
  if (q.kind === "order") {
    // На экране — сколько поставили каждую карточку на своё место.
    const right = q.options.map((_, i) => answers.filter((a) => parseOrder(a.value, q.options.length)?.[i] === i).length);
    return { counts: [], correct: answers.filter((a) => isCorrect(q, a.value, accepted)).length, total: answers.length, accepted, right };
  }
  if (q.kind === "number") {
    const guesses: Record<string, number> = {};
    for (const a of answers) {
      const g = parseGuess(a.value);
      if (g !== null) guesses[a.pid] = g;
    }
    return { counts: [], correct: answers.filter((a) => isCorrect(q, a.value, accepted)).length, total: answers.length, accepted, guesses };
  }
  const counts = usesAnswers(q) ? [] : q.options.map((_, i) => answers.filter((a) => a.value === i).length);
  return {
    counts,
    correct: answers.filter((a) => isCorrect(q, a.value, accepted)).length,
    total: answers.length,
    accepted,
  };
}

export interface OpenAnswerGroup {
  /** Нормализованный ответ: ключ группы. */
  key: string;
  /** Как написал первый гость. */
  text: string;
  count: number;
  status: "correct" | "accepted" | "wrong";
}

/**
 * Уникальные открытые ответы гостей для пульта: одинаковые после нормализации
 * собираются в одну строку, частые — сверху.
 */
export function groupOpenAnswers(q: QuizQuestion, answers: Answer[], accepted: string[], picture?: number): OpenAnswerGroup[] {
  const groups = new Map<string, OpenAnswerGroup>();
  const source = picture === undefined ? q.answers : (q.pictures?.[picture]?.answers ?? []);
  const correct = new Set(source.map(normalizeAnswer));
  const prefix = picture === undefined ? "" : `${picture}:`;
  for (const a of answers) {
    const raw = picture === undefined ? a.value : Array.isArray(a.value) ? a.value[picture] : undefined;
    if (typeof raw !== "string") continue;
    const norm = normalizeAnswer(raw);
    const key = norm ? prefix + norm : "";
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.count++;
    else {
      const status = correct.has(norm) ? "correct" : accepted.includes(key) ? "accepted" : "wrong";
      groups.set(key, { key, text: raw.trim(), count: 1, status });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "ru"));
}
