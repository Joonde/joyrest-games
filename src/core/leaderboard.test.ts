import { describe, expect, it } from "vitest";
import type { Participant } from "../data/types";
import { leaderboardAdditions, scoringParticipants, sortedLeaderboard } from "./leaderboard";

const anna: Participant = { id: "u1", name: "Анна", kind: "player", teamId: null, captainUid: "u1" };
const boris: Participant = { id: "u2", name: "Борис", kind: "player", teamId: "t1", captainUid: "u2" };
const team: Participant = { id: "t1", name: "Котики", kind: "team", teamId: null, captainUid: "u2" };

describe("таблица лидеров", () => {
  it("в solo считает игроков, в teams — команды", () => {
    expect(scoringParticipants([anna, boris, team], "solo").map((p) => p.id)).toEqual(["u1", "u2"]);
    expect(scoringParticipants([anna, boris, team], "teams").map((p) => p.id)).toEqual(["t1"]);
  });

  it("добавляет новых участников с нулём очков", () => {
    expect(leaderboardAdditions({}, [anna], "solo")).toEqual({
      u1: { name: "Анна", kind: "player", score: 0 },
    });
  });

  it("выдаёт командам цвета по порядку и не меняет их", () => {
    const team2: Participant = { ...team, id: "t2", name: "Зайки" };
    const board = { t1: { name: "Котики", kind: "team" as const, score: 3, colorIndex: 0 } };
    expect(leaderboardAdditions(board, [team, team2], "teams")).toEqual({
      t2: { name: "Зайки", kind: "team", score: 0, colorIndex: 1 },
    });
  });

  it("не трогает существующие записи и их очки", () => {
    const board = { u1: { name: "Анна", kind: "player" as const, score: 5 } };
    expect(leaderboardAdditions(board, [anna], "solo")).toEqual({});
  });

  it("обновляет имя, сохраняя очки", () => {
    const board = { u1: { name: "Аня", kind: "player" as const, score: 5 } };
    expect(leaderboardAdditions(board, [anna], "solo")).toEqual({
      u1: { name: "Анна", kind: "player", score: 5 },
    });
  });

  it("сортирует по очкам, затем по имени", () => {
    const sorted = sortedLeaderboard({
      a: { name: "Яна", kind: "player", score: 1 },
      b: { name: "Аня", kind: "player", score: 1 },
      c: { name: "Петя", kind: "player", score: 3 },
    });
    expect(sorted.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });
});
