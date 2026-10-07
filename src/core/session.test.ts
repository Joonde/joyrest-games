import { describe, expect, it } from "vitest";
import type { Session } from "../data/types";
import { acceptsAnswers, adjustBoard, answerDeadline, applyChange, meetsExpect, secondsLeft, startState } from "./session";

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

  it("игра пошла дальше — таблица «посмотреть сейчас» уходит с экрана", () => {
    const peeking = { ...session, state: { ...session.state, peek: "total" as const } };
    expect(applyChange(peeking, { state: { stage: "reveal" } }, 1).state.peek).toBeNull();
    expect(applyChange(peeking, { state: { answered: 3 } }, 1).state.peek).toBe("total");
  });
});

describe("ожидание пульта и правки таблицы", () => {
  it("изменение — только если игра там, где её видел пульт", () => {
    const state = { ...startState(), step: 2, stage: "question" as const };
    expect(meetsExpect(state, undefined)).toBe(true);
    expect(meetsExpect(state, { phase: "playing", step: 2, stage: "question" })).toBe(true);
    expect(meetsExpect(state, { step: 1 })).toBe(false);
    expect(meetsExpect(state, { stage: "ready" })).toBe(false);
    expect(meetsExpect(state, { phase: "lobby" })).toBe(false);
  });

  it("прибавка очков и новое имя — только у тех, кто в таблице", () => {
    const board = { a: { name: "Аня", kind: "player" as const, score: 10, last: 5 } };
    expect(adjustBoard(board, { a: 10, x: 5 }, { a: "Анна", y: "Боря" })).toEqual({ a: { name: "Анна", kind: "player", score: 20, last: 5 } });
    const twice = adjustBoard(adjustBoard(board, { a: 10 }), { a: 10 });
    expect(twice.a?.score).toBe(30);
  });
});
