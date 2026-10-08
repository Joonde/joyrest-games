import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session } from "../../data/types";
import { createBoard, findCell, parseBoard, resizeBoard, type BoardContent } from "./content";
import {
  boardBack,
  boardBuzzSync,
  boardPrimary,
  boardReveal,
  boardSteps,
  boardWrong,
  maxBet,
  openCell,
  parseBoardResult,
  playDeltas,
  startCatQuestion,
  toBoard,
} from "./logic";

function content(): BoardContent {
  const board = resizeBoard(createBoard(), 2, 2);
  const [a, b] = board.categories;
  if (!a || !b) throw new Error("поле");
  a.cells = a.cells.map((c, i) => ({ ...c, id: `a${i}`, text: "Вопрос", answer: "Ответ" }));
  b.cells = b.cells.map((c, i) => ({ ...c, id: `b${i}`, text: "Вопрос", answer: "Ответ", kind: i === 1 ? "cat" : "question" }));
  return { ...board, penalty: true };
}

const participants: Participant[] = ["p1", "p2", "p3"].map((id, i) => ({ id, name: `Игрок ${i + 1}`, kind: "player", teamId: null, captainUid: id, joinedAt: i }));

function session(): Session {
  return {
    id: "s",
    code: "123456",
    hostId: "h",
    gameId: "g",
    gameTitle: "",
    mechanic: "board",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: startState(),
    leaderboard: {
      p1: { name: "Игрок 1", kind: "player", score: 0 },
      p2: { name: "Игрок 2", kind: "player", score: 0 },
      p3: { name: "Игрок 3", kind: "player", score: 50 },
    },
    createdAt: 0,
  };
}

let time = 1000;
const press = (pid: string, step: number, at: number): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value: { buzz: true }, submittedAt: at });
const bet = (pid: string, step: number, value: number): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value: { bet: value }, submittedAt: 1 });
const apply = (s: Session, change: ReturnType<typeof openCell>) => applyChange(s, change, (time += 1000));

describe("Своя игра: поле", () => {
  it("разбор поля не бросает и сохраняет клетки; шаги — все клетки", () => {
    const c = content();
    expect(parseBoard(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(parseBoard(null).categories).toEqual([]);
    expect(boardSteps(c)).toHaveLength(4);
  });

  it("ставка — не больше своего счёта, но не меньше стоимости клетки", () => {
    expect(maxBet(0, 200)).toBe(200);
    expect(maxBet(700, 200)).toBe(700);
  });
});

describe("Своя игра: ход", () => {
  it("клетка → кнопка → «Неверно» (штраф) → слово второму → «Верно»; клетка гаснет, выбирает победитель", () => {
    const c = content();
    let s = session();
    expect(boardPrimary(s, c)).toBe("pick");
    s = apply(s, openCell(s, c, "a1"));
    expect(s.state.stage).toBe("question");
    expect(parseBoardResult(s.state.result).cell).toBe("a1");

    const answers = [press("p2", 0, 20), press("p1", 0, 10)];
    s = apply(s, boardBuzzSync(s, answers) ?? {});
    expect(parseBoardResult(s.state.result).buzz.current).toBe("p1");
    expect(boardBuzzSync(s, answers)).toBeNull();

    s = apply(s, boardWrong(s, c));
    const cell = findCell(c, "a1")?.cell;
    expect(s.leaderboard.p1?.score).toBe(-(cell?.points ?? 0));
    expect(parseBoardResult(s.state.result).buzz.current).toBe("p2");

    s = apply(s, boardReveal(s, c, participants, true));
    expect(s.leaderboard.p2?.score).toBe(cell?.points);
    expect(parseBoardResult(s.state.result).picker).toBe("p2");
    expect(boardPrimary(s, c)).toBe("toBoard");

    s = apply(s, toBoard(s));
    const r = parseBoardResult(s.state.result);
    expect(r.opened).toEqual(["a1"]);
    expect(r.cell).toBeNull();
    expect(s.state.step).toBe(1);
    // Сыгранную клетку не открыть второй раз.
    expect(openCell(s, c, "a1")).toEqual({});
  });

  it("«Назад» с поля возвращает прошлую клетку, с вопроса — закрывает её и возвращает штраф", () => {
    const c = content();
    let s = session();
    s = apply(s, openCell(s, c, "a0"));
    s = apply(s, boardBuzzSync(s, [press("p1", 0, 5)]) ?? {});
    s = apply(s, boardReveal(s, c, participants, true));
    s = apply(s, toBoard(s));
    const back = boardBack(s, c);
    expect(back).not.toBeNull();
    s = apply(s, back?.change ?? {});
    expect(s.state.stage).toBe("reveal");
    expect(parseBoardResult(s.state.result).opened).toEqual([]);
    expect(parseBoardResult(s.state.result).cell).toBe("a0");

    // С ответа — к вопросу: очки снимаются, слово снова у отвечавшего.
    s = apply(s, boardBack(s, c)?.change ?? {});
    expect(s.state.stage).toBe("question");
    expect(s.leaderboard.p1?.score).toBe(0);
    expect(parseBoardResult(s.state.result).buzz.current).toBe("p1");

    // Ошибка со штрафом, потом «Назад» с вопроса: штраф вернулся, клетка снова на поле.
    s = apply(s, boardWrong(s, c));
    expect(s.leaderboard.p1?.score).toBeLessThan(0);
    const closed = boardBack(s, c);
    expect(closed?.clear).toEqual([0]);
    s = apply(s, closed?.change ?? {});
    expect(s.leaderboard.p1?.score).toBe(0);
    expect(s.state.stage).toBe("ready");
    expect(parseBoardResult(s.state.result).cell).toBeNull();
  });

  it("«Кот в мешке»: ставки, кнопка; верный получает ставку, остальные ставившие теряют", () => {
    const c = content();
    let s = session();
    s = apply(s, openCell(s, c, "b1"));
    expect(parseBoardResult(s.state.result).mode).toBe("bet");
    expect(s.state.timeLimit).toBe(c.betTime);
    expect(boardPrimary(s, c)).toBe("toBuzz");

    const points = findCell(c, "b1")?.cell.points ?? 0;
    s = apply(s, startCatQuestion(s, c, [bet("p1", 0, 100), bet("p2", 0, 99999), bet("p3", 0, 30)]));
    const r = parseBoardResult(s.state.result);
    expect(s.state.step).toBe(1);
    expect(r.mode).toBe("buzz");
    expect(r.catStep).toBe(true);
    expect(r.bets).toEqual({ p1: 100, p2: points, p3: 30 });

    // Без ставки — слова нет; p3 ставил.
    expect(boardBuzzSync(s, [press("p9", 1, 1)])).toBeNull();
    s = apply(s, boardBuzzSync(s, [press("p9", 1, 1), press("p3", 1, 3)]) ?? {});
    expect(parseBoardResult(s.state.result).buzz.current).toBe("p3");
    // У кота неверный ответ не штрафуется отдельно: теряется ставка.
    expect(boardWrong(s, c).addScore).toBeUndefined();
    s = apply(s, boardReveal(s, c, participants, true));
    expect(s.leaderboard.p3?.score).toBe(80);
    expect(s.leaderboard.p1?.score).toBe(-100);
    expect(s.leaderboard.p2?.score).toBe(-points);

    // «Назад» с вопроса кота убирает и ставки, и нажатия (два шага).
    s = apply(s, boardBack(s, c)?.change ?? {});
    expect(boardBack(s, c)?.clear).toEqual([0, 1]);
  });

  it("никто не ответил: очков нет; все клетки сыграны — награждение", () => {
    const c = content();
    let s = session();
    for (const id of ["a0", "a1", "b0"]) {
      s = apply(s, openCell(s, c, id));
      s = apply(s, boardReveal(s, c, participants, false));
      s = apply(s, toBoard(s));
    }
    s = apply(s, openCell(s, c, "b1"));
    s = apply(s, startCatQuestion(s, c, [bet("p3", s.state.step, 10)]));
    s = apply(s, boardBuzzSync(s, [press("p3", s.state.step, 1)]) ?? {});
    s = apply(s, boardReveal(s, c, participants, true));
    // Последняя клетка: дальше — награждение (у p3 очки есть).
    expect(boardPrimary(s, c)).toBe("podium");
    expect(playDeltas(findCell(c, "a0")?.cell ?? c.categories[0]!.cells[0]!, { buzz: { order: [], current: null, out: [], winner: null }, bets: {} })).toEqual([]);
  });

  it("«Назад» через две клетки не даёт начислить очки дважды; право выбора возвращается", () => {
    const c = content();
    let s = session();
    const a = findCell(c, "a0")?.cell.points ?? 0;
    s = apply(s, openCell(s, c, "a0"));
    s = apply(s, boardBuzzSync(s, [press("p1", s.state.step, 1)]) ?? {});
    s = apply(s, boardReveal(s, c, participants, true));
    s = apply(s, toBoard(s));
    s = apply(s, openCell(s, c, "a1"));
    s = apply(s, boardBuzzSync(s, [press("p2", s.state.step, 1)]) ?? {});
    s = apply(s, boardReveal(s, c, participants, true));
    // Назад: ответ a1 → вопрос a1 → поле → ответ a0 → вопрос a0.
    for (let i = 0; i < 4; i++) s = apply(s, boardBack(s, c)?.change ?? {});
    expect(s.state.stage).toBe("question");
    expect(s.leaderboard.p1?.score).toBe(0);
    expect(s.leaderboard.p2?.score).toBe(0);
    s = apply(s, boardReveal(s, c, participants, true));
    expect(s.leaderboard.p1?.score).toBe(a);
  });
});
