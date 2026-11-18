import { describe, expect, it } from "vitest";
import type { Leaderboard, RoomStreamEvent } from "../../../data/types";
import { World } from "../rules/world.test-kit";
import { applyHost, commandError, emptyHost, leaderboardChange, leftOf, mmss, pausedMomentOf, syncsLeaderboard } from "./model";

function hostEvent(w: World, at = w.now): RoomStreamEvent {
  return {
    type: "host", at, version: w.changes, moment: w.host().moment, paused: w.paused, restored: false,
    players: w.players.length, online: w.players.length - w.offline.size, offline: [],
    loop: { lagMs: 2, maxLagMs: 4, memoryMb: 100 }, data: w.host(),
  };
}

describe("пульт Матрёшки: модель", () => {
  it("принимает корректную сводку, часы и паузу; мусор не ломает последний вид", () => {
    const w = new World(6);
    let m = emptyHost();
    m = applyHost(m, hostEvent(w, 12_000), 11_980);
    expect(m.view?.phase).toBe("lobby");
    expect(m.skew).toBe(20);
    expect(m.seq).toBe(1);
    const before = m;
    const fresh = hostEvent(w);
    if (fresh.type !== "host") throw new Error("expected host event");
    m = applyHost(m, { ...fresh, data: { bad: true } }, w.now);
    expect(m.view).toBe(before.view);
    w.pause();
    m = applyHost(m, { type: "room", at: 13_000, paused: true }, 12_990);
    expect(pausedMomentOf(m)).toBe(13_000);
    m = applyHost(m, hostEvent(w, 13_100), 13_090);
    expect(m.view?.pausedAt).not.toBeNull();
    expect(pausedMomentOf(m)).toBe(m.view?.pausedAt);
  });

  it("считает время только от серверных сроков", () => {
    expect(leftOf(10_000, 4_000, null)).toBe(6_000);
    expect(leftOf(10_000, 8_000, 3_000)).toBe(7_000);
    expect(leftOf(null, 8_000, null)).toBeNull();
    expect(mmss(58_000)).toBe("0:58");
    expect(mmss(68_000)).toBe("1:08");
  });

  it("пишет итоги solo по pid без повторов и не трогает чужие записи", () => {
    const w = new World(6);
    const v = { ...w.host(), phase: "podium" as const, standings: [
      { pid: "p1", num: 2, name: "Б", place: 1, points: 60, removed: false },
      { pid: "p2", num: 3, name: "В", place: 2, points: 50, removed: false },
    ] };
    const board: Leaderboard = { other: { name: "Другой", kind: "player", score: 10 } };
    expect(leaderboardChange(v, board)).toEqual({
      p1: { name: "Б", kind: "player", score: 60 },
      p2: { name: "В", kind: "player", score: 50 },
    });
    const filled = { ...board, ...leaderboardChange(v, board) };
    expect(leaderboardChange(v, filled)).toEqual({});
    expect(syncsLeaderboard(v)).toBe(true);
  });

  it("различает молчаливый moved и понятные отказы", () => {
    expect(commandError("failed-precondition", "moved")).toBeNull();
    expect(commandError("failed-precondition", "paused")).toContain("паузе");
    expect(commandError("failed-precondition", "limit")).toContain("60");
    expect(commandError("permission-denied", "")).toContain("ведущий");
  });
});
