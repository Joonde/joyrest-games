import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { createBoard, findCell, parseBoard, resizeBoard, roundsOf, setRounds, type BoardContent } from "./content";
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
  nextRound,
  startAuction,
  maxBet,
  openCell,
  parseBoardResult,
  playDeltas,
  setCat,
  catGiveOf,
  startCatQuestion,
  toBoard,
} from "./logic";
import { DEMO_BOARD } from "./demo";
import { validateBoard } from "./validate";
import { parseShowLook, SHOW_LOOK_TITLES, SHOW_LOOKS, showStageClass } from "../showLook";

function content(): BoardContent {
  const board = resizeBoard(setRounds(createBoard(), 1), 2, 2);
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

describe("Ставка на знания: поле", () => {
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

describe("Ставка на знания: ход", () => {
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

  it("«Кот в мешке»: выбиравший отдаёт вопрос другому (ведущий может поправить и поставить цену); отвечает только он — верно плюс, неверно минус", () => {
    const c = content();
    let s = session();
    s = apply(s, openCell(s, c, "b1"));
    expect(parseBoardResult(s.state.result).mode).toBe("bet");
    expect(s.state.timeLimit).toBeNull();
    expect(boardPrimary(s, c)).toBe("toBuzz");
    expect(startCatQuestion(s, c)).toBeNull();
    // Выбиравший клетку отдаёт вопрос с телефона; себе — нельзя, ставок нет.
    const picked = { ...s, state: { ...s.state, result: { ...(s.state.result as object), pickerBefore: "p1" } } } as Session;
    const give = (to: string, at: number): Answer => ({ id: `0_p1_${at}`, step: 0, pid: "p1", uid: "p1", value: { give: to }, submittedAt: at });
    expect(catGiveOf(picked, [give("p1", 1)])).toBeNull();
    expect(catGiveOf(picked, [give("p2", 1), give("p3", 2)])).toBe("p3");
    expect(catGiveOf(picked, [{ ...give("p3", 1), pid: "p2" }])).toBeNull();
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

  it("раунды: поле раунда, «Следующий раунд» — дороже; «Назад» возвращает в прошлый раунд", () => {
    const base = content();
    expect(roundsOf(createBoard())).toBe(2);
    const two = resizeBoard(setRounds(base, 2), 2, 1);
    expect(roundsOf(two)).toBe(2);
    expect(two.categories.filter((c) => c.round === 2)[0]?.cells[0]?.points).toBe(200);
    const c: BoardContent = { ...two, categories: two.categories.map((cat) => ({ ...cat, cells: cat.cells.map((cell) => ({ ...cell, kind: "question" as const, text: "В", answer: "О" })) })) };
    let s = session();
    const r1 = c.categories.filter((cat) => cat.round === 1).flatMap((cat) => cat.cells.map((cell) => cell.id));
    for (const id of r1) {
      s = openArmed(s, c, id);
      s = apply(s, boardReveal(s, c, participants, false));
      if (id !== r1.at(-1)) s = apply(s, toBoard(s));
    }
    expect(boardPrimary(s, c)).toBe("nextRound");
    s = apply(s, nextRound(s, c));
    let r = parseBoardResult(s.state.result);
    expect(r.round).toBe(2);
    expect(s.state.stage).toBe("ready");
    expect(r.opened).toEqual(r1);
    expect(boardPrimary(s, c)).toBe("pick");
    s = apply(s, boardBack(s, c)?.change ?? null);
    r = parseBoardResult(s.state.result);
    expect(r.round).toBe(1);
    expect(s.state.stage).toBe("reveal");
  });

  it("аукцион: все ставят, отвечает поставивший больше (при равных — раньше); верно плюс, неверно минус", () => {
    const base = content();
    const c: BoardContent = { ...base, categories: base.categories.map((cat) => ({ ...cat, cells: cat.cells.map((cell) => (cell.id === "a1" ? { ...cell, kind: "auction" as const } : cell)) })) };
    let s = session();
    s = apply(s, openCell(s, c, "a1"));
    expect(parseBoardResult(s.state.result).mode).toBe("auction");
    expect(s.state.timeLimit).toBe(c.betTime);
    expect(boardPrimary(s, c)).toBe("auction");
    const points = findCell(c, "a1")?.cell.points ?? 0;
    const bid = (pid: string, value: number, at: number): Answer => ({ id: `0_${pid}`, step: 0, pid, uid: pid, value: { bet: value }, submittedAt: at });
    // У p1 счёт 0 — может поставить до стоимости клетки; p2 ставит столько же, но позже.
    s = apply(s, startAuction(s, c, [bid("p2", points, 9), bid("p1", 99999, 5), bid("p3", 10, 1)]));
    const r = parseBoardResult(s.state.result);
    expect(r).toMatchObject({ mode: "buzz", catStep: true, catTo: "p1", catPrice: points, bets: { p1: points } });
    expect(r.buzz.current).toBe("p1");
    s = apply(s, boardReveal(s, c, participants, true));
    expect(s.leaderboard.p1?.score).toBe(points);
    // Ставок нет — отвечает выбиравший клетку за её стоимость; некому — нельзя.
    const empty = apply(session(), openCell(session(), c, "a1"));
    expect(startAuction(empty, c, [])).toBeNull();
  });
});

describe("оформление экрана зала «Ставки на знания»", () => {
  it("старые игры без поля и неизвестные значения — «Классика», шаблон и новые игры — «Студия»", () => {
    const old: Record<string, unknown> = { ...createBoard() };
    delete old.look;
    expect(parseBoard(old).look).toBe("classic");
    expect(parseBoard({ ...old, look: "neon" }).look).toBe("classic");
    expect(parseBoard({ ...old, look: 3 }).look).toBe("classic");
    expect(parseBoard(null).look).toBe("classic");
    expect(parseBoard({ ...old, look: "studio" }).look).toBe("studio");
    expect(parseBoard({ ...old, look: "evening" }).look).toBe("evening");
    expect(parseBoard({ ...old, look: "table" }).look).toBe("table");
    expect(createBoard().look).toBe("table");
    const demo = parseBoard(DEMO_BOARD.content);
    expect(demo.look).toBe("table");
    expect(validateBoard(demo)).toEqual([]);
    for (const look of SHOW_LOOKS) expect(validateBoard({ ...demo, look })).toEqual([]);
  });

  it("класс экрана: «Классика» — без изменений, остальные — фон и плашки телешоу", () => {
    expect(showStageClass("classic")).toBe("");
    expect(showStageClass("studio")).toBe(" show-stage show-stage--studio");
    expect(showStageClass("evening")).toBe(" show-stage show-stage--evening");
    expect(SHOW_LOOKS.map((l) => SHOW_LOOK_TITLES[l])).toEqual(["Классика", "Студия", "Вечер JoyRest"]);
    expect(parseShowLook(undefined)).toBe("classic");
  });
});

describe("«Ставка на знания»: пока отвечают — время и трек замирают", () => {
  it("«Неверно» — отсчёт продолжается с того места, где нажали, кнопки снова открыты", () => {
    const c = content();
    let s = openArmed(session(), c, "a0");
    const start = s.state.startedAt ?? 0;
    expect(s.state.timeLimit).toBe(c.buzzTime);
    // Нажал через 3 с после отсчёта — время на этом месте замирает.
    s = apply(s, boardBuzzSync(s, [press("p1", s.state.step, start + 3000)], start + 3100));
    expect(parseBoardResult(s.state.result).pausedAt).toBe(start + 3000);
    // Отвечал 40 с (таймер давно бы вышел) — ведущий «Неверно»: к таймеру прибавились те 40 с.
    s = apply(s, boardWrong(s, c, start + 43000));
    const r = parseBoardResult(s.state.result);
    expect(r.buzz.current).toBeNull();
    expect(r.buzz.out).toEqual(["p1"]);
    expect(r.pausedAt).toBeNull();
    expect(s.state.timeLimit).toBe(c.buzzTime + 40);
    // Осталось столько же, сколько было в момент нажатия.
    expect((s.state.startedAt ?? 0) + (s.state.timeLimit ?? 0) * 1000 - (start + 43000)).toBe((c.buzzTime - 3) * 1000);
  });

  it("нажал в последнюю секунду — остальным всё равно не меньше 5 секунд; очередь — время стоит дальше", () => {
    const c = content();
    let s = openArmed(session(), c, "a0");
    const start = s.state.startedAt ?? 0;
    const late = start + c.buzzTime * 1000 + 2000;
    s = apply(s, boardBuzzSync(s, [press("p1", s.state.step, late), press("p2", s.state.step, late + 100)], late));
    s = apply(s, boardWrong(s, c, late + 10_000));
    // Слово перешло к p2 из очереди — таймер не трогаем, он всё ещё стоит.
    expect(parseBoardResult(s.state.result).buzz.current).toBe("p2");
    expect(s.state.timeLimit).toBe(c.buzzTime);
    expect(parseBoardResult(s.state.result).pausedAt).toBe(late);
    s = apply(s, boardWrong(s, c, late + 20_000));
    const deadline = (s.state.startedAt ?? 0) + (s.state.timeLimit ?? 0) * 1000;
    expect(deadline - (late + 20_000)).toBeGreaterThanOrEqual(5000);
  });
});
