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

interface DarkPalette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  primary: string;
  highlight: string;
  link: string;
  danger: string;
  success: string;
  stops: [string, string];
  background: string;
}

/** Тёмная тема по палитре: текст на кнопках и акцентах — цвет фона (светлые акценты). */
function darkTheme(id: string, title: string, kind: Theme["kind"], p: DarkPalette, effects: NonNullable<Theme["effects"]>): Theme {
  return {
    id,
    title,
    kind,
    ageRating: "0+",
    sounds: {},
    effects,
    tokens: {
      scheme: "dark",
      colors: {
        bg: p.bg,
        surface: p.surface,
        surfaceAlt: p.surfaceAlt,
        border: "rgba(255, 255, 255, 0.14)",
        text: p.text,
        textMuted: p.textMuted,
        primary: p.primary,
        primaryText: p.bg,
        accentText: p.bg,
        highlight: p.highlight,
        control: p.textMuted,
        controlChecked: p.highlight,
        link: p.link,
        danger: p.danger,
        success: p.success,
        focus: p.highlight,
        logo: p.text,
        teamText: brand.espresso,
      },
      gradients: {
        secondary: `linear-gradient(120deg, ${p.stops[0]} 0%, ${p.stops[1]} 100%)`,
        secondaryStops: p.stops,
        code: shineGradient(p.stops[0], p.stops[1]),
        codeStops: p.stops,
      },
      teamColors,
      fonts,
      radius,
      background: p.background,
    },
  };
}

// ---------- Времена года ----------

export const spring = darkTheme(
  "spring",
  "Весна",
  "seasonal",
  {
    bg: "#132019",
    surface: "#1B2B22",
    surfaceAlt: "#23372B",
    text: "#F3F7EE",
    textMuted: "#B5C7B4",
    primary: "#F4B6C8",
    highlight: "#B9E3A6",
    link: "#F4B6C8",
    danger: "#FF9E94",
    success: "#9FE0A8",
    stops: ["#F7D6E0", "#B9E3A6"],
    background: "radial-gradient(120% 70% at 50% 0%, #1E3427 0%, #132019 65%)",
  },
  { scene: "petals", shine: true, soundSet: "soft", particle: "#F7C6D6", glow: "rgba(185, 227, 166, 0.2)" },
);

export const summer = darkTheme(
  "summer",
  "Лето",
  "seasonal",
  {
    bg: "#0E1D29",
    surface: "#162B3A",
    surfaceAlt: "#1E3749",
    text: "#FFF8EC",
    textMuted: "#BFD0DA",
    primary: "#FFC66B",
    highlight: "#7FD8E8",
    link: "#FFC66B",
    danger: "#FF9E94",
    success: "#9FE0B5",
    stops: ["#FFD98A", "#7FD8E8"],
    background: "radial-gradient(120% 70% at 80% 0%, #1D3B4F 0%, #0E1D29 65%)",
  },
  { scene: "sun", shine: true, soundSet: "classic", particle: "#FFE3A3", glow: "rgba(255, 198, 107, 0.22)" },
);

export const autumn = darkTheme(
  "autumn",
  "Осень",
  "seasonal",
  {
    bg: "#1D130C",
    surface: "#291B11",
    surfaceAlt: "#342317",
    text: "#FBF1E4",
    textMuted: "#CDB59C",
    primary: "#E8A25A",
    highlight: "#E8C07A",
    link: "#F0B27A",
    danger: "#FF9E94",
    success: "#B5D99C",
    stops: ["#F3D08A", "#E8A25A"],
    background: "radial-gradient(120% 70% at 50% 0%, #33210F 0%, #1D130C 65%)",
  },
  { scene: "leaves", shine: true, soundSet: "jazz", particle: "#E8A25A", glow: "rgba(232, 162, 90, 0.2)" },
);

export const winter = darkTheme(
  "winter",
  "Зима",
  "seasonal",
  {
    bg: "#0E1625",
    surface: "#172238",
    surfaceAlt: "#1F2C46",
    text: "#F2F6FC",
    textMuted: "#AFC0D8",
    primary: "#A9D4F5",
    highlight: "#CFE6FA",
    link: "#A9D4F5",
    danger: "#FF9EA8",
    success: "#9FE0C0",
    stops: ["#E3F1FD", "#A9D4F5"],
    background: "radial-gradient(120% 70% at 50% 0%, #1C2C47 0%, #0E1625 65%)",
  },
  { scene: "snow", shine: true, soundSet: "bells", particle: "#FFFFFF", glow: "rgba(207, 230, 250, 0.22)" },
);

// ---------- Под игру ----------

/** «Своя игра»: телестудия — синий эфир, золотые прожекторы. */
export const studio = darkTheme(
  "studio",
  "Телестудия",
  "occasion",
  {
    bg: "#0A1230",
    surface: "#121C42",
    surfaceAlt: "#1A2652",
    text: "#F5F7FF",
    textMuted: "#B4BEDF",
    primary: "#F3C64F",
    highlight: "#F3C64F",
    link: "#8FC1FF",
    danger: "#FF9EA8",
    success: "#8FE3B0",
    stops: ["#F3DFAE", "#8FC1FF"],
    background: "radial-gradient(120% 80% at 50% 100%, #1B2C6E 0%, #0A1230 65%)",
  },
  { scene: "spotlights", shine: true, soundSet: "classic", particle: "#FFFFFF", glow: "rgba(143, 193, 255, 0.24)" },
);

/** «Шашки»: шахматный клуб — тёмное дерево, клетки по углам. */
export const chessClub = darkTheme(
  "chess",
  "Шахматный клуб",
  "occasion",
  {
    bg: "#16120E",
    surface: "#211B15",
    surfaceAlt: "#2B231B",
    text: "#F6EEDF",
    textMuted: "#C8B9A0",
    primary: "#E9D3A6",
    highlight: "#D9B77A",
    link: "#E9D3A6",
    danger: "#F2A08F",
    success: "#B5D99C",
    stops: ["#F6EEDF", "#D9B77A"],
    background: "radial-gradient(120% 70% at 50% 0%, #2A2119 0%, #16120E 65%)",
  },
  { scene: "checker", shine: false, soundSet: "jazz", particle: "#F6EEDF", glow: "rgba(217, 183, 122, 0.18)" },
);

/** «Танцевальный батл»: танцпол — неон и зеркальный шар. */
export const dancefloor = darkTheme(
  "dancefloor",
  "Танцпол",
  "occasion",
  {
    bg: "#0D0B1F",
    surface: "#17133A",
    surfaceAlt: "#201A4A",
    text: "#FAF6FF",
    textMuted: "#BDB3E0",
    primary: "#5EF2D6",
    highlight: "#FF7AD9",
    link: "#5EF2D6",
    danger: "#FF9EA8",
    success: "#8FE3B0",
    stops: ["#5EF2D6", "#FF7AD9"],
    background: "radial-gradient(120% 80% at 50% 100%, #2A1660 0%, #0D0B1F 65%)",
  },
  { scene: "disco", shine: true, soundSet: "disco", particle: "#FFFFFF", glow: "rgba(94, 242, 214, 0.28)" },
);

/** «Активная настолка»: приключение — старая карта, тропинка, компас. */
export const adventure = darkTheme(
  "adventure",
  "Приключение",
  "occasion",
  {
    bg: "#1A1710",
    surface: "#25211A",
    surfaceAlt: "#2F2A20",
    text: "#F8F1DE",
    textMuted: "#CBBF9F",
    primary: "#E7C873",
    highlight: "#9ED29A",
    link: "#E7C873",
    danger: "#F2A08F",
    success: "#9ED29A",
    stops: ["#F3E3AE", "#9ED29A"],
    background: "radial-gradient(120% 70% at 50% 0%, #2B2618 0%, #1A1710 65%)",
  },
  { scene: "map", shine: true, soundSet: "classic", particle: "#E7C873", glow: "rgba(231, 200, 115, 0.22)" },
);

export const conceptThemes: Theme[] = [newYear, winter, spring, summer, autumn, gatsby, hollywood, disco, wedding, studio, chessClub, dancefloor, adventure];
