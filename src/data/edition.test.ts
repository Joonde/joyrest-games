import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { edition } from "./edition";

function withMeta(content: string | null) {
  vi.stubGlobal("document", {
    querySelector: (selector: string) =>
      selector === 'meta[name="joyrest-edition"]' && content !== null ? { getAttribute: () => content } : null,
  });
}

describe("редакция в браузере", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Лайт — только точная метка lite; нет метки или другое — агентство", () => {
    withMeta("lite");
    expect(edition()).toBe("lite");
    for (const value of [null, "", "agency", "LITE", " lite", "лайт"]) {
      withMeta(value);
      expect(edition(), String(value)).toBe("agency");
    }
  });

  it("без document (сервер, тесты) — агентство", () => {
    expect(edition()).toBe("agency");
  });

  it("разделы агентства в Лайте отключены, общие — нет", () => {
    const active = readFileSync(resolve(import.meta.dirname, "active.ts"), "utf8");
    expect(active).toContain('const agency = server && edition() !== "lite";');
    for (const repo of ["proposalsRepo", "staffRepo", "teamRepo", "venuesRepo", "calendarRepo", "eventsRepo", "clientsRepo", "noticesRepo", "telegramRepo"]) {
      expect(active, repo).toMatch(new RegExp(`export const ${repo}: [^=]+= agency \\?`));
    }
    for (const repo of ["gamesRepo", "sessionsRepo", "tracksRepo", "videosRepo", "decksRepo", "brandingsRepo", "finaleRepo", "photosRepo", "pollsRepo"]) {
      expect(active, repo).not.toMatch(new RegExp(`export const ${repo}: [^=]+= agency \\?`));
    }
  });
});
