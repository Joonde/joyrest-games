import { describe, expect, it } from "vitest";
import { clockText, parseTimerLook, timerFraction, timerUrgent } from "./HallTimer";
import { themes, themeVars } from "../../themes/registry";

describe("таймер экрана зала", () => {
  it("доля оставшегося времени", () => {
    expect(timerFraction(null, 30)).toBe(1);
    expect(timerFraction(15, 30)).toBe(0.5);
    expect(timerFraction(40, 30)).toBe(1);
    expect(timerFraction(0, 30)).toBe(0);
    expect(timerFraction(5, null)).toBe(1);
    expect(timerFraction(0, null)).toBe(0);
  });

  it("тревога — последние секунды, у короткого отсчёта — не с начала", () => {
    expect(timerUrgent(10, 60)).toBe(true);
    expect(timerUrgent(11, 60)).toBe(false);
    expect(timerUrgent(0, 60)).toBe(false);
    expect(timerUrgent(3, 5)).toBe(true);
    expect(timerUrgent(4, 9)).toBe(false);
    expect(timerUrgent(null, 30)).toBe(false);
  });

  it("цифры: до минуты — секунды, дольше — минуты", () => {
    expect(clockText(45)).toBe("45");
    expect(clockText(65)).toBe("1:05");
    expect(clockText(600)).toBe("10:00");
    expect(clockText(-3)).toBe("0");
  });

  it("вид — только известный, иначе кольцо", () => {
    expect(parseTimerLook(" candle ")).toBe("candle");
    expect(parseTimerLook("rocket")).toBe("ring");
    expect(parseTimerLook(null)).toBe("ring");
  });

  it("каждая тема даёт известный вид таймера", () => {
    for (const theme of themes) {
      const look = themeVars(theme)["--timer-look"];
      expect(parseTimerLook(look)).toBe(look);
    }
  });
});
