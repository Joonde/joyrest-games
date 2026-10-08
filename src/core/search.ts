/**
 * Поиск по спискам (база площадок, заявки, игры): без регистра, ё = е, слова в любом порядке;
 * телефон находится по цифрам («999 12» найдёт «+7 (999) 123-…»). Подсказки — не больше пяти.
 */

export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Каждое слово запроса есть в тексте (или, если слово из цифр, — в цифрах текста). */
export function matchesSearch(parts: Array<string | null | undefined>, query: string): boolean {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const text = normalizeSearch(parts.filter(Boolean).join(" "));
  const digits = text.replace(/\D/g, "");
  return words.every((w) => text.includes(w) || (/^\d+$/.test(w) && digits.includes(w)));
}

export const SUGGESTIONS_MAX = 5;

/**
 * Подсказки к запросу: подходящие варианты без повторов, сначала те, что начинаются с запроса.
 * Пустой запрос или точное совпадение с единственным вариантом — подсказок нет.
 */
export function searchSuggestions(candidates: Array<string | null | undefined>, query: string, limit = SUGGESTIONS_MAX): string[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const seen = new Set<string>();
  const starts: string[] = [];
  const inside: string[] = [];
  for (const raw of candidates) {
    const label = (raw ?? "").trim();
    const key = normalizeSearch(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (key === q) continue;
    if (key.startsWith(q) || key.split(" ").some((w) => w.startsWith(q))) starts.push(label);
    else if (key.includes(q)) inside.push(label);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, "ru");
  return [...starts.sort(byName), ...inside.sort(byName)].slice(0, limit);
}
