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

  it("страницы агентства в Лайте не открываются: маршруты — только у агентства", () => {
    const app = readFileSync(resolve(import.meta.dirname, "../App.tsx"), "utf8");
    const start = app.indexOf("{agency && (");
    const end = app.indexOf(")}", start);
    expect(start).toBeGreaterThan(0);
    const block = app.slice(start, end);
    // Точное совпадение с кавычкой и пробелом: "/studio" не путается с "/studio/clients".
    const route = (path: string) => `path="${path}" `;
    for (const path of ["/studio/clients", "/studio/calendar", "/studio/team", "/studio/reviews", "/studio/photos", "/venues", "/v", "/r", "/o/:offerId", "/review/:sessionId", "/studio/qr"]) {
      expect(block, path).toContain(route(path));
      expect(app.indexOf(route(path)), path).toBe(app.lastIndexOf(route(path)));
    }
    for (const path of ["/studio", "/admin", "/host/:code", "/play/:code", "/screen/:code", "/studio/decks", "/results/:resultId"]) {
      expect(block, path).not.toContain(route(path));
      expect(app, path).toContain(route(path));
    }
  });

  it("«Итоги игр» в Лайте ведут назад к «Ведущим», а не на скрытую «Команду»", () => {
    const page = readFileSync(resolve(import.meta.dirname, "../screens/studio/HostGames.tsx"), "utf8");
    expect(page).toContain('teamRepo ? { label: "К команде", to: "/studio/team?tab=manage" } : { label: "К ведущим", to: "/admin" }');
    expect(page.match(/\/studio\/team/g)?.length).toBe(1);
  });

  it("слайды Лайта — без «команды JoyRest»", async () => {
    const { slideDefaults, thanksSlide } = await import("../core/slides");
    expect(slideDefaults("thanks").text).toContain("JoyRest");
    expect(slideDefaults("thanks", true).text).not.toContain("JoyRest");
    expect(slideDefaults("intro", true).text).not.toContain("JoyRest");
    expect(thanksSlide("a", true).text).not.toContain("JoyRest");
    expect(slideDefaults("rules", true)).toEqual(slideDefaults("rules"));
  });

  it("разделы агентства в Лайте отключены, общие — нет", () => {
    const active = readFileSync(resolve(import.meta.dirname, "active.ts"), "utf8");
    expect(active).toContain('const agency = server && edition() !== "lite";');
    for (const repo of ["proposalsRepo", "staffRepo", "teamRepo", "venuesRepo", "calendarRepo", "eventsRepo", "clientsRepo", "noticesRepo", "telegramRepo", "finaleRepo", "photosRepo", "brandingsRepo"]) {
      expect(active, repo).toMatch(new RegExp(`export const ${repo}: [^=]+= agency \\?`));
    }
    for (const repo of ["gamesRepo", "sessionsRepo", "tracksRepo", "videosRepo", "decksRepo", "pollsRepo", "drawingsRepo"]) {
      expect(active, repo).not.toMatch(new RegExp(`export const ${repo}: [^=]+= agency \\?`));
    }
  });
});
