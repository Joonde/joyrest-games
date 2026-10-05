/**
 * Фирменная палитра JoyRest (CLAUDE.md, раздел 8). Источник цветов для тем и логотипа.
 */
export const brand = {
  espresso: "#221E1B",
  cocoa: "#2A2622",
  cocoaLight: "#35302B",
  cream: "#FBF6F1",
  ink: "#362E29",
  taupe: "#B5ABA2",
  taupeDark: "#7A6E66",
  rose: "#C49E96",
  coral: "#E3AA9C",
  wine: "#D2A0AC",
  gold: "#E3C68C",
  sage: "#A3C2AA",
  lavender: "#B3AADD",
} as const;

export const fonts = {
  display: "'Cormorant Garamond', 'Cormorant', Georgia, 'Times New Roman', serif",
  body: "'Jost', 'Futura', 'Century Gothic', 'Segoe UI', Roboto, system-ui, sans-serif",
} as const;

/** Пастельные цвета команд. */
export const teamColors = [brand.coral, brand.gold, brand.sage, brand.wine, brand.lavender];

/** Градиентные заливки логотипа для будущих тем: свадебной и праздничной. */
export const logoGradients = {
  gold: ["#F3DFAE", "#C9A15F", "#E9CF93"],
  festive: ["#7FB3FF", "#B79CFF", "#F59AD7"],
} as const;
