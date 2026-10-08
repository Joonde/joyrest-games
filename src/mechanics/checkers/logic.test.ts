import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { parseCheckers } from "./content";
import { DEMO_CHECKERS } from "./demo";
import { validateCheckers } from "./validate";
import { DEMO_BOARD } from "../board/demo";
import { validateBoard } from "../board/validate";
import { checkersBack, checkersPrimary, markTask, moveChange, nextTurn, parseCheckersResult, pathChange, revealTask, startGame, taskRight, toTask } from "./logic";

const content = parseCheckers({
  timeLimit: 20,
  questions: [
    { id: "q1", kind: "choice", text: "2+2?", options: ["3", "4"], correct: 1 },
    { id: "q2", kind: "open", text: "Столица Франции?", answers: ["Париж"] },
  ],
});

const teams: Participant[] = [
  { id: "W", name: "Белые", kind: "team", teamId: null, captainUid: "u1", joinedAt: 1 },
  { id: "B", name: "Чёрные", kind: "team", teamId: null, captainUid: "u2", joinedAt: 2 },
];

function session(): Session {
  return { id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "checkers", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 };
}

let t = 0;
const apply = (s: Session, c: SessionChange) => applyChange(s, c, (t += 1000));
const ans = (pid: string, step: number, value: unknown, at = 1e12): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: at });

describe("Шашки: ход игры", () => {
  it("ходят по очереди: белые, чёрные, белые; чужой и неправильный ход не принимаются; ведущий ходит на пульте", () => {
    let s = session();
    expect(checkersPrimary(s, content)).toBe("start");
    s = apply(s, startGame(s, teams));
    const r0 = parseCheckersResult(s.state.result);
    expect(r0.white).toBe("W");
    expect(r0.black).toBe("B");
    expect(r0.mover).toBe("W");
    expect(s.leaderboard.W?.name).toBe("Белые");
    expect(checkersPrimary(s, content)).toBe("waitMove");
    const step1 = s.state.step;
    // Ход чёрных (не их очередь) и неправильный ход не принимаются.
    expect(moveChange(s, [ans("B", step1, { path: [17, 24] })])).toBeNull();
    expect(moveChange(s, [ans("W", step1, { path: [40, 30] })])).toBeNull();
    s = apply(s, moveChange(s, [ans("W", step1, { path: [40, 33] })]) ?? {});
    expect(parseCheckersResult(s.state.result).board[33]).toBe("w");
    expect(checkersPrimary(s, content)).toBe("turn");

    // «Назад» отменяет ход.
    const back = checkersBack(s);
    expect(back?.clear).toEqual([step1]);
    s = apply(s, back?.change ?? {});
    expect(parseCheckersResult(s.state.result).board[40]).toBe("w");
    // Ведущий ходит за команду на пульте.
    s = apply(s, pathChange(s, [40, 33]) ?? {});
    s = apply(s, nextTurn(s));
    expect(parseCheckersResult(s.state.result).mover).toBe("B");
    s = apply(s, pathChange(s, [17, 24]) ?? {});
    s = apply(s, nextTurn(s));
    expect(parseCheckersResult(s.state.result).mover).toBe("W");
    // «Назад» с начала хода — к показанному ходу чёрных.
    s = apply(s, checkersBack(s)?.change ?? {});
    expect(s.state.stage).toBe("reveal");
    expect(parseCheckersResult(s.state.result).mover).toBe("B");
  });

  it("съели шашку — вопрос потерявшим: верно +20, ход переходит им", () => {
    let s = session();
    s = apply(s, startGame(s, teams));
    // Позиция: белая шашка может побить чёрную.
    const r = parseCheckersResult(s.state.result);
    const b = ".".repeat(64).split("");
    b[40] = "w";
    b[33] = "b";
    b[1] = "b";
    s = { ...s, state: { ...s.state, result: { ...r, board: b.join("") } } };
    s = apply(s, pathChange(s, [40, 26]) ?? {});
    expect(s.leaderboard.W?.score).toBe(10);
    expect(checkersPrimary(s, content)).toBe("task");
    s = apply(s, toTask(s, content));
    const t = parseCheckersResult(s.state.result);
    expect(t.victim).toBe("B");
    expect(t.task).toBe(0);
    expect(s.state.timeLimit).toBe(20);
    expect(checkersPrimary(s, content)).toBe("taskReveal");
    // Ответ белых не считается — отвечают только потерявшие.
    expect(taskRight(content, t, [ans("W", s.state.step, 1)], s.state.step)).toBe(false);
    s = apply(s, revealTask(s, content, [ans("B", s.state.step, 1)]));
    expect(parseCheckersResult(s.state.result).taskOk).toBe(true);
    expect(s.leaderboard.B?.score).toBe(20);
    // «Назад» снимает очки задания.
    const undo = checkersBack(s);
    s = apply(s, undo?.change ?? {});
    expect(s.leaderboard.B?.score).toBe(0);
    // Ведущий сам засчитал «неверно».
    s = apply(s, markTask(s, false));
    s = apply(s, revealTask(s, content, [ans("B", s.state.step, 1)]));
    expect(s.leaderboard.B?.score).toBe(0);
    s = apply(s, nextTurn(s));
    expect(parseCheckersResult(s.state.result).mover).toBe("B");
    expect(parseCheckersResult(s.state.result).q).toBe(1);
  });

  it("последняя шашка соперника — победа; вопросы кончились — задания нет", () => {
    let s = session();
    s = apply(s, startGame(s, teams));
    const r = parseCheckersResult(s.state.result);
    const b = ".".repeat(64).split("");
    b[40] = "w";
    b[33] = "b";
    s = { ...s, state: { ...s.state, result: { ...r, board: b.join(""), q: 2 } } };
    s = apply(s, pathChange(s, [40, 26]) ?? {});
    const done = parseCheckersResult(s.state.result);
    expect(done.mode).toBe("over");
    expect(done.winner).toBe("W");
    expect(s.leaderboard.W?.score).toBe(10 + 50);
    expect(checkersPrimary(s, content)).toBe("podium");
  });
});

describe("шаблоны", () => {
  it("«Шашки» и «Своя игра» из библиотеки готовы к запуску", () => {
    expect(DEMO_CHECKERS.content.questions.length).toBe(30);
    expect(validateCheckers(DEMO_CHECKERS.content)).toEqual([]);
    expect(validateBoard(DEMO_BOARD.content)).toEqual([]);
  });
});
