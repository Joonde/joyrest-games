// Ход «Своей игры» на пульте — чистые функции (пульт пишет в базу, репетиция — в память).
//
// Этапы: `ready` — поле, ведущий касается клетки → `question`: вопрос на экране, ведущий его читает, кнопки
// гостей ещё не активны (без фальстарта) → «Запустить отсчёт» (`armed`, новый шаг: нажатия до него не
// считаются, время — `content.buzzTime`) → кнопка «кто первый» (у «Кота в мешке» сначала ставки — свой шаг)
// → `reveal` (ответ, очки) → «К полю»: следующий шаг, клетка погасла. Все клетки сыграны — награждение.
import { leaderboardAdditions } from "../../core/leaderboard";
import { buzzOrder, buzzRight, buzzWrong, EMPTY_BUZZ, parseBuzz, syncBuzz, type BuzzState } from "../../core/buzz";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreContext, ScoreDelta, Step } from "../types";
import { allCells, findCell, roundsOf, type BoardCell, type BoardContent } from "./content";

/** pick — поле; bet — «Кот в мешке» (ведущий отдаёт вопрос); auction — ставки «Аукциона»; buzz — вопрос. */
export type BoardMode = "pick" | "bet" | "auction" | "buzz";

/** Что было до «К полю» — «Назад» с поля вернёт ответ прошлой клетки. */
interface PrevPlay {
  cell: string;
  buzz: BuzzState;
  bets: Record<string, number>;
  fines: Record<string, number>;
  picker: string | null;
  catStep: boolean;
  /** Кто выбирал до розыгрыша этой клетки — «Назад» с ответа возвращает право выбора ему. */
  pickerBefore: string | null;
  /** Шаг, на котором открыли клетку (её шаги убирает «Назад»). */
  openStep: number | null;
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
  /** Кто выбирал клетку до её розыгрыша. */
  pickerBefore: string | null;
  prev: PrevPlay | null;
  /** Ведущий дочитал вопрос и запустил отсчёт: кнопки гостей активны. */
  armed: boolean;
  /** Шаг, на котором клетку открыли («Назад» с вопроса возвращает к нему и чистит все шаги клетки). */
  openStep: number | null;
  /** «Кот в мешке»: кому ведущий отдал вопрос (отвечает только он, увернуться нельзя) и его цена. */
  catTo: string | null;
  catPrice: number;
  /** Текущий раунд (1–3). */
  round: number;
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
    pickerBefore: typeof d.pickerBefore === "string" && ID.test(d.pickerBefore) ? d.pickerBefore : null,
    openStep: typeof d.openStep === "number" && Number.isInteger(d.openStep) && d.openStep >= 0 ? d.openStep : null,
  };
}

export function parseBoardResult(raw: unknown): BoardResult {
  const d = rec(raw);
  const mode = d.mode === "bet" || d.mode === "buzz" || d.mode === "auction" ? d.mode : "pick";
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
    pickerBefore: typeof d.pickerBefore === "string" && ID.test(d.pickerBefore) ? d.pickerBefore : null,
    prev: parsePrev(d.prev),
    armed: d.armed === true,
    openStep: typeof d.openStep === "number" && Number.isInteger(d.openStep) && d.openStep >= 0 ? d.openStep : null,
    catTo: typeof d.catTo === "string" && ID.test(d.catTo) ? d.catTo : null,
    catPrice: typeof d.catPrice === "number" && Number.isFinite(d.catPrice) ? Math.min(CAT_MAX, Math.max(1, Math.round(d.catPrice))) : 0,
    round: typeof d.round === "number" && Number.isInteger(d.round) && d.round >= 1 && d.round <= 3 ? d.round : 1,
  };
}

/** Цена «Кота в мешке» — от 1 до стольки очков. */
export const CAT_MAX = 5000;

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

export type BoardAction = "pick" | "toBuzz" | "auction" | "arm" | "reveal" | "toBoard" | "nextRound" | "podium" | "podiumNext" | "finish";

/** Клетки раунда. */
export function roundCells(content: BoardContent, round: number) {
  return allCells(content).filter(({ category }) => category.round === round);
}

/** Сыграно всё поле текущего раунда (играющая сейчас клетка считается сыгранной). */
export function allOpened(content: BoardContent, result: BoardResult): boolean {
  const total = roundCells(content, result.round);
  return total.length > 0 && total.every(({ cell }) => result.opened.includes(cell.id) || cell.id === result.cell);
}

/** Есть ли следующий раунд с клетками. */
export function hasNextRound(content: BoardContent, result: BoardResult): boolean {
  for (let r = result.round + 1; r <= roundsOf(content); r++) if (roundCells(content, r).length > 0) return true;
  return false;
}

/** Главное действие пульта на этом этапе. */
export function boardPrimary(session: Session, content: BoardContent): BoardAction {
  const { stage } = session.state;
  const result = parseBoardResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (stage === "question") return result.mode === "bet" ? "toBuzz" : result.mode === "auction" ? "auction" : result.armed ? "reveal" : "arm";
  if (stage === "reveal") {
    if (allOpened(content, result)) return hasNextRound(content, result) ? "nextRound" : hasPodium(session.leaderboard) ? "podium" : "finish";
    return "toBoard";
  }
  // Поле: ждём выбор клетки; если сыграно всё поле раунда — следующий раунд или награждение.
  const cells = roundCells(content, result.round);
  const done = cells.every(({ cell }) => result.opened.includes(cell.id));
  if (done && cells.length > 0) return hasNextRound(content, result) ? "nextRound" : hasPodium(session.leaderboard) ? "podium" : "finish";
  return "pick";
}

/** Ведущий коснулся клетки: вопрос (кнопки откроет «Запустить отсчёт»); у кота — сначала выбор, кому он достаётся. */
export function openCell(session: Session, content: BoardContent, cellId: string): SessionChange {
  const found = findCell(content, cellId);
  const result = parseBoardResult(session.state.result);
  if (!found || result.opened.includes(cellId)) return {};
  const cat = found.cell.kind === "cat";
  const auction = found.cell.kind === "auction";
  const next: BoardResult = { ...result, cell: cellId, mode: cat ? "bet" : auction ? "auction" : "buzz", buzz: EMPTY_BUZZ, bets: {}, fines: {}, catStep: false, replay: 0, pickerBefore: result.picker, armed: false, openStep: session.state.step, catTo: null, catPrice: found.cell.points };
  return {
    state: {
      stage: "question",
      startedAt: "server",
      timeLimit: auction ? content.betTime : null,
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

/** «Кот в мешке»: ведущий выбирает, кому отдать вопрос, и ставит его цену. */
export function setCat(session: Session, to: string | null, price: number): SessionChange {
  const result = parseBoardResult(session.state.result);
  const catPrice = Math.min(CAT_MAX, Math.max(1, Math.round(Number.isFinite(price) ? price : 1)));
  return { state: { result: write({ ...result, catTo: to, catPrice }) } };
}

/**
 * «Кот в мешке»: вопрос тому, кому его отдали, — отвечает только он (кнопка не нужна, увернуться нельзя).
 * Верно — плюс цена и право выбора, неверно — минус цена.
 */
export function startCatQuestion(session: Session, content: BoardContent): SessionChange | null {
  const result = parseBoardResult(session.state.result);
  const found = findCell(content, result.cell);
  if (!found || !result.catTo) return null;
  const price = result.catPrice > 0 ? result.catPrice : found.cell.points;
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: write({ ...result, mode: "buzz", buzz: { order: [result.catTo], current: result.catTo, out: [], winner: null }, bets: { [result.catTo]: price }, catStep: true, armed: true }),
    },
  };
}

/**
 * «Аукцион»: ставки сделаны — вопрос тому, кто поставил больше всех (при равных — кто раньше). Ставка — от
 * 1 до своего счёта (у кого меньше стоимости клетки — до стоимости). Отвечает только он: верно — плюс
 * ставка и право выбора, неверно — минус ставка. Ставок нет — отвечает выбиравший клетку за её стоимость.
 */
export function startAuction(session: Session, content: BoardContent, answers: Answer[]): SessionChange | null {
  const result = parseBoardResult(session.state.result);
  const found = findCell(content, result.cell);
  if (!found || result.mode !== "auction") return null;
  let best: { pid: string; bet: number; at: number } | null = null;
  for (const a of answers) {
    if (a.step !== session.state.step) continue;
    const raw = rec(a.value).bet;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue;
    const bet = Math.min(Math.round(raw), maxBet(session.leaderboard[a.pid]?.score ?? 0, found.cell.points));
    const at = a.submittedAt ?? Number.MAX_SAFE_INTEGER;
    if (!best || bet > best.bet || (bet === best.bet && at < best.at)) best = { pid: a.pid, bet, at };
  }
  const who = best?.pid ?? result.pickerBefore;
  if (!who) return null;
  const price = best?.bet ?? found.cell.points;
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: write({ ...result, mode: "buzz", buzz: { order: [who], current: who, out: [], winner: null }, bets: { [who]: price }, catStep: true, armed: true, catTo: who, catPrice: price }),
    },
  };
}

/** Раунд кончился: клетка гаснет, на экране — поле следующего раунда (дороже). */
export function nextRound(session: Session, content: BoardContent): SessionChange | null {
  const result = parseBoardResult(session.state.result);
  if (!hasNextRound(content, result)) return null;
  const base = session.state.stage === "reveal" && result.cell ? toBoard(session) : null;
  const after = base ? parseBoardResult(base.state?.result) : result;
  let round = result.round + 1;
  while (round < 3 && roundCells(content, round).length === 0) round++;
  return {
    state: { ...(base?.state ?? {}), step: session.state.step + 1, stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...after, round }) },
  };
}

/**
 * «Запустить отсчёт»: ведущий дочитал вопрос — кнопки активны на `content.buzzTime` секунд. Новый шаг:
 * нажатия, сделанные до отсчёта (фальстарт), не считаются.
 */
export function armBuzz(session: Session, content: BoardContent): SessionChange | null {
  const result = parseBoardResult(session.state.result);
  if (session.state.stage !== "question" || result.mode !== "buzz" || result.armed) return null;
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: content.buzzTime,
      revealed: false,
      answered: 0,
      result: write({ ...result, buzz: EMPTY_BUZZ, armed: true }),
    },
  };
}

/** Свежие нажатия → у кого слово; null — записывать нечего. */
export function boardBuzzSync(session: Session, answers: Answer[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const result = parseBoardResult(session.state.result);
  if (result.mode !== "buzz" || !result.armed) return null;
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
  const prev: PrevPlay = { cell: result.cell, buzz: result.buzz, bets: result.bets, fines: result.fines, picker: result.picker, catStep: result.catStep, pickerBefore: result.pickerBefore, openStep: result.openStep };
  return {
    state: {
      step: session.state.step + 1,
      stage: "ready",
      startedAt: null,
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: write({ ...result, opened: [...result.opened, result.cell], cell: null, mode: "pick", buzz: EMPTY_BUZZ, bets: {}, fines: {}, catStep: false, replay: 0, prev, armed: false, openStep: null, catTo: null, catPrice: 0 }),
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
export function boardBack(session: Session, content: BoardContent): BoardBack | null {
  const { stage, step } = session.state;
  const result = parseBoardResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "reveal") {
    // Снимаем ровно очки этой клетки (по её итогу, а не по «last»: его перепишет следующая клетка);
    // слово снова у того, кто отвечал, — ведущий решит ещё раз.
    const found = findCell(content, result.cell);
    const minus: Record<string, number> = {};
    if (found) for (const d of playDeltas(found.cell, result)) if (d.delta !== 0) minus[d.pid] = -d.delta;
    const buzz = result.buzz.winner ? { ...result.buzz, current: result.buzz.winner, winner: null } : result.buzz;
    const change: SessionChange = { state: { stage: "question", revealed: false, result: write({ ...result, buzz, picker: result.pickerBefore }) } };
    if (Object.keys(minus).length > 0) change.addScore = minus;
    return { change };
  }
  if (stage === "question") {
    // Клетка закрывается без розыгрыша: штрафы возвращаются, ответы и ставки убираются.
    const refund: Record<string, number> = {};
    for (const [pid, fine] of Object.entries(result.fines)) refund[pid] = fine;
    // Все шаги клетки (ставки, вопрос, отсчёт) убираются — назад к полю на шаг, где клетку открыли.
    const back = result.openStep !== null && result.openStep <= step ? result.openStep : result.catStep ? step - 1 : step;
    const change: SessionChange = {
      state: { step: back, stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...result, cell: null, mode: "pick", buzz: EMPTY_BUZZ, bets: {}, fines: {}, catStep: false, armed: false, openStep: null, catTo: null, catPrice: 0 }) },
    };
    if (Object.keys(refund).length > 0) change.addScore = refund;
    return { change, clear: Array.from({ length: step - back + 1 }, (_, i) => back + i) };
  }
  // С поля — к ответу прошлой клетки (она снова «не сыграна», пока ведущий не вернётся к полю).
  const prev = result.prev;
  if (!prev || step === 0) return null;
  // Назад через начало раунда — к прошлому раунду (раунд клетки).
  const prevRound = findCell(content, prev.cell)?.category.round ?? result.round;
  return {
    change: {
      state: {
        step: step - 1,
        stage: "reveal",
        revealed: true,
        result: write({ ...result, opened: result.opened.filter((c) => c !== prev.cell), cell: prev.cell, mode: "buzz", buzz: prev.buzz, bets: prev.bets, fines: prev.fines, picker: prev.picker, pickerBefore: prev.pickerBefore, catStep: prev.catStep, prev: null, armed: true, openStep: prev.openStep, round: prevRound }),
      },
    },
  };
}

/** Жеребьёвка выбрала участника — у него право выбрать первую клетку (только пока на экране поле). */
export function boardFirstTurn(session: Session, pid: string): SessionChange | null {
  if (session.state.phase !== "playing" || session.state.stage !== "ready") return null;
  const result = parseBoardResult(session.state.result);
  return { state: { result: write({ ...result, picker: pid }) } };
}
