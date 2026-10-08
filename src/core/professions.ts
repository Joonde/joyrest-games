/**
 * Профессии команды JoyRest (решение владельца 8 октября 2026). Ведущие проводят игры; остальные —
 * диджеи, музыканты, фокусники, повара и т.д. — входят в платформу, видят команду и свою страницу
 * (пока пустую), но игр у них нет. Профессию ставит владелец при добавлении и в «⋯ → Профессия».
 */
export const PROFESSIONS = [
  { id: "host", title: "Ведущий", many: "Ведущие" },
  { id: "dj", title: "Диджей", many: "Диджеи" },
  { id: "musician", title: "Музыкант", many: "Музыканты" },
  { id: "singer", title: "Вокалист", many: "Вокалисты" },
  { id: "dancer", title: "Танцор", many: "Танцоры" },
  { id: "magician", title: "Фокусник", many: "Фокусники" },
  { id: "chef", title: "Выездной повар", many: "Выездные повара" },
  { id: "tamada", title: "Тамада", many: "Тамады" },
  { id: "organizer", title: "Организатор", many: "Организаторы" },
  { id: "photo", title: "Фото и видео", many: "Фото и видео" },
  { id: "animator", title: "Аниматор", many: "Аниматоры" },
  { id: "other", title: "Другая профессия", many: "Другие" },
] as const;

export type Profession = (typeof PROFESSIONS)[number]["id"];

export function isProfession(value: unknown): value is Profession {
  return typeof value === "string" && PROFESSIONS.some((p) => p.id === value);
}

/** Неизвестное или пустое — ведущий (так было до профессий). */
export function professionOf(value: unknown): Profession {
  return isProfession(value) ? value : "host";
}

export function professionTitle(value: unknown): string {
  const id = professionOf(value);
  return PROFESSIONS.find((p) => p.id === id)?.title ?? "Ведущий";
}
