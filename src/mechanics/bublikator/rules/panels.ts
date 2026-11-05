/**
 * Раздача приборов и тексты приказов. На перелёт каждому игроку — 3 прибора разных типов (в третьем — 4, один из которых —
 * близнец другого: Бубликатор и Бубликатрон). Названия уникальны на весь зал, в экипаже отличаются минимум на 3 буквы и не
 * повторяют корни названий экипажей. Детская сложность — кнопка, тумблер и рычаг с картинками, 3 прибора (2 — если в экипаже
 * больше 6 человек: предметов всего 20), без близнецов.
 */
import { distance, isBlocked, joinName, KIDS_ITEMS, nameCandidates, norm, shuffle, TWIN_ENDINGS } from "./names";
import type { Control, ControlType, Difficulty, Theme } from "./types";

export const NORMAL_TYPES: readonly ControlType[] = ["button", "toggle", "slider", "lever", "dial"];
export const KIDS_TYPES: readonly ControlType[] = ["button", "toggle", "lever"];
/** Сколько положений у прибора (у кнопки — нажатия, положений нет). */
export const STATES: Record<ControlType, number> = { button: 0, toggle: 2, slider: 6, lever: 3, dial: 4 };
export const SLIDER_WORDS = ["ноль", "один", "два", "три", "четыре", "пять"];
export const LEVER_WORDS = ["вверх", "в середину", "вниз"];
export const DIAL_WORDS = ["красный", "жёлтый", "зелёный", "синий"];
/** Минимальное отличие названий в экипаже (буквы, расстояние Левенштейна). */
export const NAME_GAP = 3;

export function controlsPerPlayer(difficulty: Difficulty, legNo: number, crewPlayers: number): number {
  if (difficulty === "kids") return crewPlayers * 3 > KIDS_ITEMS.length ? 2 : 3;
  return legNo === 2 ? 4 : 3;
}

export interface DealInput {
  theme: Theme;
  difficulty: Difficulty;
  /** 0–2; тренировка — 0 без близнецов. */
  legNo: number;
  drill: boolean;
  /** Экипажи: id и игроки по порядку входа. */
  crews: Array<{ id: number; players: string[] }>;
  crewNames: string[];
  customNames: string[];
  rand: () => number;
  nextId: () => string;
}

export interface DealResult {
  controls: Control[];
  panels: Record<string, string[]>;
  /** Названия пришлось повторить в зале (приборов больше, чем сочетаний). */
  relaxed: boolean;
}

export function initialState(type: ControlType, rand: () => number): number {
  const n = STATES[type];
  return n === 0 ? 0 : Math.floor(rand() * n);
}

export function dealPanels(input: DealInput): DealResult {
  const { rand } = input;
  const kids = input.difficulty === "kids";
  const twins = !kids && !input.drill && input.legNo === 2;
  const pool = [
    ...shuffle(input.customNames.filter((n) => !isBlocked(n)), rand).map((name) => ({ root: "", name })),
    ...nameCandidates(input.theme, input.crewNames, rand),
  ];
  const hallUsed = new Set<string>();
  const controls: Control[] = [];
  const panels: Record<string, string[]> = {};
  let relaxed = false;

  const pickName = (crewList: string[]): string => {
    for (const strict of [true, false]) {
      for (const c of pool) {
        const key = norm(c.name);
        if (strict && hallUsed.has(key)) continue;
        if (crewList.some((x) => norm(x) === key)) continue;
        if (crewList.every((x) => distance(x, c.name) >= NAME_GAP)) {
          if (!strict) relaxed = true;
          hallUsed.add(key);
          return c.name;
        }
      }
    }
    // Совсем нет — лишь бы не повторялось в экипаже.
    relaxed = true;
    let i = crewList.length + 1;
    while (crewList.some((x) => norm(x) === norm(`Прибор ${i}`))) i += 1;
    return `Прибор ${i}`;
  };

  const pickTwins = (crewList: string[]): [string, string] | null => {
    const roots = shuffle([...new Set(pool.filter((p) => p.root !== "").map((p) => p.root))], rand);
    for (const root of roots) {
      for (const [ea, eb] of shuffle(TWIN_ENDINGS, rand)) {
        const a = joinName(root, ea);
        const b = joinName(root, eb);
        if (isBlocked(a) || isBlocked(b) || hallUsed.has(norm(a)) || hallUsed.has(norm(b))) continue;
        if (crewList.every((x) => distance(x, a) >= NAME_GAP && distance(x, b) >= NAME_GAP)) {
          hallUsed.add(norm(a));
          hallUsed.add(norm(b));
          return [a, b];
        }
      }
    }
    return null;
  };

  for (const crew of input.crews) {
    const per = controlsPerPlayer(input.difficulty, input.legNo, crew.players.length);
    const crewList: string[] = [];
    const items = kids ? shuffle(KIDS_ITEMS, rand) : [];
    let item = 0;
    for (const pid of crew.players) {
      const types = shuffle(kids ? KIDS_TYPES : NORMAL_TYPES, rand).slice(0, per);
      const names: Array<{ name: string; acc?: string; icon?: string }> = [];
      if (kids) {
        for (let k = 0; k < per; k += 1) {
          const it = items[item % items.length];
          item += 1;
          if (it) names.push({ name: it.name, acc: it.acc, icon: it.icon });
        }
      } else {
        const pair = twins ? pickTwins(crewList) : null;
        if (pair) {
          names.push({ name: pair[0] }, { name: pair[1] });
          crewList.push(pair[0], pair[1]);
        }
        while (names.length < per) {
          const name = pickName(crewList);
          names.push({ name });
          crewList.push(name);
        }
      }
      // Близнецы — на одном телефоне (макет «Переворот»), плитки вперемешку.
      const ids: string[] = [];
      names.forEach((n, k) => {
        const type = types[k] ?? "button";
        const control: Control = {
          id: input.nextId(),
          crew: crew.id,
          owner: pid,
          name: n.name,
          type,
          state: initialState(type, rand),
          movedAt: -1,
          by: null,
          lastOrder: -1,
        };
        if (n.acc) control.acc = n.acc;
        if (n.icon) control.icon = n.icon;
        controls.push(control);
        ids.push(control.id);
      });
      panels[pid] = shuffle(ids, rand);
    }
  }
  return { controls, panels, relaxed };
}

/** Цель приказа: всегда не текущее положение; у кнопки — «нажать» (-1). */
export function randomTarget(control: Pick<Control, "type" | "state">, rand: () => number): number {
  const n = STATES[control.type];
  if (n === 0) return -1;
  if (n === 2) return control.state === 1 ? 0 : 1;
  const options = Array.from({ length: n }, (_, i) => i).filter((i) => i !== control.state);
  return options[Math.floor(rand() * options.length)] ?? 0;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Текст приказа по шаблону типа (ТЗ, «Шаблоны текста»). */
export function orderText(control: Pick<Control, "type" | "name" | "acc">, target: number, kids: boolean): string {
  const name = control.name;
  if (kids) {
    const acc = control.acc ?? name.toLowerCase();
    if (control.type === "button") return `Нажми ${acc}!`;
    if (control.type === "toggle") return target === 1 ? `Включи ${acc}!` : `Выключи ${acc}!`;
    if (control.type === "lever") return `${capital(acc)} — ${LEVER_WORDS[target] ?? "вверх"}!`;
  }
  switch (control.type) {
    case "button":
      return `Жми ${name}!`;
    case "toggle":
      return target === 1 ? `Включите ${name}!` : `Выключите ${name}!`;
    case "slider":
      return `${name} на ${SLIDER_WORDS[target] ?? target}!`;
    case "lever":
      return `${name} — ${LEVER_WORDS[target] ?? "вверх"}!`;
    case "dial":
      return `${name} на ${DIAL_WORDS[target] ?? "синий"}!`;
  }
}

/** Положение из движения телефона: в пределах прибора, целое; иначе null. */
export function cleanState(type: ControlType, value: unknown): number | null {
  if (type === "button") return 0;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 0 && value < STATES[type] ? value : null;
}
