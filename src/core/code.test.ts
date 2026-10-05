import { describe, expect, it } from "vitest";
import {
  formatSessionCode,
  generateSessionCode,
  isValidSessionCode,
  normalizeSessionCode,
} from "./code";

describe("код сессии", () => {
  it("генерирует 6 цифр без ведущего нуля", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateSessionCode();
      expect(isValidSessionCode(code)).toBe(true);
      expect(code[0]).not.toBe("0");
    }
  });

  it("крайние значения генератора дают корректный код", () => {
    expect(generateSessionCode(() => 0)).toBe("100000");
    expect(generateSessionCode(() => 0.9999)).toBe("999999");
  });

  it("нормализует ввод гостя", () => {
    expect(normalizeSessionCode(" 123 456 ")).toBe("123456");
    expect(normalizeSessionCode("123-456")).toBe("123456");
  });

  it("отклоняет неверные коды", () => {
    expect(isValidSessionCode("12345")).toBe(false);
    expect(isValidSessionCode("1234567")).toBe(false);
    expect(isValidSessionCode("12a456")).toBe(false);
  });

  it("форматирует код для показа", () => {
    expect(formatSessionCode("123456")).toBe("123 456");
  });
});
