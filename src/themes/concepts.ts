/**
 * Темы-концепции (CLAUDE.md, раздел 8): свои цвета, живой фон и набор звуков. Цвета проверяет
 * contrast.test.ts так же, как у фирменных тем. Шрифты — фирменные (свои файлы, без Google Fonts).
 */
import { brand, fonts, teamColors } from "./brand";
import type { Theme } from "./types";

const radius = { sm: "10px", md: "16px", lg: "24px" };

/** Градиент с ярким бликом посередине: при «блеске» он бежит по надписи. */
function shineGradient(from: string, to: string, flash = "#FFFFFF"): string {
  return `linear-gradient(110deg, ${from} 0%, ${from} 35%, ${flash} 50%, ${to} 65%, ${to} 100%)`;
}

export const newYear: Theme = {
  id: "newyear",
  title: "Новый год",
  kind: "seasonal",
  ageRating: "0+",
  sounds: {},
  effects: { scene: "snow", garland: true, shine: true, soundSet: "bells", particle: "#FFFFFF", glow: "rgba(245, 247, 251, 0.25)" },
  tokens: {
    scheme: "dark",
    colors: {
      bg: "#0E1A2B",
      surface: "#16263D",
      surfaceAlt: "#1E3150",
      border: "rgba(232, 198, 106, 0.22)",
      text: "#F5F7FB",
      textMuted: "#A9B8CC",
      primary: "#E8C66A",
      primaryText: "#0E1A2B",
      accentText: "#0E1A2B",
      highlight: "#E8C66A",
      control: "#A9B8CC",
      controlChecked: "#E8C66A",
      link: "#F4B0B0",
      danger: "#FF9B9B",
      success: "#8FD6A8",
      focus: "#E8C66A",
      logo: "#F5F7FB",
      teamText: brand.espresso,
    },
    gradients: {
      secondary: "linear-gradient(120deg, #F3D58A 0%, #F4B0B0 100%)",
      secondaryStops: ["#F3D58A", "#F4B0B0"],
      code: shineGradient("#F3D58A", "#F4B0B0"),
      codeStops: ["#F3D58A", "#F4B0B0"],
    },
    teamColors,
    fonts,
    radius,
    background: "radial-gradient(120% 70% at 50% 0%, #1B3150 0%, #0E1A2B 65%)",
  },
};

export const gatsby: Theme = {
  id: "gatsby",
  title: "Гэтсби",
  kind: "occasion",
  ageRating: "0+",
  sounds: {},
  effects: { scene: "deco", shine: true, soundSet: "jazz", particle: "#F3DFAE", glow: "rgba(212, 175, 90, 0.28)" },
  tokens: {
    scheme: "dark",
    colors: {
      bg: "#0B0B0C",
      surface: "#171513",
      surfaceAlt: "#211E1A",
      border: "rgba(212, 175, 90, 0.28)",
      text: "#F4EBD8",
      textMuted: "#B9AD95",
      primary: "#D4AF5A",
      primaryText: "#0B0B0C",
      accentText: "#0B0B0C",
      highlight: "#D4AF5A",
      control: "#B9AD95",
      controlChecked: "#D4AF5A",
      link: "#E6C77E",
      danger: "#F2A08F",
      success: "#A8CDA0",
      focus: "#E6C77E",
      logo: "#E6C77E",
      teamText: brand.espresso,
    },
    gradients: {
      secondary: "linear-gradient(120deg, #F3DFAE 0%, #C9A15F 100%)",
      secondaryStops: ["#F3DFAE", "#C9A15F"],
      code: shineGradient("#F3DFAE", "#C9A15F", "#FFF8E6"),
      codeStops: ["#F3DFAE", "#C9A15F"],
    },
    teamColors,
    fonts,
    radius: { sm: "4px", md: "6px", lg: "8px" },
    background: "radial-gradient(120% 70% at 50% 0%, #1E1B16 0%, #0B0B0C 70%)",
  },
};

export const hollywood: Theme = {
  id: "hollywood",
  title: "Голливуд",
  kind: "occasion",
  ageRating: "0+",
  sounds: {},
  effects: { scene: "spotlights", shine: true, soundSet: "classic", particle: "#FFFFFF", glow: "rgba(255, 240, 210, 0.22)" },
  tokens: {
    scheme: "dark",
    colors: {
      bg: "#1A0A0D",
      surface: "#271215",
      surfaceAlt: "#341A1E",
      border: "rgba(227, 198, 140, 0.24)",
      text: "#FBF1EC",
      textMuted: "#C9AEA8",
      primary: brand.gold,
      primaryText: "#1A0A0D",
      accentText: "#1A0A0D",
      highlight: brand.gold,
      control: "#C9AEA8",
      controlChecked: brand.gold,
      link: "#F2A69C",
      danger: "#FF9E94",
      success: brand.sage,
      focus: brand.gold,
      logo: "#F3DFAE",
      teamText: brand.espresso,
    },
    gradients: {
      secondary: "linear-gradient(120deg, #F3DFAE 0%, #E8A49A 100%)",
      secondaryStops: ["#F3DFAE", "#E8A49A"],
      code: shineGradient("#F3DFAE", "#E8A49A"),
      codeStops: ["#F3DFAE", "#E8A49A"],
    },
    teamColors,
    fonts,
    radius,
    background: "radial-gradient(130% 80% at 50% 110%, #4A1018 0%, #1A0A0D 60%)",
  },
};

export const disco: Theme = {
  id: "disco",
  title: "Диско",
  kind: "occasion",
  ageRating: "0+",
  sounds: {},
  effects: { scene: "disco", shine: true, soundSet: "disco", particle: "#FFFFFF", glow: "rgba(127, 212, 255, 0.3)" },
  tokens: {
    scheme: "dark",
    colors: {
      bg: "#140B24",
      surface: "#1F1236",
      surfaceAlt: "#2A1946",
      border: "rgba(127, 212, 255, 0.24)",
      text: "#F7F2FF",
      textMuted: "#BCAEDB",
      primary: "#F59AD7",
      primaryText: "#140B24",
      accentText: "#140B24",
      highlight: "#7FD4FF",
      control: "#BCAEDB",
      controlChecked: "#F59AD7",
      link: "#7FD4FF",
      danger: "#FF9EA8",
      success: "#8FE3B0",
      focus: "#7FD4FF",
      logo: "#F7F2FF",
      teamText: brand.espresso,
    },
    gradients: {
      secondary: "linear-gradient(120deg, #B79CFF 0%, #F59AD7 100%)",
      secondaryStops: ["#B79CFF", "#F59AD7"],
      code: shineGradient("#7FD4FF", "#F59AD7"),
      codeStops: ["#7FD4FF", "#F59AD7"],
    },
    teamColors,
    fonts,
    radius,
    background: "radial-gradient(120% 80% at 50% 0%, #2B1650 0%, #140B24 65%)",
  },
};

export const wedding: Theme = {
  id: "wedding",
  title: "Свадьба",
  kind: "occasion",
  ageRating: "0+",
  sounds: {},
  effects: { scene: "petals", shine: true, soundSet: "soft", particle: "#EBB8B0", glow: "rgba(201, 161, 95, 0.18)" },
  tokens: {
    scheme: "light",
    colors: {
      bg: "#FBF7F2",
      surface: "#FFFFFF",
      surfaceAlt: "#F7EFE8",
      border: "rgba(138, 81, 72, 0.16)",
      text: "#3A2E2A",
      textMuted: "#6E605A",
      primary: brand.rose,
      primaryText: brand.espresso,
      accentText: brand.espresso,
      highlight: "#9A7444",
      control: "#6E605A",
      controlChecked: "#8A5148",
      link: "#8A5148",
      danger: "#A6443A",
      success: "#3F6B4A",
      focus: "#8A5148",
      logo: "#8A5148",
      teamText: brand.espresso,
    },
    gradients: {
      secondary: "linear-gradient(120deg, #F3DFAE 0%, #E9CF93 100%)",
      secondaryStops: ["#F3DFAE", "#E9CF93"],
      code: shineGradient("#8A5148", "#7A5A2E", "#C9A15F"),
      codeStops: ["#8A5148", "#7A5A2E"],
    },
    teamColors,
    fonts,
    radius,
    background: "radial-gradient(120% 70% at 50% 0%, #FFFFFF 0%, #FBF7F2 60%, #F6E9E2 100%)",
  },
};

export const conceptThemes: Theme[] = [newYear, gatsby, hollywood, disco, wedding];
