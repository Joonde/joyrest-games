// «Бой с драконом»: капитаны выбирают героя (у каждого своя врождённая сила) и раскладывают 5 очков по
// свойствам, потом команды в нескольких боях бьют дракона: каждое задание помечено свойством, урон — по
// свойству героя. Не справились — дракон отнимает жизнь; жизни кончились — команда теряет очки боя и
// ждёт следующего; дракон дожил до конца боя — все теряют очки боя.

export type Stat = "str" | "mind" | "agi" | "luck" | "cha";

export const STATS: Array<{ id: Stat; title: string; icon: string; hint: string }> = [
  { id: "str", title: "Сила", icon: "💪", hint: "активные задания" },
  { id: "mind", title: "Ум", icon: "🧠", hint: "вопросы" },
  { id: "agi", title: "Ловкость", icon: "⚡", hint: "вопросы на скорость" },
  { id: "luck", title: "Удача", icon: "🍀", hint: "бросок кубика" },
  { id: "cha", title: "Харизма", icon: "🎤", hint: "песни, тосты, выступления" },
];

export const STAT_IDS = STATS.map((s) => s.id);
export const STAT_POINTS = 5;
export const STAT_MAX = 3;

export type HeroId = "elfess" | "elf" | "dwarf" | "knight" | "sorceress" | "archer" | "barbarian" | "priestess" | "thief" | "bard";

export interface Hero {
  id: HeroId;
  icon: string;
  name: string;
  ability: string;
  /** Что умеет — для телефона и пульта. */
  hint: string;
}

export const HEROES: Hero[] = [
  { id: "elfess", icon: "🧝‍♀️", name: "Эльфийка", ability: "Звёздная стрела", hint: "Ответили первыми на вопрос на скорость — урон ×2" },
  { id: "elf", icon: "🧝", name: "Эльф", ability: "Лесная тень", hint: "Через раз уворачивается от удара дракона" },
  { id: "dwarf", icon: "⛏️", name: "Гном", ability: "Каменная кожа", hint: "+2 жизни в каждом бою" },
  { id: "knight", icon: "🛡️", name: "Рыцарь", ability: "Щит", hint: "Первый удар дракона в бою не проходит" },
  { id: "sorceress", icon: "🧙‍♀️", name: "Волшебница", ability: "Огненный шар", hint: "На вопросах «Ум» урон +50%" },
  { id: "archer", icon: "🏹", name: "Лучник", ability: "Меткий выстрел", hint: "Каждый верный ответ на вопрос — ещё +20 урона" },
  { id: "barbarian", icon: "🪓", name: "Варвар", ability: "Ярость", hint: "На заданиях «Сила» урон ×2" },
  { id: "priestess", icon: "💖", name: "Жрица", ability: "Исцеление", hint: "Каждое третье выполненное задание возвращает жизнь" },
  { id: "thief", icon: "🗡️", name: "Вор", ability: "Удачный бросок", hint: "На кубике выпадает на 1 больше (до 6)" },
  { id: "bard", icon: "🎻", name: "Бард", ability: "Песнь отваги", hint: "На заданиях «Харизма» урон ×2" },
];

export function heroOf(id: unknown): Hero | null {
  return HEROES.find((h) => h.id === id) ?? null;
}

export type DragonTaskKind = "choice" | "task" | "dice";

export interface DragonTask {
  id: string;
  kind: DragonTaskKind;
  /** Свойство, от которого зависит урон. */
  stat: Stat;
  text: string;
  options: string[];
  correct: number;
  /** Базовый урон за выполненное задание (дальше — ×(1 + свойство) и силы героя). */
  power: number;
  /** Секунд на ответ (0 — без таймера). */
  seconds: number;
}

export interface DragonBattle {
  id: string;
  /** «Огненный дракон». */
  name: string;
  hp: number;
  tasks: DragonTask[];
}

export interface DragonContent {
  battles: DragonBattle[];
  /** Жизни команды в каждом бою. */
  lives: number;
  /** Бонус за последний удар и каждой выжившей команде за победу. */
  killBonus: number;
  winBonus: number;
  style: "classic" | "kids";
}

export const DRAGON_LIMITS = { maxBattles: 5, maxTasks: 20, text: 300, option: 120, maxHp: 100_000, maxPower: 5000, maxLives: 9, maxSeconds: 180 } as const;

function id(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newDragonTask(kind: DragonTaskKind = "choice", stat: Stat = kind === "dice" ? "luck" : kind === "task" ? "str" : "mind"): DragonTask {
  return { id: id("t"), kind, stat, text: kind === "dice" ? "Бросайте кубик — бейте наудачу!" : "", options: ["", "", "", ""], correct: 0, power: 100, seconds: kind === "choice" ? 30 : 0 };
}

export function newBattle(n = 1): DragonBattle {
  return { id: id("b"), name: n === 1 ? "Огненный дракон" : n === 2 ? "Ледяной дракон" : "Древний дракон", hp: 1500 * n, tasks: [newDragonTask("choice"), newDragonTask("task"), newDragonTask("dice")] };
}

export function createDragon(): DragonContent {
  return { battles: [newBattle(1), newBattle(2)], lives: 3, killBonus: 300, winBonus: 100, style: "classic" };
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
const ID = /^[A-Za-z0-9_-]{1,40}$/;

function parseTask(raw: unknown, i: number, seen: Set<string>): DragonTask {
  const t = rec(raw);
  let tid = typeof t.id === "string" && ID.test(t.id) ? t.id : `t${i + 1}`;
  while (seen.has(tid)) tid += "_";
  seen.add(tid);
  const kind: DragonTaskKind = t.kind === "task" || t.kind === "dice" ? t.kind : "choice";
  return {
    id: tid,
    kind,
    stat: STAT_IDS.includes(t.stat as Stat) ? (t.stat as Stat) : kind === "dice" ? "luck" : kind === "task" ? "str" : "mind",
    text: str(t.text, DRAGON_LIMITS.text),
    options: Array.from({ length: 4 }, (_, k) => str(Array.isArray(t.options) ? t.options[k] : "", DRAGON_LIMITS.option)),
    correct: int(t.correct, 0, 0, 3),
    power: int(t.power, 100, 0, DRAGON_LIMITS.maxPower),
    seconds: int(t.seconds, kind === "choice" ? 30 : 0, 0, DRAGON_LIMITS.maxSeconds),
  };
}

export function parseDragon(raw: unknown): DragonContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const battles = (Array.isArray(d.battles) ? d.battles : []).slice(0, DRAGON_LIMITS.maxBattles).map((item, i) => {
    const b = rec(item);
    let bid = typeof b.id === "string" && ID.test(b.id) ? b.id : `b${i + 1}`;
    while (seen.has(bid)) bid += "_";
    seen.add(bid);
    return {
      id: bid,
      name: str(b.name, 60) || "Дракон",
      hp: int(b.hp, 1500, 1, DRAGON_LIMITS.maxHp),
      tasks: (Array.isArray(b.tasks) ? b.tasks : []).slice(0, DRAGON_LIMITS.maxTasks).map((t, k) => parseTask(t, k, seen)),
    };
  });
  return {
    battles,
    lives: int(d.lives, 3, 1, DRAGON_LIMITS.maxLives),
    killBonus: int(d.killBonus, 300, 0, DRAGON_LIMITS.maxPower),
    winBonus: int(d.winBonus, 100, 0, DRAGON_LIMITS.maxPower),
    style: d.style === "kids" ? "kids" : "classic",
  };
}

export type Stats = Record<Stat, number>;

/** Свойства от капитана: целые 0–3, всего не больше 5; иначе — поровну (по 1). */
export function parseStats(raw: unknown): Stats {
  const r = rec(raw);
  const stats = Object.fromEntries(STAT_IDS.map((s) => [s, int(r[s], 0, 0, STAT_MAX)])) as Stats;
  const total = STAT_IDS.reduce((a, s) => a + stats[s], 0);
  if (total > STAT_POINTS || total === 0) return Object.fromEntries(STAT_IDS.map((s) => [s, 1])) as Stats;
  return stats;
}

export function statTitle(s: Stat): string {
  return STATS.find((x) => x.id === s)?.title ?? s;
}

/**
 * Список: «# Бой: Огненный дракон 2000» — новый бой (число — здоровье). Дальше задания: «Ум: вопрос?» и
 * строки «- вариант», «* верный»; «Сила: задание» / «Харизма: …» — задание (засчитывает ведущий); «Удача» —
 * кубик. «(150)» в конце — урон.
 */
export function parseDragonList(text: string): DragonBattle[] {
  const battles: DragonBattle[] = [];
  let battle: DragonBattle | null = null;
  let task: DragonTask | null = null;
  const statByWord: Record<string, Stat> = { сила: "str", ум: "mind", ловкость: "agi", удача: "luck", харизма: "cha" };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^#\s*бой\s*[:.]?\s*(.*?)\s*(\d{2,6})?\s*$/i);
    if (head) {
      battle = { id: id("b"), name: (head[1] ?? "").trim().slice(0, 60) || "Дракон", hp: Math.min(DRAGON_LIMITS.maxHp, Number(head[2] ?? 1500) || 1500), tasks: [] };
      battles.push(battle);
      task = null;
      continue;
    }
    if (!battle) {
      battle = { id: id("b"), name: "Дракон", hp: 1500, tasks: [] };
      battles.push(battle);
    }
    const opt = line.match(/^([-*•])\s*(.+)$/);
    if (opt && task && task.kind === "choice") {
      const free = task.options.findIndex((o) => !o);
      if (free >= 0) {
        task.options[free] = (opt[2] ?? "").slice(0, DRAGON_LIMITS.option);
        if (opt[1] === "*") task.correct = free;
      }
      continue;
    }
    const pts = line.match(/\((\d{1,4})\)\s*$/);
    const body = (pts ? line.slice(0, pts.index) : line).trim();
    const m = body.match(/^(сила|ум|ловкость|удача|харизма)\s*[:.]\s*(.*)$/i);
    const stat = m ? (statByWord[(m[1] ?? "").toLowerCase()] ?? "mind") : "mind";
    const textPart = (m ? (m[2] ?? "") : body).slice(0, DRAGON_LIMITS.text);
    const kind: DragonTaskKind = stat === "luck" ? "dice" : stat === "str" || stat === "cha" ? "task" : "choice";
    task = { ...newDragonTask(kind, stat), text: textPart || (kind === "dice" ? "Бросайте кубик!" : ""), power: pts ? Math.min(DRAGON_LIMITS.maxPower, Number(pts[1])) : 100 };
    if (battle.tasks.length < DRAGON_LIMITS.maxTasks) battle.tasks.push(task);
  }
  return battles.filter((b) => b.tasks.length > 0).slice(0, DRAGON_LIMITS.maxBattles);
}
export const LETTERS_RU = ["A", "B", "C", "D"];
