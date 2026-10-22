import { describe, expect, it } from "vitest";
import type { Leaderboard } from "../data/types";
import { blockWinners, eveningTable, EVENING_MECHANIC, eveningScore, moveProgram, newProgram, nextBlockIndex, parseProgram, publicProgram } from "./program";

const blocks = [
  { title: "Квиз", mechanic: "quiz", snapshot: { content: { q: 1 } } },
  { title: "Ставка на знания", mechanic: "board", snapshot: { content: { b: 1 } } },
  { title: "Мафия", mechanic: "mafia", snapshot: { content: { m: 1 } } },
];

describe("мероприятие из блоков", () => {
  it("блок → перерыв → следующий блок → … → итоги: очки блока, общий счёт, победители", () => {
    let program = newProgram("Корпоратив", blocks);
    expect(program).toMatchObject({ at: "block", index: 0, results: [], totals: {} });

    // Блок 1: у Ани 300, у Бори 100, Вера вошла и без очков.
    const b1: Leaderboard = {
      a: { name: "Аня", kind: "player", score: 300, last: 100, roundBase: 200, move: 1 },
      b: { name: "Боря", kind: "player", score: 100 },
      c: { name: "Вера", kind: "player", score: 0 },
    };
    const toBreak = moveProgram(program, b1, "break", 0);
    expect(toBreak).not.toBeNull();
    if (!toBreak) return;
    expect(toBreak.mechanic).toBe(EVENING_MECHANIC);
    expect(toBreak.program).toMatchObject({ at: "break", index: 0, totals: { a: 300, b: 100, c: 0 } });
    // В перерыве таблица — общий счёт вечера, без служебных полей раунда.
    expect(toBreak.leaderboard.a).toEqual({ name: "Аня", kind: "player", score: 300 });
    const r1 = toBreak.program.results[0];
    expect(r1 && blockWinners(r1).map((w) => w.name)).toEqual(["Аня"]);
    expect(nextBlockIndex(toBreak.program)).toBe(1);
    // Повтор того же действия (второй пульт) ничего не делает.
    expect(moveProgram(toBreak.program, toBreak.leaderboard, "break", 0)).toBeNull();

    // Следующий блок: снимок второй игры, таблица с нуля, новый номер.
    const toNext = moveProgram(toBreak.program, toBreak.leaderboard, "next", 0);
    expect(toNext).toMatchObject({ mechanic: "board", snapshot: { content: { b: 1 } } });
    if (!toNext) return;
    expect(toNext.leaderboard.a?.score).toBe(0);
    expect(toNext.program).toMatchObject({ at: "block", index: 1 });
    expect(moveProgram(toNext.program, toNext.leaderboard, "next", 0)).toBeNull();
    program = toNext.program;

    // Во время блока 2 общий счёт = прошлые блоки + таблица.
    const b2: Leaderboard = { ...toNext.leaderboard, b: { name: "Боря", kind: "player", score: 400 }, d: { name: "Гена", kind: "player", score: 50 } };
    expect(eveningScore(program, "b", b2.b)).toBe(500);
    expect(eveningScore(program, "d", b2.d)).toBe(50);

    // Блок 2 закончен → перерыв, блок 3 — сразу «Итоги вечера» без мафии.
    const br2 = moveProgram(program, b2, "break", 1);
    if (!br2) throw new Error("нет перерыва");
    expect(br2.program.totals).toEqual({ a: 300, b: 500, c: 0, d: 50 });
    const fin = moveProgram(br2.program, br2.leaderboard, "final", 1);
    expect(fin?.program.at).toBe("final");
    expect(fin?.leaderboard.b?.score).toBe(500);
    expect(fin && nextBlockIndex(fin.program)).toBeNull();
    expect(fin && moveProgram(fin.program, fin.leaderboard, "next", 1)).toBeNull();
    // В конце — очки по блокам и общий счёт; несыгранный блок — null.
    if (!fin) return;
    expect(eveningTable(fin.program, fin.leaderboard).map((r) => [r.pid, r.place, r.blocks, r.total])).toEqual([
      ["b", 1, [100, 400, null], 500],
      ["a", 2, [300, 0, null], 300],
      ["d", 3, [0, 50, null], 50],
      ["c", 4, [0, 0, null], 0],
    ]);
  });

  it("последний блок сразу ведёт к итогам; ничья — несколько победителей; без очков — нет победителя", () => {
    const one = newProgram("Вечер", [blocks[0] as (typeof blocks)[number]]);
    const fin = moveProgram(one, { a: { name: "А", kind: "team", score: 10, colorIndex: 2 }, b: { name: "Б", kind: "team", score: 10 } }, "break", 0);
    expect(fin?.program.at).toBe("final");
    const r = fin?.program.results[0];
    expect(r && blockWinners(r).map((w) => w.pid).sort()).toEqual(["a", "b"]);
    expect(r?.board[0]?.colorIndex ?? r?.board[1]?.colorIndex).toBe(2);
    expect(blockWinners({ index: 0, title: "", board: [{ pid: "x", name: "X", score: 0 }] })).toEqual([]);
  });

  it("браузер получает программу без снимков; битые данные — без ошибок", () => {
    const stored = newProgram("Вечер", blocks);
    const pub = publicProgram(JSON.parse(JSON.stringify(stored)));
    expect(pub && "snapshots" in pub).toBe(false);
    expect(pub?.blocks.map((b) => b.mechanic)).toEqual(["quiz", "board", "mafia"]);
    expect(parseProgram(null)).toBeNull();
    expect(parseProgram({ blocks: [] })).toBeNull();
    expect(parseProgram({ blocks: [{ title: 5 }], at: "x", index: 99, totals: { a: "x" } })).toMatchObject({ at: "block", index: 0, totals: { a: 0 } });
  });
});
