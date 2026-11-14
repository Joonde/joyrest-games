/** Содержимое игры из конструктора: разбор без исключений, непонятное — по умолчанию (docs/matryoshka.md, «Содержимое»). */
import {
  FINALISTS_DEFAULT,
  FINALISTS_MAX,
  FINALISTS_MIN,
  LIVES_ADULTS,
  LIVES_KIDS,
  OPTION_MAX_LEN,
  QUESTION_MAX_LEN,
  QUESTIONS_MAX,
  QUESTIONS_MIN,
  SECOND_CHANCE_DEFAULT,
  SECOND_CHANCE_OPTIONS,
} from "./constants";
import { BUILTIN_QUESTIONS } from "./questions";
import type { MatContent, Question, ShapeId, Style, Tempo, TrialKind } from "./types";

export const TRIAL_KINDS: readonly TrialKind[] = ["freeze", "ginger", "chairs", "rope", "hopscotch"];
export const SHAPE_IDS: readonly ShapeId[] = ["circle", "star", "tree", "matryoshka", "umbrella", "heart", "house"];
export const DEFAULT_SHAPES: readonly ShapeId[] = ["circle", "star", "tree", "matryoshka"];
export const STYLES: readonly Style[] = ["sunny", "night"];
export const TEMPOS: readonly Tempo[] = ["short", "normal", "long"];

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Свой вопрос: текст, 2–4 варианта, верный — номер варианта. Не годится — null. */
export function parseQuestion(raw: unknown): Question | null {
  const r = rec(raw);
  const q = cleanText(r.q, QUESTION_MAX_LEN);
  const options = Array.isArray(r.options) ? r.options.map((o) => cleanText(o, OPTION_MAX_LEN)).filter((o) => o !== "").slice(0, 4) : [];
  const correct = typeof r.correct === "number" && Number.isInteger(r.correct) ? r.correct : -1;
  if (q === "" || options.length < 2 || correct < 0 || correct >= options.length) return null;
  return { q, options, correct };
}

/** Порядок испытаний: «Замри!» всегда первым и включённым; остальные — как задал ведущий, каждое один раз. */
function parseTrials(raw: unknown): MatContent["trials"] {
  const seen = new Set<TrialKind>(["freeze"]);
  const out: MatContent["trials"] = [{ kind: "freeze", on: true }];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const r = rec(item);
      const kind = pick(r.kind, TRIAL_KINDS, "freeze");
      if (seen.has(kind)) continue;
      seen.add(kind);
      out.push({ kind, on: r.on !== false });
    }
  }
  for (const kind of TRIAL_KINDS) if (!seen.has(kind)) out.push({ kind, on: !Array.isArray(raw) });
  return out;
}

function parseShapes(raw: unknown): ShapeId[] {
  const list = Array.isArray(raw) ? [...new Set(raw.filter((x): x is ShapeId => typeof x === "string" && (SHAPE_IDS as readonly string[]).includes(x)))] : [];
  if (list.length === 4) return list;
  // Не четыре — добираем по умолчанию (или обрезаем).
  const out = list.slice(0, 4);
  for (const s of [...DEFAULT_SHAPES, ...SHAPE_IDS]) if (out.length < 4 && !out.includes(s)) out.push(s);
  return out;
}

export function parseContent(raw: unknown): MatContent {
  const r = rec(raw);
  const style = pick(r.style, STYLES, "sunny");
  const finalists = typeof r.finalists === "number" && Number.isFinite(r.finalists) ? Math.max(FINALISTS_MIN, Math.min(FINALISTS_MAX, Math.round(r.finalists))) : FINALISTS_DEFAULT;
  const lives = r.lives === 1 || r.lives === 2 ? r.lives : style === "night" ? LIVES_ADULTS : LIVES_KIDS;
  const sc = typeof r.secondChance === "number" && (SECOND_CHANCE_OPTIONS as readonly number[]).includes(r.secondChance) ? (r.secondChance as MatContent["secondChance"]) : SECOND_CHANCE_DEFAULT;
  const own = Array.isArray(r.questions) ? r.questions.map(parseQuestion).filter((q): q is Question => q !== null).slice(0, QUESTIONS_MAX) : [];
  return {
    style,
    trials: parseTrials(r.trials),
    finalists,
    lives: lives as 1 | 2,
    secondChance: sc,
    questions: own.length >= QUESTIONS_MIN ? own : [],
    tempo: pick(r.tempo, TEMPOS, "normal"),
    fanBets: r.fanBets !== false,
    shapes: parseShapes(r.shapes),
  };
}

/** Вопросы игры: свои (3–10) или встроенные 10. */
export function questionsOf(c: MatContent): readonly Question[] {
  return c.questions.length >= QUESTIONS_MIN ? c.questions : BUILTIN_QUESTIONS;
}

/** Включённые испытания по порядку. */
export function planOf(c: MatContent): TrialKind[] {
  return c.trials.filter((t) => t.on).map((t) => t.kind);
}
