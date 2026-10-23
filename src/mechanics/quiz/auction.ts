// «Аукцион» в квизе (решение владельца 23 октября 2026): заставка с темой → «Открыть ставки» (все ставят очки на
// телефонах) → «Ставки сделаны»: отвечает поставивший больше всех, при равных — жребий на экране зала (монетка,
// колесо фортуны или барабан, как в «Ставке на знания»), отвечает на своём телефоне → «Показать ответ»: верно +ставка,
// неверно или молчал −ставка. Ставок нет — вопрос для всех за очки вопроса. Весь аукцион — один шаг квиза: ставка и
// ответ — один документ ответа (`step_pid`); ответ пишется с новым стартом шага, поэтому сервер заменяет им ставку.
import { DRAW_MS, drawSlide, drawWinner, type DrawEffect } from "../../core/draw";
import type { Answer, Session, SessionChange } from "../../data/types";
import { DEFAULT_BET_TIME, type QuizQuestion } from "./content";
import { emptyResult, parseResult, type AuctionState } from "./logic";

/** Жребий докрутился и постоял — пульт убирает его сам (как в «Ставке на знания»). */
export const QUIZ_AUCTION_HOLD_MS = 4500;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Сколько может поставить участник: до своего счёта, у кого меньше — до очков вопроса. */
export function auctionMax(score: number, q: Pick<QuizQuestion, "points">): number {
  return Math.max(Math.floor(score), q.points, 1);
}

/** Ставка телефона: `{ bet }` — целое от 1. */
export function parseBet(value: unknown): number | null {
  const raw = asRecord(value).bet;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : null;
}

/** Ставки шага: свежие ставки телефонов поверх запомненных (после «Назад» к ставкам), не больше разрешённого. */
export function auctionBets(session: Session, q: QuizQuestion, answers: Answer[]): Array<{ pid: string; bet: number; at: number }> {
  const auction = parseResult(session.state.result).auction;
  const startedAt = session.state.startedAt;
  const out = new Map<string, { pid: string; bet: number; at: number }>();
  for (const [pid, bet] of Object.entries(auction?.bets ?? {})) out.set(pid, { pid, bet, at: 0 });
  for (const a of answers) {
    if (a.step !== session.state.step) continue;
    if (startedAt !== null && a.submittedAt !== null && a.submittedAt < startedAt) continue;
    const bet = parseBet(a.value);
    if (bet !== null) out.set(a.pid, { pid: a.pid, bet, at: a.submittedAt ?? 0 });
  }
  const list: Array<{ pid: string; bet: number; at: number }> = [];
  for (const b of out.values()) {
    // Участник, которого пульт ещё не внёс в таблицу, — со счётом 0.
    list.push({ ...b, bet: Math.min(b.bet, auctionMax(session.leaderboard[b.pid]?.score ?? 0, q)) });
  }
  return list;
}

const BETS: AuctionState = { phase: "bets", placed: [], bets: {}, who: null, bet: 0, tie: [] };

/** «Открыть ставки»: шаг открыт на время ставок, ставку можно поменять, пока идёт время. */
export function openBets(session: Session, q: QuizQuestion, carry: Record<string, unknown>, keep?: AuctionState): SessionChange {
  const auction: AuctionState = keep ? { ...BETS, bets: keep.bets, placed: Object.keys(keep.bets) } : BETS;
  return {
    state: {
      stage: "question",
      startedAt: "server",
      timeLimit: q.betTime ?? DEFAULT_BET_TIME,
      revealed: false,
      answered: 0,
      result: { ...emptyResult(), auction, changeable: true, ...carry },
    },
  };
}

/** Кто уже поставил — на экран (без сумм). null — записывать нечего. */
export function auctionSync(session: Session, q: QuizQuestion, answers: Answer[]): SessionChange | null {
  const result = parseResult(session.state.result);
  const auction = result.auction;
  if (session.state.stage !== "question" || auction?.phase !== "bets") return null;
  const placed = auctionBets(session, q, answers)
    .map((b) => b.pid)
    .sort();
  if (placed.length === auction.placed.length && placed.every((p, i) => auction.placed[i] === p)) return null;
  return { state: { result: { ...asRecord(session.state.result), auction: { ...auction, placed } } } };
}

export interface AuctionDraw {
  /** id слайда жребия (начинается с `auc`, чтобы пульт убрал его сам). */
  id: string;
  /** Часы сервера на пульте. */
  now: number;
  name: (pid: string) => string;
  effect: DrawEffect;
  /** Жребий: по умолчанию — случайный (crypto). */
  pick?: (pool: string[]) => string | null;
}

/**
 * «Ставки сделаны»: самая большая ставка отвечает (равные — жребий на экране), ставок нет — отвечают все за очки
 * вопроса. Новый старт шага: время ответа идёт заново, ответ заменяет на сервере ставку того же участника.
 */
export function closeBets(session: Session, q: QuizQuestion, answers: Answer[], draw?: AuctionDraw): SessionChange | null {
  const result = parseResult(session.state.result);
  if (session.state.stage !== "question" || result.auction?.phase !== "bets") return null;
  const bets = auctionBets(session, q, answers);
  const top = bets.reduce((m, b) => Math.max(m, b.bet), 0);
  const tied = bets.filter((b) => b.bet === top && top > 0).sort((a, b) => a.at - b.at || a.pid.localeCompare(b.pid));
  const saved: Record<string, number> = {};
  for (const b of bets) saved[b.pid] = b.bet;
  const { changeable: _c, auction: _a, ...rest } = asRecord(session.state.result);
  const base = { ...rest, ...emptyResult(), accepted: [] as string[] };
  if (tied.length === 0) {
    return {
      state: {
        startedAt: "server",
        timeLimit: q.timeLimit,
        answered: 0,
        result: { ...base, auction: { phase: "all", placed: [], bets: saved, who: null, bet: 0, tie: [] } satisfies AuctionState },
      },
    };
  }
  let who = tied[0]?.pid ?? null;
  const tie = tied.length > 1 ? tied.map((b) => b.pid) : [];
  if (tie.length > 1 && draw) who = (draw.pick ?? ((pool: string[]) => drawWinner(pool)))(tie) ?? who;
  if (!who) return null;
  const drawn = tie.length > 1 && Boolean(draw);
  const state: SessionChange["state"] = {
    startedAt: "server",
    // Пока крутится жребий, время ответа не тратится: к нему прибавлено время жребия.
    timeLimit: q.timeLimit + (drawn ? Math.ceil((DRAW_MS + QUIZ_AUCTION_HOLD_MS) / 1000) : 0),
    answered: 0,
    result: { ...base, auction: { phase: "answer", placed: [], bets: saved, who, bet: top, tie } satisfies AuctionState },
  };
  if (drawn && draw) {
    state.slide = drawSlide(
      draw.id,
      tie.map(draw.name),
      draw.name(who),
      draw.now,
      {
        spinEyebrow: "Аукцион · ставки равны",
        spinText: `Одинаковая ставка у ${tie.length}: по ${top} — жребий решит, кто отвечает`,
        doneEyebrow: "Аукцион разыгрывает",
        doneText: `Ставка ${top} · отвечает на вопрос`,
      },
      draw.effect,
    );
  }
  return { state };
}

/** Слайд жребия «Аукциона» на экране (его пульт убирает сам, «Назад» — тоже). */
export function isAuctionDraw(session: Pick<Session, "state">): boolean {
  const slide = session.state.slide;
  return slide?.kind === "draw" && slide.id.startsWith("auc");
}

/** «Назад» с ответа «Аукциона» — снова ставки (запомненные ставки возвращаются, время ставок заново). */
export function auctionBackToBets(session: Session, q: QuizQuestion, carry: Record<string, unknown>): SessionChange {
  const auction = parseResult(session.state.result).auction;
  const change = openBets(session, q, carry, auction);
  return { ...change, state: { ...change.state, ...(isAuctionDraw(session) ? { slide: null } : {}) } };
}
