import { describe, expect, it } from "vitest";
import { NAME_MAX_LENGTH, cleanName, isValidName } from "./names";

describe("имена участников", () => {
  it("обрезает и схлопывает пробелы", () => {
    expect(cleanName("  Анна   Петрова ")).toBe("Анна Петрова");
  });

  it("ограничивает длину", () => {
    expect(cleanName("я".repeat(50))).toHaveLength(NAME_MAX_LENGTH);
  });

  it("пустое имя недопустимо", () => {
    expect(isValidName(cleanName("   "))).toBe(false);
    expect(isValidName("Оля")).toBe(true);
  });
});
