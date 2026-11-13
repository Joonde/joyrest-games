/**
 * Раздача приборов и тексты приказов. На перелёт каждому игроку — 3 прибора разных типов (в третьем — 4, один из которых —
 * близнец другого: Бубликатор и Бубликатрон). Названия уникальны на весь зал, в экипаже отличаются минимум на 3 буквы и не
 * повторяют корни названий экипажей. Детская сложность — кнопка, тумблер и рычаг с картинками, 3 прибора, без близнецов;
 * предметы уникальны на весь зал (дальше 20 — тот же предмет с цветом).
 */
import { closer, isBlocked, isRudeName, joinName, KIDS_ITEMS, KIDS_TINTS, kidsTinted, nameCandidates, norm, shuffle, TWIN_ENDINGS } from "./names";
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

/** ТЗ: 3 прибора (в третьем перелёте — 4); в детской сложности всегда 3 (без близнецов третьего перелёта). */
export function controlsPerPlayer(difficulty: Difficulty, legNo: number, crewPlayers: number): number {
  void crewPlayers;
  if (difficulty === "kids") return 3;
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

interface Candidate {
  name: string;
  key: string;
  root: string;
}

const twinCache = new Map<string, Array<Array<[Candidate, Candidate]>>>();

/** Пары близнецов по корням: для каждой пары окончаний — список по корням (без стоп-листа). Один раз на набор корней. */
function twinCandidates(roots: string[]): Array<Array<[Candidate, Candidate]>> {
  const cacheKey = [...roots].sort().join("|");
  const known = twinCache.get(cacheKey);
  if (known) return known;
  const out = TWIN_ENDINGS.map((pair) => {
    const list: Array<[Candidate, Candidate]> = [];
    for (const root of roots) {
      const a = joinName(root, pair[0]);
      const b = joinName(root, pair[1]);
      if (isBlocked(a) || isBlocked(b) || norm(a) === norm(b)) continue;
      list.push([{ name: a, key: norm(a), root }, { name: b, key: norm(b), root }]);
    }
    return list;
  });
  if (twinCache.size > 64) twinCache.clear();
  twinCache.set(cacheKey, out);
  return out;
}

/**
 * Раздача. Названия уникальны на весь зал (соседний экипаж слышит чужой крик); в экипаже, кроме пары близнецов, отличаются
 * минимум на 3 буквы. Экипажи получают названия по кругу (игрок первого экипажа, второго… потом вторые игроки), чтобы
 * последним экипажам хватило непохожих. Повтор в зале — только если сочетаний меньше, чем приборов (`relaxed`).
 */
export function dealPanels(input: DealInput): DealResult {
  const { rand } = input;
  const kids = input.difficulty === "kids";
  const twins = !kids && !input.drill && input.legNo === 2;
  const seen = new Set<string>();
  const pool: Candidate[] = [];
  const add = (name: string, root: string, check: boolean) => {
    const key = norm(name);
    if (seen.has(key) || (check && isRudeName(name))) return;
    seen.add(key);
    pool.push({ name, key, root });
  };
  // Свои названия ведущего проверяются здесь тем же `isRudeName`, что и в конструкторе; сочетания темы — уже проверены (`isBlocked`).
  for (const n of shuffle(input.customNames, rand)) add(n, "", true);
  for (const c of nameCandidates(input.theme, input.crewNames, rand)) add(c.name, c.root, false);
  const hallUsed = new Set<string>();
  const controls: Control[] = [];
  const panels: Record<string, string[]> = {};
  let relaxed = false;
  // Пары близнецов по всем корням темы (считаются один раз на набор корней), в случайном порядке: по виду пары, внутри — по корням.
  const twinPairs: Array<[Candidate, Candidate]> = [];
  if (twins) {
    const byEnding = twinCandidates([...new Set(pool.filter((c) => c.root !== "").map((c) => c.root))]);
    for (const group of shuffle(byEnding, rand)) twinPairs.push(...shuffle(group, rand));
  }

  const fits = (crewList: Candidate[], c: Candidate) => {
    for (const x of crewList) if (x.key === c.key || closer(x.key, c.key, NAME_GAP)) return false;
    return true;
  };
  // Свободные сочетания идут подряд от `cursor`: занятые в начале пропускаются один раз, а не на каждом выборе.
  let cursor = 0;
  const pickName = (crewList: Candidate[]): Candidate => {
    while (cursor < pool.length && hallUsed.has(pool[cursor]?.key ?? "")) cursor += 1;
    for (let i = cursor; i < pool.length; i += 1) {
      const c = pool[i];
      if (c && !hallUsed.has(c.key) && fits(crewList, c)) return use(c);
    }
    // Сочетаний на зал не хватило — хотя бы в экипаже непохожие, потом хотя бы не повторяются.
    relaxed = true;
    for (const c of pool) if (fits(crewList, c)) return use(c);
    for (const c of pool) if (!crewList.some((x) => x.key === c.key)) return use(c);
    let i = crewList.length + 1;
    while (crewList.some((x) => x.key === norm(`Прибор ${i}`))) i += 1;
    return { name: `Прибор ${i}`, key: norm(`Прибор ${i}`), root: "" };
  };
  const use = (c: Candidate): Candidate => {
    hallUsed.add(c.key);
    return c;
  };
  let twinCursor = 0;
  const pickTwins = (crewList: Candidate[]): [Candidate, Candidate] | null => {
    while (twinCursor < twinPairs.length) {
      const first = twinPairs[twinCursor];
      if (!first || !(hallUsed.has(first[0].key) || hallUsed.has(first[1].key))) break;
      twinCursor += 1;
    }
    for (let i = twinCursor; i < twinPairs.length; i += 1) {
      const pair = twinPairs[i];
      if (!pair) continue;
      const [a, b] = pair;
      if (hallUsed.has(a.key) || hallUsed.has(b.key)) continue;
      if (fits(crewList, a) && fits(crewList, b)) {
        use(a);
        use(b);
        return [a, b];
      }
    }
    return null;
  };

  // Детские предметы: сначала все 20 без цвета, потом с цветами — на весь зал по одному; в экипаже — разные предметы, пока хватает.
  const kidsPool: Array<{ name: string; key: string; acc: string; icon: string; tint: number | null }> = [];
  if (kids) {
    for (const it of shuffle(KIDS_ITEMS, rand)) kidsPool.push({ name: it.name, key: norm(it.name), acc: it.acc, icon: it.icon, tint: null });
    const tinted: typeof kidsPool = [];
    for (let tint = 0; tint < KIDS_TINTS.length; tint += 1) {
      for (const it of KIDS_ITEMS) {
        const n = kidsTinted(it, tint);
        tinted.push({ name: n.name, key: norm(n.name), acc: n.acc, icon: it.icon, tint });
      }
    }
    kidsPool.push(...shuffle(tinted, rand));
  }
  const kidsUsed = new Set<string>();
  const pickKid = (icons: Set<string>, names: Set<string>) => {
    const free = (k: (typeof kidsPool)[number]) => !kidsUsed.has(k.key) && !names.has(k.key);
    const found =
      kidsPool.find((k) => free(k) && !icons.has(k.icon)) ??
      kidsPool.find((k) => free(k)) ??
      (() => {
        relaxed = true;
        return kidsPool.find((k) => !names.has(k.key) && !icons.has(k.icon)) ?? kidsPool.find((k) => !names.has(k.key));
      })();
    if (found) kidsUsed.add(found.key);
    return found;
  };

  const crewLists = new Map<number, Candidate[]>();
  const crewIcons = new Map<number, Set<string>>();
  const deep = Math.max(0, ...input.crews.map((c) => c.players.length));
  // Третий перелёт: сначала всем по паре близнецов (по кругу экипажей), потом остальные названия — иначе близнецам не хватает корней.
  const twinOf = new Map<string, [Candidate, Candidate]>();
  if (twins) {
    for (let round = 0; round < deep; round += 1) {
      for (const crew of input.crews) {
        const pid = crew.players[round];
        if (pid === undefined) continue;
        const crewList = crewLists.get(crew.id) ?? [];
        crewLists.set(crew.id, crewList);
        const pair = pickTwins(crewList);
        if (!pair) {
          relaxed = true;
          continue;
        }
        crewList.push(pair[0], pair[1]);
        twinOf.set(pid, pair);
      }
    }
  }
  for (let round = 0; round < deep; round += 1) {
    for (const crew of input.crews) {
      const pid = crew.players[round];
      if (pid === undefined) continue;
      const per = controlsPerPlayer(input.difficulty, input.legNo, crew.players.length);
      const crewList = crewLists.get(crew.id) ?? [];
      crewLists.set(crew.id, crewList);
      const icons = crewIcons.get(crew.id) ?? new Set<string>();
      crewIcons.set(crew.id, icons);
      const types = shuffle(kids ? KIDS_TYPES : NORMAL_TYPES, rand).slice(0, per);
      const names: Array<{ name: string; acc?: string; icon?: string; tint?: number }> = [];
      if (kids) {
        const crewNames = new Set(crewList.map((c) => c.key));
        for (let k = 0; k < per; k += 1) {
          const it = pickKid(icons, crewNames);
          if (!it) continue;
          icons.add(it.icon);
          crewNames.add(it.key);
          crewList.push({ name: it.name, key: it.key, root: "" });
          const n: { name: string; acc?: string; icon?: string; tint?: number } = { name: it.name, acc: it.acc, icon: it.icon };
          if (it.tint !== null) n.tint = it.tint;
          names.push(n);
        }
      } else {
        // Близнецы — на одном телефоне (макет «Переворот»), плитки вперемешку.
        const pair = twinOf.get(pid);
        if (pair) names.push({ name: pair[0].name }, { name: pair[1].name });
        while (names.length < per) {
          const c = pickName(crewList);
          names.push({ name: c.name });
          crewList.push(c);
        }
      }
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
          claim: -1,
          by: null,
          lastOrder: -1,
        };
        if (n.acc) control.acc = n.acc;
        if (n.icon) control.icon = n.icon;
        if (n.tint !== undefined) control.tint = n.tint;
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
