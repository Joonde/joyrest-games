import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { createSurvival, newSurvivalRound, parseSurvival, parseSurvivalList, ticketAllowed, type SurvivalContent } from "./content";
import { DEMO_SURVIVAL } from "./demo";
import {
  afterAuction,
  betOf,
  closeBets,
  finishAuction,
  minBet,
  nextRound,
  openAuction,
  openBets,
  parseSurvivalResult,
  revealRound,
  showRound,
  startSurvival,
  survivalBack,
  survivalPrimary,
  toggleMark,
} from "./logic";
import { validateSurvival } from "./validate";

const teams: Participant[] = ["A", "B", "C"].map((id, i) => ({ id, name: `Команда ${id}`, kind: "team", teamId: null, captainUid: `u${id}`, joinedAt: i }));
const session = (): Session => ({ id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "survival", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: { ...startState(), stage: "ready" }, leaderboard: {}, createdAt: 0 });
let t = 1_000_000;
const apply = (s: Session, c: SessionChange | null) => applyChange(s, c ?? {}, (t += 1000));
const ans = (s: Session, pid: string, value: unknown, late = 10): Answer => ({ id: `${s.state.step}_${pid}`, step: s.state.step, pid, uid: `u${pid}`, value, submittedAt: (s.state.startedAt ?? 0) + late });

function game(): SurvivalContent {
  const c = createSurvival();
  c.rounds = c.rounds.map((r, i) => ({ ...r, kind: (i + 1) % 5 === 0 ? "choice" : i % 2 ? "task" : "choice", text: `Раунд ${i + 1}`, options: ["а", "б", "в", "г"], correct: 1, points: 100 }));
  return c;
}

function started() {
  const content = game();
  let s = session();
  expect(survivalPrimary(s, content)).toBe("start");
  s = apply(s, startSurvival(s, teams));
  return { s, content };
}

/** Пройти раунды до номера `n` (с 1), никому не начисляя. */
function skipTo(s: Session, content: SurvivalContent, n: number): Session {
  let cur = s;
  while (parseSurvivalResult(cur.state.result).round + 1 < n) {
    const a = survivalPrimary(cur, content);
    if (a === "auction") cur = apply(cur, openAuction(cur, content));
    else if (a === "auctionDone") cur = apply(cur, finishAuction(cur, [], teams));
    else if (a === "afterAuction") cur = apply(cur, afterAuction(cur));
    else if (a === "bets") cur = apply(cur, openBets(cur, content));
    else if (a === "betsDone") cur = apply(cur, closeBets(cur, content, [], teams));
    else if (a === "show") cur = apply(cur, showRound(cur, content, teams));
    else if (a === "reveal") cur = apply(cur, revealRound(cur, content, [], teams));
    else cur = apply(cur, nextRound(cur, content, teams));
  }
  return cur;
}

describe("Гонка на выживание: содержимое", () => {
  it("30 раундов, каждый 5-й — войнушка; билеты только после второй войнушки, не больше 3", () => {
    const c = createSurvival();
    expect(c.rounds).toHaveLength(30);
    expect(ticketAllowed(c, 10)).toBe(false);
    expect(ticketAllowed(c, 11)).toBe(true);
    expect(ticketAllowed(c, 15)).toBe(false);
    expect(parseSurvival({ ...c, tickets: [3, 11, 12, 13, 14, 15] }).tickets).toEqual([11, 12, 13]);
  });

  it("список: вопрос с вариантами, открытый, задание, очки", () => {
    const list = parseSurvivalList("Столица?\n- Рим\n* Париж\n- Берлин\n- Осло\n2+2? = 4 | четыре (50)\nЗадание: спойте гимн (200)");
    expect(list.map((r) => r.kind)).toEqual(["choice", "open", "task"]);
    expect(list[0]?.correct).toBe(1);
    expect(list[1]).toMatchObject({ answer: "4 | четыре", points: 50 });
    expect(list[2]?.points).toBe(200);
  });

  it("проверка: шаблон проходит, войнушка — только вопрос с вариантами", () => {
    expect(validateSurvival(DEMO_SURVIVAL)).toEqual([]);
    const bad = game();
    bad.rounds[4] = { ...newSurvivalRound("task"), text: "Танец" };
    expect(validateSurvival(bad).some((e) => e.message.includes("войнушка"))).toBe(true);
  });
});

describe("Гонка на выживание: ход", () => {
  it("вопрос: верно — очки раунда; задание — кому засчитал ведущий; «Назад» снимает", () => {
    let { s, content } = started();
    expect(survivalPrimary(s, content)).toBe("show");
    s = apply(s, showRound(s, content, teams));
    s = apply(s, revealRound(s, content, [ans(s, "A", { choice: 1 }), ans(s, "B", { choice: 0 })], teams));
    expect(s.leaderboard.A?.score).toBe(100);
    expect(s.leaderboard.B?.score).toBe(0);
    const back = survivalBack(s, content, teams);
    s = apply(s, back?.change ?? null);
    expect(s.leaderboard.A?.score).toBe(0);
    s = apply(s, revealRound(s, content, [ans(s, "A", { choice: 1 })], teams));
    s = apply(s, nextRound(s, content, teams));
    // Раунд 2 — задание.
    s = apply(s, showRound(s, content, teams));
    s = apply(s, toggleMark(s, "C"));
    s = apply(s, revealRound(s, content, [], teams));
    expect(s.leaderboard.C?.score).toBe(100);
  });

  it("войнушка: ставка не меньше половины, банк = ставки + приз, победитель — первый верный", () => {
    let { s, content } = started();
    s = skipTo(s, content, 5);
    // Счёт: A 400, B 200, C 0.
    s = { ...s, leaderboard: { ...s.leaderboard, A: { ...s.leaderboard.A!, score: 400 }, B: { ...s.leaderboard.B!, score: 200 } } };
    expect(survivalPrimary(s, content)).toBe("bets");
    s = apply(s, openBets(s, content));
    expect(parseSurvivalResult(s.state.result).prize).toBe(100);
    expect(minBet(201)).toBe(101);
    expect(betOf(400, { bet: 50 })).toBe(200);
    expect(betOf(400, { bet: 9999 })).toBe(400);
    s = apply(s, closeBets(s, content, [ans(s, "A", { bet: 300 })], teams));
    let r = parseSurvivalResult(s.state.result);
    expect(r.bets).toEqual({ A: 300, B: 100, C: 0 });
    expect(r.bank).toBe(500);
    // B ответил первым и верно, A — позже и верно.
    s = apply(s, revealRound(s, content, [ans(s, "A", { choice: 1 }, 50), ans(s, "B", { choice: 1 }, 20)], teams));
    r = parseSurvivalResult(s.state.result);
    expect(r.winner).toBe("B");
    expect(s.leaderboard.A?.score).toBe(100);
    expect(s.leaderboard.B?.score).toBe(600);
  });

  it("войнушка без верных — ставки сгорают; приз растёт: вторая — 200", () => {
    let { s, content } = started();
    s = skipTo(s, content, 10);
    s = { ...s, leaderboard: { ...s.leaderboard, A: { ...s.leaderboard.A!, score: 100 } } };
    s = apply(s, openBets(s, content));
    expect(parseSurvivalResult(s.state.result).prize).toBe(200);
    s = apply(s, closeBets(s, content, [], teams));
    s = apply(s, revealRound(s, content, [ans(s, "A", { choice: 0 })], teams));
    expect(s.leaderboard.A?.score).toBe(50);
  });

  it("аукцион билета: больше всех (при равных — раньше) платит и получает билет; билет освобождает от войнушки один раз", () => {
    let { s, content } = started();
    s = skipTo(s, content, 13);
    s = { ...s, leaderboard: { ...s.leaderboard, A: { ...s.leaderboard.A!, score: 500 }, B: { ...s.leaderboard.B!, score: 500 } } };
    expect(survivalPrimary(s, content)).toBe("auction");
    s = apply(s, openAuction(s, content));
    s = apply(s, finishAuction(s, [ans(s, "A", { bid: 200 }, 30), ans(s, "B", { bid: 200 }, 10), ans(s, "C", { bid: 999 })], teams));
    let r = parseSurvivalResult(s.state.result);
    // У C нет очков — ставка 0 не считается; B поставил раньше.
    expect(r.bid).toEqual({ pid: "B", amount: 200 });
    expect(r.tickets.B).toBe(1);
    expect(s.leaderboard.B?.score).toBe(300);
    s = apply(s, afterAuction(s));
    expect(survivalPrimary(s, content)).toBe("show");
    s = skipTo(s, content, 15);
    s = apply(s, openBets(s, content));
    // Билет без наличия не действует (A), у B — действует.
    s = apply(s, closeBets(s, content, [ans(s, "A", { ticket: true }), ans(s, "B", { ticket: true })], teams));
    r = parseSurvivalResult(s.state.result);
    expect(r.freed).toEqual(["B"]);
    expect(r.bets.B).toBeUndefined();
    expect(r.bets.A).toBe(250);
    expect(r.tickets.B).toBe(0);
    // «Назад» с вопроса войнушки — билет возвращается.
    s = apply(s, survivalBack(s, content, teams)?.change ?? null);
    expect(parseSurvivalResult(s.state.result).tickets.B).toBe(1);
  });

  it("после 30-го раунда — награждение, никто не выбывает", () => {
    let { s, content } = started();
    s = skipTo(s, content, 30);
    s = { ...s, leaderboard: { ...s.leaderboard, A: { ...s.leaderboard.A!, score: 10 } } };
    s = apply(s, openBets(s, content));
    s = apply(s, closeBets(s, content, [], teams));
    s = apply(s, revealRound(s, content, [ans(s, "A", { choice: 1 })], teams));
    s = apply(s, nextRound(s, content, teams));
    expect(parseSurvivalResult(s.state.result).phase).toBe("over");
    expect(survivalPrimary(s, content)).toBe("podium");
    expect(Object.keys(s.leaderboard)).toEqual(["A", "B", "C"]);
  });
});
