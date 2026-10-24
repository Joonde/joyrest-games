/**
 * Тема студии — тёмная («Вечерняя») или светлая («Дневная»), решение владельца 24 октября 2026: переключатель в шапке
 * студии на телефоне, планшете и ноутбуке; выбор запоминается на устройстве. Пульт, экран зала и телефоны гостей
 * по-прежнему показывают тему игры (`useTheme`), а уходя, возвращают тему студии.
 */
import { useEffect, useState } from "react";
import { joyrest, joyrestDay } from "./joyrest";

export type StudioThemeId = typeof joyrest.id | typeof joyrestDay.id;

export const STUDIO_THEME_KEY = "joyrest.studio.theme";
const CHANGED = "joyrest:studio-theme";

/** Только точное «joyrest-day» — светлая; всё остальное (нет, мусор, недоступно хранилище) — тёмная. */
export function parseStudioTheme(value: string | null | undefined): StudioThemeId {
  return value === joyrestDay.id ? joyrestDay.id : joyrest.id;
}

export function studioThemeId(): StudioThemeId {
  try {
    return parseStudioTheme(localStorage.getItem(STUDIO_THEME_KEY));
  } catch {
    return joyrest.id;
  }
}

/** Запомнить выбор; тему на странице ставит вызывающий (applyTheme), чтобы модуль не тянул реестр тем. */
export function saveStudioTheme(id: StudioThemeId): void {
  try {
    if (id === joyrest.id) localStorage.removeItem(STUDIO_THEME_KEY);
    else localStorage.setItem(STUDIO_THEME_KEY, id);
  } catch {
    /* приватный режим — тема до перезагрузки */
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function useStudioThemeId(): StudioThemeId {
  const [id, setId] = useState(studioThemeId);
  useEffect(() => {
    const refresh = () => setId(studioThemeId());
    window.addEventListener(CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return id;
}
