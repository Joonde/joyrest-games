// «Рулетка судьбы» — формат содержимого игры (паспорт LOGIC.md, п. 6–8). Хранится в games/{id}.content и в снимке
// сессии. Картинки, треки и видео — только id медиатеки (Р-37), без blob: и base64. Разбор ничего не бросает:
// неизвестные и битые поля заменяются значениями по умолчанию.
import { parseClip, type Clip } from "../../core/clip";
import { parseAnswerMusic, type AnswerMusic } from "../quiz/content";
import { parseVideo, type VideoSource } from "../dance/content";

export type Rarity = "common" | "rare" | "legendary";
export const RARITIES: readonly Rarity[] = ["common", "rare", "legendary"];

export type TaskKind = "task" | "choice" | "open" | "order" | "pictures" | "speed" | "number" | "buzz" | "dance" | "karaoke" | "battle" | "bonus";
export const TASK_KINDS: readonly TaskKind[] = ["task", "choice", "open", "order", "pictures", "speed", "number", "buzz", "dance", "karaoke", "battle", "bonus"];

/** Эффекты бонусов (п. 3.6). В первой версии в игре работает только «extraSpin» (Р-33). */
export type BonusEffect = "extraSpin" | "doubleNext" | "doubleOrNothing" | "chooseTheme" | "freePass";
export const BONUS_EFFECTS: readonly BonusEffect[] = ["extraSpin", "doubleNext", "doubleOrNothing", "chooseTheme", "freePass"];
/** Эффекты, которые уже можно ставить в игру (остальные — этап 7). */
export const READY_EFFECTS: ReadonlySet<BonusEffect> = new Set<BonusEffect>(["extraSpin"]);

export type SkinId = "royal" | "olympus" | "neon" | "noir";
export const SKINS: readonly SkinId[] = ["royal", "olympus", "neon", "noir"];
export type PointerId = "arrow" | "bottle" | "dagger" | "sword" | "spear" | "trident" | "key" | "scepter" | "quill";
export const POINTERS: readonly PointerId[] = ["arrow", "bottle", "dagger", "sword", "spear", "trident", "key", "scepter", "quill"];
/** Старые указатели прототипа → новые (ТЗ §13.5). */
const OLD_POINTERS: Record<string, PointerId> = { cupid: "dagger", zeus: "trident", target: "key" };

/** Иконки тем (рисуются на секторе и в каталоге). */
export const THEME_ICONS = ["music", "dance", "film", "mic", "bolt", "swords", "question", "chat", "sparkles", "gift", "glass", "trophy", "star", "heart", "camera", "book"] as const;
export type ThemeIcon = (typeof THEME_ICONS)[number];

export type BoardMode = "each" | "rounds" | "manual";
export type ChoiceMode = "any" | "all";
export type NumberScoring = "closest" | "places";
/** Танец и караоке: оценивает ведущий или капитаны других команд (1–5). */
export type RateMode = "host" | "captains";
/** Батл: кто решает. */
export type BattleJudge = "host" | "captains" | "hall";
/** Батл: кто выбирает соперника. */
export type BattleOpponent = "captain" | "host" | "random";

export interface RoulettePicture {
  imageId: string | null;
  alt: string;
  /** До 10 верных написаний. */
  answers: string[];
}

export interface RouletteVideo {
  source: VideoSource;
  url: string;
  name: string;
}

/**
 * Задание. Поля всех типов хранятся всегда: смена типа их скрывает, а не стирает (п. 6). Проверка (validate) смотрит
 * только поля текущего типа.
 */
export interface RouletteTask {
  id: string;
  kind: TaskKind;
  title: string;
  text: string;
  rarity: Rarity;
  points: number;
  /** Секунды на задание; 0 — без таймера. */
  seconds: number;
  active: boolean;
  /** 18+ (Р-27), напитки и спорт (Р-28). */
  adult: boolean;
  alcohol: boolean;
  sport: boolean;
  /** «Безалкогольная / безопасная замена» — показывается на экране вместе с заданием (Р-28). */
  alt: string;
  /** Заметка ведущему: видна только на пульте. */
  note: string;
  imageId: string | null;
  imageAlt: string;
  imageFit: "contain" | "cover";
  /** Варианты (choice, speed) и карточки в верном порядке (order). */
  options: string[];
  /** Номера верных вариантов. */
  correct: number[];
  /** Несколько верных: «любой» — капитан выбирает ровно один; «все» — точный набор. */
  choiceMode: ChoiceMode;
  /** Верные написания (open) и ответ для ведущего (buzz). */
  answers: string[];
  numberAnswer: number | null;
  unit: string;
  scoring: NumberScoring;
  /** order: частичные очки за карточки на своём месте. */
  partial: boolean;
  pictures: RoulettePicture[];
  /** Основной трек задания (угадывание, припев, звучание). */
  clip: Clip;
  /** Музыка на ответ (Р-35). */
  answerMusic: AnswerMusic | null;
  video: RouletteVideo;
  effect: BonusEffect;
  rate: RateMode;
  judge: BattleJudge;
  opponent: BattleOpponent;
}

export interface RouletteTheme {
  id: string;
  name: string;
  /** Короткая подпись на секторе. */
  short: string;
  icon: ThemeIcon;
  active: boolean;
  tasks: RouletteTask[];
}

export interface RouletteContent {
  description: string;
  themes: RouletteTheme[];
  /** Шансы редкостей в процентах, сумма — ровно 100. */
  weights: Record<Rarity, number>;
  /** Очки по умолчанию для новых заданий (Р-26: на уже созданные не влияют). */
  rarityPoints: Record<Rarity, number>;
  /** Не давать команде два легендарных подряд (Р-17 п. 4). */
  noTwoLegendary: boolean;
  /** Режим 18+: без него задания 18+ не попадают в колоду (Р-27). */
  adult: boolean;
  themesPerTeam: 1 | 2;
  rounds: number;
  /** Штраф за «Пропустить»; 0 — выключен (Р-30). */
  refusePenalty: number;
  /** Заставка перед заданием. */
  intro: boolean;
  /** Таблица: после каждого хода, в конце круга или по кнопке. */
  boardMode: BoardMode;
  /** Картинки заданий и на телефонах. */
  phoneImages: boolean;
  skin: SkinId;
  pointer: PointerId;
  /** Длительность вращения, секунды. */
  spinSeconds: number;
}

export const LIMITS = {
  /** Разбор держит больше, чем пропускает проверка (15), — чтобы лишнее было видно, а не пропадало. */
  themes: 30,
  maxThemes: 15,
  minThemes: 3,
  tasks: 60,
  themeName: 40,
  themeShort: 14,
  title: 80,
  text: 500,
  note: 300,
  alt: 200,
  imageAlt: 120,
  description: 500,
  options: 6,
  minOptions: 2,
  minOrder: 3,
  option: 120,
  answers: 10,
  answer: 100,
  unit: 20,
  pictures: 4,
  minPictures: 2,
  maxPoints: 1000,
  minSeconds: 5,
  maxSeconds: 900,
  maxRounds: 10,
  minSpin: 2,
  maxSpin: 8,
  maxNumber: 1e12,
  videoUrl: 500,
} as const;

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 8;

export const DEFAULT_WEIGHTS: Record<Rarity, number> = { common: 60, rare: 30, legendary: 10 };
export const DEFAULT_RARITY_POINTS: Record<Rarity, number> = { common: 50, rare: 100, legendary: 200 };

export const RARITY_TITLES: Record<Rarity, string> = { common: "Обычное", rare: "Редкое", legendary: "Легендарное" };

export const KIND_TITLES: Record<TaskKind, string> = {
  task: "Задание",
  choice: "Варианты",
  open: "Открытый ответ",
  order: "По порядку",
  pictures: "Картинки",
  speed: "На скорость",
  number: "Угадай число",
  buzz: "Кто первый",
  dance: "Танец",
  karaoke: "Караоке",
  battle: "Батл",
  bonus: "Бонус",
};

export const EFFECT_TITLES: Record<BonusEffect, string> = {
  extraSpin: "Ещё вращение",
  doubleNext: "Следующее ×2",
  doubleOrNothing: "Всё или ничего",
  chooseTheme: "Выбор темы",
  freePass: "Пропуск без штрафа",
};

/** Время по умолчанию для нового задания, секунды (0 — без таймера). */
export const DEFAULT_SECONDS: Record<TaskKind, number> = {
  task: 60,
  choice: 30,
  open: 30,
  order: 45,
  pictures: 45,
  speed: 20,
  number: 30,
  buzz: 30,
  dance: 60,
  karaoke: 60,
  battle: 60,
  bonus: 0,
};

/** Типы, где итог ставит ведущий кнопками (Р-23). */
export const MANUAL_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>(["task", "dance", "karaoke", "battle", "bonus"]);
/** Типы, где отвечают капитаны всех команд (п. 3.4). */
export const ALL_TEAMS_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>(["speed", "number", "buzz"]);

export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function createRoulette(): RouletteContent {
  return {
    description: "",
    themes: [],
    weights: { ...DEFAULT_WEIGHTS },
    rarityPoints: { ...DEFAULT_RARITY_POINTS },
    noTwoLegendary: true,
    adult: false,
    themesPerTeam: 2,
    rounds: 3,
    refusePenalty: 0,
    intro: true,
    boardMode: "each",
    phoneImages: false,
    skin: "royal",
    pointer: "arrow",
    spinSeconds: 5,
  };
}

/** Новое задание: очки — по редкости из настроек игры (Р-26). */
export function newTask(content: Pick<RouletteContent, "rarityPoints">, kind: TaskKind = "task", rarity: Rarity = "common"): RouletteTask {
  return {
    id: newId("t"),
    kind,
    title: "",
    text: "",
    rarity,
    points: content.rarityPoints[rarity],
    seconds: DEFAULT_SECONDS[kind],
    active: true,
    adult: false,
    alcohol: false,
    sport: false,
    alt: "",
    note: "",
    imageId: null,
    imageAlt: "",
    imageFit: "contain",
    options: kind === "order" ? ["", "", ""] : kind === "choice" || kind === "speed" ? ["", ""] : [],
    correct: [],
    choiceMode: "any",
    answers: [],
    numberAnswer: null,
    unit: "",
    scoring: "places",
    partial: true,
    pictures: [],
    clip: parseClip({}),
    answerMusic: null,
    video: { source: "none", url: "", name: "" },
    effect: "extraSpin",
    rate: "host",
    judge: "host",
    opponent: "captain",
  };
}

export function newTheme(name = ""): RouletteTheme {
  return { id: newId("th"), name, short: "", icon: "sparkles", active: true, tasks: [] };
}

// ------------------------------------------------------------------ разбор

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const MEDIA_ID = /^[A-Za-z0-9_-]{1,64}$/;

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Одна строка без управляющих символов. */
export function cleanLine(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Текст с переносами строк (без остальных управляющих символов). */
function cleanText(value: unknown, max: number): string {
  return typeof value === "string"
    ? value
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, max)
    : "";
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value) ? value.slice(0, maxItems).map((v) => cleanLine(v, maxLength)) : [];
}

function uniqueId(raw: unknown, fallback: string, seen: Set<string>): string {
  let id = typeof raw === "string" && ID.test(raw) ? raw : fallback;
  for (let n = 2; seen.has(id); n++) id = (typeof raw === "string" && ID.test(raw) ? raw : fallback).slice(0, 34) + "_" + n;
  seen.add(id);
  return id;
}

/** Секунды задания: 0 — без таймера, иначе 5–900. */
export function parseSeconds(value: unknown, fallback: number): number {
  if (value === 0) return 0;
  return int(value, fallback, LIMITS.minSeconds, LIMITS.maxSeconds);
}

function parseNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > LIMITS.maxNumber) return null;
  return Math.round(value * 1000) / 1000;
}

function parsePictures(value: unknown): RoulettePicture[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, LIMITS.pictures).map((raw) => {
    const d = rec(raw);
    return {
      imageId: typeof d.imageId === "string" && MEDIA_ID.test(d.imageId) ? d.imageId : null,
      alt: cleanLine(d.alt, LIMITS.imageAlt),
      answers: strings(d.answers, LIMITS.answers, LIMITS.answer),
    };
  });
}

function parseCorrect(raw: unknown, count: number): number[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "number" ? [raw] : [];
  return [...new Set(list.filter((i): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < count))].sort((a, b) => a - b);
}

function parseTask(raw: unknown, index: number, seen: Set<string>, points: Record<Rarity, number>): RouletteTask {
  const d = rec(raw);
  const kind = oneOf(d.kind, TASK_KINDS, "task");
  const rarity = oneOf(d.rarity, RARITIES, "common");
  const options = strings(d.options, LIMITS.options, LIMITS.option);
  const video = parseVideo(d.video, LIMITS.videoUrl);
  return {
    id: uniqueId(d.id, "t" + (index + 1), seen),
    kind,
    title: cleanLine(d.title, LIMITS.title),
    text: cleanText(d.text, LIMITS.text),
    rarity,
    points: int(d.points, points[rarity], 0, LIMITS.maxPoints),
    seconds: parseSeconds(d.seconds, DEFAULT_SECONDS[kind]),
    active: d.active !== false,
    adult: d.adult === true,
    alcohol: d.alcohol === true,
    sport: d.sport === true,
    alt: cleanLine(d.alt, LIMITS.alt),
    note: cleanText(d.note, LIMITS.note),
    imageId: typeof d.imageId === "string" && MEDIA_ID.test(d.imageId) ? d.imageId : null,
    imageAlt: cleanLine(d.imageAlt, LIMITS.imageAlt),
    imageFit: d.imageFit === "cover" ? "cover" : "contain",
    options,
    correct: parseCorrect(d.correct, options.length),
    choiceMode: d.choiceMode === "all" ? "all" : "any",
    answers: strings(d.answers, LIMITS.answers, LIMITS.answer),
    numberAnswer: parseNumber(d.numberAnswer),
    unit: cleanLine(d.unit, LIMITS.unit),
    scoring: d.scoring === "closest" ? "closest" : "places",
    partial: d.partial !== false,
    pictures: parsePictures(d.pictures),
    clip: parseClip(d.clip),
    answerMusic: parseAnswerMusic(d.answerMusic),
    video: { source: video.source, url: video.url, name: video.name },
    effect: oneOf(d.effect, BONUS_EFFECTS, "extraSpin"),
    rate: d.rate === "captains" ? "captains" : "host",
    judge: oneOf(d.judge, ["host", "captains", "hall"] as const, "host"),
    // «randomOpponent» из ТЗ — настройка батла «соперник: случайный» (Р-32).
    opponent: oneOf(d.opponent, ["captain", "host", "random"] as const, "captain"),
  };
}

function parseRarityMap(raw: unknown, fallback: Record<Rarity, number>, max: number): Record<Rarity, number> {
  const d = rec(raw);
  return { common: int(d.common, fallback.common, 0, max), rare: int(d.rare, fallback.rare, 0, max), legendary: int(d.legendary, fallback.legendary, 0, max) };
}

/** Содержимое из базы → формат игры. Ничего не бросает. */
export function parseRoulette(raw: unknown): RouletteContent {
  const d = rec(raw);
  const base = createRoulette();
  const rarityPoints = parseRarityMap(d.rarityPoints, base.rarityPoints, LIMITS.maxPoints);
  const seenThemes = new Set<string>();
  const seenTasks = new Set<string>();
  let taskIndex = 0;
  const themes = (Array.isArray(d.themes) ? d.themes : []).slice(0, LIMITS.themes).map((raw, i): RouletteTheme => {
    const t = rec(raw);
    return {
      id: uniqueId(t.id, "th" + (i + 1), seenThemes),
      name: cleanLine(t.name, LIMITS.themeName),
      short: cleanLine(t.short, LIMITS.themeShort),
      icon: oneOf(t.icon, THEME_ICONS, "sparkles"),
      active: t.active !== false,
      tasks: (Array.isArray(t.tasks) ? t.tasks : []).slice(0, LIMITS.tasks).map((task) => parseTask(task, taskIndex++, seenTasks, rarityPoints)),
    };
  });
  const oldPointer = typeof d.pointer === "string" ? OLD_POINTERS[d.pointer] : undefined;
  return {
    description: cleanText(d.description, LIMITS.description),
    themes,
    weights: parseRarityMap(d.weights, base.weights, 100),
    rarityPoints,
    noTwoLegendary: d.noTwoLegendary !== false,
    adult: d.adult === true,
    themesPerTeam: d.themesPerTeam === 1 ? 1 : 2,
    rounds: int(d.rounds, base.rounds, 1, LIMITS.maxRounds),
    refusePenalty: int(d.refusePenalty, base.refusePenalty, 0, LIMITS.maxPoints),
    intro: d.intro !== false,
    boardMode: oneOf(d.boardMode, ["each", "rounds", "manual"] as const, base.boardMode),
    phoneImages: d.phoneImages === true,
    skin: oneOf(d.skin, SKINS, base.skin),
    pointer: oldPointer ?? oneOf(d.pointer, POINTERS, base.pointer),
    spinSeconds: int(d.spinSeconds, base.spinSeconds, LIMITS.minSpin, LIMITS.maxSpin),
  };
}

// ------------------------------------------------------------------ колоды

/**
 * Задание может выпасть в этой игре: включено, подходит под режим 18+ и не пустое (Р-17 п. 1). Пустое задание
 * не выпадает, даже если проверку обошли (старая игра в снимке).
 */
export function playable(content: Pick<RouletteContent, "adult">, task: RouletteTask): boolean {
  return task.active && (content.adult || !task.adult) && task.title.length > 0 && task.text.length > 0;
}

/** Задания темы, которые могут выпасть. */
export function availableTasks(content: Pick<RouletteContent, "adult">, theme: RouletteTheme): RouletteTask[] {
  return theme.tasks.filter((t) => playable(content, t));
}

/** Каталог для капитанов: включённые темы, в которых есть что выпасть (Р-4). */
export function catalogThemes(content: RouletteContent): RouletteTheme[] {
  return content.themes.filter((t) => t.active && t.name.length > 0 && availableTasks(content, t).length > 0);
}

export function themeById(content: RouletteContent, id: string | null | undefined): RouletteTheme | undefined {
  return id ? content.themes.find((t) => t.id === id) : undefined;
}

export function taskById(content: RouletteContent, id: string | null | undefined): { theme: RouletteTheme; task: RouletteTask } | undefined {
  if (!id) return undefined;
  for (const theme of content.themes) {
    const task = theme.tasks.find((t) => t.id === id);
    if (task) return { theme, task };
  }
  return undefined;
}

/** Подпись сектора: короткая или название. */
export function sectorLabel(theme: Pick<RouletteTheme, "short" | "name">): string {
  return theme.short || theme.name;
}

export function mediaIds(content: RouletteContent): string[] {
  return [...new Set(content.themes.flatMap((th) => th.tasks.flatMap((t) => [t.imageId, ...t.pictures.map((p) => p.imageId)])).filter((id): id is string => Boolean(id)))];
}

/** Треки игры (экран зала скачивает их заранее). */
export function trackIds(content: RouletteContent): string[] {
  return [...new Set(content.themes.flatMap((th) => th.tasks.flatMap((t) => [t.clip.trackId, t.answerMusic?.trackId])).filter((id): id is string => Boolean(id)))];
}
