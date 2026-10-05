export const NAME_MAX_LENGTH = 30;

/** Чистит имя игрока или команды: обрезает пробелы, схлопывает повторы, ограничивает длину. */
export function cleanName(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
}

export function isValidName(name: string): boolean {
  return name.length > 0 && name.length <= NAME_MAX_LENGTH;
}
