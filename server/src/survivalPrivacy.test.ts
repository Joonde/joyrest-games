import { describe, expect, it } from "vitest";
import { startState } from "../../src/core/session";
import type { Session } from "../../src/data/types";
import { hasTaskWords, parseSurvival, taskWordFor } from "../../src/mechanics/survival/content";
import { survivalEventFor, survivalSessionFor } from "./survivalPrivacy";

function session(playMode: "solo" | "teams" = "teams", phase = "play"): Session {
  return {
    id: "s",
    code: "123456",
    hostId: "host",
    gameId: "g",
    gameTitle: "Гонка",
    mechanic: "survival",
    gameSnapshot: {
      title: "Гонка",
      content: {
        rounds: [
          { id: "r1", kind: "task", text: "Покажи", solo: "", options: [], correct: -1, answer: "слон | жираф", points: 100, seconds: 0 },
          { id: "r2", kind: "task", text: "Будущее", solo: "", options: [], correct: -1, answer: "тигр | лев", points: 100, seconds: 0 },
        ],
      },
    },
    themeId: "joyrest",
    playMode,
    screenMode: "laptop",
    state: { ...startState(), phase: "playing", stage: "question", result: { round: 0, phase, order: playMode === "teams" ? ["teamA", "teamB"] : ["u1", "u2"] } },
    leaderboard: playMode === "teams"
      ? {
          teamA: { name: "A", kind: "team", score: 0, captainUid: "capA" },
          teamB: { name: "B", kind: "team", score: 0, captainUid: "capB" },
        }
      : {
          u1: { name: "Аня", kind: "player", score: 0 },
          u2: { name: "Боря", kind: "player", score: 0 },
        },
    createdAt: 0,
  };
}

function answers(view: Session): string[] {
  const snapshot = view.gameSnapshot as { content: { rounds: Array<{ answer: string; hasWords?: boolean }> } };
  return snapshot.content.rounds.map((round) => round.answer);
}

describe("серверная секретность слов Гонки", () => {
  it("пульт получает полный список, капитан — только своё слово текущего раунда", () => {
    const original = session();
    expect(survivalSessionFor(original, "host", true)).toBe(original);
    const first = survivalSessionFor(original, "capA");
    const second = survivalSessionFor(original, "capB");
    expect(answers(first)).toEqual(["слон", ""]);
    expect(answers(second)).toEqual(["жираф", ""]);
    expect(JSON.stringify(first)).not.toContain("жираф");
    expect(JSON.stringify(first)).not.toContain("тигр");
    expect(JSON.stringify(second)).not.toContain("слон");
  });

  it("участник команды и экран не получают слов, но сохраняют признак задания", () => {
    for (const uid of ["member", "screen", null]) {
      const view = survivalSessionFor(session(), uid);
      expect(answers(view)).toEqual(["", ""]);
      const content = parseSurvival((view.gameSnapshot as { content: unknown }).content);
      expect(hasTaskWords(content.rounds[0]!)).toBe(true);
      expect(taskWordFor(content.rounds[0]!, ["teamA", "teamB"], "teamA")).toBeNull();
    }
  });

  it("в одиночной игре каждый получает только своё слово", () => {
    expect(answers(survivalSessionFor(session("solo"), "u1"))).toEqual(["слон", ""]);
    expect(answers(survivalSessionFor(session("solo"), "u2"))).toEqual(["жираф", ""]);
  });

  it("до показа задания и после его закрытия слова не выдаются", () => {
    expect(answers(survivalSessionFor(session("teams", "intro"), "capA"))).toEqual(["", ""]);
    const revealed = session();
    revealed.state.stage = "reveal";
    expect(answers(survivalSessionFor(revealed, "capA"))).toEqual(["", ""]);
  });

  it("SSE-снимок персонализируется, обычный patch остаётся без изменений", () => {
    const patch = { type: "patch", version: 2 };
    expect(survivalEventFor(patch, "capA")).toBe(patch);
    const event = survivalEventFor({ type: "snapshot", session: session() }, "capA") as { session: Session };
    expect(answers(event.session)).toEqual(["слон", ""]);
  });
});
