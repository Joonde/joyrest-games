import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import { themes } from "./registry";

/** WCAG AA: 4.5 для обычного текста, 3 для крупного текста и рамок. */
const TEXT = 4.5;
const UI = 3;

describe.each(themes)("контраст темы $id", (theme) => {
  const { colors, gradients, teamColors } = theme.tokens;

  it.each([
    ["основной текст на фоне", colors.text, colors.bg],
    ["основной текст на карточке", colors.text, colors.surface],
    ["основной текст на вложенной карточке", colors.text, colors.surfaceAlt],
    ["второстепенный текст на фоне", colors.textMuted, colors.bg],
    ["второстепенный текст на карточке", colors.textMuted, colors.surface],
    ["второстепенный текст на вложенной карточке", colors.textMuted, colors.surfaceAlt],
    ["текст основной кнопки", colors.primaryText, colors.primary],
    ["текст второстепенной кнопки (начало градиента)", colors.secondaryText, gradients.secondaryStops[0]],
    ["текст второстепенной кнопки (конец градиента)", colors.secondaryText, gradients.secondaryStops[1]],
    ["код игры (начало градиента)", gradients.codeStops[0], colors.bg],
    ["код игры (конец градиента)", gradients.codeStops[1], colors.bg],
    ["ссылки", colors.link, colors.bg],
    ["ошибки на карточке", colors.danger, colors.surface],
    ["успех на карточке", colors.success, colors.surface],
  ])("%s ≥ 4.5", (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(TEXT);
  });

  it.each([
    ["рамка фокуса", colors.focus, colors.bg],
    ["подсветка выбранного варианта", colors.highlight, colors.surfaceAlt],
  ])("%s ≥ 3", (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(UI);
  });

  it.each(teamColors)("текст на цвете команды %s ≥ 4.5", (color) => {
    expect(contrastRatio(colors.teamText, color)).toBeGreaterThanOrEqual(TEXT);
  });
});

describe("contrastRatio", () => {
  it("чёрный на белом — 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});
