// Музыкальное лото: карточки игроков, проверка «Лото!», очки и ход игры на пульте. Чистые функции:
// пульт отправляет результат в базу, репетиция и тесты применяют его в памяти.
import { leaderboardAdditions } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreContext, ScoreDelta, Step } from "../types";
import { cardCells, type LottoContent, type LottoSong, type WinRule } from "./content";

/** Шаг лото — одна песня; на шаге принимаются заявки «Лото!». */
export interface LottoStep extends Step {
  song: LottoSong;
  index: number;
  /** Игра целиком: проверке заявки нужны карточки и уже сыгранные песни. */
  content: LottoContent;
}

export function lottoSteps(content: LottoContent): LottoStep[] {
  return content.songs.map((song, index) => ({ id: song.id, answerable: true, song, index, content }));
}

// ---------------------------------------------------------------- карточки

/** FNV-1a: одинаковый на телефоне и пульте. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function random(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Карточка игрока (или команды): size² песен в случайном порядке. Зависит только от игры и id
 * участника — телефон и пульт получают одну и ту же карточку без лишних записей в базу.
 */
export function cardFor(content: LottoContent, pid: string): string[] {
  const ids = content.songs.map((s) => s.id);
  const next = random(hash(`${pid}|${ids.join(",")}`));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
  }
  return ids.slice(0, cardCells(content));
}

/** Все линии карточки: ряды, столбцы и две диагонали (номера клеток). */
export function cardLines(size: number): number[][] {
  const lines: number[][] = [];
  for (let r = 0; r < size; r++) lines.push(Array.from({ length: size }, (_, c) => r * size + c));
  for (let c = 0; c < size; c++) lines.push(Array.from({ length: size }, (_, r) => r * size + c));
  lines.push(Array.from({ length: size }, (_, i) => i * size + i));
  lines.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));
  return lines;
}

/** Собрана ли карточка по правилу, если отмечены (или прозвучали) эти песни. */
export function isWin(card: string[], marked: Set<string>, size: number, rule: WinRule): boolean {
  if (card.length === 0) return false;
  if (rule === "full") return card.every((id) => marked.has(id));
  const done = cardLines(size).filter((line) => line.every((cell) => marked.has(card[cell] ?? ""))).length;
  return done >= (rule === "twoLines" ? 2 : 1);
}

/** Песни, которые уже прозвучали к этому шагу (включая текущую). */
export function playedUpTo(content: LottoContent, step: number): Set<string> {
  return new Set(content.songs.slice(0, step + 1).map((s) => s.id));
}

// ---------------------------------------------------------------- итоги шага

export interface LottoResult {
  /** Победители по порядку (за всю игру). */
  winners: string[];
  /** Новые победители этой песни. */
  last: string[];
  /** Заявки этой песни, которые не подтвердились. */
  rejected: string[];
  /** «Повторить песню» — экран зала сыграет фрагмент ещё раз. */
  replay: number;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function parseLottoResult(raw: unknown): LottoResult {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { winners: strings(r.winners), last: strings(r.last), rejected: strings(r.rejected), replay: typeof r.replay === "number" ? r.replay : 0 };
}

/** Заявка «Лото!» с телефона: отмеченные песни. */
export function isClaim(value: unknown): value is { marks: string[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { marks?: unknown }).marks);
}

function claimOrder(a: Answer, b: Answer): number {
  return (a.submittedAt ?? Number.MAX_SAFE_INTEGER) - (b.submittedAt ?? Number.MAX_SAFE_INTEGER) || a.pid.localeCompare(b.pid);
}

/** Очки победителю по порядку: первому — первый приз, дальше — последний приз списка. */
export function prizeFor(content: LottoContent, place: number): number {
  return content.prizes[place] ?? content.prizes[content.prizes.length - 1] ?? 0;
}

/**
 * Очки за песню. Заявка верна, если карточка участника собрана по правилу из уже прозвучавших
 * песен (отметки на телефоне не важны — честно и для тех, кто забыл отметить). Кто уже выиграл,
 * второй раз не получает. Порядок — по времени заявки на сервере.
 */
export function score(step: LottoStep, answers: Answer[], { state }: ScoreContext): ScoreDelta[] {
  const prior = new Set(parseLottoResult(state.result).winners);
  const played = playedUpTo(step.content, step.index);
  const seen = new Set<string>();
  const winners = answers
    .filter((a) => isClaim(a.value) && !prior.has(a.pid))
    .sort(claimOrder)
    .filter((a) => {
      if (seen.has(a.pid)) return false;
      seen.add(a.pid);
      return isWin(cardFor(step.content, a.pid), played, step.content.size, step.content.rule);
    });
  return winners.map((a, i) => ({ pid: a.pid, delta: prizeFor(step.content, prior.size + i) }));
}

// ---------------------------------------------------------------- ход игры

export type LottoAction = "play" | "reveal" | "next" | "podium" | "podiumNext" | "finish";

export function lottoPrimary(session: Session, content: LottoContent): LottoAction {
  const { stage, step } = session.state;
  if (stage === "ready") return "play";
  if (stage === "question") return "reveal";
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (step < content.songs.length - 1) return "next";
  return hasPodium(session.leaderboard) ? "podium" : "finish";
}

function carryWinners(session: Session): Pick<LottoResult, "winners"> {
  return { winners: parseLottoResult(session.state.result).winners };
}

/** Включить песню: заявки принимаются, пока она звучит, и до показа названия. */
export function playSong(session: Session): SessionChange {
  return {
    state: { stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: { ...carryWinners(session), last: [], rejected: [], replay: 0 } },
  };
}

/** Повторить песню на экране зала. */
export function replaySong(session: Session): SessionChange {
  const result = parseLottoResult(session.state.result);
  return { state: { result: { ...result, replay: result.replay + 1 } } };
}

/** Показать название песни и проверить заявки «Лото!»: победители получают очки. */
export function revealSong(session: Session, content: LottoContent, answers: Answer[], participants: Participant[]): SessionChange {
  const step = lottoSteps(content)[session.state.step];
  if (!step) return {};
  const own = answers.filter((a) => a.step === session.state.step);
  const board: Record<string, LeaderboardEntry> = {
    ...session.leaderboard,
    ...leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
  const deltas = score(step, own, { state: session.state });
  const won = new Map(deltas.map((d) => [d.pid, d.delta]));
  const leaderboard: Record<string, LeaderboardEntry> = {};
  for (const [pid, entry] of Object.entries(board)) {
    const delta = won.get(pid) ?? 0;
    if (delta === 0 && (entry.last ?? 0) === 0 && session.leaderboard[pid]) continue;
    leaderboard[pid] = { ...entry, score: entry.score + delta, last: delta };
  }
  const prior = parseLottoResult(session.state.result);
  const claimed = [...new Set(own.filter((a) => isClaim(a.value)).map((a) => a.pid))];
  return {
    state: {
      stage: "reveal",
      revealed: true,
      answered: own.length,
      result: { winners: [...prior.winners, ...deltas.map((d) => d.pid)], last: deltas.map((d) => d.pid), rejected: claimed.filter((pid) => !won.has(pid) && !prior.winners.includes(pid)), replay: 0 },
    },
    leaderboard,
  };
}

/** Следующая песня — сразу звучит (пауза между песнями — показ названия). */
export function nextSong(session: Session): SessionChange {
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: { ...carryWinners(session), last: [], rejected: [], replay: 0 },
    },
  };
}

export interface LottoBack {
  change: SessionChange;
  clearAnswers?: number;
}

/** «Назад» на один этап; null — назад некуда. */
export function lottoBack(session: Session): LottoBack | null {
  const { stage, step } = session.state;
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "reveal") {
    // Снимаем очки этой песни и её победителей: при повторном показе всё посчитается заново.
    const result = parseLottoResult(session.state.result);
    const leaderboard: Record<string, LeaderboardEntry> = {};
    for (const [pid, entry] of Object.entries(session.leaderboard)) {
      if (entry.last) leaderboard[pid] = { ...entry, score: entry.score - entry.last, last: 0 };
    }
    const winners = result.winners.filter((pid) => !result.last.includes(pid));
    return { change: { state: { stage: "question", revealed: false, result: { winners, last: [], rejected: [], replay: result.replay } }, leaderboard } };
  }
  if (stage === "question") {
    if (step === 0) {
      return { change: { state: { stage: "ready", startedAt: null, revealed: false, answered: 0, result: carryWinners(session) } }, clearAnswers: step };
    }
    // Песня ещё не дозвучала — на название прошлой песни (её победители остаются).
    // Победители прошлой песни — у кого в таблице её очки (`last`): «Назад» с её названия снимет
    // и очки, и победу, иначе победитель остался бы в списке без очков.
    const winners = parseLottoResult(session.state.result).winners;
    const last = Object.entries(session.leaderboard)
      .filter(([pid, e]) => (e.last ?? 0) > 0 && winners.includes(pid))
      .map(([pid]) => pid);
    return { change: { state: { step: step - 1, stage: "reveal", revealed: true, answered: 0, result: { winners, last, rejected: [], replay: 0 } } }, clearAnswers: step };
  }
  // «ready» бывает только перед первой песней.
  return null;
}
