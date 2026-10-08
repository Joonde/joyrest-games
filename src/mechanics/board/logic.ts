// Ход «Своей игры» на пульте — чистые функции (пульт пишет в базу, репетиция — в память).
//
// Этапы: `ready` — поле, ведущий касается клетки → `question` (кнопка «кто первый»; у «Кота в мешке»
// сначала ставки — свой шаг, потом вопрос — следующий шаг) → `reveal` (ответ, очки) → «К полю»: следующий
// шаг, клетка погасла. Все клетки сыграны — награждение (общий пьедестал).
import { leaderboardAdditions } from "../../core/leaderboard";
import { buzzOrder, buzzRight, buzzWrong, EMPTY_BUZZ, parseBuzz, syncBuzz, type BuzzState } from "../../core/buzz";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreContext, ScoreDelta, Step } from "../types";
import { allCells, findCell, type BoardCell, type BoardContent } from "./content";

export type BoardMode = "pick" | "bet" | "buzz";

/** Что было до «К полю» — «Назад» с поля вернёт ответ прошлой клетки. */
interface PrevPlay {
  cell: string;
  buzz: BuzzState;
  bets: Record<string, number>;
  fines: Record<string, number>;
  picker: string | null;
  catStep: boolean;
}

export interface BoardResult {
  /** Сыгранные клетки: на поле погасли. */
  opened: string[];
  /** Клетка, которая сейчас играет. */
  cell: string | null;
  /** Кто выбирает клетку (ответил верно последним). */
  picker: string | null;
  mode: BoardMode;
  buzz: BuzzState;
  /** «Кот в мешке»: ставки. */
  bets: Record<string, number>;
  /** Штрафы за неверные ответы в этой клетке (если включены). */
  fines: Record<string, number>;
  /** «Кот в мешке»: ставки — отдельный шаг перед вопросом. */
  catStep: boolean;
  /** «Повторить фрагмент» трека клетки. */
  replay: number;
  prev: PrevPlay | null;
}

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

function numbers(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(value))) if (ID.test(k) && typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(0, Math.round(v));
  return out;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && ID.test(v)))] : [];
}

function parsePrev(value: unknown): PrevPlay | null {
  const d = rec(value);
  if (typeof d.cell !== "string") return null;
  return {
    cell: d.cell,
    buzz: parseBuzz(d.buzz),
    bets: numbers(d.bets),
    fines: numbers(d.fines),
    picker: typeof d.picker === "string" && ID.test(d.picker) ? d.picker : null,
    catStep: d.catStep === true,
  };
}

export function parseBoardResult(raw: unknown): BoardResult {
  const d = rec(raw);
  const mode = d.mode === "bet" || d.mode === "buzz" ? d.mode : "pick";
  return {
    opened: strings(d.opened),
    cell: typeof d.cell === "string" && ID.test(d.cell) ? d.cell : null,
    picker: typeof d.picker === "string" && ID.test(d.picker) ? d.picker : null,
    mode,
    buzz: parseBuzz(d.buzz),
    bets: numbers(d.bets),
    fines: numbers(d.fines),
    catStep: d.catStep === true,
    replay: typeof d.replay === "number" ? d.replay : 0,
    prev: parsePrev(d.prev),
  };
}

function write(result: BoardResult): Record<string, unknown> {
  return { ...result };
}

// ---------------------------------------------------------------- шаги и очки (интерфейс механики)

export interface BoardStep extends Step {
  cell: BoardCell;
}

export function boardSteps(content: BoardContent): BoardStep[] {
  return allCells(content).map(({ cell }) => ({ id: cell.id, answerable: true, cell }));
}

/** Сколько можно поставить: свой счёт, но не меньше стоимости клетки (у кого мало очков — тоже играет). */
export function maxBet(score: number, cellPoints: number): number {
  return Math.max(0, Math.max(score, cellPoints));
}

/**
 * Очки клетки по итогу кнопки: верно ответившему — стоимость клетки; в «Коте в мешке» — его
 * ставка, а все остальные, кто ставил, свою ставку теряют.
 */
export function playDeltas(cell: BoardCell, result: Pick<BoardResult, "buzz" | "bets">): ScoreDelta[] {
  const winner = result.buzz.winner;
  if (cell.kind !== "cat") return winner ? [{ pid: winner, delta: cell.points }] : [];
  const out: ScoreDelta[] = [];
  for (const [pid, bet] of Object.entries(result.bets)) {
    if (bet <= 0) continue;
    out.push({ pid, delta: pid === winner ? bet : -bet });
  }
  return out;
}

export function score(step: BoardStep, _answers: Answer[], { state }: ScoreContext): ScoreDelta[] {
  return playDeltas(step.cell, parseBoardResult(state.result));
}

// ---------------------------------------------------------------- ход

export type BoardAction = "pick" | "toBuzz" | "reveal" | "toBoard" | "podium" | "podiumNext" | "finish";

export function allOpened(content: BoardContent, result: BoardResult): boolean {
  const total = allCells(content);
  return total.length > 0 && total.every(({ cell }) => result.opened.includes(cell.id) || cell.id === result.cell);
}

/** Главное действие пульта на этом этапе. */
export function boardPrimary(session: Session, content: BoardContent): BoardAction {
  const { stage } = session.state;
  const result = parseBoardResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (stage === "question") return result.mode === "bet" ? "toBuzz" : "reveal";
  if (stage === "reveal") {
    if (allOpened(content, result)) return hasPodium(session.leaderboard) ? "podium" : "finish";
    return "toBoard";
  }
  // Поле: ждём выбор клетки; если сыграно всё — награждение.
  const done = allCells(content).every(({ cell }) => result.opened.includes(cell.id));
  if (done && allCells(content).length > 0) return hasPodium(session.leaderboard) ? "podium" : "finish";
  return "pick";
}

/** Ведущий коснулся клетки: вопрос с кнопкой; у кота — сначала ставки. */
export function openCell(session: Session, content: BoardContent, cellId: string): SessionChange {
  const found = findCell(content, cellId);
  const result = parseBoardResult(session.state.result);
  if (!found || result.opened.includes(cellId)) return {};
  const cat = found.cell.kind === "cat";
  const next: BoardResult = { ...result, cell: cellId, mode: cat ? "bet" : "buzz", buzz: EMPTY_BUZZ, bets: {}, fines: {}, catStep: false, replay: 0 };
  return {
    state: {
      stage: "question",
      startedAt: "server",
      timeLimit: cat ? content.betTime : null,
      revealed: false,
      answered: 0,
      result: write(next),
    },
  };
}

/** Ставки на шаге кота: `{ bet: n }`, без отметки времени — не в счёт. */
export function collectBets(answers: Answer[], step: number): Record<string, number> {
  const bets: Record<string, number> = {};
  for (const a of answers) {
    if (a.step !== step) continue;
    const bet = rec(a.value).bet;
    if (typeof bet === "number" && Number.isFinite(bet) && bet > 0) bets[a.pid] = Math.round(bet);
  }
  return bets;
}

/**
 * «Кот в мешке»: ставки приняты — вопрос и кнопка на следующем шаге. Ставка не больше
 * допустимой (свой счёт или стоимость клетки).
 */
export function startCatQuestion(session: Session, content: BoardContent, answers: Answer[]): SessionChange {
  const result = parseBoardResult(session.state.result);
  const found = findCell(content, result.cell);
  if (!found) return {};
  const raw = collectBets(answers, session.state.step);
  const bets: Record<string, number> = {};
  for (const [pid, bet] of Object.entries(raw)) bets[pid] = Math.min(bet, maxBet(session.leaderboard[pid]?.score ?? 0, found.cell.points));
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: write({ ...result, mode: "buzz", buzz: EMPTY_BUZZ, bets, catStep: true }),
    },
  };
}

/** Свежие нажатия → у кого слово; null — записывать нечего. */
export function boardBuzzSync(session: Session, answers: Answer[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const result = parseBoardResult(session.state.result);
  if (result.mode !== "buzz") return null;
  // «Кот в мешке»: слово получают только сделавшие ставку.
  const order = buzzOrder(answers, session.state.step).filter((pid) => !result.catStep || (result.bets[pid] ?? 0) > 0);
  const next = syncBuzz(result.buzz, order);
  return next ? { state: { result: write({ ...result, buzz: next }) } } : null;
}

/** «Неверно»: слово следующему; при штрафе — минус стоимость клетки (не у кота: там своя ставка). */
export function boardWrong(session: Session, content: BoardContent): SessionChange {
  const result = parseBoardResult(session.state.result);
  const found = findCell(content, result.cell);
  const who = result.buzz.current;
  if (!who) return {};
  const fine = content.penalty && found && found.cell.kind !== "cat" ? found.cell.points : 0;
  const next: BoardResult = { ...result, buzz: buzzWrong(result.buzz), fines: fine > 0 ? { ...result.fines, [who]: fine } : result.fines };
  return fine > 0 ? { state: { result: write(next) }, addScore: { [who]: -fine } } : { state: { result: write(next) } };
}

/** Показать ответ: «Верно» (`right`) — победителю очки и право выбора; иначе — без победителя. */
export function boardReveal(session: Session, content: BoardContent, participants: Participant[], right: boolean): SessionChange {
  const result = parseBoardResult(session.state.result);
  const found = findCell(content, result.cell);
  if (!found) return {};
  const buzz = right ? buzzRight(result.buzz) : { ...result.buzz, current: null };
  const deltas = new Map(playDeltas(found.cell, { buzz, bets: result.bets }).map((d) => [d.pid, d.delta]));
  const board: Record<string, LeaderboardEntry> = { ...session.leaderboard, ...leaderboardAdditions(session.leaderboard, participants, session.playMode) };
  const leaderboard: Record<string, LeaderboardEntry> = {};
  for (const [pid, entry] of Object.entries(board)) {
    const delta = deltas.get(pid) ?? 0;
    if (delta === 0 && (entry.last ?? 0) === 0 && session.leaderboard[pid]) continue;
    leaderboard[pid] = { ...entry, score: entry.score + delta, last: delta };
  }
  return {
    state: { stage: "reveal", revealed: true, result: write({ ...result, buzz, picker: buzz.winner ?? result.picker }) },
    leaderboard,
  };
}

/** «К полю»: клетка погасла, следующий шаг. */
export function toBoard(session: Session): SessionChange {
  const result = parseBoardResult(session.state.result);
  if (!result.cell) return {};
  const prev: PrevPlay = { cell: result.cell, buzz: result.buzz, bets: result.bets, fines: result.fines, picker: result.picker, catStep: result.catStep };
  return {
    state: {
      step: session.state.step + 1,
      stage: "ready",
      startedAt: null,
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: write({ ...result, opened: [...result.opened, result.cell], cell: null, mode: "pick", buzz: EMPTY_BUZZ, bets: {}, fines: {}, catStep: false, replay: 0, prev }),
    },
  };
}

export function replayCell(session: Session): SessionChange {
  const result = parseBoardResult(session.state.result);
  return { state: { result: write({ ...result, replay: result.replay + 1 }) } };
}

export interface BoardBack {
  change: SessionChange;
  /** Шаги, ответы которых убрать. */
  clear?: number[];
}

/** «Назад» на один этап; null — назад некуда. */
export function boardBack(session: Session): BoardBack | null {
  const { stage, step } = session.state;
  const result = parseBoardResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "reveal") {
    // Снимаем очки клетки; слово снова у того, кто отвечал, — ведущий решит ещё раз.
    const leaderboard: Record<string, LeaderboardEntry> = {};
    for (const [pid, entry] of Object.entries(session.leaderboard)) if (entry.last) leaderboard[pid] = { ...entry, score: entry.score - entry.last, last: 0 };
    const buzz = result.buzz.winner ? { ...result.buzz, current: result.buzz.winner, winner: null } : result.buzz;
    return { change: { state: { stage: "question", revealed: false, result: write({ ...result, buzz, picker: result.prev?.picker ?? null }) }, leaderboard } };
  }
  if (stage === "question") {
    // Клетка закрывается без розыгрыша: штрафы возвращаются, ответы и ставки убираются.
    const refund: Record<string, number> = {};
    for (const [pid, fine] of Object.entries(result.fines)) refund[pid] = fine;
    const back = result.catStep ? step - 1 : step;
    const change: SessionChange = {
      state: { step: back, stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...result, cell: null, mode: "pick", buzz: EMPTY_BUZZ, bets: {}, fines: {}, catStep: false }) },
    };
    if (Object.keys(refund).length > 0) change.addScore = refund;
    return { change, clear: result.catStep ? [step - 1, step] : [step] };
  }
  // С поля — к ответу прошлой клетки (она снова «не сыграна», пока ведущий не вернётся к полю).
  const prev = result.prev;
  if (!prev || step === 0) return null;
  return {
    change: {
      state: {
        step: step - 1,
        stage: "reveal",
        revealed: true,
        result: write({ ...result, opened: result.opened.filter((c) => c !== prev.cell), cell: prev.cell, mode: "buzz", buzz: prev.buzz, bets: prev.bets, fines: prev.fines, picker: prev.picker, catStep: prev.catStep, prev: null }),
      },
    },
  };
}
