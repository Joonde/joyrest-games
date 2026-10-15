// «Весь зал»: ответ гостя сверяется с ответами табло и их синонимами — без регистра, ё/е, пробелов и
// пунктуации (`core/normalize.ts`), с небольшими опечатками и «внутри фразы» («конверт с деньгами» — «конверт»).
// Что не распозналось — ведущий видит списком и засчитывает сам (`accepted`: ключ → id ответа, "" — не засчитывать).
import { normalizeAnswer } from "../../core/normalize";
import { ranked, type HundredQuestion } from "./content";

/** Расстояние Левенштейна, но не дальше `max` (дальше — max + 1). */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

/** Сколько опечаток прощаем: короткие слова — точно, от 5 букв — одну, от 9 — две. */
function tolerance(length: number): number {
  return length >= 9 ? 2 : length >= 5 ? 1 : 0;
}

/** Ключ ответа гостя: так он группируется у ведущего. */
export const wordKey = normalizeAnswer;

/** Какому ответу табло соответствует слово гостя; null — не распознано. */
export function matchWord(question: HundredQuestion, word: string, accepted: Record<string, string> = {}): string | null {
  const key = wordKey(word);
  if (!key) return null;
  if (key in accepted) {
    const to = accepted[key] ?? "";
    return question.answers.some((a) => a.id === to) ? to : null;
  }
  const list = ranked(question).map((a) => ({ id: a.id, keys: [a.text, ...a.synonyms].map(wordKey).filter((k) => k.length > 0) }));
  for (const a of list) if (a.keys.includes(key)) return a.id;
  for (const a of list) if (a.keys.some((k) => editDistance(k, key, tolerance(Math.min(k.length, key.length))) <= tolerance(Math.min(k.length, key.length)))) return a.id;
  // «конверт с деньгами» → «конверт»: ответ внутри фразы (только слова от 5 букв, чтобы «кот» не нашёлся в «котлете»).
  for (const a of list) if (a.keys.some((k) => k.length >= 5 && key.includes(k))) return a.id;
  return null;
}

/** Ответ телефона «Весь зал»: до трёх слов. */
export function wordsOf(value: unknown): string[] {
  const words = typeof value === "object" && value !== null ? (value as { words?: unknown }).words : undefined;
  return Array.isArray(words) ? words.filter((w): w is string => typeof w === "string").map((w) => w.trim().slice(0, 80)).filter(Boolean).slice(0, 3) : [];
}

/** Какие ответы табло угадал участник: каждый ответ — один раз, сколько бы слов на него ни пришлось. */
export function matchedAnswers(question: HundredQuestion, words: string[], accepted: Record<string, string> = {}): string[] {
  const out: string[] = [];
  for (const w of words) {
    const id = matchWord(question, w, accepted);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export interface Unmatched {
  key: string;
  /** Как написали (первый вариант). */
  label: string;
  /** Сколько участников так написали. */
  count: number;
}

/** Нераспознанные ответы зала, сгруппированные по ключу, частые — сверху. */
export function unmatchedWords(question: HundredQuestion, answers: Array<{ pid: string; value: unknown }>, accepted: Record<string, string> = {}): Unmatched[] {
  const groups = new Map<string, { label: string; pids: Set<string> }>();
  for (const a of answers) {
    for (const w of wordsOf(a.value)) {
      const key = wordKey(w);
      if (!key || key in accepted || matchWord(question, w, accepted)) continue;
      const g = groups.get(key) ?? { label: w, pids: new Set<string>() };
      g.pids.add(a.pid);
      groups.set(key, g);
    }
  }
  return [...groups.entries()].map(([key, g]) => ({ key, label: g.label, count: g.pids.size })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
}
