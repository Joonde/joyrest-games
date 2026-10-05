import { brand, fonts, teamColors } from "./brand";
import type { Theme } from "./types";

/** Базовая тема: фирменный стиль JoyRest, вечерний (тёмный) вариант. */
export const joyrest: Theme = {
  id: "joyrest",
  title: "JoyRest · вечер",
  kind: "brand",
  ageRating: "0+",
  sounds: {},
  tokens: {
    scheme: "dark",
    colors: {
      bg: brand.espresso,
      surface: brand.cocoa,
      surfaceAlt: brand.cocoaLight,
      border: "rgba(227, 198, 140, 0.18)",
      text: brand.cream,
      textMuted: brand.taupe,
      primary: brand.rose,
      primaryText: brand.espresso,
      secondaryText: brand.espresso,
      highlight: brand.gold,
      link: brand.coral,
      danger: "#F2A79C",
      success: brand.sage,
      focus: brand.gold,
      logo: brand.cream,
      teamText: brand.espresso,
    },
    gradients: {
      secondary: `linear-gradient(120deg, ${brand.gold} 0%, ${brand.sage} 100%)`,
      secondaryStops: [brand.gold, brand.sage],
      code: `linear-gradient(120deg, ${brand.gold} 0%, ${brand.sage} 100%)`,
      codeStops: [brand.gold, brand.sage],
    },
    teamColors,
    fonts,
    radius: { sm: "10px", md: "16px", lg: "24px" },
    background: `radial-gradient(120% 70% at 50% 0%, #2F2A25 0%, ${brand.espresso} 65%)`,
  },
};

/** Дневной (светлый) вариант фирменной темы. */
export const joyrestDay: Theme = {
  id: "joyrest-day",
  title: "JoyRest · день",
  kind: "brand",
  ageRating: "0+",
  sounds: {},
  tokens: {
    scheme: "light",
    colors: {
      bg: brand.cream,
      surface: "#FFFFFF",
      surfaceAlt: "#FAF4EE",
      border: "rgba(54, 46, 41, 0.14)",
      text: brand.ink,
      textMuted: brand.taupeDark,
      primary: brand.rose,
      primaryText: brand.espresso,
      secondaryText: brand.espresso,
      highlight: "#9A7444",
      link: "#8A5148",
      danger: "#A6443A",
      success: "#3F6B4A",
      focus: "#8A5148",
      logo: brand.espresso,
      teamText: brand.espresso,
    },
    gradients: {
      secondary: `linear-gradient(120deg, ${brand.gold} 0%, ${brand.sage} 100%)`,
      secondaryStops: [brand.gold, brand.sage],
      code: `linear-gradient(120deg, #8A5148 0%, ${brand.ink} 100%)`,
      codeStops: ["#8A5148", brand.ink],
    },
    teamColors,
    fonts,
    radius: { sm: "10px", md: "16px", lg: "24px" },
    background: `radial-gradient(120% 70% at 50% 0%, #FFFFFF 0%, ${brand.cream} 65%)`,
  },
};
