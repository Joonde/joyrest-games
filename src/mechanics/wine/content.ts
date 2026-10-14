// «Винное казино» (очередь владельца 11 октября 2026; 18+): ведущий заранее заносит «паспорт» каждого вина
// (цвет, Старый/Новый Свет, сладость, страна, сорт, год). На каждую бутылку гости получают фишки и ставят их на
// телефонах, как на рулеточном поле; «Открыть бутылку» — паспорт на экране, фишки на верных ответах платят по
// коэффициенту: цвет ×2, Свет ×2, сладость ×3, страна ×4, сорт ×5, год ×8 (ведущий меняет).

export type WineColor = "red" | "white" | "rose" | "orange";
export type WineWorld = "old" | "new";
export type WineSweetness = "dry" | "semidry" | "semisweet" | "sweet";
export type BetCategory = "color" | "world" | "sweetness" | "country" | "grape" | "year";

export interface Wine {
  id: string;
  /** Название — на экране только после «Открыть бутылку». */
  name: string;
  color: WineColor;
  world: WineWorld;
  sweetness: WineSweetness;
  country: string;
  grape: string;
  /** Год урожая; null — без года (NV). */
  year: number | null;
  /** Пара слов для ведущего и на экран после открытия. */
  note: string;
}

export interface WineContent {
  wines: Wine[];
  /** Страны и сорта на поле (плюс «Другое»). */
  countries: string[];
  grapes: string[];
  /** Год на поле: от этого года до прошлого, старше — «Старше», без года — «Без года». */
  yearFrom: number;
  /** Коэффициенты по категориям. */
  odds: Record<BetCategory, number>;
  /** Фишек у гостя на бутылку и цена фишки в очках. */
  chips: number;
  chipValue: number;
  /** Секунд на ставки. */
  betTime: number;
}

export const CATEGORIES: BetCategory[] = ["color", "world", "sweetness", "country", "grape", "year"];

export const CATEGORY_TITLES: Record<BetCategory, string> = {
  color: "Цвет",
  world: "Старый или Новый Свет",
  sweetness: "Сладость",
  country: "Страна",
  grape: "Сорт",
  year: "Год",
};

export const COLOR_TITLES: Record<WineColor, string> = { red: "Красное", white: "Белое", rose: "Розовое", orange: "Оранжевое" };
export const WORLD_TITLES: Record<WineWorld, string> = { old: "Старый Свет", new: "Новый Свет" };
export const SWEETNESS_TITLES: Record<WineSweetness, string> = { dry: "Сухое", semidry: "Полусухое", semisweet: "Полусладкое", sweet: "Сладкое" };

export const DEFAULT_ODDS: Record<BetCategory, number> = { color: 2, world: 2, sweetness: 3, country: 4, grape: 5, year: 8 };

export const DEFAULT_COUNTRIES = ["Франция", "Италия", "Испания", "Португалия", "Германия", "Грузия", "Россия", "Чили", "Аргентина", "ЮАР", "Австралия", "Новая Зеландия", "США"];
export const DEFAULT_GRAPES = ["Каберне Совиньон", "Мерло", "Пино Нуар", "Сира", "Мальбек", "Темпранильо", "Санджовезе", "Саперави", "Шардоне", "Совиньон Блан", "Рислинг", "Пино Гриджо"];

export const WINE_LIMITS = { wines: 12, name: 80, note: 200, option: 40, options: 16, chipsMin: 1, chipsMax: 20, valueMin: 1, valueMax: 1000, oddsMin: 1, oddsMax: 50, timeMin: 15, timeMax: 300 } as const;

/** Ячейки «Другое», «Старше», «Без года». */
export const OTHER = "other";
export const OLDER = "older";
export const NO_YEAR = "nv";

function id(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "v" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function thisYear(now = Date.now()): number {
  return new Date(now).getUTCFullYear();
}

export function newWine(): Wine {
  return { id: id(), name: "", color: "red", world: "old", sweetness: "dry", country: "Франция", grape: "Каберне Совиньон", year: thisYear() - 3, note: "" };
}

export function createWine(): WineContent {
  return { wines: [newWine()], countries: [...DEFAULT_COUNTRIES], grapes: [...DEFAULT_GRAPES], yearFrom: thisYear() - 10, odds: { ...DEFAULT_ODDS }, chips: 5, chipValue: 10, betTime: 90 };
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);

function options(v: unknown, def: string[]): string[] {
  if (!Array.isArray(v)) return [...def];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x, WINE_LIMITS.option).trim();
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, WINE_LIMITS.options);
}

export function parseWine(raw: unknown): WineContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const wines = (Array.isArray(d.wines) ? d.wines : []).slice(0, WINE_LIMITS.wines).map((item, i) => {
    const w = rec(item);
    let wid = typeof w.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(w.id) ? w.id : `v${i + 1}`;
    while (seen.has(wid)) wid += "_";
    seen.add(wid);
    const year = typeof w.year === "number" && Number.isInteger(w.year) && w.year >= 1900 && w.year <= 2100 ? w.year : null;
    return {
      id: wid,
      name: str(w.name, WINE_LIMITS.name),
      color: oneOf(w.color, ["red", "white", "rose", "orange"] as const, "red"),
      world: oneOf(w.world, ["old", "new"] as const, "old"),
      sweetness: oneOf(w.sweetness, ["dry", "semidry", "semisweet", "sweet"] as const, "dry"),
      country: str(w.country, WINE_LIMITS.option).trim(),
      grape: str(w.grape, WINE_LIMITS.option).trim(),
      year,
      note: str(w.note, WINE_LIMITS.note),
    };
  });
  const o = rec(d.odds);
  const odds = Object.fromEntries(CATEGORIES.map((c) => [c, int(o[c], DEFAULT_ODDS[c], WINE_LIMITS.oddsMin, WINE_LIMITS.oddsMax)])) as Record<BetCategory, number>;
  return {
    wines,
    countries: options(d.countries, DEFAULT_COUNTRIES),
    grapes: options(d.grapes, DEFAULT_GRAPES),
    yearFrom: int(d.yearFrom, thisYear() - 10, 1950, thisYear()),
    odds,
    chips: int(d.chips, 5, WINE_LIMITS.chipsMin, WINE_LIMITS.chipsMax),
    chipValue: int(d.chipValue, 10, WINE_LIMITS.valueMin, WINE_LIMITS.valueMax),
    betTime: int(d.betTime, 90, WINE_LIMITS.timeMin, WINE_LIMITS.timeMax),
  };
}

export interface BetOption {
  /** Ключ ставки: «категория:вариант». */
  key: string;
  label: string;
}

/**
 * Поле ставок: варианты каждой категории. Год — от `yearFrom` до прошлого года, «Старше» и «Без года».
 * `year` — год игры (по умолчанию текущий): поле не зависит от часов устройства, если передан.
 */
export function boardOf(content: WineContent, year = thisYear()): Record<BetCategory, BetOption[]> {
  const opt = (cat: BetCategory, value: string, label: string): BetOption => ({ key: `${cat}:${value}`, label });
  const years: BetOption[] = [];
  for (let y = Math.max(content.yearFrom, year - 30); y <= year; y++) years.push(opt("year", String(y), String(y)));
  return {
    color: (Object.keys(COLOR_TITLES) as WineColor[]).map((c) => opt("color", c, COLOR_TITLES[c])),
    world: (Object.keys(WORLD_TITLES) as WineWorld[]).map((w) => opt("world", w, WORLD_TITLES[w])),
    sweetness: (Object.keys(SWEETNESS_TITLES) as WineSweetness[]).map((s) => opt("sweetness", s, SWEETNESS_TITLES[s])),
    country: [...content.countries.map((c) => opt("country", c, c)), opt("country", OTHER, "Другая")],
    grape: [...content.grapes.map((g) => opt("grape", g, g)), opt("grape", OTHER, "Другой")],
    year: [opt("year", OLDER, `До ${Math.max(content.yearFrom, year - 30)}`), ...years, opt("year", NO_YEAR, "Без года")],
  };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Верные ключи по паспорту вина: страна и сорт не из списка — «Другое», год раньше поля — «Старше». */
export function winningKeys(content: WineContent, wine: Wine, year = thisYear()): Record<BetCategory, string> {
  const country = content.countries.find((c) => same(c, wine.country));
  const grape = content.grapes.find((g) => same(g, wine.grape));
  const from = Math.max(content.yearFrom, year - 30);
  const y = wine.year === null ? NO_YEAR : wine.year < from ? OLDER : String(wine.year);
  return {
    color: `color:${wine.color}`,
    world: `world:${wine.world}`,
    sweetness: `sweetness:${wine.sweetness}`,
    country: `country:${country ?? OTHER}`,
    grape: `grape:${grape ?? OTHER}`,
    year: `year:${y}`,
  };
}

export function categoryOfKey(key: string): BetCategory | null {
  const cat = key.split(":")[0] as BetCategory;
  return CATEGORIES.includes(cat) ? cat : null;
}
