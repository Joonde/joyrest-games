// «Бой с драконом»: капитаны выбирают героя (у каждого своя врождённая сила) и раскладывают 5 очков по
// свойствам, потом команды в нескольких боях бьют дракона: каждое задание помечено свойством, урон — по
// свойству героя. Не справились — дракон отнимает жизнь; жизни кончились — команда теряет очки боя и
// ждёт следующего; дракон дожил до конца боя — все теряют очки боя.

import { isQuestionHeader, listedOption, listOption, newListedRun, nextLines, pointsSuffix, QUESTION_NUMBERING, splitLines, stripBold, type ListedRun } from "../quiz/listText";

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
  /** Текст для режима «каждый сам», если задание командное («капитан», «вся команда»); '' — как `text`. */
  solo: string;
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
  /** Жизни команды (или игрока в режиме «каждый сам») в каждом бою. */
  lives: number;
  /** Сколько заданий играть в каждом бою: первые N из списка боя; 0 — все. Решение владельца 16 октября 2026. */
  perBattle: number;
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
  return { id: id("t"), kind, stat, text: kind === "dice" ? "Бросайте кубик — бейте наудачу!" : "", solo: "", options: ["", "", "", ""], correct: -1, power: 100, seconds: kind === "choice" ? 30 : 0 };
}

export function newBattle(n = 1): DragonBattle {
  return { id: id("b"), name: n === 1 ? "Огненный дракон" : n === 2 ? "Ледяной дракон" : "Древний дракон", hp: 1500 * n, tasks: [newDragonTask("choice"), newDragonTask("task"), newDragonTask("dice")] };
}

export function createDragon(): DragonContent {
  return { battles: [newBattle(1), newBattle(2)], lives: 3, perBattle: 0, killBonus: 300, winBonus: 100, style: "classic" };
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
    solo: str(t.solo, DRAGON_LIMITS.text),
    options: Array.from({ length: 4 }, (_, k) => str(Array.isArray(t.options) ? t.options[k] : "", DRAGON_LIMITS.option)),
    correct: int(t.correct, -1, -1, 3),
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
    perBattle: int(d.perBattle, 0, 0, DRAGON_LIMITS.maxTasks),
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

export interface DragonImport {
  battles: DragonBattle[];
  /** Номера строк (с 1), которые не удалось разобрать: вариант без вопроса, пятый вариант, лишнее задание. */
  skipped: number[];
  /** Замечания по строкам: «(1799)» похоже на год — урон не поставлен. */
  notes: Array<{ line: number; text: string }>;
}

/** Свойство в начале строки: «Ум: …», «Удача.», «Удача Бросайте кубик» (без двоеточия — только если дальше текст с большой буквы). */
const STAT_LINE = /^(сила|ум|ловкость|удача|харизма)(?:\s*[:.]\s*(.*)|\s+(.*)|\s*)$/i;

/** Свойство и текст задания; «Сила тока…» (дальше с маленькой буквы, без двоеточия) — не свойство, а текст. */
function statLine(body: string): { word: string; text: string } | null {
  const m = STAT_LINE.exec(body);
  if (!m) return null;
  const loose = m[3];
  if (loose !== undefined) {
    const first = loose.charAt(0);
    if (first.toLowerCase() === first && first.toUpperCase() !== first) return null;
  }
  return { word: (m[1] ?? "").toLowerCase(), text: m[2] ?? loose ?? "" };
}

/**
 * Список: «# Бой: Огненный дракон 2000» — новый бой (число — здоровье). Дальше задания: «Ум: вопрос?» и
 * строки «- вариант», «* верный» (или «- верный *»); «Сила: задание» / «Харизма: …» — задание (засчитывает ведущий);
 * «Удача» — кубик (можно без двоеточия: «Удача Бросайте кубик»). Варианты — и «а)», «1.». «(150)» в конце — урон
 * («(1799)» без слова — похоже на год: урон не ставим, пишем замечание). «Задание для команд || задание для каждого сам» — второй текст в режиме
 * «каждый сам». Без «*» верный вариант не отмечен — проверка попросит отметить.
 */
export function parseDragonImport(text: string): DragonImport {
  const battles: DragonBattle[] = [];
  const skipped: number[] = [];
  let battle: DragonBattle | null = null;
  let task: DragonTask | null = null;
  const notes: DragonImport["notes"] = [];
  let run: ListedRun = newListedRun();
  let dashed = false;
  const statByWord: Record<string, Stat> = { сила: "str", ум: "mind", ловкость: "agi", удача: "luck", харизма: "cha" };
  const lines = splitLines(text);
  const ahead = nextLines(lines);
  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const line = stripBold(raw.trim()).trim();
    if (!line) return;
    const head = line.match(/^#\s*бой\s*[:.]?\s*(.*?)\s*(\d{2,6})?\s*$/i);
    if (head) {
      battle = { id: id("b"), name: (head[1] ?? "").trim().slice(0, 60) || "Дракон", hp: Math.min(DRAGON_LIMITS.maxHp, Number(head[2] ?? 1500) || 1500), tasks: [] };
      battles.push(battle);
      task = null;
      return;
    }
    // «Вопрос 1» отдельной строкой — заголовок: текст вопроса — на следующей строке.
    if (isQuestionHeader(line)) return;
    const dash = listOption(raw);
    const cur0 = task as DragonTask | null;
    const room = cur0 !== null && cur0.kind === "choice" && cur0.options.some((o) => !o);
    const opt = dash ?? listedOption(line, room && !dashed ? run : null, ahead[index]);
    if (dash) dashed = true;
    if (opt) {
      const cur = task as DragonTask | null;
      if (!cur || cur.kind !== "choice") {
        skipped.push(lineNo);
        return;
      }
      const free = cur.options.findIndex((o) => !o);
      if (free < 0 || !opt.text) {
        skipped.push(lineNo);
        return;
      }
      cur.options[free] = opt.text.slice(0, DRAGON_LIMITS.option);
      if (opt.correct && cur.correct < 0) cur.correct = free;
      return;
    }
    let target = battle as DragonBattle | null;
    if (!target) {
      target = { id: id("b"), name: "Дракон", hp: 1500, tasks: [] };
      battle = target;
      battles.push(target);
    }
    run = newListedRun();
    dashed = false;
    const { body: numbered, points, note } = pointsSuffix(line, DRAGON_LIMITS.maxPower, "урон не поставлен");
    if (note) notes.push({ line: lineNo, text: note });
    const body = numbered.replace(QUESTION_NUMBERING, "").trim();
    const m = statLine(body);
    const stat = m ? (statByWord[m.word] ?? "mind") : "mind";
    // «текст для команд || текст для режима „каждый сам“».
    const [teamPart = "", soloPart = ""] = (m ? m.text : body).split(/\s*\|\|\s*/);
    const textPart = teamPart.slice(0, DRAGON_LIMITS.text);
    const kind: DragonTaskKind = stat === "luck" ? "dice" : stat === "str" || stat === "cha" ? "task" : "choice";
    const next: DragonTask = { ...newDragonTask(kind, stat), text: textPart || (kind === "dice" ? "Бросайте кубик!" : ""), solo: soloPart.trim().slice(0, DRAGON_LIMITS.text), power: points ?? 100 };
    task = next;
    if (target.tasks.length < DRAGON_LIMITS.maxTasks) target.tasks.push(next);
    else skipped.push(lineNo);
  });
  return { battles: battles.filter((b) => b.tasks.length > 0).slice(0, DRAGON_LIMITS.maxBattles), skipped, notes };
}

/** То же, только бои (шаблоны и старые вызовы). */
export function parseDragonList(text: string): DragonBattle[] {
  return parseDragonImport(text).battles;
}
export const LETTERS_RU = ["A", "B", "C", "D"];

/** Кубик: столько и больше — удача (удар по дракону), меньше — неудача (дракон бьёт). Решение владельца 16 октября 2026. */
export const DICE_LUCK = 3;

/** Текст задания для режима игры: в «каждый сам» — `solo`, если он есть. */
export function taskText(task: DragonTask, playMode: string | undefined, dice = "Бросайте кубик!"): string {
  if (task.kind === "dice") return task.text || dice;
  return playMode === "solo" && task.solo ? task.solo : task.text;
}
