// Оформление экрана зала телешоу («Своя игра», «Кто хочет стать миллионером», «Гонка на выживание»): `content.look`.
// «Классика» — как раньше, в цветах темы сессии; остальные — фон-картинка на весь кадр
// (`public/shows/art/web/<игра>-<вид>.webp`, нарисованы в Figma AI) и «телевизионные» плашки. Цвета и
// картинки — переменные `.show-stage--<вид>` в src/styles.css, логика игры от вида не зависит.
// У каждой механики свой список видов: «Своя игра» и «Миллионер» — «Студия», «Гонка» — «Трасса».

export type ShowLook = "classic" | "studio" | "evening" | "track" | "table";

/** Виды «Своей игры» и «Миллионера». */
export const SHOW_LOOKS: ShowLook[] = ["classic", "studio", "evening"];

/** Виды «Своей игры» и «100 к 1»: ещё «Игровой стол» (карты, кубики, кнопка — Figma AI, `public/covers/art/web/board`). */
export const TABLE_LOOKS: ShowLook[] = ["classic", "studio", "evening", "table"];

/** Новые игры и шаблон «Своей игры» (решение владельца 17 октября 2026). */
export const DEFAULT_BOARD_LOOK: ShowLook = "table";

/** Виды «Гонки на выживание». */
export const SURVIVAL_LOOKS: ShowLook[] = ["classic", "track", "evening"];

export const SHOW_LOOK_TITLES: Record<ShowLook, string> = {
  classic: "Классика",
  studio: "Студия",
  evening: "Вечер JoyRest",
  track: "Трасса",
  table: "Игровой стол",
};

/** Новые игры и шаблоны библиотеки («Своя игра», «Миллионер»). */
export const DEFAULT_SHOW_LOOK: ShowLook = "studio";

/** Новые игры и шаблон «Гонки на выживание». */
export const DEFAULT_SURVIVAL_LOOK: ShowLook = "track";

/** Из базы: старые игры без поля и неизвестные (или чужие для механики) значения — «Классика». */
export function parseShowLook(value: unknown, looks: readonly ShowLook[] = SHOW_LOOKS): ShowLook {
  return typeof value === "string" && value !== "classic" && (looks as readonly string[]).includes(value) ? (value as ShowLook) : "classic";
}

/** Классы корня экрана зала: «Классика» — без изменений. */
export function showStageClass(look: ShowLook): string {
  return look === "classic" ? "" : ` show-stage show-stage--${look}`;
}
