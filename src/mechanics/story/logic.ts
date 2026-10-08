// Ход «Не моей истории» — чистые функции.
//
// Шаг записи (`question`, режим `write`, ответ можно менять): телефоны шлют `{ story }`. Ведущий может
// убрать неподходящие → «Начать угадывание»: истории без имён, в случайном порядке, в `result.stories`
// (id `s1…`, автор не хранится — пульт находит его по тексту среди ответов шага записи). Каждая
// история — свой шаг (`question` с таймером): телефоны голосуют `{ guess: pid }`, автор тоже жмёт —
// для вида, его голос не считается → «Открыть автора» (`reveal`): угадавшим — очки, никто не угадал —
// очки автору → следующая история → награждение.
import { leaderboardAdditions } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { cleanText, STORY_LIMITS, type StoryContent } from "./content";

export type StoryMode = "write" | "guess";

export interface StoryItem {
  id: string;
  text: string;
}

export interface StoryReveal {
  author: string | null;
  /** Голоса за каждого (без голоса автора). */
  counts: Record<string, number>;
  /** Кто угадал. */
  right: string[];
  /** Очки этой истории (для «Назад»). */
  deltas: Record<string, number>;
}

export interface StoryResult {
  mode: StoryMode;
  /** Шаг записи: его ответы — истории. */
  writeStep: number | null;
  /** Ответы шага записи, убранные ведущим (id ответа). */
  hidden: string[];
  stories: StoryItem[];
  /** Какая история сейчас (номер в `stories`). */
  current: number;
  reveal: StoryReveal | null;
  /** На шаге записи ответ можно менять — сервер перезаписывает ответ того же телефона. */
  changeable: boolean;
  /** Итоги открытых историй — для «Назад» на прошлую историю. */
  history: Array<StoryReveal | null>;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown, max = 300) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, max) : []);
function nums(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(v))) if (ID.test(k) && typeof n === "number" && Number.isFinite(n)) out[k] = Math.round(n);
  return out;
}

function parseReveal(v: unknown): StoryReveal | null {
  const d = rec(v);
  if (!("counts" in d)) return null;
  return { author: typeof d.author === "string" ? d.author : null, counts: nums(d.counts), right: ids(d.right), deltas: nums(d.deltas) };
}

export function parseStoryResult(raw: unknown): StoryResult {
  const d = rec(raw);
  return {
    mode: d.mode === "guess" ? "guess" : "write",
    writeStep: typeof d.writeStep === "number" ? d.writeStep : null,
    hidden: ids(d.hidden),
    stories: (Array.isArray(d.stories) ? d.stories : []).flatMap((x) => {
      const s = rec(x);
      return typeof s.id === "string" && typeof s.text === "string" ? [{ id: s.id, text: cleanText(s.text, STORY_LIMITS.story) }] : [];
    }),
    current: typeof d.current === "number" && d.current >= 0 ? Math.floor(d.current) : 0,
    reveal: parseReveal(d.reveal),
    changeable: d.changeable === true,
    history: Array.isArray(d.history) ? d.history.map(parseReveal) : [],
  };
}

export function storySteps(): Step[] {
  return [];
}

export function score(): ScoreDelta[] {
  return [];
}

export function storyOf(value: unknown): string {
  return cleanText(rec(value).story, STORY_LIMITS.story);
}

export function guessOf(value: unknown): string | null {
  const g = rec(value).guess;
  return typeof g === "string" && ID.test(g) ? g : null;
}

/** Сравнение текстов без регистра и пробелов: телефон узнаёт свою историю, пульт — автора. */
export function sameText(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
  return n(a) === n(b) && n(a).length > 0;
}

/** Истории шага записи (без убранных ведущим), по порядку прихода. */
export function writtenStories(answers: Answer[], r: StoryResult): Array<{ id: string; pid: string; text: string }> {
  return answers
    .filter((a) => a.step === r.writeStep && !r.hidden.includes(a.id))
    .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))
    .flatMap((a) => {
      const text = storyOf(a.value);
      return text ? [{ id: a.id, pid: a.pid, text }] : [];
    });
}

/** Автор истории — по тексту среди ответов шага записи. */
export function authorOf(text: string, written: Array<{ pid: string; text: string }>): string | null {
  return written.find((w) => sameText(w.text, text))?.pid ?? null;
}

export type StoryAction = "write" | "start" | "reveal" | "next" | "podium" | "podiumNext" | "finish";

export function storyPrimary(session: Session): StoryAction {
  const { stage } = session.state;
  const r = parseStoryResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (stage === "ready") return "write";
  if (r.mode === "write") return "start";
  if (stage === "question") return "reveal";
  if (r.current + 1 < r.stories.length) return "next";
  return hasPodium(session.leaderboard) ? "podium" : "finish";
}

/** «Пишем истории»: телефоны пишут, ответ можно менять до начала угадывания. */
export function startWriting(session: Session, participants: Participant[]): SessionChange {
  return {
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
    state: { stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: { mode: "write", writeStep: session.state.step, hidden: [], stories: [], current: 0, reveal: null, changeable: true, history: [] } },
  };
}

/** Убрать историю (или вернуть) до начала угадывания. */
export function toggleHidden(session: Session, answerId: string): SessionChange {
  const r = parseStoryResult(session.state.result);
  const hidden = r.hidden.includes(answerId) ? r.hidden.filter((h) => h !== answerId) : [...r.hidden, answerId];
  return { state: { result: { ...r, hidden } } };
}

/** «Начать угадывание»: истории без имён в случайном порядке (не больше `maxStories`). */
export function startGuessing(session: Session, content: StoryContent, answers: Answer[], participants: Participant[], random: () => number = Math.random): SessionChange | null {
  const r = parseStoryResult(session.state.result);
  const list = writtenStories(answers, r);
  if (list.length === 0) return null;
  const shuffled = [...list];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as (typeof list)[number], shuffled[i] as (typeof list)[number]];
  }
  const played = content.maxStories > 0 ? shuffled.slice(0, content.maxStories) : shuffled;
  return {
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: content.guessSeconds,
      revealed: false,
      answered: 0,
      result: { ...r, mode: "guess", changeable: false, stories: played.map((s, i) => ({ id: `s${i + 1}`, text: s.text })), current: 0, reveal: null, history: [] },
    },
  };
}

/** Подсчёт голосов истории: голос автора и голоса за себя не считаются. */
export function tallyGuesses(answers: Answer[], step: number, author: string | null): { counts: Record<string, number>; right: string[] } {
  const counts: Record<string, number> = {};
  const right: string[] = [];
  for (const a of answers) {
    if (a.step !== step || a.pid === author) continue;
    const g = guessOf(a.value);
    if (!g || g === a.pid) continue;
    counts[g] = (counts[g] ?? 0) + 1;
    if (g === author) right.push(a.pid);
  }
  return { counts, right };
}

/** «Открыть автора»: очки угадавшим, а если никто не угадал — автору. */
export function revealAuthor(session: Session, content: StoryContent, answers: Answer[], written: Array<{ pid: string; text: string }>): SessionChange {
  const r = parseStoryResult(session.state.result);
  const story = r.stories[r.current];
  if (!story) return {};
  const author = authorOf(story.text, written);
  const { counts, right } = tallyGuesses(answers, session.state.step, author);
  const deltas: Record<string, number> = {};
  for (const p of right) if (session.leaderboard[p]) deltas[p] = content.guessPoints;
  if (right.length === 0 && author && session.leaderboard[author] && content.authorBonus > 0) deltas[author] = content.authorBonus;
  const add = Object.fromEntries(Object.entries(deltas).filter(([, d]) => d !== 0));
  return {
    state: { stage: "reveal", revealed: true, result: { ...r, reveal: { author, counts, right, deltas } } },
    ...(Object.keys(add).length > 0 ? { addScore: add } : {}),
  };
}

/** Следующая история. */
export function nextStory(session: Session, content: StoryContent): SessionChange {
  const r = parseStoryResult(session.state.result);
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: content.guessSeconds,
      revealed: false,
      answered: 0,
      result: { ...r, current: r.current + 1, reveal: null, history: [...r.history, r.reveal] },
    },
  };
}

export interface StoryBack {
  change: SessionChange;
  clearAnswers?: number;
}

const minus = (d: Record<string, number>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, -v]));

/** «Назад» на один этап; null — некуда. */
export function storyBack(session: Session): StoryBack | null {
  const { stage, step } = session.state;
  const r = parseStoryResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "ready") return null;
  if (r.mode === "write") return { change: { state: { stage: "ready", startedAt: null, result: null } }, clearAnswers: step };
  if (stage === "reveal" && r.reveal) {
    const add = minus(r.reveal.deltas);
    // Голоса остаются, таймер — заново: кто не успел, проголосует.
    return { change: { state: { stage: "question", revealed: false, startedAt: "server", result: { ...r, reveal: null } }, ...(Object.keys(add).length > 0 ? { addScore: add } : {}) } };
  }
  if (r.current > 0) {
    // Голоса этой истории стираются, прошлая — снова открыта (очки её на месте).
    const prev = r.history[r.history.length - 1] ?? null;
    return { change: { state: { step: step - 1, stage: "reveal", revealed: true, result: { ...r, current: r.current - 1, reveal: prev, history: r.history.slice(0, -1) } } }, clearAnswers: step };
  }
  // С первой истории — обратно к записи (истории на месте, их можно поправить).
  return { change: { state: { step: r.writeStep ?? step - 1, stage: "question", startedAt: "server", timeLimit: null, result: { ...r, mode: "write", changeable: true, stories: [], current: 0, reveal: null, history: [] } } }, clearAnswers: step };
}
