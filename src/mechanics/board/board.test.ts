import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { createBoard, findCell, parseBoard, resizeBoard, type BoardContent } from "./content";
import {
  armBuzz,
  boardBack,
  boardFirstTurn,
  boardBuzzSync,
  boardPrimary,
  boardReveal,
  boardSteps,
  boardWrong,
  CAT_MAX,
  maxBet,
  openCell,
  parseBoardResult,
  playDeltas,
  setCat,
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
const apply = (s: Session, change: SessionChange | null) => applyChange(s, change ?? {}, (time += 1000));
/** Открыть клетку и сразу «Запустить отсчёт» (ведущий прочитал вопрос). */
const openArmed = (s: Session, c: BoardContent, id: string) => {
  const opened = apply(s, openCell(s, c, id));
  return parseBoardResult(opened.state.result).mode === "buzz" ? apply(opened, armBuzz(opened, c)) : opened;
};

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
    // Ведущий читает вопрос: кнопка не активна, фальстарт не считается.
    expect(boardPrimary(s, c)).toBe("arm");
    expect(boardBuzzSync(s, [press("p3", 0, 1)])).toBeNull();
    s = apply(s, armBuzz(s, c));
    expect(s.state.step).toBe(1);
    expect(s.state.timeLimit).toBe(c.buzzTime);
    expect(boardPrimary(s, c)).toBe("reveal");

    const answers = [press("p2", 1, 20), press("p1", 1, 10)];
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
    expect(s.state.step).toBe(2);
    // Сыгранную клетку не открыть второй раз.
    expect(openCell(s, c, "a1")).toEqual({});
  });

  it("«Назад» с поля возвращает прошлую клетку, с вопроса — закрывает её и возвращает штраф", () => {
    const c = content();
    let s = session();
    s = openArmed(s, c, "a0");
    s = apply(s, boardBuzzSync(s, [press("p1", 1, 5)]) ?? {});
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
    // Все шаги клетки: вопрос и отсчёт.
    expect(closed?.clear).toEqual([0, 1]);
    s = apply(s, closed?.change ?? {});
    expect(s.leaderboard.p1?.score).toBe(0);
    expect(s.state.stage).toBe("ready");
    expect(parseBoardResult(s.state.result).cell).toBeNull();
  });

  it("«Кот в мешке»: ведущий отдаёт вопрос одному и ставит цену; отвечает только он — верно плюс, неверно минус", () => {
    const c = content();
    let s = session();
    s = apply(s, openCell(s, c, "b1"));
    expect(parseBoardResult(s.state.result).mode).toBe("bet");
    expect(s.state.timeLimit).toBeNull();
    expect(boardPrimary(s, c)).toBe("toBuzz");
    expect(startCatQuestion(s, c)).toBeNull();
    s = apply(s, setCat(s, "p3", 99999));
    expect(parseBoardResult(s.state.result).catPrice).toBe(CAT_MAX);
    s = apply(s, setCat(s, "p3", 250));
    s = apply(s, startCatQuestion(s, c));
    const r = parseBoardResult(s.state.result);
    expect(s.state.step).toBe(1);
    expect(r).toMatchObject({ mode: "buzz", catStep: true, armed: true, bets: { p3: 250 } });
    expect(r.buzz.current).toBe("p3");
    // Никто другой слово не перехватит.
    expect(boardBuzzSync(s, [press("p9", 1, 1)])).toBeNull();
    // Неверно — минус цена.
    const wrong = apply(s, boardReveal(s, c, participants, false));
    // У p3 было 50.
    expect(wrong.leaderboard.p3?.score).toBe(-200);
    s = apply(s, boardReveal(s, c, participants, true));
    expect(s.leaderboard.p3?.score).toBe(300);
    expect(parseBoardResult(s.state.result).picker).toBe("p3");
    // «Назад» с вопроса кота убирает оба шага клетки.
    s = apply(s, boardBack(s, c)?.change ?? null);
    expect(boardBack(s, c)?.clear).toEqual([0, 1]);
  });

  it("жеребьёвка даёт право выбрать первую клетку — только пока на экране поле", () => {
    const c = content();
    let s = session();
    s = apply(s, boardFirstTurn(s, "p2"));
    expect(parseBoardResult(s.state.result).picker).toBe("p2");
    s = apply(s, openCell(s, c, "a0"));
    expect(boardFirstTurn(s, "p1")).toBeNull();
  });

  it("никто не ответил: очков нет; все клетки сыграны — награждение", () => {
    const c = content();
    let s = session();
    for (const id of ["a0", "a1", "b0"]) {
      s = openArmed(s, c, id);
      s = apply(s, boardReveal(s, c, participants, false));
      s = apply(s, toBoard(s));
    }
    s = apply(s, openCell(s, c, "b1"));
    s = apply(s, setCat(s, "p3", 10));
    s = apply(s, startCatQuestion(s, c));
    s = apply(s, boardReveal(s, c, participants, true));
    // Последняя клетка: дальше — награждение (у p3 очки есть).
    expect(boardPrimary(s, c)).toBe("podium");
    expect(playDeltas(findCell(c, "a0")?.cell ?? c.categories[0]!.cells[0]!, { buzz: { order: [], current: null, out: [], winner: null }, bets: {} })).toEqual([]);
  });

  it("«Назад» через две клетки не даёт начислить очки дважды; право выбора возвращается", () => {
    const c = content();
    let s = session();
    const a = findCell(c, "a0")?.cell.points ?? 0;
    s = openArmed(s, c, "a0");
    s = apply(s, boardBuzzSync(s, [press("p1", s.state.step, 1)]) ?? {});
    s = apply(s, boardReveal(s, c, participants, true));
    s = apply(s, toBoard(s));
    s = openArmed(s, c, "a1");
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
