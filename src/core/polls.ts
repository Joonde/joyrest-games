// «Опрос гостей заранее» для «Что скажет большинство» (только свой сервер, `server/src/polls.ts`): гости до мероприятия по
// ссылке или QR пишут свой ответ на каждый вопрос (без входа, имя не спрашиваем). Ведущий видит сводку —
// ответы, сгруппированные после нормализации (регистр, ё/е, пунктуация), может объединить похожие и
// переименовать группу, а «Взять 6 лучших в табло» считает очки: доля ответивших на вопрос, в пересчёте на 100.
// Общая логика — здесь (конструктор, страница опроса, сервер, тесты).
import { normalizeAnswer } from "./normalize";

export const POLL_LIMITS = {
  questions: 40,
  question: 200,
  answer: 80,
  title: 120,
  /** Ответивших на один опрос. */
  respondents: 2000,
  /** Объединений и переименований на вопрос. */
  groups: 200,
} as const;

export interface PollQuestion {
  id: string;
  text: string;
}

/** Решения ведущего по вопросу: ключ группы → в какую группу влит, и подписи групп. */
export interface PollEdits {
  merges: Record<string, string>;
  labels: Record<string, string>;
}

export interface PollGroup {
  key: string;
  /** Подпись: как переименовал ведущий, иначе самый частый вариант написания. */
  label: string;
  count: number;
  /** Как ещё писали (без подписи) — пойдут в синонимы табло. */
  variants: string[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Ключ ответа гостя (одинаковые по смыслу написания склеиваются). */
export function pollKey(text: string): string {
  return normalizeAnswer(text).slice(0, 80);
}

export function cleanPollText(value: unknown, max: number): string {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
}

export function parsePollQuestions(value: unknown): PollQuestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: PollQuestion[] = [];
  for (const item of value.slice(0, POLL_LIMITS.questions)) {
    const d = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const id = typeof d.id === "string" && ID.test(d.id) ? d.id : null;
    const text = cleanPollText(d.text, POLL_LIMITS.question);
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text });
  }
  return out;
}

/** Решения ведущего: только ключи, без мусора. */
export function parsePollEdits(value: unknown): Record<string, PollEdits> {
  const out: Record<string, PollEdits> = {};
  const d = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  for (const [qid, raw] of Object.entries(d).slice(0, POLL_LIMITS.questions)) {
    if (!ID.test(qid)) continue;
    const e = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const merges: Record<string, string> = {};
    const labels: Record<string, string> = {};
    const m = typeof e.merges === "object" && e.merges !== null ? (e.merges as Record<string, unknown>) : {};
    const l = typeof e.labels === "object" && e.labels !== null ? (e.labels as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(m).slice(0, POLL_LIMITS.groups)) if (k && k.length <= 80 && typeof v === "string" && v && v.length <= 80 && v !== k) merges[k] = v;
    for (const [k, v] of Object.entries(l).slice(0, POLL_LIMITS.groups)) {
      const label = cleanPollText(v, POLL_LIMITS.answer);
      if (k && k.length <= 80 && label) labels[k] = label;
    }
    out[qid] = { merges, labels };
  }
  return out;
}

/** Ответы гостя: только вопросы опроса, текст до 80 символов, пустые — не ответил. */
export function parsePollAnswers(value: unknown, questions: PollQuestion[]): Record<string, string> {
  const d = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const q of questions) {
    const text = cleanPollText(d[q.id], POLL_LIMITS.answer);
    if (text && pollKey(text)) out[q.id] = text;
  }
  return out;
}

/** Куда в итоге влит ключ (цепочки объединений, без петель). */
export function rootOf(key: string, merges: Record<string, string>): string {
  let cur = key;
  const seen = new Set<string>([cur]);
  for (let next = merges[cur]; next !== undefined && !seen.has(next); next = merges[cur]) {
    seen.add(next);
    cur = next;
  }
  return cur;
}

/** Ответы гостей на вопрос → группы (частые сверху). */
export function groupPollAnswers(texts: string[], edits: PollEdits = { merges: {}, labels: {} }): PollGroup[] {
  const groups = new Map<string, { count: number; spell: Map<string, number> }>();
  for (const text of texts) {
    const key = pollKey(text);
    if (!key) continue;
    const root = rootOf(key, edits.merges);
    const g = groups.get(root) ?? { count: 0, spell: new Map<string, number>() };
    g.count++;
    const t = text.trim();
    g.spell.set(t, (g.spell.get(t) ?? 0) + 1);
    groups.set(root, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const spellings = [...g.spell.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru")).map(([t]) => t);
      const label = edits.labels[key] ?? spellings[0] ?? key;
      const variants = [...new Set(spellings.filter((t) => pollKey(t) !== pollKey(label)))].slice(0, 12);
      return { key, label, count: g.count, variants };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
}

/**
 * «Взять N лучших в табло»: очки — доля ответивших на вопрос (в пересчёте на 100), не меньше 1. Сумма из-за
 * округления не выходит за 100.
 */
export function topAnswers(groups: PollGroup[], answered: number, n = 6): Array<{ text: string; points: number; synonyms: string[] }> {
  if (answered <= 0) return [];
  const top = groups.slice(0, n).map((g) => ({ text: g.label.slice(0, 60), points: Math.max(1, Math.round((g.count / answered) * 100)), synonyms: g.variants.map((v) => v.slice(0, 40)).slice(0, 12) }));
  let sum = top.reduce((s, a) => s + a.points, 0);
  for (let i = 0; sum > 100 && i < 1000; i++) {
    const biggest = top.reduce((best, a) => (a.points > best.points ? a : best), top[0] ?? { text: "", points: 0, synonyms: [] });
    if (biggest.points <= 1) break;
    biggest.points--;
    sum--;
  }
  return top;
}
