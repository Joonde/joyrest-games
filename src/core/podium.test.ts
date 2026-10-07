import { describe, expect, it } from "vitest";
import type { Leaderboard, Session } from "../data/types";
import {
  hasPodium,
  nextPlace,
  podiumBack,
  podiumDone,
  podiumLabel,
  podiumNext,
  podiumPlaces,
  podiumShown,
  revealedPlaces,
  revealOrder,
  startPodium,
} from "./podium";
import { applyChange, startState } from "./session";

const p = (name: string, score: number) => ({ name, kind: "player" as const, score });

function session(leaderboard: Leaderboard, result: unknown = { counts: [1, 2], correct: 1 }): Session {
  return {
    id: "s",
    code: "123456",
    hostId: "h",
    gameId: "g",
    gameTitle: "Квиз",
    mechanic: "quiz",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: { ...startState(), phase: "playing", stage: "board", revealed: true, result },
    leaderboard,
    createdAt: 0,
  };
}

describe("пьедестал", () => {
  it("места 1–3 с очками; при равных — на одной ступени, пустое место пропущено", () => {
    const board = { a: p("Аня", 30), b: p("Боря", 30), c: p("Вика", 20), d: p("Гоша", 10), e: p("Даша", 0) };
    const places = podiumPlaces(board);
    expect(places.map((x) => [x.place, x.entries.map((e) => e.name), x.score])).toEqual([
      [1, ["Аня", "Боря"], 30],
      [3, ["Вика"], 20],
    ]);
    expect(revealOrder(board)).toEqual([3, 1]);
  });

  it("без очков награждать некого; ноль очков на пьедестал не попадает", () => {
    expect(hasPodium({ a: p("Аня", 0) })).toBe(false);
    expect(hasPodium({})).toBe(false);
    expect(revealOrder({ a: p("Аня", 5), b: p("Боря", 0) })).toEqual([1]);
  });

  it("открывает с третьего по первое, «Назад» закрывает и возвращает таблицу", () => {
    let s = session({ a: p("Аня", 30), b: p("Боря", 20), c: p("Вика", 10), d: p("Гоша", 5) });
    s = applyChange(s, startPodium(s), 1);
    expect(s.state.stage).toBe("podium");
    expect(podiumShown(s.state)).toBe(0);
    expect(podiumLabel(s)).toBe("Показать 3 место");
    s = applyChange(s, podiumNext(s), 2);
    expect([...revealedPlaces(s)]).toEqual([3]);
    expect(nextPlace(s)).toBe(2);
    s = applyChange(s, podiumNext(s), 3);
    s = applyChange(s, podiumNext(s), 4);
    expect(podiumDone(s)).toBe(true);
    expect(podiumLabel(s)).toBe("Завершить игру");
    // Лишнее нажатие не уходит дальше последнего места.
    s = applyChange(s, podiumNext(s), 5);
    expect(podiumShown(s.state)).toBe(3);
    for (let i = 0; i < 3; i++) s = applyChange(s, podiumBack(s), 6 + i);
    expect(podiumShown(s.state)).toBe(0);
    s = applyChange(s, podiumBack(s), 10);
    expect(s.state.stage).toBe("board");
    expect(s.state.result).toEqual({ counts: [1, 2], correct: 1 });
  });

  it("испорченное значение — ничего не открыто", () => {
    expect(podiumShown({ result: { podium: "2" } })).toBe(0);
    expect(podiumShown({ result: null })).toBe(0);
    expect(podiumShown({ result: { podium: -1 } })).toBe(0);
  });
});
