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
import { cleanText, STORY_LIMITS, type SectionKind, type StoryContent } from "./content";
import { sameText } from "./text";
import { endingBack, endingPrimary, parseEnding, type EndingAction, type EndingState } from "./ending";
import { liesBack, liesPrimary, parseLies, type LiesAction, type LiesState } from "./lies";
import { hasMoreSentences, parseWords, wordsBack, wordsIntro, type WordsState } from "./words";

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
  /** Какой раздел идёт (номер в `content.sections`). */
  part: number;
  /** «Кто это сказал?»: номер вопроса. */
  q: number;
  /** Раздел «Сочиняем историю». */
  words: WordsState | null;
  /** Раздел «Две правды и ложь». */
  lies: LiesState | null;
  /** Раздел «Что было дальше?». */
  ending: EndingState | null;
  /** Гости с телефонами (в командах — люди, а не команды): за них голосуют, на них крутится рулетка. */
  people: string[];
  /** Имена гостей с телефонами (в командах их нет в таблице). */
  names: Record<string, string>;
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
    part: typeof d.part === "number" && d.part >= 0 ? Math.floor(d.part) : 0,
    q: typeof d.q === "number" && d.q >= 0 ? Math.floor(d.q) : 0,
    words: parseWords(d.words),
    lies: parseLies(d.lies),
    ending: parseEnding(d.ending),
    people: ids(d.people),
    names: Object.fromEntries(Object.entries(rec(d.names)).filter(([k, v]) => ID.test(k) && typeof v === "string").map(([k, v]) => [k, cleanText(v, 60)])),
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

export { sameText };

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

export type StoryAction = "write" | "start" | "reveal" | "next" | "nextQuestion" | LiesAction | EndingAction | "wordsSentence" | "wordsShow" | "wordsSpin" | "wordsRate" | "wordsRated" | "nextPart" | "podium" | "podiumNext" | "finish";

export function kindOf(content: StoryContent, part: number): SectionKind {
  return content.sections[part] ?? "author";
}

/** Что после раздела: следующий раздел или награждение. */
function afterPart(session: Session, content: StoryContent, r: StoryResult): StoryAction {
  if (r.part + 1 < content.sections.length) return "nextPart";
  return hasPodium(session.leaderboard) ? "podium" : "finish";
}

export function storyPrimary(session: Session, content: StoryContent): StoryAction {
  const { stage } = session.state;
  const r = parseStoryResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  const kind = kindOf(content, r.part);
  if (kind === "words") {
    const w = r.words;
    if (!w || w.mode === "intro") return hasMoreSentences(content, w ?? wordsIntro()) ? "wordsSentence" : afterPart(session, content, r);
    if (w.mode === "pick") return "wordsShow";
    if (w.mode === "shown") return "wordsSpin";
    if (w.mode === "spin") return "wordsRate";
    if (w.mode === "rate") return "wordsRated";
    return hasMoreSentences(content, w) ? "wordsSentence" : afterPart(session, content, r);
  }
  if (kind === "lies") return liesPrimary(r.lies) ?? afterPart(session, content, r);
  if (kind === "ending") return endingPrimary(content, r.ending) ?? afterPart(session, content, r);
  if (stage === "ready") return "write";
  if (r.mode === "write") return "start";
  if (stage === "question") return "reveal";
  if (r.current + 1 < r.stories.length) return "next";
  if (kind === "said" && r.q + 1 < content.saidQuestions.length) return "nextQuestion";
  return afterPart(session, content, r);
}

/** Следующий раздел: заставка раздела (`ready`). */
export function nextPart(session: Session): SessionChange {
  const r = parseStoryResult(session.state.result);
  return { state: { step: session.state.step + 1, stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: { ...emptyFlat(), people: r.people, names: r.names, part: r.part + 1, prevPart: { ...r, prevPart: null } } } };
}

/** Гости с телефонами и их имена: в одиночной игре — игроки таблицы, в командах — телефоны команд. */
export function peopleOf(session: Session, participants: Participant[]): { people: string[]; names: Record<string, string> } {
  if (session.playMode !== "teams") {
    const people = [...new Set([...Object.keys(session.leaderboard), ...participants.filter((p) => p.kind === "player").map((p) => p.id)])];
    const names: Record<string, string> = {};
    for (const p of participants) if (p.kind === "player") names[p.id] = p.name;
    return { people, names };
  }
  const phones = participants.filter((p) => p.kind === "player" && p.teamId).sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
  return { people: phones.map((p) => p.id), names: Object.fromEntries(phones.map((p) => [p.id, p.name])) };
}

/** Команда телефона (в одиночной игре — сам игрок). */
export function teamOfPhone(participants: Participant[]): (pid: string) => string {
  const map = new Map(participants.filter((p) => p.teamId).map((p) => [p.id, p.teamId as string]));
  return (pid) => map.get(pid) ?? pid;
}

/** Имя гостя: из таблицы или из имён телефонов. */
export function personName(session: Session, pid: string | null): string {
  if (!pid) return "";
  const names = rec(rec(session.state.result).names);
  return session.leaderboard[pid]?.name ?? (typeof names[pid] === "string" ? (names[pid] as string) : "Гость");
}

function emptyFlat(): Omit<StoryResult, "part"> {
  return { q: 0, people: [], names: {}, words: null, lies: null, ending: null, mode: "write", writeStep: null, hidden: [], stories: [], current: 0, reveal: null, changeable: false, history: [] };
}

/** Состояние раздела «Две правды и ложь» → изменение сессии (на записи ответ можно менять). */
export function withLies(session: Session, lies: LiesState | null, change: SessionChange = {}): SessionChange {
  const r = parseStoryResult(session.state.result);
  const prevPart = rec(session.state.result).prevPart ?? null;
  return { ...change, state: { ...(change.state ?? {}), result: { ...r, lies, changeable: lies?.phase === "write", prevPart } } };
}

/** Состояние раздела «Что было дальше?» → изменение сессии (запись и концовки можно менять). */
export function withEnding(session: Session, ending: EndingState | null, change: SessionChange = {}): SessionChange {
  const r = parseStoryResult(session.state.result);
  const prevPart = rec(session.state.result).prevPart ?? null;
  return { ...change, state: { ...(change.state ?? {}), result: { ...r, ending, changeable: ending?.phase === "write" || (ending?.phase === "fake" && !ending.reveal), prevPart } } };
}

/** Состояние раздела «Сочиняем историю» → изменение сессии. */
export function withWords(session: Session, words: WordsState, change: SessionChange = {}): SessionChange {
  const r = parseStoryResult(session.state.result);
  return { ...change, state: { ...(change.state ?? {}), result: { ...r, words } } };
}

/** «Пишем истории»: телефоны пишут, ответ можно менять до начала угадывания. */
export function startWriting(session: Session, participants: Participant[], q = 0): SessionChange {
  const additions = leaderboardAdditions(session.leaderboard, participants, session.playMode);
  const who = peopleOf({ ...session, leaderboard: { ...session.leaderboard, ...additions } }, participants);
  // Новый вопрос посреди раздела — новый шаг; с заставки раздела — тот же шаг.
  const step = session.state.stage === "ready" ? session.state.step : session.state.step + 1;
  const prevPart = rec(session.state.result).prevPart ?? null;
  return {
    leaderboard: additions,
    state: { step, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: { ...emptyFlat(), ...who, part: parseStoryResult(session.state.result).part, q, mode: "write", writeStep: step, changeable: true, prevPart, ...(q > 0 ? { prevQ: { ...parseStoryResult(session.state.result) } } : {}) } },
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
  const max = kindOf(content, r.part) === "said" ? content.saidShown : content.maxStories;
  const played = max > 0 ? shuffled.slice(0, max) : shuffled;
  return {
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: content.guessSeconds,
      revealed: false,
      answered: 0,
      result: { ...r, ...peopleOf(session, participants), mode: "guess", changeable: false, stories: played.map((s, i) => ({ id: `s${i + 1}`, text: s.text })), current: 0, reveal: null, history: [] },
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
export function revealAuthor(session: Session, content: StoryContent, answers: Answer[], written: Array<{ pid: string; text: string }>, teamOf: (pid: string) => string = (p) => p): SessionChange {
  const r = parseStoryResult(session.state.result);
  const story = r.stories[r.current];
  if (!story) return {};
  const author = authorOf(story.text, written);
  const { counts, right } = tallyGuesses(answers, session.state.step, author);
  const deltas: Record<string, number> = {};
  for (const p of right) {
    const to = teamOf(p);
    if (session.leaderboard[to]) deltas[to] = (deltas[to] ?? 0) + content.guessPoints;
  }
  const authorTo = author ? teamOf(author) : null;
  if (right.length === 0 && authorTo && session.leaderboard[authorTo] && content.authorBonus > 0) deltas[authorTo] = (deltas[authorTo] ?? 0) + content.authorBonus;
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
export function storyBack(session: Session, content: StoryContent): StoryBack | null {
  const { stage, step } = session.state;
  const r = parseStoryResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  const prevPart = rec(rec(session.state.result).prevPart);
  const toPrevPart = (): StoryBack | null => ("part" in prevPart ? { change: { state: { step: step - 1, stage: "reveal", revealed: true, result: prevPart } } } : null);
  if (kindOf(content, r.part) === "lies") {
    if (!r.lies) return toPrevPart();
    const b = liesBack(session, r.lies);
    if (!b) return { change: withLies(session, null, { state: { stage: "ready", startedAt: null } }), clearAnswers: step };
    return { change: withLies(session, b.lies, b.change), ...(b.clearAnswers !== undefined ? { clearAnswers: b.clearAnswers } : {}) };
  }
  if (kindOf(content, r.part) === "ending") {
    if (!r.ending) return toPrevPart();
    const b = endingBack(session, r.ending);
    if (!b) return { change: withEnding(session, null, { state: { stage: "ready", startedAt: null } }), clearAnswers: step };
    return { change: withEnding(session, b.ending, b.change), ...(b.clearAnswers !== undefined ? { clearAnswers: b.clearAnswers } : {}) };
  }
  if (kindOf(content, r.part) === "words") {
    if (r.words?.undo) {
      const b = wordsBack(session, r.words);
      return b ? { change: { ...b.change, state: { ...(b.change.state ?? {}), result: { ...r, words: b.words } } }, ...(b.clearAnswers !== undefined ? { clearAnswers: b.clearAnswers } : {}) } : null;
    }
    return toPrevPart();
  }
  if (stage === "ready") return toPrevPart();
  if (r.mode === "write") {
    const prevQ = rec(rec(session.state.result).prevQ);
    if ("part" in prevQ) return { change: { state: { step: step - 1, stage: "reveal", revealed: true, timeLimit: null, result: { ...prevQ, prevPart: rec(session.state.result).prevPart ?? null } } }, clearAnswers: step };
    return { change: { state: { stage: "ready", startedAt: null, result: r.part > 0 ? { ...emptyFlat(), part: r.part, prevPart } : null } }, clearAnswers: step };
  }
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
