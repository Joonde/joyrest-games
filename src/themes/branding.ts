/**
 * Тема с цветами заказчика (`src/core/branding.ts`): цвета компании ложатся на кнопки, рамки, код игры и градиенты
 * выбранной темы, но так, чтобы всё читалось — каждый цвет при необходимости светлеет или темнеет до контраста WCAG AA
 * (текст ≥ 4.5, рамки ≥ 3) с фоном и карточками этой темы. Фон, текст и цвета команд остаются от темы.
 */
import type { SessionBranding } from "../core/branding";
import { contrastRatio } from "./contrast";
import type { Theme } from "./types";

const DARK = "#221E1B";
const LIGHT = "#FFFFFF";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/**
 * Ближайший к `color` цвет (подмешиваем белый или чёрный — сколько нужно), у которого контраст со всеми `against`
 * не меньше `min`. Не нашлось (так не бывает при min ≤ 4.5 и одном фоне) — более контрастный из белого и тёмного.
 */
export function fitColor(color: string, against: string[], min: number): string {
  const enough = (c: string) => against.every((bg) => contrastRatio(c, bg) >= min);
  if (enough(color)) return color;
  for (let step = 1; step <= 50; step++) {
    const t = step / 50;
    const options = [mix(color, LIGHT, t), mix(color, "#000000", t)].filter(enough);
    if (options.length > 0) return options[0] ?? color;
  }
  return [LIGHT, DARK].sort((a, b) => Math.min(...against.map((bg) => contrastRatio(b, bg))) - Math.min(...against.map((bg) => contrastRatio(a, bg))))[0] ?? LIGHT;
}

/** Текст на заливке цвета: тёмный или белый — что читается лучше. */
export function textOn(fill: string): string {
  return contrastRatio(DARK, fill) >= contrastRatio(LIGHT, fill) ? DARK : LIGHT;
}

/** Тема с цветами заказчика. Без цветов (только логотип) — тема как есть. */
export function brandTheme(theme: Theme, branding: SessionBranding | null | undefined): Theme {
  const first = branding?.colors[0];
  if (!first) return theme;
  const second = branding?.colors[1] ?? first;
  const { colors, gradients } = theme.tokens;
  const surfaces = [colors.bg, colors.surface, colors.surfaceAlt];

  // Кнопка: заливка — цвет заказчика, текст — тёмный или белый; не хватает контраста — цвет уходит от текста.
  const primaryText = textOn(first);
  const primary = fitColor(first, [primaryText], 4.5);
  const highlight = fitColor(second, surfaces, 3);
  const controlChecked = fitColor(first, surfaces, 3);
  const link = fitColor(first, [colors.bg, colors.surface], 4.5);
  const codeStops: [string, string] = [fitColor(first, [colors.bg, colors.surface], 4.5), fitColor(second, [colors.bg, colors.surface], 4.5)];
  const secondaryStops: [string, string] = [fitColor(first, [colors.accentText], 4.5), fitColor(second, [colors.accentText], 4.5)];

  return {
    ...theme,
    tokens: {
      ...theme.tokens,
      colors: { ...colors, primary, primaryText, highlight, focus: highlight, controlChecked, link },
      gradients: {
        ...gradients,
        secondary: `linear-gradient(120deg, ${secondaryStops[0]} 0%, ${secondaryStops[1]} 100%)`,
        secondaryStops,
        code: `linear-gradient(120deg, ${codeStops[0]} 0%, ${codeStops[1]} 100%)`,
        codeStops,
      },
    },
  };
}
