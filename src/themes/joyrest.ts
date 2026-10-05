import type { Theme } from "./types";

/**
 * Базовая тема. Цвета временные: фирменный стиль JoyRest ещё не заполнен
 * (CLAUDE.md, раздел 8). Заменить значения, когда появятся цвета и шрифты с сайта.
 */
export const joyrest: Theme = {
  id: "joyrest",
  title: "JoyRest",
  kind: "brand",
  ageRating: "0+",
  sounds: {},
  tokens: {
    colors: {
      bg: "#1f1147",
      surface: "#2c1a63",
      surfaceAlt: "#3a2580",
      text: "#ffffff",
      textMuted: "#c9bfef",
      primary: "#ff5a5f",
      primaryText: "#ffffff",
      accent: "#ffc94d",
      danger: "#ff6b6b",
      success: "#4cd99a",
      focus: "#ffc94d",
      border: "#4b3896",
    },
    fonts: {
      body: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
      display: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    },
    radius: { sm: "8px", md: "14px", lg: "24px" },
    background: "radial-gradient(circle at 20% 0%, #3a2580 0%, #1f1147 60%)",
  },
};
