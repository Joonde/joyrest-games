import { useEffect, type CSSProperties } from "react";
import { joyrest, joyrestDay } from "./joyrest";
import type { AgeRating, Theme } from "./types";

export const DEFAULT_THEME_ID = joyrest.id;

export const themes: Theme[] = [joyrest, joyrestDay];

/** Темы для игры с возрастным ограничением: 18+ не предлагаются в детских и обычных играх. */
export function themesForRating(rating: AgeRating): Theme[] {
  return themes.filter((t) => t.ageRating !== "18+" || rating === "18+");
}

export function getTheme(id: string): Theme {
  return themes.find((t) => t.id === id) ?? joyrest;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** CSS-переменные темы: имя → значение. Компоненты используют только их. */
export function themeVars(theme: Theme): Record<string, string> {
  const { colors, gradients, teamColors, fonts, radius, background } = theme.tokens;
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(colors)) vars[`--color-${kebab(name)}`] = value;
  vars["--gradient-secondary"] = gradients.secondary;
  vars["--gradient-code"] = gradients.code;
  teamColors.forEach((color, i) => (vars[`--team-${i + 1}`] = color));
  vars["--font-body"] = fonts.body;
  vars["--font-display"] = fonts.display;
  for (const [name, value] of Object.entries(radius)) vars[`--radius-${name}`] = value;
  vars["--background"] = background;
  return vars;
}

/** Переводит токены темы в CSS-переменные страницы. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(themeVars(theme))) root.style.setProperty(name, value);
  root.style.colorScheme = theme.tokens.scheme;
  root.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.tokens.colors.bg);
}

/**
 * Тема для одного блока (предпросмотр в студии): переменные действуют только внутри,
 * а фон и цвет текста задаются явно, потому что body остаётся в теме студии.
 */
export function themeStyle(themeId: string): CSSProperties {
  const theme = getTheme(themeId);
  return {
    ...themeVars(theme),
    colorScheme: theme.tokens.scheme,
    background: theme.tokens.background,
    backgroundColor: theme.tokens.colors.bg,
    color: theme.tokens.colors.text,
    fontFamily: theme.tokens.fonts.body,
  } as CSSProperties;
}

/** Подсказки к фирменным темам: при выборе в конструкторе и при запуске. */
export const THEME_HINTS: Record<string, string> = {
  joyrest: "Тёмное, для вечера и затемнённого зала.",
  "joyrest-day": "Светлое, для дневных мероприятий и яркого света.",
};

/** Включает тему на время показа экрана, потом возвращает базовую. */
export function useTheme(themeId: string): void {
  useEffect(() => {
    applyTheme(getTheme(themeId));
    return () => applyTheme(getTheme(DEFAULT_THEME_ID));
  }, [themeId]);
}

/** Номер CSS-переменной цвета команды (`--team-N`) по её порядковому номеру. */
export function teamColorVar(colorIndex: number | undefined): string | undefined {
  if (colorIndex === undefined) return undefined;
  const count = getTheme(DEFAULT_THEME_ID).tokens.teamColors.length;
  return `var(--team-${(colorIndex % count) + 1})`;
}
