import { describe, expect, it } from "vitest";
import type { GameResult } from "../data/types";
import { compactBoard, formatResultsText, participantsLabel, places, pointsLabel, questionsLabel } from "./results";

const result: GameResult = {
  id: "s1",
  hostId: "h",
  code: "123456",
  gameTitle: "Свадьба Ани и Миши",
  mechanic: "quiz",
  themeId: "joyrest",
  playMode: "teams",
  playedAt: Date.UTC(2026, 9, 5, 12),
  participantsCount: 23,
  board: [
    { name: "Котики", score: 10, colorIndex: 0 },
    { name: "Ёжики", score: 10, colorIndex: 1 },
    { name: "Зайки", score: 7, colorIndex: 2 },
  ],
};

describe("compactBoard", () => {
  it("сортирует по очкам и оставляет только имя, очки и цвет команды", () => {
    expect(
      compactBoard({
        a: { name: "Боря", kind: "player", score: 1 },
        b: { name: "Анна", kind: "player", score: 5 },
        t: { name: "Котики", kind: "team", score: 3, colorIndex: 2 },
      }),
    ).toEqual([
      { name: "Анна", score: 5 },
      { name: "Котики", score: 3, colorIndex: 2 },
      { name: "Боря", score: 1 },
    ]);
  });

  it("пустая таблица — пустой список", () => {
    expect(compactBoard({})).toEqual([]);
  });
});

describe("places", () => {
  it("равные очки делят место", () => {
    expect(places(result.board)).toEqual([1, 1, 3]);
    expect(places([])).toEqual([]);
  });
});

describe("formatResultsText", () => {
  it("название, дата, участники, места и ссылка", () => {
    const text = formatResultsText(result, "https://joyrest.ru/results/s1");
    expect(text).toContain("Итоги игры «Свадьба Ани и Миши»");
    expect(text).toContain("5 октября 2026 · 23 участника");
    expect(text).toContain("1. Котики — 10 очков\n1. Ёжики — 10 очков\n3. Зайки — 7 очков");
    expect(text).toContain("https://joyrest.ru/results/s1");
  });

  it("длинная таблица обрезается", () => {
    const board = Array.from({ length: 25 }, (_, i) => ({ name: `Игрок ${i}`, score: 100 - i }));
    const text = formatResultsText({ ...result, board });
    expect(text).toContain("20. Игрок 19");
    expect(text).not.toContain("Игрок 20 ");
    expect(text).toContain("…и ещё 5");
  });

  it("без очков — понятная строка", () => {
    expect(formatResultsText({ ...result, board: [] })).toContain("Очков никто не набрал.");
  });
});

describe("склонения", () => {
  it("очки, участники, вопросы", () => {
    expect([0, 1, 2, 5, 11, 21, 22, 112].map(pointsLabel)).toEqual([
      "0 очков",
      "1 очко",
      "2 очка",
      "5 очков",
      "11 очков",
      "21 очко",
      "22 очка",
      "112 очков",
    ]);
    expect(participantsLabel(1)).toBe("1 участник");
    expect(participantsLabel(3)).toBe("3 участника");
    expect(questionsLabel(12)).toBe("12 вопросов");
  });
});
