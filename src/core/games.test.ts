import { describe, expect, it } from "vitest";
import type { Game } from "../data/types";
import { cleanGameTitle, copyOfGame, GAME_TITLE_MAX_LENGTH, gameSnapshot, isValidGameTitle, sortGames } from "./games";

const game: Game = {
  id: "g1",
  scope: "agency",
  ownerId: "admin",
  title: "Новогодний квиз",
  mechanic: "quiz",
  themeId: "joyrest",
  ageRating: "12+",
  content: { questions: [1, 2] },
  createdAt: 1,
  updatedAt: 2,
};

describe("copyOfGame", () => {
  it("копия общей игры в «Мои игры» — с тем же названием и содержимым", () => {
    expect(copyOfGame(game, "personal", "host")).toEqual({
      scope: "personal",
      ownerId: "host",
      title: "Новогодний квиз",
      mechanic: "quiz",
      themeId: "joyrest",
      ageRating: "12+",
      content: { questions: [1, 2] },
    });
  });

  it("дубль в своей библиотеке помечается «(копия)» и не длиннее предела", () => {
    const mine = { ...game, scope: "personal" as const, ownerId: "host" };
    expect(copyOfGame(mine, "personal", "host").title).toBe("Новогодний квиз (копия)");
    const long = copyOfGame({ ...mine, title: "Я".repeat(GAME_TITLE_MAX_LENGTH) }, "personal", "host").title;
    expect(long.length).toBeLessThanOrEqual(GAME_TITLE_MAX_LENGTH);
    expect(long.endsWith("(копия)")).toBe(true);
  });
});

describe("название игры", () => {
  it("чистится и проверяется", () => {
    expect(cleanGameTitle("  Квиз   для  друзей ")).toBe("Квиз для друзей");
    expect(isValidGameTitle("")).toBe(false);
    expect(isValidGameTitle(cleanGameTitle("x".repeat(200)))).toBe(true);
  });
});

describe("sortGames", () => {
  it("свежие сверху, без даты — в конце", () => {
    const list = sortGames([
      { ...game, id: "old", updatedAt: 1 },
      { ...game, id: "none", updatedAt: null, createdAt: null },
      { ...game, id: "new", updatedAt: 5 },
    ]);
    expect(list.map((g) => g.id)).toEqual(["new", "old", "none"]);
  });
});

describe("gameSnapshot", () => {
  it("копирует то, что нужно сессии", () => {
    expect(gameSnapshot(game)).toEqual({
      title: "Новогодний квиз",
      mechanic: "quiz",
      themeId: "joyrest",
      content: { questions: [1, 2] },
    });
  });
});
