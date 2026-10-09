// Раздел «Сочиняем историю» — чистые функции.
//
// Предложение-шаблон с пропусками («Однажды [кто] отправился в [куда]…»). Каждый участник (команда или
// игрок) по очереди получает «бумажку» на свой пропуск — несколько слов из банка — и выбирает одно на
// телефоне (`{ word: номер }`, в командах — капитан). «Показать историю» — предложение целиком на экране
// (кто не выбрал — слово выбирает случай). «Крутить рулетку» — колесо с именами всех гостей с
// телефонами, выпавший выходит и показывает историю. «Оценить» — шаг с таймером: телефоны ставят 1–5
// звёзд (`{ stars }`), выступившему (его команде) — среднее × `starPoints`.
import type { Answer, Session, SessionChange } from "../../data/types";
import { cleanText, fillTemplate, slotsOf, type StoryContent } from "./content";

export type WordsMode = "intro" | "pick" | "shown" | "spin" | "rate" | "rated";

export interface Paper {
  slot: number;
  label: string;
  /** Кто выбирает (участник, получающий очки); null — пропуск без участника, слово выберет случай. */
  pid: string | null;
  words: string[];
}

export interface WordsState {
  mode: WordsMode;
  /** Сколько предложений уже начато (номер текущего = sentence − 1). */
  sentence: number;
  template: string;
  papers: Paper[];
  /** Слова пропусков после «Показать историю». */
  filled: string[];
  /** Чья очередь получать бумажку дальше (по кругу). */
  pos: number;
  performer: string | null;
  /** Кому очки за показ: игрок или его команда. */
  scoreTo: string | null;
  /** Номер прокрутки (новый — экран крутит колесо). */
  spin: number;
  /** Имена на колесе (до 12, выпавший среди них). */
  wheel: string[];
  avg: number | null;
  votes: number;
  points: number;
  /** «Назад»: прежний шаг, этап и состояние раздела. */
  undo: { step: number; stage: string; words: Omit<WordsState, "undo"> } | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const MODES: WordsMode[] = ["intro", "pick", "shown", "spin", "rate", "rated"];

function parseFlat(raw: unknown): Omit<WordsState, "undo"> {
  const d = rec(raw);
  return {
    mode: MODES.includes(d.mode as WordsMode) ? (d.mode as WordsMode) : "intro",
    sentence: typeof d.sentence === "number" ? d.sentence : 0,
    template: typeof d.template === "string" ? cleanText(d.template, 240) : "",
    papers: (Array.isArray(d.papers) ? d.papers : []).slice(0, 12).flatMap((x) => {
      const p = rec(x);
      if (typeof p.slot !== "number") return [];
      return [{ slot: p.slot, label: typeof p.label === "string" ? p.label : "", pid: typeof p.pid === "string" && ID.test(p.pid) ? p.pid : null, words: Array.isArray(p.words) ? p.words.filter((w): w is string => typeof w === "string").slice(0, 8) : [] }];
    }),
    filled: Array.isArray(d.filled) ? d.filled.map((w) => (typeof w === "string" ? w : "")) : [],
    pos: typeof d.pos === "number" ? d.pos : 0,
    performer: typeof d.performer === "string" ? d.performer : null,
    scoreTo: typeof d.scoreTo === "string" ? d.scoreTo : null,
    spin: typeof d.spin === "number" ? d.spin : 0,
    wheel: Array.isArray(d.wheel) ? d.wheel.filter((x): x is string => typeof x === "string").slice(0, 12) : [],
    avg: typeof d.avg === "number" ? d.avg : null,
    votes: typeof d.votes === "number" ? d.votes : 0,
    points: typeof d.points === "number" ? d.points : 0,
  };
}

export function parseWords(raw: unknown): WordsState | null {
  if (!raw || typeof raw !== "object") return null;
  const u = rec(rec(raw).undo);
  return { ...parseFlat(raw), undo: typeof u.step === "number" && typeof u.stage === "string" ? { step: u.step, stage: u.stage, words: parseFlat(u.words) } : null };
}

const flat = (w: WordsState): Omit<WordsState, "undo"> => {
  const { undo: _u, ...rest } = w;
  return rest;
};

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Слово из ответа на бумажку. */
export function wordOf(value: unknown): number | null {
  const w = rec(value).word;
  return typeof w === "number" && Number.isInteger(w) && w >= 0 && w < 8 ? w : null;
}

export function starsOf(value: unknown): number | null {
  const s = rec(value).stars;
  return typeof s === "number" && Number.isInteger(s) && s >= 1 && s <= 5 ? s : null;
}

/** Предложение на экране: слова после показа, до — пустые пропуски. */
export function sentenceParts(w: WordsState) {
  return fillTemplate(w.template, w.mode === "pick" || w.mode === "intro" ? w.papers.map(() => null) : w.filled);
}

/** Начало раздела: заставка (`ready`). */
export function wordsIntro(): WordsState {
  return { mode: "intro", sentence: 0, template: "", papers: [], filled: [], pos: 0, performer: null, scoreTo: null, spin: 0, wheel: [], avg: null, votes: 0, points: 0, undo: null };
}

/** Можно ли сочинить ещё одно предложение. */
export function hasMoreSentences(content: StoryContent, w: WordsState): boolean {
  return content.templates.length > 0 && w.sentence < content.templates.length;
}

/**
 * Новое предложение: шаблон по порядку, бумажки — следующим по очереди участникам (`order` — команды или
 * игроки). Участников меньше, чем пропусков, — лишние пропуски заполнит случай.
 */
export function newSentence(session: Session, content: StoryContent, w: WordsState, order: string[], random: () => number = Math.random): { words: WordsState; change: Pick<SessionChange, "state"> } {
  const template = content.templates[w.sentence % Math.max(1, content.templates.length)] ?? "";
  const labels = slotsOf(template);
  const takers = order.length > 0 ? labels.map((_, i) => (i < order.length ? (order[(w.pos + i) % order.length] ?? null) : null)) : labels.map(() => null);
  const papers: Paper[] = labels.map((label, slot) => {
    const bank = content.bank[label] ?? [];
    return { slot, label, pid: takers[slot] ?? null, words: shuffle(bank, random).slice(0, content.paperWords) };
  });
  const next: WordsState = { ...w, mode: "pick", sentence: w.sentence + 1, template, papers, filled: [], pos: order.length > 0 ? (w.pos + Math.min(labels.length, order.length)) % order.length : 0, performer: null, scoreTo: null, wheel: [], avg: null, votes: 0, points: 0, undo: { step: session.state.step, stage: session.state.stage, words: flat(w) } };
  return {
    words: next,
    change: { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0 } },
  };
}

/** «Показать историю»: выбранные слова, у кого нет — случайное с его бумажки. */
export function showSentence(session: Session, w: WordsState, answers: Answer[], random: () => number = Math.random): { words: WordsState; change: Pick<SessionChange, "state"> } {
  const step = session.state.step;
  const filled = w.papers.map((p) => {
    const a = p.pid ? answers.find((x) => x.step === step && x.pid === p.pid) : undefined;
    const i = a ? wordOf(a.value) : null;
    const word = i !== null ? p.words[i] : undefined;
    return word ?? p.words[Math.floor(random() * p.words.length)] ?? "…";
  });
  return { words: { ...w, mode: "shown", filled, undo: { step, stage: session.state.stage, words: flat(w) } }, change: { state: { stage: "reveal", revealed: true } } };
}

/**
 * «Крутить рулетку»: случайный гость с телефона (`phones` — id телефонов-игроков, `teamOf` — его
 * команда). На колесе до 12 имён, выпавший — среди них.
 */
export function spinWheel(session: Session, w: WordsState, phones: string[], teamOf: (pid: string) => string, random: () => number = Math.random): { words: WordsState } {
  if (phones.length === 0) return { words: w };
  const performer = phones[Math.floor(random() * phones.length)] as string;
  const others = shuffle(phones.filter((p) => p !== performer), random).slice(0, 11);
  const wheel = shuffle([performer, ...others], random);
  return { words: { ...w, mode: "spin", performer, scoreTo: teamOf(performer), spin: w.spin + 1, wheel, undo: { step: session.state.step, stage: session.state.stage, words: flat(w) } } };
}

/** «Оценить»: шаг с таймером, телефоны ставят звёзды. */
export function startRating(session: Session, content: StoryContent, w: WordsState): { words: WordsState; change: Pick<SessionChange, "state"> } {
  return {
    words: { ...w, mode: "rate", undo: { step: session.state.step, stage: session.state.stage, words: flat(w) } },
    change: { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: content.rateSeconds, revealed: false, answered: 0 } },
  };
}

/** Средняя оценка: без самого выступившего (и без его команды). */
export function tallyStars(answers: Answer[], step: number, excluded: (pid: string) => boolean): { avg: number | null; votes: number } {
  const list = answers.filter((a) => a.step === step && !excluded(a.pid)).map((a) => starsOf(a.value)).filter((s): s is number => s !== null);
  if (list.length === 0) return { avg: null, votes: 0 };
  return { avg: Math.round((list.reduce((x, y) => x + y, 0) / list.length) * 10) / 10, votes: list.length };
}

/** «Итог»: очки выступившему (или его команде) — среднее × очки за звезду. */
export function finishRating(session: Session, content: StoryContent, w: WordsState, answers: Answer[], excluded: (pid: string) => boolean): { words: WordsState; change: SessionChange } {
  const { avg, votes } = tallyStars(answers, session.state.step, excluded);
  const points = avg !== null ? Math.round(avg * content.starPoints) : 0;
  const to = w.scoreTo;
  return {
    words: { ...w, mode: "rated", avg, votes, points, undo: { step: session.state.step, stage: session.state.stage, words: flat(w) } },
    change: { state: { stage: "reveal", revealed: true }, ...(to && points > 0 && session.leaderboard[to] ? { addScore: { [to]: points } } : {}) },
  };
}

/** «Назад» внутри раздела: прежний шаг и этап; очки показа снимаются. */
export function wordsBack(session: Session, w: WordsState): { words: WordsState | null; change: SessionChange; clearAnswers?: number } | null {
  if (!w.undo) return null;
  const u = w.undo;
  const stage = u.stage === "question" || u.stage === "reveal" || u.stage === "ready" ? u.stage : "reveal";
  const minus = w.mode === "rated" && w.scoreTo && w.points > 0 ? { addScore: { [w.scoreTo]: -w.points } } : {};
  return {
    words: { ...u.words, undo: null },
    change: { state: { step: u.step, stage, ...(stage === "question" ? { revealed: false } : { revealed: true }) }, ...minus },
    ...(session.state.step !== u.step ? { clearAnswers: session.state.step } : {}),
  };
}
