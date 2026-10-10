// «Олимп» — правила игры: кубик и исходы, стихии, уровни и здоровье, деление драхм.
// Чистые функции без React и данных сессии: их проверяют тесты (olymp.test.ts),
// а будущий сервер кампаний может пересчитать то же самое у себя.

/** Шесть характеристик бога. Скорость отдельно: её дают только вещи и одежда. */
export const STATS = ["might", "influence", "wisdom", "endurance", "luck", "cunning"] as const;
export type StatId = (typeof STATS)[number];

export const STAT_NAMES: Record<StatId | "speed", string> = {
  might: "Мощь",
  influence: "Влияние",
  wisdom: "Мудрость",
  endurance: "Стойкость",
  luck: "Удача",
  cunning: "Хитрость",
  speed: "Скорость",
};

export type Stats = Record<StatId, number>;

// ---------------------------------------------------------------- кубик

/** Пять исходов броска d100. */
export type Outcome = "crit" | "good" | "mid" | "bad" | "fail";

export const OUTCOME_NAMES: Record<Outcome, string> = {
  crit: "Критическая удача",
  good: "Хорошо",
  mid: "Средне",
  bad: "Плохо",
  fail: "Критическая неудача",
};

/** Сила действия по исходу: удар, лечение, щит. Крит. неудача — промах и обратный эффект. */
export const OUTCOME_MULT: Record<Outcome, number> = { crit: 2, good: 1.5, mid: 1, bad: 0.25, fail: 0 };

/** Опыт за разговор и проверку по исходу броска. */
export const OUTCOME_XP: Record<Outcome, number> = { crit: 30, good: 20, mid: 10, bad: 5, fail: 0 };

/** Порог успеха: 100 − характеристика, но не легче 5 и не тяжелее 95. */
export function threshold(stat: number): number {
  return Math.max(5, Math.min(95, 100 - Math.round(stat)));
}

/**
 * Исход броска. 96–100 — всегда крит. удача, 1–5 — всегда крит. неудача (до модификаторов:
 * судьбу не перехитрить); между ними — бросок с модификаторами против порога характеристики:
 * «хорошо» — порог + 20 и выше, «средне» — от порога, ниже — «плохо».
 */
export function outcomeOf(raw: number, stat: number, mod = 0): Outcome {
  const roll = clampRoll(raw);
  if (roll >= 96) return "crit";
  if (roll <= 5) return "fail";
  const value = roll + mod;
  const thr = threshold(stat);
  if (value >= thr + 20) return "good";
  if (value >= thr) return "mid";
  return "bad";
}

export function clampRoll(raw: number): number {
  return Math.max(1, Math.min(100, Math.round(raw)));
}

/**
 * Бросок d100 из нажатия на телефоне: id ответа и время сервера — телефон число не выбирает,
 * а повтор того же ответа даёт то же число (пульт на втором устройстве посчитает так же).
 */
export function d100Of(answer: { id: string; submittedAt?: number | null }, salt = ""): number {
  const text = `${answer.id}:${answer.submittedAt ?? 0}:${salt}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Перемешиваем ещё раз, чтобы младшие разряды не зависели от последнего символа.
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (Math.abs(h) % 100) + 1;
}

// ---------------------------------------------------------------- стихии

export const ELEMENTS = ["fire", "water", "ice", "bolt", "earth", "wind", "light", "dark", "poison", "chaos"] as const;
export type ElementId = (typeof ELEMENTS)[number];

export const ELEMENT_NAMES: Record<ElementId, string> = {
  fire: "Огонь",
  water: "Вода",
  ice: "Лёд",
  bolt: "Молния",
  earth: "Земля",
  wind: "Ветер",
  light: "Свет",
  dark: "Тьма",
  poison: "Яд",
  chaos: "Хаос",
};

/**
 * Кого стихия бьёт сильнее (×1,5). У каждой ровно две сильные и две слабые стороны,
 * взаимных пар нет (проверяет тест) — схема в прототипе «Схема стихий».
 */
export const STRONG: Record<ElementId, [ElementId, ElementId]> = {
  fire: ["ice", "poison"],
  dark: ["poison", "chaos"],
  wind: ["chaos", "earth"],
  ice: ["earth", "water"],
  poison: ["water", "light"],
  chaos: ["light", "bolt"],
  earth: ["bolt", "fire"],
  water: ["fire", "dark"],
  light: ["dark", "wind"],
  bolt: ["wind", "ice"],
};

/** Множитель стихии атаки против стихии цели: 1,5 — сильнее, 0,5 — слабее, иначе 1. */
export function elementMult(attack: ElementId | null, target: ElementId | null): number {
  if (!attack || !target) return 1;
  if (STRONG[attack].includes(target)) return 1.5;
  if (STRONG[target].includes(attack)) return 0.5;
  return 1;
}

/** Сопротивления по умолчанию из стихии противника: сильные против него — 150%, слабые — 50%, своя — 0%. */
export function resistOf(element: ElementId): Record<ElementId, number> {
  const out = {} as Record<ElementId, number>;
  for (const e of ELEMENTS) {
    out[e] = e === element ? 0 : Math.round(elementMult(e, element) * 100);
  }
  return out;
}

// ---------------------------------------------------------------- уровни, опыт, здоровье

export const MAX_LEVEL = 30;
export const POINTS_PER_LEVEL = 2;

/** Опыта до следующего уровня: 100 × уровень^1,8 (100, 348, 721, 1213 … 42 886 перед 30-м). */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return Infinity;
  return Math.round(100 * Math.pow(Math.max(1, level), 1.8));
}

/** Уровень и остаток опыта по всему накопленному опыту. */
export function levelOf(totalXp: number): { level: number; xp: number; next: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(totalXp));
  while (level < MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level += 1;
  }
  return { level, xp: rest, next: xpToNext(level) };
}

/** Здоровье: 100 + 6 за уровень после первого, плюс «+N% здоровья» от вещей. */
export function hpMaxOf(level: number, hpPercent = 0): number {
  return Math.round((100 + 6 * (Math.max(1, level) - 1)) * (1 + hpPercent / 100));
}

// ---------------------------------------------------------------- награды

/**
 * Делёж драхм бросками: каждому — доля по его броску, только целые, сумма всегда равна награде
 * (метод наибольших остатков; при равных остатках — у кого бросок больше, потом по порядку).
 */
export function splitCoins(total: number, rolls: number[]): number[] {
  const n = rolls.length;
  if (n === 0 || total <= 0) return rolls.map(() => 0);
  const sum = rolls.reduce((a, r) => a + Math.max(1, r), 0);
  const exact = rolls.map((r) => (total * Math.max(1, r)) / sum);
  const out = exact.map((x) => Math.floor(x));
  let left = total - out.reduce((a, x) => a + x, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x), roll: rolls[i] ?? 0 }))
    .sort((a, b) => b.frac - a.frac || b.roll - a.roll || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    out[o.i] = (out[o.i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

/** Опыт за бой по доле нанесённого урона; кто помогал без урона — не меньше 10% награды. */
export function splitXp(total: number, damage: Record<string, number>, helpers: string[] = []): Record<string, number> {
  const ids = [...new Set([...Object.keys(damage), ...helpers])];
  const out: Record<string, number> = {};
  if (ids.length === 0 || total <= 0) return out;
  const floor = Math.round(total * 0.1);
  const dealt = ids.reduce((a, id) => a + Math.max(0, damage[id] ?? 0), 0);
  for (const id of ids) {
    const share = dealt > 0 ? (total * Math.max(0, damage[id] ?? 0)) / dealt : total / ids.length;
    out[id] = Math.max(Math.round(share), helpers.includes(id) || (damage[id] ?? 0) > 0 ? floor : 0);
  }
  return out;
}

/** Опыт за победу над врагом по рангу; босс — ×3; враг намного слабее — в 4 раза меньше. */
export const RANK_XP = { F: 20, E: 40, D: 70, C: 120, B: 200, A: 350, S: 600, SS: 1000, SSS: 1800 } as const;
export type Rank = keyof typeof RANK_XP;

export function foeXp(rank: Rank, boss: boolean, muchWeaker = false): number {
  const base = RANK_XP[rank] * (boss ? 3 : 1);
  return muchWeaker ? Math.round(base / 4) : base;
}

// ---------------------------------------------------------------- скорость

/** «Время до хода» на шкале боя: 1000 / Скорость. Скорость 200 против 100 — два хода на один. */
export function turnTime(speed: number): number {
  return 1000 / Math.max(10, speed);
}
