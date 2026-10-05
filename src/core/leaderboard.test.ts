import { describe, expect, it } from "vitest";
import type { Participant } from "../data/types";
import {
  captainChanges,
  CAPTAIN_TIMEOUT_MS,
  leaderboardAdditions,
  placeOf,
  rankedLeaderboard,
  scoringParticipants,
  sortedLeaderboard,
  uniqueName,
} from "./leaderboard";

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
    const board = { t1: { name: "Котики", kind: "team" as const, score: 3, colorIndex: 0, captainUid: "u2" } };
    expect(leaderboardAdditions(board, [team, team2], "teams")).toEqual({
      t2: { name: "Зайки", kind: "team", score: 0, colorIndex: 1, captainUid: "u2" },
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

describe("одинаковые имена", () => {
  it("получают номер", () => {
    expect(uniqueName("Аня", ["Петя"])).toBe("Аня");
    expect(uniqueName("Аня", ["аня"])).toBe("Аня 2");
    expect(uniqueName("Алёна", ["Алена", "Алена 2"])).toBe("Алёна 3");
    expect(uniqueName("Я".repeat(30), ["Я".repeat(30)])).toHaveLength(30);
  });

  it("второй гость с тем же именем попадает в таблицу с номером", () => {
    const anna2: Participant = { ...anna, id: "u3", joinedAt: 5 };
    const additions = leaderboardAdditions({}, [{ ...anna, joinedAt: 1 }, anna2], "solo");
    expect(additions.u1?.name).toBe("Анна");
    expect(additions.u3?.name).toBe("Анна 2");
    // Повторно номер не меняется.
    expect(leaderboardAdditions({ ...additions }, [anna, anna2], "solo")).toEqual({});
  });

  it("капитан команды переносится в таблицу", () => {
    const board = { t1: { name: "Котики", kind: "team" as const, score: 3, colorIndex: 0, captainUid: "u2" } };
    expect(leaderboardAdditions(board, [{ ...team, captainUid: "u9" }], "teams")).toEqual({
      t1: { name: "Котики", kind: "team", score: 3, colorIndex: 0, captainUid: "u9" },
    });
  });
});

describe("места", () => {
  const board = {
    a: { name: "Аня", kind: "player" as const, score: 10 },
    b: { name: "Боря", kind: "player" as const, score: 10 },
    c: { name: "Вика", kind: "player" as const, score: 7 },
    d: { name: "Гоша", kind: "player" as const, score: 0 },
  };

  it("равные очки — общее место, следующее место с пропуском", () => {
    expect(rankedLeaderboard(board).map((e) => [e.id, e.place])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 3],
      ["d", 4],
    ]);
    expect(placeOf(board, "b")).toEqual({ place: 1, total: 4 });
    expect(placeOf(board, "x")).toBeNull();
  });
});

describe("смена капитана", () => {
  const now = 1_000_000;
  const t: Participant = { id: "t1", name: "Котики", kind: "team", teamId: null, captainUid: "c1" };
  const phone = (id: string, joinedAt: number, seenAt: number | null = null): Participant => ({
    id,
    name: id,
    kind: "player",
    teamId: "t1",
    captainUid: id,
    joinedAt,
    seenAt,
  });

  it("капитан на связи — ничего не меняется", () => {
    expect(captainChanges([t, phone("c1", 1, now - 10_000), phone("m1", 2)], now)).toEqual({});
  });

  it("капитан пропал — капитаном становится следующий участник", () => {
    const stale = now - CAPTAIN_TIMEOUT_MS - 1;
    expect(captainChanges([t, phone("m2", 3), phone("c1", 1, stale), phone("m1", 2)], now)).toEqual({ t1: "m1" });
  });

  it("телефона капитана нет — капитан первый вошедший", () => {
    expect(captainChanges([t, phone("m2", 3), phone("m1", 2)], now)).toEqual({ t1: "m1" });
  });

  it("в команде один капитан — менять не на кого", () => {
    expect(captainChanges([t, phone("c1", 1, 0)], now)).toEqual({});
  });
});
