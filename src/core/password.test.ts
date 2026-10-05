import { describe, expect, it } from "vitest";
import { generateTempPassword, isStrongEnough, TEMP_PASSWORD_LENGTH } from "./password";

describe("временный пароль", () => {
  it("нужной длины и без похожих символов", () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTempPassword();
      expect(password).toHaveLength(TEMP_PASSWORD_LENGTH);
      expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
    }
  });

  it("проходит проверку длины пароля Firebase и нашу", () => {
    expect(isStrongEnough(generateTempPassword())).toBe(true);
  });

  it("отбрасывает байты, которые дали бы перекос", () => {
    let call = 0;
    // Первая пачка — только «плохие» байты 255, дальше — нули.
    const random = (bytes: Uint8Array) => bytes.fill(call++ === 0 ? 255 : 0);
    expect(generateTempPassword(random)).toBe("a".repeat(TEMP_PASSWORD_LENGTH));
  });

  it("короткий пароль не принимается", () => {
    expect(isStrongEnough("1234567")).toBe(false);
    expect(isStrongEnough("12345678")).toBe(true);
  });
});
