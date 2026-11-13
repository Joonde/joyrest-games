import { describe, expect, it } from "vitest";
import { podiumPlaces } from "./podium";
import type { Participant } from "../data/types";
import {
  captainChanges,
  CAPTAIN_TIMEOUT_MS,
  leaderboardAdditions,
  crewBoard,
  placeOf,
  rankedLeaderboard,
  scoreChange,
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

  it("группа (команды одного экипажа «Бубликатора») — одно место и считается за одного, «голова» первой", () => {
    const merged = {
      t0: { name: "Лисы", kind: "team" as const, score: 1200, group: "t0" },
      t2: { name: "Медведи", kind: "team" as const, score: 1200, group: "t0" },
      t1: { name: "Ракеты", kind: "team" as const, score: 800 },
      t3: { name: "Альфа", kind: "team" as const, score: 800 },
      t4: { name: "Бета", kind: "team" as const, score: 100 },
    };
    expect(rankedLeaderboard(merged).map((e) => [e.id, e.place])).toEqual([
      ["t0", 1],
      ["t2", 1],
      ["t3", 2],
      ["t1", 2],
      ["t4", 4],
    ]);
    // Мест — по экипажам: 4 экипажа, а не 5 команд.
    expect(placeOf(merged, "t2")).toEqual({ place: 1, total: 4 });
    expect(placeOf(merged, "t4")).toEqual({ place: 4, total: 4 });
    // Без групп — как раньше.
    expect(rankedLeaderboard(board).map((e) => e.place)).toEqual([1, 1, 3, 4]);
  });

  it("одна строка на экипаж (итог экрана «Бубликатора» после завершения) и пьедестал без повторов", () => {
    const merged = {
      t0: { name: "Лисы", kind: "team" as const, score: 1200, group: "t0" },
      t2: { name: "Медведи", kind: "team" as const, score: 1200, group: "t0" },
      t1: { name: "Ракеты", kind: "team" as const, score: 800 },
    };
    expect(crewBoard(merged)).toEqual([
      { id: "t0", name: "Лисы", score: 1200, place: 1 },
      { id: "t1", name: "Ракеты", score: 800, place: 2 },
    ]);
    expect(podiumPlaces(merged).map((p) => [p.place, p.entries.map((e) => e.id)])).toEqual([
      [1, ["t0"]],
      [2, ["t1"]],
    ]);
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

describe("scoreChange", () => {
  const board = { a: { name: "А", kind: "team" as const, score: 500_000 }, b: { name: "Б", kind: "team" as const, score: 10 } };
  it("обычные суммы — прибавкой, нули отбрасываются", () => {
    expect(scoreChange(board, { a: 100, b: 0 })).toEqual({ addScore: { a: 100 } });
    expect(scoreChange(board, {})).toEqual({});
  });
  it("сумма больше лимита сервера — записью таблицы целиком", () => {
    expect(scoreChange(board, { a: 150_000, b: 5 })).toEqual({
      leaderboard: { a: { name: "А", kind: "team", score: 650_000, last: 150_000 }, b: { name: "Б", kind: "team", score: 15, last: 5 } },
    });
    expect(scoreChange(board, { a: -150_000 }).leaderboard?.a?.score).toBe(350_000);
  });
});
