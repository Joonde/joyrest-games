import { describe, expect, it } from "vitest";
import { drawCaptionsOf, drawEffectOf, drawPool } from "../../core/draw";
import { applyChange, startState } from "../../core/session";
import type { Answer, Session } from "../../data/types";
import { auctionBets, auctionMax, auctionSync, closeBets, isAuctionDraw } from "./auction";
import { changeKind, createContent, DEFAULT_SETTINGS, drawEffectOfSettings, newQuestion, parseContent, type QuizContent, type QuizQuestion } from "./content";
import { actionLabel, back, nextQuestion, primaryAction, reveal, showQuestion, toggleAccepted } from "./flow";
import { parseImport } from "./importText";
import { isCorrect, parseResult, score, steps } from "./logic";
import { normalizeAnswer } from "./normalize";
import { validateQuestion } from "./validate";

function auctionQ(patch: Partial<QuizQuestion> = {}): QuizQuestion {
  return { ...newQuestion("auction"), id: "qa", text: "Год выхода «Титаника»?", options: ["1997", "1999"], correct: 0, topic: "Кино 90-х", points: 200, timeLimit: 30, betTime: 20, ...patch };
}

function session(scores: Record<string, number> = { a: 500, b: 100, c: 0 }): Session {
  const leaderboard: Session["leaderboard"] = {};
  for (const [pid, score] of Object.entries(scores)) leaderboard[pid] = { name: pid.toUpperCase(), kind: "player", score };
  return {
    id: "s",
    code: "1",
    hostId: "h",
    gameId: "g",
    gameTitle: "К",
    mechanic: "quiz",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: { ...startState(), phase: "playing" },
    leaderboard,
    createdAt: 0,
  } as Session;
}

const ans = (pid: string, value: unknown, at: number, step = 0): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: at });

const content = (q = auctionQ()): QuizContent => ({ questions: [q], settings: { ...DEFAULT_SETTINGS, drawEffect: "wheel" } });

describe("аукцион в квизе: содержимое", () => {
  it("новый вопрос — без отмеченного верного, тема и время ставок; разбор из базы", () => {
    const q = newQuestion("auction");
    expect(q).toMatchObject({ kind: "auction", correct: -1, topic: "", auctionAnswer: "choice", betTime: 30, points: 200 });
    const parsed = parseContent({ questions: [{ kind: "auction", topic: "  Кино  ", auctionAnswer: "open", betTime: 999, answers: ["Х"] }] }).questions[0];
    expect(parsed).toMatchObject({ kind: "auction", topic: "  Кино  ".replace(/\s+/g, " "), auctionAnswer: "open", betTime: 90 });
    expect(parseContent({ questions: [{ kind: "auction", auctionAnswer: "что-то" }] }).questions[0]?.auctionAnswer).toBe("choice");
  });

  it("эффект жребия: новые игры — колесо, старые — монетка", () => {
    expect(drawEffectOfSettings(createContent())).toBe("wheel");
    expect(drawEffectOfSettings(parseContent({ questions: [], settings: { intro: true } }))).toBe("coin");
    expect(drawEffectOfSettings(parseContent({ questions: [], settings: { drawEffect: "reel" } }))).toBe("reel");
  });

  it("смена вида: открытый → аукцион пишет ответ, варианты → аукцион с вариантами", () => {
    const open = changeKind({ ...newQuestion("open"), answers: ["Париж"] }, "auction");
    expect(open).toMatchObject({ auctionAnswer: "open", answers: ["Париж"] });
    expect(changeKind(newQuestion("choice"), "auction").auctionAnswer).toBe("choice");
  });

  it("проверка: нет верного варианта или ответа — ошибка, без темы — можно", () => {
    expect(validateQuestion(auctionQ({ topic: "" }))).toEqual([]);
    expect(validateQuestion(auctionQ({ correct: -1 })).map((e) => e.message)).toContain("Отметьте правильный вариант.");
    expect(validateQuestion(auctionQ({ auctionAnswer: "open", answers: [""] })).map((e) => e.message)).toContain("Добавьте хотя бы один верный ответ.");
  });

  it("импорт: «# Аукцион: тема» делает следующий вопрос аукционом", () => {
    const { questions } = parseImport("# Аукцион: Кино\nГод «Титаника»?\n- 1997 *\n- 1999\n\nОбычный?\n= да\n\n#аукцион\nСтолица?\n= Париж");
    expect(questions.map((x) => x.question.kind)).toEqual(["auction", "open", "auction"]);
    expect(questions[0]?.question).toMatchObject({ topic: "Кино", auctionAnswer: "choice", correct: 0 });
    expect(questions[2]?.question).toMatchObject({ topic: "", auctionAnswer: "open", answers: ["Париж"] });
    expect(questions.every((x) => x.problems.length === 0)).toBe(true);
  });
});

describe("аукцион в квизе: ход", () => {
  it("ставки → больше всех отвечает: верно +ставка; «Назад» возвращает ставки и очки", () => {
    const c = content();
    let s = session();
    expect(actionLabel(s, c, "show")).toBe("Открыть ставки");
    s = applyChange(s, showQuestion(s, c), 1000);
    expect(s.state).toMatchObject({ stage: "question", timeLimit: 20 });
    expect(parseResult(s.state.result).auction?.phase).toBe("bets");
    expect(actionLabel(s, c, primaryAction(s, c))).toBe("Ставки сделаны");
    // Ставка больше счёта — урезается до счёта; у кого меньше очков вопроса — до очков вопроса.
    const bets = [ans("a", { bet: 900 }, 1100), ans("b", { bet: 150 }, 1200), ans("c", { bet: 1000 }, 1300)];
    expect(auctionBets(s, c.questions[0]!, bets).map((b) => [b.pid, b.bet])).toEqual([
      ["a", 500],
      ["b", 150],
      ["c", 200],
    ]);
    expect(auctionMax(0, c.questions[0]!)).toBe(200);
    const sync = auctionSync(s, c.questions[0]!, bets);
    if (!sync) throw new Error("нет записи");
    s = applyChange(s, sync, 1400);
    expect(parseResult(s.state.result).auction?.placed).toEqual(["a", "b", "c"]);
    const close = closeBets(s, c.questions[0]!, bets);
    if (!close) throw new Error("нет записи");
    s = applyChange(s, close, 2000);
    const auction = parseResult(s.state.result).auction;
    expect(auction).toMatchObject({ phase: "answer", who: "a", bet: 500, tie: [] });
    expect(s.state).toMatchObject({ stage: "question", startedAt: 2000, timeLimit: 30 });
    expect(s.state.slide ?? null).toBeNull();
    // Ответ выигравшего (новее старта); старые ставки других — не ответы.
    const all = [ans("a", 0, 2500), ans("b", { bet: 150 }, 1200), ans("c", 0, 2600)];
    s = applyChange(s, reveal(s, c, all, []), 3000);
    expect(s.leaderboard.a).toMatchObject({ score: 1000, last: 500 });
    expect(s.leaderboard.c?.score).toBe(0);
    expect(parseResult(s.state.result).auction?.who).toBe("a");
    // Назад с ответа — очки сняты, снова вопрос того же отвечающего.
    let plan = back(s, c);
    if (!plan) throw new Error("назад");
    s = applyChange(s, plan.change, 3100);
    expect(s.leaderboard.a?.score).toBe(500);
    expect(parseResult(s.state.result).auction?.phase).toBe("answer");
    // Назад с вопроса — снова ставки, запомненные ставки на месте.
    plan = back(s, c);
    if (!plan) throw new Error("назад");
    expect(plan.clearAnswers).toBeUndefined();
    s = applyChange(s, plan.change, 3200);
    expect(parseResult(s.state.result).auction).toMatchObject({ phase: "bets", bets: { a: 500, b: 150, c: 200 } });
    expect(auctionBets(s, c.questions[0]!, []).length).toBe(3);
    // Назад со ставок — заставка, ответы шага стираются.
    plan = back(s, c);
    expect(plan?.clearAnswers).toBe(0);
  });

  it("неверно или молчал — минус ставка", () => {
    const c = content();
    let s = session();
    s = applyChange(s, showQuestion(s, c), 1000);
    s = applyChange(s, closeBets(s, c.questions[0]!, [ans("b", { bet: 100 }, 1100)])!, 2000);
    expect(score(steps(c)[0]!, [ans("b", 1, 2100)], { state: s.state })).toEqual([{ pid: "b", delta: -100 }]);
    expect(score(steps(c)[0]!, [], { state: s.state })).toEqual([{ pid: "b", delta: -100 }]);
    expect(score(steps(c)[0]!, [ans("b", { bet: 100 }, 1100)], { state: s.state })).toEqual([{ pid: "b", delta: -100 }]);
  });

  it("равные ставки — жребий на экране с подписями и эффектом, время ответа не тратится", () => {
    const c = content();
    let s = session({ a: 300, b: 300, c: 0 });
    s = applyChange(s, showQuestion(s, c), 1000);
    const bets = [ans("a", { bet: 300 }, 1100), ans("b", { bet: 300 }, 1200), ans("c", { bet: 50 }, 1300)];
    const close = closeBets(s, c.questions[0]!, bets, { id: "auc1", now: 5000, name: (pid) => pid.toUpperCase(), effect: "reel", pick: (pool) => pool[1] ?? null });
    if (!close) throw new Error("нет записи");
    s = applyChange(s, close, 5000);
    expect(parseResult(s.state.result).auction).toMatchObject({ phase: "answer", who: "b", bet: 300, tie: ["a", "b"] });
    expect(isAuctionDraw(s)).toBe(true);
    const slide = s.state.slide!;
    expect(slide.title).toBe("B");
    expect(drawPool(slide)).toEqual(["A", "B"]);
    expect(drawEffectOf(slide)).toBe("reel");
    expect(drawCaptionsOf(slide).spinText).toContain("Одинаковая ставка у 2: по 300");
    expect(s.state.timeLimit).toBeGreaterThan(30);
    // Назад с вопроса убирает жребий.
    const plan = back(s, c);
    s = applyChange(s, plan!.change, 6000);
    expect(s.state.slide ?? null).toBeNull();
  });

  it("ставок нет — отвечают все за очки вопроса", () => {
    const c = content(auctionQ({ auctionAnswer: "open", answers: ["1997"], options: [] }));
    let s = session();
    s = applyChange(s, showQuestion(s, c), 1000);
    s = applyChange(s, closeBets(s, c.questions[0]!, [])!, 2000);
    expect(parseResult(s.state.result).auction?.phase).toBe("all");
    // Опечатку засчитывает ведущий.
    s = applyChange(s, toggleAccepted(s, normalizeAnswer("1997г")), 2100);
    expect(parseResult(s.state.result).auction?.phase).toBe("all");
    s = applyChange(s, reveal(s, c, [ans("a", "1997", 2200), ans("b", "1997г", 2300), ans("c", "2000", 2400)], []), 3000);
    expect([s.leaderboard.a?.last ?? 0, s.leaderboard.b?.last ?? 0, s.leaderboard.c?.last ?? 0]).toEqual([200, 200, 0]);
  });

  it("заставка аукциона — даже без заставок вопросов; ответ по вариантам и по словам", () => {
    const c: QuizContent = { questions: [{ ...newQuestion("choice"), text: "1", options: ["a", "b"], correct: 0 }, auctionQ()], settings: { ...DEFAULT_SETTINGS, intro: false } };
    let s = session();
    expect(actionLabel(s, c, "next")).toBe("Аукцион");
    s = applyChange(s, nextQuestion(s, c), 1);
    expect(s.state.stage).toBe("ready");
    expect(isCorrect(auctionQ(), 0)).toBe(true);
    expect(isCorrect(auctionQ(), 1)).toBe(false);
    expect(isCorrect(auctionQ({ auctionAnswer: "open", answers: ["Париж"] }), "париж")).toBe(true);
  });
});
