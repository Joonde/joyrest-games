import { describe, expect, it } from "vitest";
import { isExpired, retentionCutoff, SESSION_RETENTION_DAYS } from "./retention";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 5);

describe("срок хранения сессий", () => {
  it("30 дней", () => {
    expect(SESSION_RETENTION_DAYS).toBe(30);
    expect(retentionCutoff(now)).toBe(now - 30 * DAY);
  });

  it("сессия старше 30 дней устарела, моложе — нет", () => {
    expect(isExpired(now - 31 * DAY, now)).toBe(true);
    expect(isExpired(now - 29 * DAY, now)).toBe(false);
    expect(isExpired(now - 30 * DAY, now)).toBe(false);
  });

  it("сессия без даты (ещё не записана сервером) не удаляется", () => {
    expect(isExpired(null, now)).toBe(false);
  });
});
