// Особые условия: у каждого игрока одна карта, сыграть можно один раз. Каждая — точное действие,
// его выполняет пульт сразу, как телефон прислал «Сыграть» (или ведущий нажал за игрока без телефона).
import { CAT_TITLES, CATS, drawRef, type Cat } from "./decks";

/** Персонаж: шесть карт (ссылки) и особое условие. */
export type Character = Record<Cat, string> & { special: SpecialId };

export type SpecialId =
  | "swapBaggage"
  | "swapHealth"
  | "swapHobby"
  | "swapFact"
  | "swapProfession"
  | "newProfession"
  | "newHealthOther"
  | "healSelf"
  | "healOther"
  | "infect"
  | "stealBaggage"
  | "peek"
  | "forceReveal"
  | "revealFacts"
  | "immunity"
  | "doubleVote"
  | "cancelVote"
  | "extraBed"
  | "collapse"
  | "returnExiled"
  | "shuffleHealth"
  | "shuffleBaggage"
  | "newBunker";

/** Цель: никого, живой игрок (не вы), живой игрок и характеристика, или последний изгнанный. */
export type Target = "none" | "player" | "playerCat";

/** Когда можно сыграть: в любой момент раунда или только во время голосования. */
export type When = "any" | "vote";

export interface Special {
  id: SpecialId;
  title: string;
  text: string;
  target: Target;
  when: When;
  /** Значок на карте (рисунок в `CardArt`). */
  icon: "swap" | "new" | "heal" | "virus" | "hand" | "eye" | "lamp" | "polygraph" | "shield" | "double" | "cross" | "bed" | "rocks" | "back" | "shuffle" | "hatch";
}

export const SPECIALS: Special[] = [
  { id: "swapBaggage", title: "Обмен багажом", text: "Поменяйтесь картой «Багаж» с любым игроком.", target: "player", when: "any", icon: "swap" },
  { id: "swapHealth", title: "Обмен здоровьем", text: "Поменяйтесь картой «Здоровье» с любым игроком.", target: "player", when: "any", icon: "swap" },
  { id: "swapHobby", title: "Обмен хобби", text: "Поменяйтесь картой «Хобби» с любым игроком.", target: "player", when: "any", icon: "swap" },
  { id: "swapFact", title: "Обмен фактами", text: "Поменяйтесь картой «Факт» с любым игроком.", target: "player", when: "any", icon: "swap" },
  { id: "swapProfession", title: "Обмен профессией", text: "Поменяйтесь картой «Профессия» с любым игроком.", target: "player", when: "any", icon: "swap" },
  { id: "newProfession", title: "Переобучение", text: "Сбросьте свою профессию и возьмите новую из колоды.", target: "none", when: "any", icon: "new" },
  { id: "newHealthOther", title: "Медкомиссия", text: "Выбранный игрок сбрасывает «Здоровье» и берёт новое из колоды.", target: "player", when: "any", icon: "new" },
  { id: "healSelf", title: "Чудесное исцеление", text: "Ваше здоровье становится «Полностью здоров».", target: "none", when: "any", icon: "heal" },
  { id: "healOther", title: "Таблетка от всего", text: "Здоровье выбранного игрока становится «Полностью здоров».", target: "player", when: "any", icon: "heal" },
  { id: "infect", title: "Заразный", text: "Здоровье выбранного игрока становится таким же, как у вас.", target: "player", when: "any", icon: "virus" },
  { id: "stealBaggage", title: "Карманник", text: "Заберите «Багаж» выбранного игрока себе, он берёт новый из колоды. Ваш прежний багаж сбрасывается.", target: "player", when: "any", icon: "hand" },
  { id: "peek", title: "Шпион", text: "Посмотрите одну закрытую карту выбранного игрока. Увидите только вы.", target: "playerCat", when: "any", icon: "eye" },
  { id: "forceReveal", title: "Допрос", text: "Выбранный игрок сразу открывает карту, которую назовёте вы.", target: "playerCat", when: "any", icon: "lamp" },
  { id: "revealFacts", title: "Детектор лжи", text: "Все игроки в игре сразу открывают свои «Факты».", target: "none", when: "any", icon: "polygraph" },
  { id: "immunity", title: "Неприкосновенность", text: "Голоса против вас в этом голосовании не считаются.", target: "none", when: "vote", icon: "shield" },
  { id: "doubleVote", title: "Решающий голос", text: "Ваш голос в этом голосовании считается дважды.", target: "none", when: "vote", icon: "double" },
  { id: "cancelVote", title: "Отмена голосования", text: "Это голосование отменяется: изгнание переносится на следующий раунд. Нельзя в последнем раунде.", target: "none", when: "vote", icon: "cross" },
  { id: "extraBed", title: "Лишняя койка", text: "В бункере нашлось ещё одно место: изгоняем на одного меньше.", target: "none", when: "any", icon: "bed" },
  { id: "collapse", title: "Обвал", text: "Обвалился отсек: в бункере на одно место меньше.", target: "none", when: "any", icon: "rocks" },
  { id: "returnExiled", title: "Второй шанс", text: "Последний изгнанный возвращается в игру.", target: "none", when: "any", icon: "back" },
  { id: "shuffleHealth", title: "Эпидемия", text: "Все игроки в игре перемешивают карты «Здоровье» и разбирают их случайно.", target: "none", when: "any", icon: "shuffle" },
  { id: "shuffleBaggage", title: "Переполох на складе", text: "Все игроки в игре перемешивают «Багаж» и разбирают его случайно.", target: "none", when: "any", icon: "shuffle" },
  { id: "newBunker", title: "Перепланировка", text: "Последняя открытая карта бункера заменяется новой из колоды.", target: "none", when: "any", icon: "hatch" },
];

export const SPECIAL_BY_ID = Object.fromEntries(SPECIALS.map((s) => [s.id, s])) as Record<SpecialId, Special>;

export function isSpecial(v: unknown): v is SpecialId {
  return typeof v === "string" && v in SPECIAL_BY_ID;
}

const SWAP: Partial<Record<SpecialId, Cat>> = { swapBaggage: "baggage", swapHealth: "health", swapHobby: "hobby", swapFact: "fact", swapProfession: "profession" };

/** Что играется: просьба телефона «сыграть», цель и характеристика. */
export interface Use {
  target: string | null;
  cat: Cat | null;
}

/** Состояние, которое меняют особые условия (кроме голосования — его считает подсчёт голосов). */
export interface SpecialWorld {
  chars: Record<string, Character>;
  alive: string[];
  exiled: string[];
  /** Открытые характеристики (по игрокам). */
  open: Record<string, Cat[]>;
  places: number;
  bunker: number[];
  /** Сколько карт бункера открыто. */
  bunkerOpen: number;
  round: number;
  rounds: number;
}

export interface SpecialOutcome {
  world: SpecialWorld;
  /** Строка для всех: «Аня сыграла „Обмен багажом“ с Борей». */
  log: string;
  /** Личная заметка игроку (Шпион). */
  note: { pid: string; text: string } | null;
  /** Голосование: защита, двойной голос, отмена. */
  vote: "immunity" | "doubleVote" | "cancelVote" | null;
}

export type Refusal = "used" | "dead" | "target" | "cat" | "time" | "last" | "empty";

export const REFUSALS: Record<Refusal, string> = {
  used: "Особое условие уже сыграно",
  dead: "Сыграть может только игрок в игре",
  target: "Выберите игрока в игре",
  cat: "Выберите закрытую карту",
  time: "Эту карту можно сыграть только во время голосования",
  last: "В последнем раунде голосование не отменить",
  empty: "Сейчас карте не на что подействовать",
};

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const takenRefs = (chars: Record<string, Character>) => new Set(Object.values(chars).flatMap((c) => CATS.map((k) => c[k])));

/**
 * Сыграть особое условие игрока `pid`. `voting` — идёт ли голосование; `name` — имена для строки
 * в журнале. Отказ — причина (телефон покажет её, карта остаётся у игрока).
 */
export function playSpecial(world: SpecialWorld, pid: string, use: Use, voting: boolean, name: (pid: string) => string, bunkerDeck: number, random: () => number = Math.random): SpecialOutcome | Refusal {
  const me = world.chars[pid];
  if (!me) return "dead";
  if (!world.alive.includes(pid)) return "dead";
  const s = SPECIAL_BY_ID[me.special];
  if (s.when === "vote" && !voting) return "time";
  const target = use.target;
  if (s.target !== "none" && (!target || target === pid || !world.alive.includes(target) || !world.chars[target])) return "target";
  const chars = { ...world.chars };
  const set = (p: string, cat: Cat, ref: string) => {
    chars[p] = { ...(chars[p] as Character), [cat]: ref };
  };
  const by = `${name(pid)}: «${s.title}»`;
  const w = (patch: Partial<SpecialWorld>, log: string, extra: Partial<SpecialOutcome> = {}): SpecialOutcome => ({ world: { ...world, chars, ...patch }, log, note: null, vote: null, ...extra });
  const swap = SWAP[s.id];
  if (swap && target) {
    const a = (chars[pid] as Character)[swap];
    set(pid, swap, (chars[target] as Character)[swap]);
    set(target, swap, a);
    return w({}, `${by} — с игроком ${name(target)}`);
  }
  switch (s.id) {
    case "newProfession":
      set(pid, "profession", drawRef("profession", takenRefs(chars), random));
      return w({}, by);
    case "newHealthOther":
      if (!target) return "target";
      set(target, "health", drawRef("health", takenRefs(chars), random));
      return w({}, `${by} — для игрока ${name(target)}`);
    case "healSelf":
      set(pid, "health", "h:0");
      return w({}, by);
    case "healOther":
      if (!target) return "target";
      set(target, "health", "h:0");
      return w({}, `${by} — игрок ${name(target)} здоров`);
    case "infect":
      if (!target) return "target";
      set(target, "health", me.health);
      return w({}, `${by} — игрок ${name(target)} заражён`);
    case "stealBaggage": {
      if (!target) return "target";
      const loot = (chars[target] as Character).baggage;
      set(pid, "baggage", loot);
      set(target, "baggage", drawRef("baggage", takenRefs(chars), random));
      return w({}, `${by} — забрал багаж игрока ${name(target)}`);
    }
    case "peek": {
      if (!target) return "target";
      const cat = use.cat;
      if (!cat || (world.open[target] ?? []).includes(cat)) return "cat";
      return w({}, `${by} — подсмотрел карту игрока ${name(target)}`, { note: { pid, text: `${name(target)} · ${CAT_TITLES[cat]}|${(chars[target] as Character)[cat]}` } });
    }
    case "forceReveal": {
      if (!target) return "target";
      const cat = use.cat;
      if (!cat || (world.open[target] ?? []).includes(cat)) return "cat";
      return w({ open: { ...world.open, [target]: [...(world.open[target] ?? []), cat] } }, `${by} — игрок ${name(target)} открывает «${CAT_TITLES[cat]}»`);
    }
    case "revealFacts": {
      const open = { ...world.open };
      for (const p of world.alive) if (!(open[p] ?? []).includes("fact")) open[p] = [...(open[p] ?? []), "fact"];
      return w({ open }, `${by} — все открывают «Факт»`);
    }
    case "immunity":
      return w({}, `${by} — голоса против него не считаются`, { vote: "immunity" });
    case "doubleVote":
      return w({}, `${by} — его голос считается дважды`, { vote: "doubleVote" });
    case "cancelVote":
      if (world.round >= world.rounds) return "last";
      return w({}, `${by} — голосование отменено`, { vote: "cancelVote" });
    case "extraBed":
      return w({ places: world.places + 1 }, `${by} — мест в бункере: ${world.places + 1}`);
    case "collapse":
      if (world.places <= 1) return "empty";
      return w({ places: world.places - 1 }, `${by} — мест в бункере: ${world.places - 1}`);
    case "returnExiled": {
      const back = world.exiled[world.exiled.length - 1];
      if (!back) return "empty";
      return w({ exiled: world.exiled.slice(0, -1), alive: [...world.alive, back] }, `${by} — ${name(back)} возвращается в игру`);
    }
    case "shuffleHealth":
    case "shuffleBaggage": {
      const cat: Cat = s.id === "shuffleHealth" ? "health" : "baggage";
      const mixed = shuffle(world.alive.map((p) => (chars[p] as Character)[cat]), random);
      world.alive.forEach((p, i) => set(p, cat, mixed[i] as string));
      return w({}, by);
    }
    case "newBunker": {
      if (world.bunkerOpen === 0) return "empty";
      const used = new Set(world.bunker);
      const free = Array.from({ length: bunkerDeck }, (_, i) => i).filter((i) => !used.has(i));
      if (free.length === 0) return "empty";
      const bunker = [...world.bunker];
      bunker[world.bunkerOpen - 1] = free[Math.floor(random() * free.length)] as number;
      return w({ bunker }, `${by} — новая карта бункера`);
    }
    default:
      return "empty";
  }
}
