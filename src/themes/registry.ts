import { useEffect, type CSSProperties } from "react";
import type { SessionBranding } from "../core/branding";
import { brandTheme } from "./branding";
import { conceptThemes } from "./concepts";
import { joyrest, joyrestDay } from "./joyrest";
import { saveStudioTheme, studioThemeId, type StudioThemeId } from "./studioTheme";
import type { AgeRating, Theme } from "./types";

export const DEFAULT_THEME_ID = joyrest.id;

export const themes: Theme[] = [joyrest, joyrestDay, ...conceptThemes];

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
  // Вид таймера экрана зала — тоже переменная: работает и для всей страницы, и для блока предпросмотра (`themeStyle`).
  vars["--timer-look"] = theme.effects?.timer ?? "ring";
  return vars;
}

/** Переводит токены темы в CSS-переменные страницы. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(themeVars(theme))) root.style.setProperty(name, value);
  root.style.colorScheme = theme.tokens.scheme;
  root.dataset.theme = theme.id;
  // Блеск надписей — по атрибуту, чтобы стили знали о нём без JS в каждом компоненте.
  if (theme.effects?.shine) root.dataset.shine = "on";
  else delete root.dataset.shine;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.tokens.colors.bg);
}

/**
 * Тема для одного блока (предпросмотр в студии): переменные действуют только внутри,
 * а фон и цвет текста задаются явно, потому что body остаётся в теме студии.
 */
export function themeStyle(themeId: string | Theme): CSSProperties {
  const theme = typeof themeId === "string" ? getTheme(themeId) : themeId;
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
  newyear: "Ночное небо, снег, гирлянда и колокольчики.",
  gatsby: "Чёрное с золотом, ар-деко, джазовые звуки.",
  hollywood: "Красная дорожка, прожекторы и вспышки камер.",
  disco: "Разноцветные огни, зеркальный шар, звуки диско.",
  wedding: "Светлая, нежное свечение и лепестки.",
};

/** Включает тему на время показа экрана (с цветами заказчика, если есть), потом возвращает базовую. */
export function useTheme(themeId: string, branding?: SessionBranding | null): void {
  const colors = branding?.colors.join(",") ?? "";
  useEffect(() => {
    applyTheme(brandTheme(getTheme(themeId), colors ? { name: "", colors: colors.split(","), logo: null } : null));
    // Уходя с игры — обратно тема студии этого устройства (тёмная или светлая).
    return () => applyTheme(getTheme(studioThemeId()));
  }, [themeId, colors]);
}

/** Переключить тему студии: запомнить и сразу показать. */
export function setStudioTheme(id: StudioThemeId): void {
  saveStudioTheme(id);
  applyTheme(getTheme(id));
}

/** Номер CSS-переменной цвета команды (`--team-N`) по её порядковому номеру. */
export function teamColorVar(colorIndex: number | undefined): string | undefined {
  if (colorIndex === undefined) return undefined;
  const count = getTheme(DEFAULT_THEME_ID).tokens.teamColors.length;
  return `var(--team-${(colorIndex % count) + 1})`;
}
