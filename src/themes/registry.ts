import { useEffect } from "react";
import { joyrest, joyrestDay } from "./joyrest";
import type { Theme } from "./types";

export const DEFAULT_THEME_ID = joyrest.id;

export const themes: Theme[] = [joyrest, joyrestDay];

export function getTheme(id: string): Theme {
  return themes.find((t) => t.id === id) ?? joyrest;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Переводит токены темы в CSS-переменные. Компоненты используют только их. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  const { colors, gradients, teamColors, fonts, radius, background, scheme } = theme.tokens;
  for (const [name, value] of Object.entries(colors)) {
    root.style.setProperty(`--color-${kebab(name)}`, value);
  }
  root.style.setProperty("--gradient-secondary", gradients.secondary);
  root.style.setProperty("--gradient-code", gradients.code);
  teamColors.forEach((color, i) => root.style.setProperty(`--team-${i + 1}`, color));
  root.style.setProperty("--font-body", fonts.body);
  root.style.setProperty("--font-display", fonts.display);
  for (const [name, value] of Object.entries(radius)) {
    root.style.setProperty(`--radius-${name}`, value);
  }
  root.style.setProperty("--background", background);
  root.style.colorScheme = scheme;
  root.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors.bg);
}

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
