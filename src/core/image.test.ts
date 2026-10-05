import { describe, expect, it } from "vitest";
import { fitSize, formatBytes } from "./image";

describe("fitSize", () => {
  it("вписывает по длинной стороне и не увеличивает", () => {
    expect(fitSize(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitSize(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 });
    expect(fitSize(800, 600, 1280)).toEqual({ width: 800, height: 600 });
    expect(fitSize(0, 10, 1280)).toEqual({ width: 1, height: 1 });
  });
});

describe("formatBytes", () => {
  it("КБ и МБ по-русски", () => {
    expect(formatBytes(150 * 1024)).toBe("150 КБ");
    expect(formatBytes(1.25 * 1024 * 1024)).toBe("1,3 МБ");
  });
});
