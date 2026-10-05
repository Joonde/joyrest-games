import { describe, expect, it } from "vitest";
import type { Session } from "../data/types";
import { acceptsAnswers, answerDeadline, applyChange, secondsLeft, startState } from "./session";

const session: Session = {
  id: "s",
  code: "123456",
  hostId: "h",
  gameId: "g",
  gameTitle: "",
  mechanic: "quiz",
  gameSnapshot: null,
  themeId: "joyrest",
  playMode: "solo",
  screenMode: "laptop",
  state: startState(),
  leaderboard: { a: { name: "Аня", kind: "player", score: 5 } },
  createdAt: 0,
};

describe("окно ответа", () => {
  const open = { ...startState(), stage: "question" as const, startedAt: 10_000, timeLimit: 20 };

  it("таймер по часам сервера", () => {
    expect(answerDeadline(open)).toBe(30_000);
    expect(secondsLeft(open, 10_000)).toBe(20);
    expect(secondsLeft(open, 29_100)).toBe(1);
    expect(secondsLeft(open, 40_000)).toBe(0);
    expect(secondsLeft(startState(), 0)).toBeNull();
  });

  it("ответы — только на открытый вопрос и пока идёт время", () => {
    expect(acceptsAnswers(open, 20_000)).toBe(true);
    expect(acceptsAnswers(open, 31_000)).toBe(false);
    expect(acceptsAnswers({ ...open, stage: "reveal", revealed: true }, 20_000)).toBe(false);
    expect(acceptsAnswers(startState(), 0)).toBe(false);
  });
});

describe("applyChange (репетиция)", () => {
  it("меняет состояние и таблицу, время сервера — текущее", () => {
    const next = applyChange(
      session,
      { state: { stage: "question", startedAt: "server" }, leaderboard: { a: null, b: { name: "Боря", kind: "player", score: 1 } } },
      777,
    );
    expect(next.state.stage).toBe("question");
    expect(next.state.startedAt).toBe(777);
    expect(next.leaderboard).toEqual({ b: { name: "Боря", kind: "player", score: 1 } });
    expect(session.leaderboard.a).toBeDefined();
  });
});
