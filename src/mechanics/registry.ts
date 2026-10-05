import type { Mechanic } from "./types";

/**
 * Реестр механик. Новая механика подключается одной строкой здесь.
 * Квиз появится на этапе 4.
 */
export const mechanics: Array<Mechanic<never, never>> = [];

export function getMechanic(id: string | null): Mechanic<never, never> | undefined {
  return id ? mechanics.find((m) => m.id === id) : undefined;
}
