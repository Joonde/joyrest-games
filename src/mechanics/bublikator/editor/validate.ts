/**
 * Проверка игры «Бубликатор» перед запуском (Блок 2d). Почти всё содержимое `parseContent` приводит к допустимому сам (числа —
 * в пределы, непонятное — по умолчанию), поэтому запуск останавливают только свои названия приборов: грубое слово (`isRudeName` —
 * такое название игра всё равно пропустит при раздаче) и повтор. Остальное — подсказки конструктора, не ошибки.
 */
import type { ValidationError } from "../../types";
import { isRudeName, norm } from "../rules/names";
import { NAME_MAX, NAME_MIN, NAMES_MAX, TASK_MAX, TASKS_MAX } from "../rules/constants";
import { cleanTask } from "../rules/content";
import type { BubContent } from "../rules/types";

export function validateBublikator(c: BubContent): ValidationError[] {
  const errors: ValidationError[] = [];
  const blocked = c.names.filter((n) => isRudeName(n));
  if (blocked.length > 0) {
    errors.push({ path: "names", message: `Уберите из своих названий приборов: ${blocked.map((n) => `«${n}»`).join(", ")} — такие слова игра не покажет гостям.` });
  }
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const n of c.names) {
    const key = norm(n);
    if (seen.has(key)) twice.add(n);
    seen.add(key);
  }
  if (twice.size > 0) errors.push({ path: "names", message: `Названия приборов повторяются: ${[...twice].map((n) => `«${n}»`).join(", ")} — оставьте по одному.` });
  return errors;
}

/** Своё задание или название — строка из поля «по одному на строку»: пустые строки — вон. */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l !== "");
}

/** Сколько примерно идёт игра, минут: перелёты + взлёт, привал и голосование между ними + сбор и награждение. */
export function gameMinutes(c: BubContent): { from: number; to: number } {
  const flights = c.legs * c.legMinutes;
  const between = c.legs * (c.saboteur ? 1.5 : 1);
  return { from: Math.round(flights + between + 3), to: Math.round(flights + between + 8) };
}

/** Что войдёт в игру из поля «по одному на строку» и что ведущему сказать об остальном (правило QA 22 октября 2026: молча не обрезаем). */
export interface LinesFit {
  kept: string[];
  notes: string[];
}

function quote(list: string[], max = 3): string {
  const shown = list.slice(0, max).map((x) => `«${x.length > 40 ? `${x.slice(0, 40)}…` : x}»`);
  return list.length > max ? `${shown.join(", ")} и ещё ${list.length - max}` : shown.join(", ");
}

/** Задания «Все на палубу!»: до 30, каждое до 120 знаков (аудит 2d, №10). */
export function fitTasks(lines: string[]): LinesFit {
  const notes: string[] = [];
  const long = lines.filter((l) => l.length > TASK_MAX);
  if (long.length > 0) notes.push(`Длиннее ${TASK_MAX} знаков — на экран уйдут первые ${TASK_MAX}: ${quote(long)}. Сократите, чтобы задание читалось целиком.`);
  const all = lines.map(cleanTask).filter((t) => t !== "");
  if (all.length > TASKS_MAX) notes.push(`Заданий ${all.length}, а в игре — до ${TASKS_MAX}: не войдут ${quote(all.slice(TASKS_MAX))}.`);
  return { kept: all.slice(0, TASKS_MAX), notes };
}

/** Свои названия приборов: от 2 до 24 знаков, до 400 (аудит 2d, №10). */
export function fitNames(lines: string[]): LinesFit {
  const notes: string[] = [];
  const short = lines.filter((l) => l.length < NAME_MIN);
  if (short.length > 0) notes.push(`Короче ${NAME_MIN} знаков — не возьмём: ${quote(short)}.`);
  const long = lines.filter((l) => l.length > NAME_MAX);
  if (long.length > 0) notes.push(`Длиннее ${NAME_MAX} знаков — в игру уйдут первые ${NAME_MAX}: ${long.slice(0, 3).map((l) => `«${l.slice(0, NAME_MAX)}»`).join(", ")}${long.length > 3 ? ` и ещё ${long.length - 3}` : ""}. Сократите сами, чтобы название было целым.`);
  const all = lines.map((l) => l.slice(0, NAME_MAX)).filter((l) => l.length >= NAME_MIN);
  if (all.length > NAMES_MAX) notes.push(`Названий ${all.length}, а в игре — до ${NAMES_MAX}: не войдут последние ${all.length - NAMES_MAX}.`);
  return { kept: all.slice(0, NAMES_MAX), notes };
}
