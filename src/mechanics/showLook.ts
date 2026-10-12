// Оформление экрана зала телешоу («Своя игра», «Кто хочет стать миллионером»): `content.look`.
// «Классика» — как раньше, в цветах темы сессии; «Студия» и «Вечер JoyRest» — фон-картинка на весь кадр
// (`public/shows/art/web/<игра>-<вид>.webp`, нарисованы в Figma AI) и «телевизионные» плашки. Цвета и
// картинки — переменные `.show-stage--studio|evening` в src/styles.css, логика игры от вида не зависит.

export type ShowLook = "classic" | "studio" | "evening";

export const SHOW_LOOKS: ShowLook[] = ["classic", "studio", "evening"];

export const SHOW_LOOK_TITLES: Record<ShowLook, string> = {
  classic: "Классика",
  studio: "Студия",
  evening: "Вечер JoyRest",
};

/** Новые игры и шаблоны библиотеки. */
export const DEFAULT_SHOW_LOOK: ShowLook = "studio";

/** Из базы: старые игры без поля и неизвестные значения — «Классика» (прежний вид). */
export function parseShowLook(value: unknown): ShowLook {
  return value === "studio" || value === "evening" ? value : "classic";
}

/** Классы корня экрана зала: «Классика» — без изменений. */
export function showStageClass(look: ShowLook): string {
  return look === "classic" ? "" : ` show-stage show-stage--${look}`;
}
