import { describe, expect, it } from "vitest";
import type { SessionState } from "../data/types";
import { canHardwareBuzz } from "./hardware";

const state = (result: unknown, patch: Partial<SessionState> = {}): SessionState => ({
  phase: "playing",
  step: 0,
  startedAt: 1000,
  revealed: false,
  stage: "question",
  timeLimit: null,
  answered: 0,
  result,
  ...patch,
});

describe("допуск физической кнопки к текущему розыгрышу", () => {
  it("квиз: только вопрос «кто первый», не обычный и не закрытый", () => {
    const snapshot = { content: { questions: [{ kind: "buzz" }, { kind: "choice" }] } };
    expect(canHardwareBuzz("quiz", snapshot, state({ buzz: {} }), "p1")).toBe(true);
    expect(canHardwareBuzz("quiz", snapshot, state({}, { step: 1 }), "p1")).toBe(false);
    expect(canHardwareBuzz("quiz", { content: { questions: [{ kind: "choice" }] } }, state({}), "p1")).toBe(false);
    expect(canHardwareBuzz("quiz", snapshot, state({}, { stage: "reveal", revealed: true }), "p1")).toBe(false);
  });

  it("Ставка на знания: отсчёт запущен, обычная клетка доступна всем", () => {
    expect(canHardwareBuzz("board", null, state({ mode: "buzz", armed: true }), "p1")).toBe(true);
    expect(canHardwareBuzz("board", null, state({ mode: "buzz", armed: false }), "p1")).toBe(false);
    expect(canHardwareBuzz("board", null, state({ mode: "auction", armed: true }), "p1")).toBe(false);
  });

  it("Кот в мешке: только положительная ставка", () => {
    const result = { mode: "buzz", armed: true, catStep: true, bets: { p1: 100, p2: 0 } };
    expect(canHardwareBuzz("board", null, state(result), "p1")).toBe(true);
    expect(canHardwareBuzz("board", null, state(result), "p2")).toBe(false);
    expect(canHardwareBuzz("board", null, state(result), "p3")).toBe(false);
  });

  it("Сто к одному: только текущая пара после запуска отсчёта", () => {
    const result = { mode: "face", armed: true, pair: ["p1", "p2"] };
    expect(canHardwareBuzz("hundred", null, state(result), "p1")).toBe(true);
    expect(canHardwareBuzz("hundred", null, state(result), "p3")).toBe(false);
    expect(canHardwareBuzz("hundred", null, state({ ...result, armed: false }), "p1")).toBe(false);
    expect(canHardwareBuzz("hundred", null, state({ ...result, mode: "hall" }), "p1")).toBe(false);
  });

  it("другие механики и лобби физические нажатия не принимают", () => {
    expect(canHardwareBuzz("lotto", null, state({}), "p1")).toBe(false);
    expect(canHardwareBuzz("quiz", { content: { questions: [{ kind: "buzz" }] } }, state({}, { phase: "lobby" }), "p1")).toBe(false);
  });
});
