/**
 * Вибрация телефона (решение владельца 6 ноября 2026, аудит 2b, №18): на телефоне гостя звука нет — звук только на экране
 * зала. Приказ выполнен (свой или с вашей помощью) — одна короткая; не успели — две коротких; на каждое движение прибора и
 * на отмену приказа — ничего. Где вибрации нет (Safari на iPhone) — молча ничего.
 */
import type { Flash } from "./model";

/** Одна короткая, мс. */
export const BUZZ_MS = 40;
/** Пауза между двумя короткими, мс. */
export const BUZZ_GAP_MS = 90;

/** Шаблон вибрации на итог приказа (`navigator.vibrate`) или null — не вибрировать. */
export function vibrationFor(kind: Flash["kind"]): number[] | null {
  switch (kind) {
    case "done":
    case "helped":
      return [BUZZ_MS];
    case "fail":
      return [BUZZ_MS, BUZZ_GAP_MS, BUZZ_MS];
    case "cancel":
      return null;
  }
}

/** Вибрировать, если телефон умеет; ошибки браузера (нет разрешения, вкладка в фоне) не мешают игре. */
export function buzz(kind: Flash["kind"]): void {
  const pattern = vibrationFor(kind);
  if (!pattern || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Нет вибрации — ничего.
  }
}

/**
 * Телефон умеет вибрировать (`navigator.vibrate`). Нет (Safari на iPhone) — переключатель «Вибрация» и подсказку о ней не
 * показываем: обещать то, чего не будет, незачем (решение проверки 2b, круг 2, №10, 11 ноября 2026).
 */
export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}
