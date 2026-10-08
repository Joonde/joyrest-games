import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { parseCheckers } from "./content";
import { DEMO_CHECKERS } from "./demo";
import { validateCheckers } from "./validate";
import { DEMO_BOARD } from "../board/demo";
import { validateBoard } from "../board/validate";
import { checkersBack, checkersPrimary, moveChange, nextQuestion, parseCheckersResult, revealQuestion, showQuestion, skipMove, toMove } from "./logic";

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
  it("верный и быстрый ответ даёт ход, ход по правилам двигает шашку; чужой и неправильный — нет", () => {
    let s = session();
    expect(checkersPrimary(s, content)).toBe("show");
    s = apply(s, showQuestion(s, content, teams));
    const r0 = parseCheckersResult(s.state.result);
    expect(r0.white).toBe("W");
    expect(r0.black).toBe("B");
    expect(s.leaderboard.W?.name).toBe("Белые");

    // Чёрные ответили верно раньше белых.
    s = apply(s, revealQuestion(s, content, [ans("W", 0, 1, 1e12 + 50), ans("B", 0, 1, 1e12 + 20)], teams));
    expect(parseCheckersResult(s.state.result).mover).toBe("B");
    expect(checkersPrimary(s, content)).toBe("toMove");
    s = apply(s, toMove(s));
    expect(checkersPrimary(s, content)).toBe("waitMove");
    // Ход белых (не их очередь) и неправильный ход не принимаются.
    expect(moveChange(s, [ans("W", 1, { path: [40, 33] })])).toBeNull();
    expect(moveChange(s, [ans("B", 1, { path: [17, 33] })])).toBeNull();
    s = apply(s, moveChange(s, [ans("B", 1, { path: [17, 24] })]) ?? {});
    const r1 = parseCheckersResult(s.state.result);
    expect(r1.board[17]).toBe(".");
    expect(r1.board[24]).toBe("b");
    expect(checkersPrimary(s, content)).toBe("next");

    // «Назад» отменяет ход.
    const back = checkersBack(s);
    expect(back?.clear).toEqual([1]);
    s = apply(s, back?.change ?? {});
    expect(parseCheckersResult(s.state.result).board[17]).toBe("b");
    s = apply(s, skipMove(s));
    s = apply(s, nextQuestion(s));
    expect(parseCheckersResult(s.state.result).q).toBe(1);
    expect(s.state.stage).toBe("ready");
  });

  it("никто не ответил верно — хода нет; открытый ответ без регистра", () => {
    let s = session();
    s = apply(s, showQuestion(s, content, teams));
    s = apply(s, revealQuestion(s, content, [ans("W", 0, 0), ans("B", 0, 0)], teams));
    expect(parseCheckersResult(s.state.result).mover).toBeNull();
    expect(checkersPrimary(s, content)).toBe("next");
    s = apply(s, nextQuestion(s));
    s = apply(s, showQuestion(s, content, teams));
    s = apply(s, revealQuestion(s, content, [ans("W", s.state.step, "париж")], teams));
    expect(parseCheckersResult(s.state.result).mover).toBe("W");
    expect(checkersPrimary(s, content)).toBe("toMove");
  });

  it("взятие — очки команде, последняя шашка соперника — победа", () => {
    let s = session();
    s = apply(s, showQuestion(s, content, teams));
    // Подставим позицию: у чёрных одна шашка под боем.
    const r = parseCheckersResult(s.state.result);
    const b = ".".repeat(64).split("");
    b[40] = "w";
    b[33] = "b";
    s = { ...s, state: { ...s.state, result: { ...r, board: b.join("") } } };
    s = apply(s, revealQuestion(s, content, [ans("W", 0, 1)], teams));
    s = apply(s, toMove(s));
    s = apply(s, moveChange(s, [ans("W", 1, { path: [40, 26] })]) ?? {});
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
