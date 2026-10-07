import type { AgeRating } from "../data/types";

export type { AgeRating };

export type ThemeKind = "brand" | "seasonal" | "occasion";

export interface ThemeTokens {
  /** Тёмная или светлая схема: влияет на системные элементы браузера. */
  scheme: "dark" | "light";
  colors: {
    bg: string;
    surface: string;
    surfaceAlt: string;
    border: string;
    text: string;
    textMuted: string;
    /** Основные кнопки. */
    primary: string;
    primaryText: string;
    /** Текст на градиентных акцентах `gradients.secondary` (не кнопки). */
    accentText: string;
    /** Рамки вторичных кнопок, выбранных вариантов и подсветки. */
    highlight: string;
    /** Кольцо невыбранной радиокнопки. */
    control: string;
    /** Кольцо и точка выбранной радиокнопки. */
    controlChecked: string;
    link: string;
    danger: string;
    success: string;
    focus: string;
    /** Цвет логотипа в варианте «по теме». */
    logo: string;
    /** Текст на пастельных цветах команд. */
    teamText: string;
  };
  gradients: {
    /** Только акценты (бейджи, полосы), не кнопки. Первый и последний цвет — для проверки контраста. */
    secondary: string;
    secondaryStops: [string, string];
    /** Крупный код игры. */
    code: string;
    codeStops: [string, string];
  };
  /** Пастельные цвета команд по порядку подключения. */
  teamColors: string[];
  fonts: { body: string; display: string };
  radius: { sm: string; md: string; lg: string };
  background: string;
}

/** Живой фон экрана зала (только CSS: transform и opacity, при «уменьшить движение» — без него). */
export type SceneEffect = "none" | "snow" | "deco" | "spotlights" | "disco" | "petals";

/** Набор синтезированных звуков экрана зала (`src/components/live/sound.ts`). */
export type SoundSet = "classic" | "bells" | "jazz" | "disco" | "soft";

export interface ThemeEffects {
  scene: SceneEffect;
  /** Мигающая гирлянда по верхнему краю. */
  garland?: boolean;
  /** Блеск крупных надписей (код игры, заставки, пьедестал) — бегущий блик по градиенту `code`. */
  shine?: boolean;
  soundSet: SoundSet;
  /** Цвет частиц фона (снежинки, лепестки) и полупрозрачный цвет света (лучи, блики, веера). */
  particle: string;
  glow: string;
}

export interface Theme {
  id: string;
  title: string;
  kind: ThemeKind;
  tokens: ThemeTokens;
  sounds: Record<string, string>;
  ageRating: AgeRating;
  /** Эффекты темы-концепции; у фирменных тем нет. */
  effects?: ThemeEffects;
}
