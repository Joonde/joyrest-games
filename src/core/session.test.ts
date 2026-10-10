import { describe, expect, it } from "vitest";
import type { Session } from "../data/types";
import { acceptsAnswers, addTimeChange, adjustBoard, answerDeadline, applyChange, meetsExpect, secondsLeft, startState } from "./session";

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

describe("отпечаток итогов шага (expect.result)", () => {
  it("не зависит от порядка ключей и пропущенных undefined", async () => {
    const { resultKey } = await import("./session");
    expect(resultKey({ a: 1, b: { y: [1, 2], x: "т" } })).toBe(resultKey({ b: { x: "т", y: [1, 2] }, a: 1, c: undefined }));
    expect(resultKey(null)).toBe(resultKey(undefined));
    expect(resultKey({ judged: true })).not.toBe(resultKey({ judged: false }));
  });

  it("второй пульт с устаревшим видом не проходит", async () => {
    const { meetsExpect, resultKey, startState } = await import("./session");
    const state = { ...startState(), result: { judged: "c1" } };
    expect(meetsExpect(state, { step: 0, result: resultKey({ judged: "c1" }) })).toBe(true);
    expect(meetsExpect(state, { step: 0, result: resultKey(null) })).toBe(false);
  });
});

describe("+10 секунд", () => {
  const open = { ...startState(), stage: "question" as const, startedAt: 100_000, timeLimit: 20 };

  it("продлевает открытый вопрос; время вышло — ещё 10 секунд с этой минуты", () => {
    expect(addTimeChange(open, 105_000)).toEqual({ state: { timeLimit: 30 }, expect: { phase: "playing", step: 0, stage: "question" } });
    // Прошло 45 с при лимите 20 — гости снова отвечают до 55-й секунды.
    expect(addTimeChange(open, 145_000)?.state?.timeLimit).toBe(55);
    expect(acceptsAnswers({ ...open, timeLimit: 55 }, 150_000)).toBe(true);
  });

  it("нечего продлевать: вопрос не открыт, без таймера, ответ показан, потолок", () => {
    expect(addTimeChange({ ...open, stage: "reveal" }, 105_000)).toBeNull();
    expect(addTimeChange({ ...open, timeLimit: null }, 105_000)).toBeNull();
    expect(addTimeChange({ ...open, revealed: true }, 105_000)).toBeNull();
    expect(addTimeChange({ ...open, timeLimit: 900 }, 105_000)).toBeNull();
  });
});
