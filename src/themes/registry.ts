import { joyrest } from "./joyrest";
import type { Theme } from "./types";

export const themes: Theme[] = [joyrest];

export function getTheme(id: string): Theme {
  return themes.find((t) => t.id === id) ?? joyrest;
}

/** Переводит токены темы в CSS-переменные. Компоненты используют только их. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  const { colors, fonts, radius, background } = theme.tokens;
  for (const [name, value] of Object.entries(colors)) {
    root.style.setProperty(`--color-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
  }
  root.style.setProperty("--font-body", fonts.body);
  root.style.setProperty("--font-display", fonts.display);
  for (const [name, value] of Object.entries(radius)) {
    root.style.setProperty(`--radius-${name}`, value);
  }
  root.style.setProperty("--background", background);
}
