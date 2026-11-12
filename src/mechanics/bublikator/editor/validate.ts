/**
 * Проверка игры «Бубликатор» перед запуском (Блок 2d). Почти всё содержимое `parseContent` приводит к допустимому сам (числа —
 * в пределы, непонятное — по умолчанию), поэтому запуск останавливают только свои названия приборов: грубое слово (стоп-лист
 * генератора — такое название игра всё равно пропустит) и повтор. Остальное — подсказки конструктора, не ошибки.
 */
import type { ValidationError } from "../../types";
import { isBlocked, norm } from "../rules/names";
import type { BubContent } from "../rules/types";

export function validateBublikator(c: BubContent): ValidationError[] {
  const errors: ValidationError[] = [];
  const blocked = c.names.filter((n) => isBlocked(n));
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
