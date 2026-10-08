// Раздел «Две правды и ложь» — чистые функции.
//
// Шаг записи (`question`, ответ можно менять): телефон шлёт три факта о себе и какой из них выдуман —
// `{ facts: [a, b, c], lie: номер }`. «Показать игроков» — по одному игроку на шаг (`question` с таймером):
// на экране имя и три карточки (порядок перемешан, где ложь — не хранится), телефоны выбирают ложь
// (`{ pick: номер }`) → «Открыть ложь»: угадавшим — очки, игроку — очки за каждого обманутого.
import type { Answer, Session, SessionChange } from "../../data/types";
import { cleanText, type StoryContent } from "./content";

export const FACT_MAX = 120;

export interface LiesItem {
  pid: string;
  facts: string[];
}

export interface LiesReveal {
  lieAt: number | null;
  counts: number[];
  right: string[];
  deltas: Record<string, number>;
}

export interface LiesState {
  phase: "write" | "show";
  writeStep: number;
  items: LiesItem[];
  current: number;
  reveal: LiesReveal | null;
  history: Array<LiesReveal | null>;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function parseReveal(v: unknown): LiesReveal | null {
  const d = rec(v);
  if (!Array.isArray(d.counts)) return null;
  const deltas: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(d.deltas))) if (ID.test(k) && typeof n === "number") deltas[k] = n;
  return {
    lieAt: typeof d.lieAt === "number" ? d.lieAt : null,
    counts: d.counts.map((n) => (typeof n === "number" ? n : 0)).slice(0, 3),
    right: Array.isArray(d.right) ? d.right.filter((x): x is string => typeof x === "string") : [],
    deltas,
  };
}

export function parseLies(raw: unknown): LiesState | null {
  if (!raw || typeof raw !== "object") return null;
  const d = rec(raw);
  return {
    phase: d.phase === "show" ? "show" : "write",
    writeStep: typeof d.writeStep === "number" ? d.writeStep : 0,
    items: (Array.isArray(d.items) ? d.items : []).flatMap((x) => {
      const i = rec(x);
      return typeof i.pid === "string" && Array.isArray(i.facts) ? [{ pid: i.pid, facts: i.facts.map((f) => cleanText(f, FACT_MAX)).slice(0, 3) }] : [];
    }),
    current: typeof d.current === "number" ? d.current : 0,
    reveal: parseReveal(d.reveal),
    history: Array.isArray(d.history) ? d.history.map(parseReveal) : [],
  };
}

/** Три факта и номер лжи из ответа; неполный ответ — null. */
export function factsOf(value: unknown): { facts: string[]; lie: number } | null {
  const d = rec(value);
  const facts = Array.isArray(d.facts) ? d.facts.map((f) => cleanText(f, FACT_MAX)) : [];
  const lie = d.lie;
  if (facts.length !== 3 || facts.some((f) => f.length < 2) || typeof lie !== "number" || lie < 0 || lie > 2) return null;
  return { facts, lie };
}

export function pickOf(value: unknown): number | null {
  const p = rec(value).pick;
  return typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= 2 ? p : null;
}

export type LiesAction = "liesWrite" | "liesStart" | "liesReveal" | "liesNext";

/** Главная кнопка раздела; null — раздел сыгран. */
export function liesPrimary(l: LiesState | null): LiesAction | null {
  if (!l) return "liesWrite";
  if (l.phase === "write") return "liesStart";
  if (!l.reveal) return "liesReveal";
  return l.current + 1 < l.items.length ? "liesNext" : null;
}

export function liesWrite(session: Session): { lies: LiesState; change: Pick<SessionChange, "state"> } {
  const step = session.state.stage === "ready" ? session.state.step : session.state.step + 1;
  return { lies: { phase: "write", writeStep: step, items: [], current: 0, reveal: null, history: [] }, change: { state: { step, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0 } } };
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Факты, что прислали (по одному ответу на телефон). */
export function writtenFacts(answers: Answer[], step: number): Array<{ pid: string; facts: string[]; lie: number }> {
  return answers.filter((a) => a.step === step).flatMap((a) => {
    const f = factsOf(a.value);
    return f ? [{ pid: a.pid, ...f }] : [];
  });
}

/** «Показать игроков»: случайный порядок, у каждого — факты вперемешку. */
export function liesStart(session: Session, content: StoryContent, l: LiesState, answers: Answer[], random: () => number = Math.random): { lies: LiesState; change: Pick<SessionChange, "state"> } | null {
  const list = shuffle(writtenFacts(answers, l.writeStep), random).slice(0, content.liesMax);
  if (list.length === 0) return null;
  return {
    lies: { ...l, phase: "show", items: list.map((w) => ({ pid: w.pid, facts: shuffle(w.facts, random) })), current: 0, reveal: null, history: [] },
    change: { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: content.guessSeconds, revealed: false, answered: 0 } },
  };
}

/** «Открыть ложь»: где ложь — по ответу игрока на шаге записи. */
export function liesReveal(session: Session, content: StoryContent, l: LiesState, answers: Answer[], written: Array<{ pid: string; facts: string[]; lie: number }>, teamOf: (pid: string) => string = (p) => p): { lies: LiesState; change: SessionChange } {
  const item = l.items[l.current];
  if (!item) return { lies: l, change: {} };
  const own = written.find((w) => w.pid === item.pid);
  const lieText = own ? own.facts[own.lie] : undefined;
  const lieAt = lieText !== undefined ? item.facts.indexOf(lieText) : -1;
  const counts = [0, 0, 0];
  const right: string[] = [];
  let fooled = 0;
  for (const a of answers) {
    if (a.step !== session.state.step || a.pid === item.pid) continue;
    const p = pickOf(a.value);
    if (p === null) continue;
    counts[p] = (counts[p] ?? 0) + 1;
    if (p === lieAt) right.push(a.pid);
    else fooled++;
  }
  const deltas: Record<string, number> = {};
  const add = (pid: string, n: number) => {
    const to = teamOf(pid);
    if (n !== 0 && session.leaderboard[to]) deltas[to] = (deltas[to] ?? 0) + n;
  };
  for (const p of right) add(p, content.guessPoints);
  if (lieAt >= 0) add(item.pid, fooled * Math.round(content.foolPoints / 2));
  return {
    lies: { ...l, reveal: { lieAt: lieAt >= 0 ? lieAt : null, counts, right, deltas } },
    change: { state: { stage: "reveal", revealed: true }, ...(Object.keys(deltas).length > 0 ? { addScore: deltas } : {}) },
  };
}

export function liesNext(session: Session, content: StoryContent, l: LiesState): { lies: LiesState; change: Pick<SessionChange, "state"> } {
  return {
    lies: { ...l, current: l.current + 1, reveal: null, history: [...l.history, l.reveal] },
    change: { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: content.guessSeconds, revealed: false, answered: 0 } },
  };
}

const minus = (d: Record<string, number>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, -v]));

/** «Назад» внутри раздела; null — к заставке раздела (решает общий «Назад»). */
export function liesBack(session: Session, l: LiesState): { lies: LiesState | null; change: SessionChange; clearAnswers?: number } | null {
  const step = session.state.step;
  if (l.phase === "write") return null;
  if (l.reveal) {
    const m = minus(l.reveal.deltas);
    return { lies: { ...l, reveal: null }, change: { state: { stage: "question", revealed: false, startedAt: "server" }, ...(Object.keys(m).length > 0 ? { addScore: m } : {}) } };
  }
  if (l.current > 0) {
    return { lies: { ...l, current: l.current - 1, reveal: l.history[l.history.length - 1] ?? null, history: l.history.slice(0, -1) }, change: { state: { step: step - 1, stage: "reveal", revealed: true } }, clearAnswers: step };
  }
  return { lies: { ...l, phase: "write", items: [], current: 0 }, change: { state: { step: l.writeStep, stage: "question", startedAt: "server", timeLimit: null } }, clearAnswers: step };
}
