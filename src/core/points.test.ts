import { describe, expect, it } from "vitest";
import { experienceLabel } from "./levels";
import { gamePoints, isValidManualPoints, pointsLabel } from "./points";

describe("баллы за игру", () => {
  it("засчитывается: больше 10 телефонов и не меньше 40 минут", () => {
    expect(gamePoints(10, 90)).toBe(0);
    expect(gamePoints(11, 39.9)).toBe(0);
    expect(gamePoints(11, 40)).toBe(1);
  });

  it("до 20 — 1 балл, за каждые полные 5 сверху — +0,5", () => {
    expect(gamePoints(20, 60)).toBe(1);
    expect(gamePoints(23, 60)).toBe(1);
    expect(gamePoints(25, 60)).toBe(1.5);
    expect(gamePoints(29, 60)).toBe(1.5);
    expect(gamePoints(30, 60)).toBe(2);
    expect(gamePoints(40, 60)).toBe(3);
    expect(gamePoints(500, 60)).toBe(49);
  });

  it("ручные баллы: шаг 0,5, не ноль, до 100 по модулю", () => {
    expect(isValidManualPoints(0.5)).toBe(true);
    expect(isValidManualPoints(-3)).toBe(true);
    expect(isValidManualPoints(0)).toBe(false);
    expect(isValidManualPoints(0.3)).toBe(false);
    expect(isValidManualPoints(101)).toBe(false);
    expect(isValidManualPoints(Number.NaN)).toBe(false);
  });

  it("подписи", () => {
    expect(pointsLabel(1)).toBe("1 балл");
    expect(pointsLabel(1.5)).toBe("1,5 балла");
    expect(pointsLabel(3)).toBe("3 балла");
    expect(pointsLabel(12)).toBe("12 баллов");
    expect(pointsLabel(21)).toBe("21 балл");
    expect(pointsLabel(-2)).toBe("−2 балла");
    expect(pointsLabel(0)).toBe("0 баллов");
  });
});

describe("стаж", () => {
  const at = (s: string) => new Date(s).getTime();
  it("годы и месяцы", () => {
    expect(experienceLabel(at("2026-10-01T12:00:00"), at("2026-10-07T12:00:00"))).toBe("меньше месяца");
    expect(experienceLabel(at("2026-02-07T12:00:00"), at("2026-10-07T12:00:00"))).toBe("8 мес.");
    expect(experienceLabel(at("2025-10-07T12:00:00"), at("2026-10-07T12:00:00"))).toBe("1 год");
    expect(experienceLabel(at("2024-07-07T12:00:00"), at("2026-10-07T12:00:00"))).toBe("2 года 3 мес.");
    expect(experienceLabel(at("2020-10-07T12:00:00"), at("2026-10-07T12:00:00"))).toBe("6 лет");
  });
});
