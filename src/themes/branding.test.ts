import { describe, expect, it } from "vitest";
import { parseBranding } from "../core/branding";
import { brandTheme, fitColor } from "./branding";
import { contrastRatio } from "./contrast";
import { themes } from "./registry";

/** Неудобные цвета заказчиков: чисто белый, чёрный, серый, жёлтый, красный, синий, зелёный, пастель. */
const COLORS = ["#FFFFFF", "#000000", "#777777", "#FFFF00", "#FF0000", "#0000FF", "#00FF00", "#C49E96", "#1A3C8B", "#F7D9E3"];

describe("оформление под заказчика: данные", () => {
  it("лишнее отбрасывается, цвета — #RRGGBB, не больше двух", () => {
    expect(parseBranding({ name: "  ООО\n«Ромашка»  ", colors: ["#ff0000", "red", "#00ff00", "#0000ff"], logo: "a".repeat(64), extra: 1 })).toEqual({
      name: "ООО «Ромашка»",
      colors: ["#FF0000", "#00FF00"],
      logo: "a".repeat(64),
    });
    expect(parseBranding({ name: "x".repeat(100), colors: ["#123456"] })?.name).toHaveLength(60);
    expect(parseBranding({ name: "Без цветов и логотипа", colors: [] })).toBeNull();
    expect(parseBranding({ logo: "../../etc/passwd", colors: ["#123456"] })?.logo).toBeNull();
    expect(parseBranding(null)).toBeNull();
    expect(parseBranding("строка")).toBeNull();
  });
});

describe.each(themes)("цвета заказчика на теме $id читаются", (base) => {
  it.each(COLORS.flatMap((a) => [[a, a], [a, COLORS[(COLORS.indexOf(a) + 3) % COLORS.length] ?? a]]))("%s + %s", (first, second) => {
    const theme = brandTheme(base, { name: "Компания", colors: [first, second], logo: null });
    const { colors, gradients } = theme.tokens;
    expect(contrastRatio(colors.primaryText, colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.link, colors.bg)).toBeGreaterThanOrEqual(4.5);
    for (const stop of gradients.codeStops) {
      expect(contrastRatio(stop, colors.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(stop, colors.surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const stop of gradients.secondaryStops) expect(contrastRatio(colors.accentText, stop)).toBeGreaterThanOrEqual(4.5);
    for (const bg of [colors.bg, colors.surface, colors.surfaceAlt]) {
      expect(contrastRatio(colors.highlight, bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors.focus, bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors.controlChecked, bg)).toBeGreaterThanOrEqual(3);
    }
    // Фон, текст и цвета команд — от темы.
    expect(colors.bg).toBe(base.tokens.colors.bg);
    expect(colors.text).toBe(base.tokens.colors.text);
    expect(theme.tokens.teamColors).toEqual(base.tokens.teamColors);
  });
});

describe("подбор цвета", () => {
  it("цвет, который и так читается, не меняется; без цветов тема та же", () => {
    expect(fitColor("#FFFFFF", ["#000000"], 4.5)).toBe("#FFFFFF");
    const base = themes[0];
    if (!base) throw new Error("нет тем");
    expect(brandTheme(base, { name: "Только логотип", colors: [], logo: "b".repeat(64) })).toBe(base);
    expect(brandTheme(base, null)).toBe(base);
  });

  it("тёмно-синий на тёмном фоне светлеет, но остаётся синим", () => {
    const fitted = fitColor("#1A3C8B", ["#221E1B"], 4.5);
    expect(contrastRatio(fitted, "#221E1B")).toBeGreaterThanOrEqual(4.5);
    const [r, , b] = [parseInt(fitted.slice(1, 3), 16), 0, parseInt(fitted.slice(5, 7), 16)];
    expect(b).toBeGreaterThan(r);
  });
});
