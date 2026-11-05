/** Содержимое игры из конструктора: разбор без исключений, значения по умолчанию — ТЗ, таблица «Конструктор». */
import { CREW_SIZE_DEFAULT, TASK_MAX } from "./constants";
import type { BubContent, Difficulty, EventKind, Theme } from "./types";

export const THEMES: readonly Theme[] = ["space", "pirates", "newyear", "submarine", "wedding"];
export const DIFFICULTIES: readonly Difficulty[] = ["kids", "normal", "crazy"];
export const EVENT_KINDS: readonly EventKind[] = ["meteor", "pull", "sos", "captain"];

/** Встроенные задания «Все на палубу!»: 6 общих и 4 темы — всего 10. */
const COMMON_TASKS = [
  "Встаньте по росту!",
  "Сделайте общее селфи всем экипажем!",
  "Покажите самую смешную рожицу экипажа!",
  "Изобразите, как ваш корабль долетает до цели!",
  "Обнимитесь всем экипажем!",
  "Придумайте и прокричите девиз экипажа!",
];
const THEME_TASKS: Record<Theme, string[]> = {
  space: ["Изобразите двигатель ракеты!", "Спойте позывной корабля!", "Покажите невесомость!", "Изобразите встречу с пришельцами!"],
  pirates: ["Изобразите шторм на палубе!", "Спойте пиратскую песню!", "Покажите, как ищут клад!", "Изобразите абордаж!"],
  newyear: ["Изобразите оленью упряжку!", "Спойте песенку своих саней!", "Изобразите хоровод вокруг ёлки!", "Покажите, как Дед Мороз дарит подарки!"],
  submarine: ["Изобразите погружение!", "Спойте песню подводников!", "Покажите стаю рыб!", "Изобразите гигантского осьминога!"],
  wedding: ["Изобразите первый танец!", "Спойте свадебную песню!", "Покажите, как ловят букет!", "Произнесите тост за молодых!"],
};

export function defaultTasks(theme: Theme): string[] {
  return [...COMMON_TASKS, ...THEME_TASKS[theme]];
}

export function cleanTask(value: unknown): string {
  if (typeof value !== "string") return "";
  // Управляющие символы — вон, пробелы — одним.
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, TASK_MAX);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

/** `content` игры → содержимое «Бубликатора»; непонятное — значения по умолчанию. */
export function parseContent(raw: unknown): BubContent {
  const r = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const theme = pick(r.theme, THEMES, "space");
  const difficulty = pick(r.difficulty, DIFFICULTIES, "normal");
  const legs = r.legs === 2 ? 2 : 3;
  const minutes = int(r.legMinutes, 3, 5, 4) as 3 | 4 | 5;
  const ev = typeof r.events === "object" && r.events !== null ? (r.events as Record<string, unknown>) : {};
  const events = Object.fromEntries(EVENT_KINDS.map((k) => [k, ev[k] !== false])) as Record<EventKind, boolean>;
  const tasks = Array.isArray(r.captainTasks) ? r.captainTasks.map(cleanTask).filter((t) => t !== "").slice(0, 30) : [];
  const size = typeof r.crewSize === "object" && r.crewSize !== null ? (r.crewSize as Record<string, unknown>) : {};
  const min = int(size.min, 1, CREW_SIZE_DEFAULT.max, CREW_SIZE_DEFAULT.min);
  const max = Math.max(min, int(size.max, 1, CREW_SIZE_DEFAULT.max, CREW_SIZE_DEFAULT.max));
  const names = Array.isArray(r.names)
    ? [...new Set(r.names.filter((n): n is string => typeof n === "string").map((n) => n.replace(/\s+/g, " ").trim().slice(0, 24)).filter((n) => n.length >= 2))].slice(0, 400)
    : [];
  return {
    theme,
    difficulty,
    legs,
    legMinutes: minutes,
    events,
    captainTasks: tasks.length > 0 ? tasks : defaultTasks(theme),
    // Диверсант — от 12 лет: в детской сложности его нет.
    saboteur: r.saboteur === true && difficulty !== "kids",
    crewSize: { min, max },
    names,
  };
}
