/**
 * Палитры дворов «Игр Матрёшки» (решение владельца 14 ноября 2026, макеты второй версии): «Солнечный двор» — гжель (белый
 * фарфор, тексты кобальтом), «Ночной двор» — хохлома (почти чёрный тёплый лак, тексты кремом и золотом, свет красно-золотой).
 * Одни и те же цвета у экрана зала и телефона: CSS-переменные `--g-*` (`paletteVars`). Контраст текста с плашкой — ≥ 4,5
 * (крупного ≥ 3), проверяют стенды.
 */
import type { Style } from "../rules/types";

export interface Palette {
  /** Фон двора под картинкой. */
  bg: string;
  text: string;
  muted: string;
  head: string;
  accent: string;
  accentText: string;
  panel: string;
  panelSolid: string;
  line: string;
  out: string;
  good: string;
  bad: string;
  coral: string;
  sage: string;
  hi: string;
  /** Подписи сторон «Каната» (текст на плашке). */
  coralText: string;
  sageText: string;
  /** Снег сугроба и его кромка. */
  snow: string;
  snowShade: string;
  snowRim: string;
  /** Скамейка трибуны. */
  bench: string;
  /** Свечение крупных надписей (ночь) — тень текста. */
  glow: string;
}

export const PALETTES: Record<Style, Palette> = {
  sunny: {
    bg: "#F3F6FB",
    text: "#14244F",
    muted: "#3D4F7A",
    head: "#1B3F8B",
    accent: "#2E5AAC",
    accentText: "#1B3F8B",
    panel: "rgba(255,255,255,.95)",
    panelSolid: "#FFFFFF",
    line: "rgba(27,63,139,.2)",
    out: "#B9C4D8",
    good: "#2F6B45",
    bad: "#A6443A",
    coral: "#E3AA9C",
    sage: "#A3C2AA",
    hi: "#2E5AAC",
    coralText: "#8A5148",
    sageText: "#3F6B4A",
    snow: "#FFFFFF",
    snowShade: "#DCE6F4",
    snowRim: "#9CB4D8",
    bench: "#9A7444",
    glow: "none",
  },
  night: {
    bg: "#140B08",
    text: "#FBF1DE",
    muted: "#E2CBA6",
    head: "#F3D27A",
    accent: "#E9B949",
    accentText: "#F3D27A",
    panel: "rgba(26,15,11,.94)",
    panelSolid: "#1E120D",
    line: "rgba(233,185,73,.34)",
    out: "#4A3A30",
    good: "#A3C2AA",
    bad: "#FF9A85",
    coral: "#E3AA9C",
    sage: "#A3C2AA",
    hi: "#E9B949",
    coralText: "#E3AA9C",
    sageText: "#A3C2AA",
    snow: "#2E2622",
    snowShade: "#1F1915",
    snowRim: "#F3D27A",
    bench: "#D9A441",
    glow: "0 0 18px rgba(243,210,122,.4)",
  },
};

/** CSS-переменные палитры для корня экрана или телефона (`style`). */
export function paletteVars(style: Style): Record<string, string> {
  const p = PALETTES[style];
  return {
    "--g-bg": p.bg,
    "--g-text": p.text,
    "--g-muted": p.muted,
    "--g-head": p.head,
    "--g-accent": p.accent,
    "--g-accent-text": p.accentText,
    "--g-panel": p.panel,
    "--g-panel-solid": p.panelSolid,
    "--g-line": p.line,
    "--g-out": p.out,
    "--g-good": p.good,
    "--g-bad": p.bad,
    "--g-coral": p.coral,
    "--g-sage": p.sage,
    "--g-hi": p.hi,
    "--g-coral-text": p.coralText,
    "--g-sage-text": p.sageText,
    "--g-snow": p.snow,
    "--g-snow-shade": p.snowShade,
    "--g-snow-rim": p.snowRim,
    "--g-bench": p.bench,
    "--g-glow": p.glow,
  };
}
