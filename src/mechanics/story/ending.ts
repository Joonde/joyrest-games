// Раздел «Что было дальше?» — чистые функции.
//
// Шаг записи (ответ можно менять): телефон шлёт начало своей истории и чем она кончилась на самом деле —
// `{ start, end }`. Дальше по истории: шаг «концовки» (`question`, таймер, ответ можно менять) — на
// экране начало и автор, все, кроме автора, придумывают концовку `{ fake }` → шаг «голос» (таймер): на
// экране концовки вперемешку вместе с настоящей (чьи — не видно), телефоны ищут правду (`{ pick: id }`)
// → «Открыть правду»: угадавшим — очки, автору выдумки — очки за каждого, кто ей поверил; никто не
// угадал — бонус автору истории.
import type { Answer, Session, SessionChange } from "../../data/types";
import { cleanText, type StoryContent } from "./content";
import { sameText } from "./text";

export const START_MAX = 200;
export const END_MAX = 140;
const MAX_OPTIONS = 6;

export interface EndingItem {
  pid: string;
  start: string;
}

export interface EndingOption {
  id: string;
  text: string;
}

export interface EndingReveal {
  realId: string | null;
  /** Чья концовка (null — настоящая). */
  owners: Record<string, string | null>;
  counts: Record<string, number>;
  right: string[];
  deltas: Record<string, number>;
}

export interface EndingState {
  phase: "write" | "fake" | "vote";
  writeStep: number;
  items: EndingItem[];
  current: number;
  fakeStep: number | null;
  options: EndingOption[];
  reveal: EndingReveal | null;
  history: Array<{ reveal: EndingReveal | null; options: EndingOption[] }>;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
function nums(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(v))) if (ID.test(k) && typeof n === "number") out[k] = n;
  return out;
}

function parseReveal(v: unknown): EndingReveal | null {
  const d = rec(v);
  if (!("counts" in d)) return null;
  const owners: Record<string, string | null> = {};
  for (const [k, o] of Object.entries(rec(d.owners))) owners[k] = typeof o === "string" ? o : null;
  return { realId: typeof d.realId === "string" ? d.realId : null, owners, counts: nums(d.counts), right: Array.isArray(d.right) ? d.right.filter((x): x is string => typeof x === "string") : [], deltas: nums(d.deltas) };
}

export function parseEnding(raw: unknown): EndingState | null {
  if (!raw || typeof raw !== "object") return null;
  const d = rec(raw);
  return {
    phase: d.phase === "fake" || d.phase === "vote" ? d.phase : "write",
    writeStep: typeof d.writeStep === "number" ? d.writeStep : 0,
    items: (Array.isArray(d.items) ? d.items : []).flatMap((x) => {
      const i = rec(x);
      return typeof i.pid === "string" && typeof i.start === "string" ? [{ pid: i.pid, start: cleanText(i.start, START_MAX) }] : [];
    }),
    current: typeof d.current === "number" ? d.current : 0,
    fakeStep: typeof d.fakeStep === "number" ? d.fakeStep : null,
    options: parseOptions(d.options),
    reveal: parseReveal(d.reveal),
    history: Array.isArray(d.history) ? d.history.map((h) => ({ reveal: parseReveal(rec(h).reveal), options: parseOptions(rec(h).options) })) : [],
  };
}

function parseOptions(v: unknown): EndingOption[] {
  return (Array.isArray(v) ? v : []).flatMap((x) => {
    const o = rec(x);
    return typeof o.id === "string" && typeof o.text === "string" ? [{ id: o.id, text: cleanText(o.text, END_MAX) }] : [];
  });
}

export function storyParts(value: unknown): { start: string; end: string } | null {
  const d = rec(value);
  const start = cleanText(d.start, START_MAX);
  const end = cleanText(d.end, END_MAX);
  return start.length >= 10 && end.length >= 3 ? { start, end } : null;
}

export function fakeOf(value: unknown): string {
  return cleanText(rec(value).fake, END_MAX);
}

export function endingPickOf(value: unknown): string | null {
  const p = rec(value).pick;
  return typeof p === "string" && ID.test(p) ? p : null;
}

export type EndingAction = "endingWrite" | "endingStart" | "endingVote" | "endingReveal" | "endingNext";

export function endingPrimary(_content: StoryContent, e: EndingState | null): EndingAction | null {
  if (!e) return "endingWrite";
  if (e.phase === "write") return "endingStart";
  if (e.phase === "fake") return "endingVote";
  if (!e.reveal) return "endingReveal";
  return e.current + 1 < e.items.length ? "endingNext" : null;
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const fakeStepChange = (step: number, content: StoryContent): Pick<SessionChange, "state"> => ({ state: { step, stage: "question", startedAt: "server", timeLimit: content.endingSeconds, revealed: false, answered: 0 } });

export function endingWrite(session: Session): { ending: EndingState; change: Pick<SessionChange, "state"> } {
  const step = session.state.stage === "ready" ? session.state.step : session.state.step + 1;
  return { ending: { phase: "write", writeStep: step, items: [], current: 0, fakeStep: null, options: [], reveal: null, history: [] }, change: { state: { step, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0 } } };
}

export function writtenEndings(answers: Answer[], step: number): Array<{ pid: string; start: string; end: string }> {
  return answers.filter((a) => a.step === step).flatMap((a) => {
    const p = storyParts(a.value);
    return p ? [{ pid: a.pid, ...p }] : [];
  });
}

/** «Начать»: истории в случайном порядке, первая — все придумывают концовку. */
export function endingStart(session: Session, content: StoryContent, e: EndingState, answers: Answer[], random: () => number = Math.random): { ending: EndingState; change: Pick<SessionChange, "state"> } | null {
  const list = shuffle(writtenEndings(answers, e.writeStep), random).slice(0, content.endingMax);
  if (list.length === 0) return null;
  const step = session.state.step + 1;
  return { ending: { ...e, phase: "fake", items: list.map((w) => ({ pid: w.pid, start: w.start })), current: 0, fakeStep: step, options: [], reveal: null, history: [] }, change: fakeStepChange(step, content) };
}

/** «Голосуем»: настоящая концовка и до 5 выдуманных вперемешку. */
export function endingVote(session: Session, content: StoryContent, e: EndingState, fakes: Answer[], written: Array<{ pid: string; end: string }>, random: () => number = Math.random): { ending: EndingState; change: Pick<SessionChange, "state"> } {
  const item = e.items[e.current];
  const real = item ? written.find((w) => w.pid === item.pid)?.end : undefined;
  const pool = shuffle(
    fakes.filter((a) => a.step === e.fakeStep && a.pid !== item?.pid).map((a) => fakeOf(a.value)).filter((t, i, all) => t.length >= 3 && (!real || !sameText(t, real)) && all.findIndex((x) => sameText(x, t)) === i),
    random,
  ).slice(0, MAX_OPTIONS - 1);
  const texts = shuffle([...(real ? [real] : []), ...pool], random);
  return {
    ending: { ...e, phase: "vote", options: texts.map((text, i) => ({ id: `o${i + 1}`, text })) },
    change: { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: content.guessSeconds, revealed: false, answered: 0 } },
  };
}

/** «Открыть правду»: кто угадал, чьи выдумки сработали. */
export function endingReveal(session: Session, content: StoryContent, e: EndingState, votes: Answer[], fakes: Answer[], written: Array<{ pid: string; end: string }>, teamOf: (pid: string) => string = (p) => p): { ending: EndingState; change: SessionChange } {
  const item = e.items[e.current];
  const real = item ? written.find((w) => w.pid === item.pid)?.end : undefined;
  const owners: Record<string, string | null> = {};
  for (const o of e.options) {
    if (real && sameText(o.text, real)) owners[o.id] = null;
    else owners[o.id] = fakes.find((a) => a.step === e.fakeStep && a.pid !== item?.pid && sameText(fakeOf(a.value), o.text))?.pid ?? null;
  }
  const realId = e.options.find((o) => real && sameText(o.text, real))?.id ?? null;
  const counts: Record<string, number> = {};
  const right: string[] = [];
  const deltas: Record<string, number> = {};
  const add = (pid: string, n: number) => {
    const to = teamOf(pid);
    if (n !== 0 && session.leaderboard[to]) deltas[to] = (deltas[to] ?? 0) + n;
  };
  for (const a of votes) {
    if (a.step !== session.state.step || a.pid === item?.pid) continue;
    const p = endingPickOf(a.value);
    if (!p || !e.options.some((o) => o.id === p) || owners[p] === a.pid) continue;
    counts[p] = (counts[p] ?? 0) + 1;
    if (p === realId) {
      right.push(a.pid);
      add(a.pid, content.guessPoints);
    } else {
      const owner = owners[p];
      if (owner) add(owner, content.foolPoints);
    }
  }
  if (right.length === 0 && item) add(item.pid, content.authorBonus);
  return { ending: { ...e, reveal: { realId, owners, counts, right, deltas } }, change: { state: { stage: "reveal", revealed: true }, ...(Object.keys(deltas).length > 0 ? { addScore: deltas } : {}) } };
}

export function endingNext(session: Session, content: StoryContent, e: EndingState): { ending: EndingState; change: Pick<SessionChange, "state"> } {
  const step = session.state.step + 1;
  return { ending: { ...e, phase: "fake", current: e.current + 1, fakeStep: step, options: [], reveal: null, history: [...e.history, { reveal: e.reveal, options: e.options }] }, change: fakeStepChange(step, content) };
}

const minus = (d: Record<string, number>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, -v]));

/** «Назад» внутри раздела; null — к заставке раздела. */
export function endingBack(session: Session, e: EndingState): { ending: EndingState; change: SessionChange; clearAnswers?: number } | null {
  const step = session.state.step;
  if (e.phase === "write") return null;
  if (e.reveal) {
    const m = minus(e.reveal.deltas);
    return { ending: { ...e, reveal: null }, change: { state: { stage: "question", revealed: false, startedAt: "server" }, ...(Object.keys(m).length > 0 ? { addScore: m } : {}) } };
  }
  if (e.phase === "vote") return { ending: { ...e, phase: "fake", options: [] }, change: { state: { step: step - 1, stage: "question", startedAt: "server", revealed: false } }, clearAnswers: step };
  if (e.current > 0) {
    const last = e.history[e.history.length - 1];
    return { ending: { ...e, phase: "vote", current: e.current - 1, fakeStep: step - 2, options: last?.options ?? [], reveal: last?.reveal ?? null, history: e.history.slice(0, -1) }, change: { state: { step: step - 1, stage: "reveal", revealed: true } }, clearAnswers: step };
  }
  return { ending: { ...e, phase: "write", items: [], current: 0, fakeStep: null }, change: { state: { step: e.writeStep, stage: "question", startedAt: "server", timeLimit: null } }, clearAnswers: step };
}
