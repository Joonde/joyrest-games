/**
 * «Убрано · Вернуть» в конструкторах (QA 22 октября 2026, M7): удалённый элемент списка можно вернуть
 * 7 секунд на то же место. Логика без React — проверяет `undoRemove.test.ts`.
 */

/** Сколько живёт «Вернуть». */
export const UNDO_MS = 7000;

/** Убранный элемент и где он стоял. */
export interface Removed<T> {
  item: T;
  index: number;
}

/** Убрать элемент из списка по номеру; номер вне списка — список как был, `removed` = null. */
export function removeAt<T>(list: readonly T[], index: number): { list: T[]; removed: Removed<T> | null } {
  if (index < 0 || index >= list.length) return { list: [...list], removed: null };
  return { list: list.filter((_, i) => i !== index), removed: { item: list[index] as T, index } };
}

/**
 * Вернуть элемент на прежнее место. Список за 7 секунд мог измениться (добавили или убрали другие) —
 * тогда номер обрезается до длины списка. Элемент с тем же ключом уже есть (вернули дважды) — список не меняется.
 */
export function insertBack<T>(list: readonly T[], removed: Removed<T>, key?: (item: T) => string): T[] {
  if (key) {
    const id = key(removed.item);
    if (list.some((x) => key(x) === id)) return [...list];
  }
  const at = Math.max(0, Math.min(removed.index, list.length));
  return [...list.slice(0, at), removed.item, ...list.slice(at)];
}
