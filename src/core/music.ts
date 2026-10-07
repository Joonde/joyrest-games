// Подписи музыки (CLAUDE.md, раздел 7, «Музыка»): категории, откуда права, длительность.
import type { TrackCategory, TrackLicense } from "../data/types";

export const TRACK_CATEGORIES: Array<{ id: TrackCategory; title: string; hint: string }> = [
  { id: "lobby", title: "Лобби", hint: "Пока гости подключаются" },
  { id: "background", title: "Фон", hint: "Под вопросы и разговоры" },
  { id: "contest", title: "Конкурс", hint: "Заводная, для активных конкурсов" },
  { id: "board", title: "Таблица", hint: "Итоги раунда, общий счёт" },
  { id: "break", title: "Перерыв", hint: "Технический перерыв, пауза" },
  { id: "award", title: "Награждение", hint: "Пьедестал и финал" },
  { id: "holiday", title: "Праздник", hint: "Новый год и другие поводы" },
];

export const LICENSE_TITLES: Record<TrackLicense, string> = {
  pixabay: "Pixabay (бесплатно, можно в коммерции)",
  bought: "Куплен с лицензией",
  own: "Свой трек",
  other: "Другое — напишу откуда",
};

export function categoryTitle(id: TrackCategory): string {
  return TRACK_CATEGORIES.find((c) => c.id === id)?.title ?? "Фон";
}

/** 61000 → «1:01». */
export function durationLabel(ms: number | null): string {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Название из имени файла: без расширения, подчёркивания — пробелы. */
export function titleFromFile(name: string): string {
  return name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Следующий трек той же категории по кругу; нет других — null. */
export function nextInCategory<T extends { id: string; category: TrackCategory }>(tracks: T[], currentId: string): T | null {
  const current = tracks.find((t) => t.id === currentId);
  if (!current) return null;
  const same = tracks.filter((t) => t.category === current.category);
  if (same.length < 2) return null;
  const index = same.findIndex((t) => t.id === currentId);
  return same[(index + 1) % same.length] ?? null;
}
