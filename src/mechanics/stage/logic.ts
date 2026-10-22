// Ход «Танцуй как звезда / Караоке на поле» — чистые функции.
//
// «Начать игру» → выбор (`reveal`, режим `pick`): команда, чья очередь, называет ведущему категорию и очки,
// ведущий касается плитки на пульте → выступление (новый шаг `question` без таймера, режим `perform`): плитка
// переворачивается, на экране видео, ведущий управляет плеером с пульта; зрители других команд дарят выступающим
// свои очки (`{ gift: true }`, «зрительская симпатия») → «Выступили» (очки плитки + подарки) или «Не вышли» →
// итог (`reveal`, `result`) → следующая команда. Батл: команда хода против соперника (выбирает ведущий) →
// «Голосование» (новый шаг с таймером, `{ vote: pid }` с телефонов зала, можно передумать) → «Подсчитать
// голоса»: победитель забирает очки плитки, ничья — поровну; ведущий может поправить победителя.
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { tileOf, type StageContent, type StageTile } from "./content";

export type StageMode = "pick" | "perform" | "vote" | "result";
export type VideoCmd = "play" | "pause" | "back" | "fwd" | "stop";
export type StageOutcome = "done" | "skip" | "win" | "tie";

interface Prev {
  tile: string;
  performer: string | null;
  opponent: string | null;
  turn: number;
  scores: Record<string, number>;
  outcome: StageOutcome | null;
  winner: string | null;
  gifts: string[];
  done: string[];
}

export interface StageResult {
  order: string[];
  turn: number;
  played: string[];
  tile: string | null;
  performer: string | null;
  opponent: string | null;
  mode: StageMode;
  /** Видео на весь экран зала. */
  full: boolean;
  /** Команда плееру экрана: новая — новый `n`. */
  video: { n: number; cmd: VideoCmd; paused: boolean };
  /** Кто подарил симпатию (живой счёт для экрана). */
  gifts: string[];
  /** Голоса батла сейчас: за кого — сколько. */
  votes: Record<string, number>;
  /** Очки этого выступления (для «Назад» и поправки победителя). */
  scores: Record<string, number>;
  outcome: StageOutcome | null;
  winner: string | null;
  /** Голос в батле можно поменять, пока идёт голосование. */
  changeable: boolean;
  /** Фраза перед голосованием батла («Это было жарко!»), номер в `HYPE`; −1 — нет. */
  hype: number;
  /** Кто уже хотя бы раз выступил («Выступили») — пока выступили не все, батлы закрыты. */
  done: string[];
  /** Ведущий открыл батлы раньше. */
  battlesOpen: boolean;
  prev: Prev | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 300) : []);
const pid = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
function nums(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(v))) if (ID.test(k) && typeof n === "number" && Number.isFinite(n)) out[k] = Math.round(n);
  return out;
}
const outcomeOf = (v: unknown): StageOutcome | null => (v === "done" || v === "skip" || v === "win" || v === "tie" ? v : null);
const CMDS: VideoCmd[] = ["play", "pause", "back", "fwd", "stop"];

/** Батл закончился — на экране сначала фраза (решение владельца 12 октября 2026), потом голосование. */
export const HYPE_MS = 3000;
export const HYPE = {
  dance: ["Это было жарко!", "Фантастика!", "Разрыв танцпола!", "Звезда в шоке!", "Танцпол горит!", "Вот это энергия!", "Зал в восторге!", "Огонь!", "Это надо повторить!", "Легенды танцпола!"],
  karaoke: ["Это было жарко!", "Фантастика!", "Вот это голос!", "Мурашки по коже!", "Звезда в шоке!", "Зал поёт вместе!", "Браво!", "Это надо повторить!", "Легенды сцены!"],
} as const;

export function hypeText(variant: "dance" | "karaoke", n: number): string {
  const list = HYPE[variant];
  return list[((n % list.length) + list.length) % list.length] ?? list[0];
}

export function parseStageResult(raw: unknown): StageResult {
  const d = rec(raw);
  const p = rec(d.prev);
  const v = rec(d.video);
  return {
    order: ids(d.order),
    turn: typeof d.turn === "number" && Number.isInteger(d.turn) && d.turn >= 0 ? d.turn : 0,
    played: ids(d.played),
    tile: pid(d.tile),
    performer: pid(d.performer),
    opponent: pid(d.opponent),
    mode: d.mode === "perform" || d.mode === "vote" || d.mode === "result" ? d.mode : "pick",
    full: d.full === true,
    video: { n: typeof v.n === "number" && Number.isInteger(v.n) ? v.n : 0, cmd: CMDS.includes(v.cmd as VideoCmd) ? (v.cmd as VideoCmd) : "play", paused: v.paused === true },
    gifts: ids(d.gifts),
    votes: nums(d.votes),
    scores: nums(d.scores),
    outcome: outcomeOf(d.outcome),
    winner: pid(d.winner),
    changeable: d.changeable === true,
    hype: typeof d.hype === "number" && Number.isInteger(d.hype) && d.hype >= 0 ? d.hype : -1,
    done: ids(d.done),
    battlesOpen: d.battlesOpen === true,
    prev:
      typeof p.tile === "string"
        ? { tile: p.tile, performer: pid(p.performer), opponent: pid(p.opponent), turn: typeof p.turn === "number" ? p.turn : 0, scores: nums(p.scores), outcome: outcomeOf(p.outcome), winner: pid(p.winner), gifts: ids(p.gifts), done: ids(p.done) }
        : null,
  };
}

const write = (r: StageResult): Record<string, unknown> => ({ ...r });

export function stageSteps(content: StageContent): Step[] {
  return content.tiles.map((t) => ({ id: t.id, answerable: true }));
}

/** Очки начисляет пульт (выступление, подарки, батл) — подсчёт по шагу не нужен. */
export function score(): ScoreDelta[] {
  return [];
}

export function turnPid(r: StageResult): string | null {
  return r.order.length > 0 ? (r.order[r.turn % r.order.length] ?? null) : null;
}

function orderOf(session: Session, participants: Participant[], r: StageResult): string[] {
  const joined = [...scoringParticipants(participants, session.playMode)].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  const known = new Set([...joined, ...Object.keys(session.leaderboard)]);
  // Новые встают в конец очереди, старые не сдвигаются; убранные ведущим — выпадают.
  return [...new Set([...r.order.filter((p) => known.has(p)), ...joined, ...Object.keys(session.leaderboard)])];
}

/** Соперник по умолчанию в батле — следующий в очереди после команды хода. */
export function defaultOpponent(r: StageResult, performer: string | null): string | null {
  if (r.order.length < 2 || !performer) return null;
  const at = r.order.indexOf(performer);
  return r.order[(at + 1) % r.order.length] ?? null;
}

/** Кто ещё не выступил, пока батлы закрыты (пусто — батлы открыты). */
export function battleWaiting(content: StageContent, r: StageResult): string[] {
  if (!content.battleLock || r.battlesOpen) return [];
  // Обычных плиток не осталось — ждать нечего, батлы открываются сами.
  if (!content.tiles.some((t) => t.kind !== "battle" && !r.played.includes(t.id) && t.id !== r.tile)) return [];
  return r.order.filter((p) => !r.done.includes(p));
}

export function battlesLocked(content: StageContent, r: StageResult): boolean {
  return battleWaiting(content, r).length > 0;
}

/** Ведущий открывает батлы раньше, чем выступили все. */
export function openBattles(session: Session): SessionChange {
  const r = parseStageResult(session.state.result);
  return { state: { result: write({ ...r, battlesOpen: true }) } };
}

export type StageAction = "start" | "pickTile" | "done" | "vote" | "count" | "next" | "podium" | "podiumNext" | "finish";

export function allPlayed(content: StageContent, r: StageResult): boolean {
  return content.tiles.every((t) => r.played.includes(t.id) || t.id === r.tile);
}

export function stagePrimary(session: Session, content: StageContent): StageAction {
  const { stage } = session.state;
  const r = parseStageResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (stage === "ready") return "start";
  if (r.mode === "pick") return content.tiles.every((t) => r.played.includes(t.id)) ? (hasPodium(session.leaderboard) ? "podium" : "finish") : "pickTile";
  const tile = tileOf(content, r.tile);
  if (r.mode === "perform") return tile?.kind === "battle" ? "vote" : "done";
  if (r.mode === "vote") return "count";
  if (allPlayed(content, r)) return hasPodium(session.leaderboard) ? "podium" : "finish";
  return "next";
}

function fresh(r: StageResult): StageResult {
  return { ...r, full: false, video: { n: 0, cmd: "play", paused: false }, gifts: [], votes: {}, scores: {}, outcome: null, winner: null, changeable: false, hype: -1 };
}

/** «Начать игру»: очередь команд, выбор первой плитки. */
export function startGame(session: Session, participants: Participant[]): SessionChange {
  const r = parseStageResult(session.state.result);
  return {
    state: { stage: "reveal", revealed: false, startedAt: null, timeLimit: null, answered: 0, result: write({ ...fresh(r), order: orderOf(session, participants, r), mode: "pick", tile: null, performer: null, opponent: null }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** Ведущий коснулся плитки: выступление (новый шаг — зрители дарят симпатию). */
export function pickTile(session: Session, content: StageContent, tileId: string, participants: Participant[], opponent?: string | null): SessionChange {
  const r = parseStageResult(session.state.result);
  const tile = tileOf(content, tileId);
  if (!tile || r.played.includes(tileId) || r.mode !== "pick") return {};
  const order = r.order.length > 0 ? r.order : orderOf(session, participants, r);
  if (tile.kind === "battle" && battlesLocked(content, { ...r, order })) return {};
  const performer = turnPid({ ...r, order });
  const rival = tile.kind === "battle" ? (opponent && opponent !== performer && order.includes(opponent) ? opponent : defaultOpponent({ ...r, order }, performer)) : null;
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: write({ ...fresh(r), order, tile: tileId, performer, opponent: rival, mode: "perform" }),
    },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** Команда (или игрок) телефона: в командах — его команда, в одиночной игре — он сам. */
function sideOf(session: Session, byId: Map<string, Participant>, answerPid: string): { side: string; phone: boolean } {
  const who = byId.get(answerPid);
  if (session.playMode === "teams") {
    if (who?.kind === "player" && who.teamId) return { side: who.teamId, phone: true };
    return { side: answerPid, phone: false };
  }
  return { side: answerPid, phone: true };
}

/** Кто подарил симпатию на этом выступлении: команда (игрок) — один раз, выступающие — нет. */
export function giftGivers(session: Session, answers: Answer[], participants: Participant[]): string[] {
  const r = parseStageResult(session.state.result);
  if (r.mode !== "perform") return [];
  const byId = new Map(participants.map((p) => [p.id, p]));
  const since = session.state.startedAt ?? 0;
  const out: string[] = [];
  for (const a of answers) {
    if (a.step !== session.state.step || (a.submittedAt ?? 0) < since || rec(a.value).gift !== true) continue;
    const { side } = sideOf(session, byId, a.pid);
    if (side === r.performer || side === r.opponent || !session.leaderboard[side] || out.includes(side)) continue;
    out.push(side);
  }
  return out;
}

/** Живой счёт подарков для экрана; null — без изменений. */
export function liveGifts(session: Session, answers: Answer[], participants: Participant[]): SessionChange | null {
  const r = parseStageResult(session.state.result);
  const gifts = giftGivers(session, answers, participants);
  if (gifts.length === r.gifts.length && gifts.every((g) => r.gifts.includes(g))) return null;
  return { state: { result: write({ ...r, gifts }) } };
}

/** «Выступили» (очки плитки + симпатия зала) или «Не вышли» (ничего). */
export function finishPerform(session: Session, content: StageContent, answers: Answer[], participants: Participant[], performed: boolean): SessionChange {
  const r = parseStageResult(session.state.result);
  const tile = tileOf(content, r.tile);
  if (!tile || r.mode !== "perform") return {};
  const scores: Record<string, number> = {};
  const gifts: string[] = [];
  // Репетиция и игра без команд: выступать некому — итог без очков, игра идёт дальше.
  if (performed && r.performer) {
    scores[r.performer] = tile.points;
    if (content.gift > 0) {
      for (const giver of giftGivers(session, answers, participants)) {
        // Дарить могут все, кто не на сцене, — и те, кто ещё не выступал (решение владельца 14 октября 2026):
        // выступающим — подарок целиком, у дарителя списывается только то, что у него есть (в минус не уходит).
        gifts.push(giver);
        const has = Math.max(0, session.leaderboard[giver]?.score ?? 0);
        const pay = Math.min(has, content.gift);
        if (pay > 0) scores[giver] = (scores[giver] ?? 0) - pay;
        scores[r.performer] = (scores[r.performer] ?? 0) + content.gift;
      }
    }
  }
  const change: SessionChange = { state: { stage: "reveal", revealed: true, result: write({ ...r, mode: "result", scores, gifts, outcome: performed ? "done" : "skip", full: false, video: { ...r.video, n: r.video.n + 1, cmd: "stop", paused: true } }) } };
  if (Object.keys(scores).length > 0) change.addScore = scores;
  return change;
}

/** Батл станцевали — на экране фраза (`hype` — случайный номер от пульта), потом голосует зал. */
export function startVote(session: Session, content: StageContent, hype = 0): SessionChange {
  const r = parseStageResult(session.state.result);
  const timeLimit = content.voteTime + HYPE_MS / 1000;
  return {
    state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit, revealed: false, answered: 0, result: write({ ...r, mode: "vote", votes: {}, changeable: true, hype: Math.max(0, Math.floor(hype)), full: false, video: { ...r.video, n: r.video.n + 1, cmd: "pause", paused: true } }) },
  };
}

/** Голоса батла: телефоны не из сторон батла, у каждого телефона один голос (можно передумать). */
export function battleVotes(session: Session, answers: Answer[], participants: Participant[]): Record<string, number> {
  const r = parseStageResult(session.state.result);
  if (!r.performer || !r.opponent) return {};
  const byId = new Map(participants.map((p) => [p.id, p]));
  const since = session.state.startedAt ?? 0;
  const votes: Record<string, number> = { [r.performer]: 0, [r.opponent]: 0 };
  for (const a of answers) {
    if (a.step !== session.state.step || (a.submittedAt ?? 0) < since) continue;
    const { side, phone } = sideOf(session, byId, a.pid);
    // В командах голосует каждый телефон своим игроком; голос «за команду» не считается (иначе капитан — дважды).
    if (!phone || side === r.performer || side === r.opponent) continue;
    const vote = pid(rec(a.value).vote);
    if (vote !== r.performer && vote !== r.opponent) continue;
    votes[vote] = (votes[vote] ?? 0) + 1;
  }
  return votes;
}

export function liveVotes(session: Session, answers: Answer[], participants: Participant[]): SessionChange | null {
  const r = parseStageResult(session.state.result);
  if (r.mode !== "vote") return null;
  const votes = battleVotes(session, answers, participants);
  const same = Object.keys(votes).length === Object.keys(r.votes).length && Object.entries(votes).every(([k, n]) => r.votes[k] === n);
  if (same) return null;
  const answered = Object.values(votes).reduce((s, n) => s + n, 0);
  return { state: { answered, result: write({ ...r, votes }) } };
}

function battleScores(tile: StageTile, r: StageResult, winner: string | "tie"): Record<string, number> {
  if (!r.performer || !r.opponent) return {};
  if (winner === "tie") {
    const half = Math.floor(tile.points / 2);
    return half > 0 ? { [r.performer]: half, [r.opponent]: half } : {};
  }
  return { [winner]: tile.points };
}

/** «Подсчитать голоса»: больше голосов — очки плитки, поровну (или голосов нет) — пополам. */
export function countVotes(session: Session, content: StageContent, answers: Answer[], participants: Participant[]): SessionChange {
  const r = parseStageResult(session.state.result);
  const tile = tileOf(content, r.tile);
  if (!tile || r.mode !== "vote") return {};
  // Без сторон батла (репетиция, одна команда) — итог без очков.
  if (!r.performer || !r.opponent) return { state: { stage: "reveal", revealed: true, result: write({ ...r, mode: "result", votes: {}, scores: {}, outcome: "tie", winner: null, changeable: false }) } };
  const votes = battleVotes(session, answers, participants);
  const a = votes[r.performer] ?? 0;
  const b = votes[r.opponent] ?? 0;
  const winner = a === b ? "tie" : a > b ? r.performer : r.opponent;
  const scores = battleScores(tile, r, winner);
  const change: SessionChange = {
    state: { stage: "reveal", revealed: true, result: write({ ...r, mode: "result", votes, scores, outcome: winner === "tie" ? "tie" : "win", winner: winner === "tie" ? null : winner, changeable: false }) },
  };
  if (Object.keys(scores).length > 0) change.addScore = scores;
  return change;
}

/** Ведущий поправляет итог батла (решил зал аплодисментами, голосов не было): очки переносятся. */
export function setBattleWinner(session: Session, content: StageContent, winner: string | "tie"): SessionChange {
  const r = parseStageResult(session.state.result);
  const tile = tileOf(content, r.tile);
  if (!tile || r.mode !== "result" || tile.kind !== "battle") return {};
  if (winner !== "tie" && winner !== r.performer && winner !== r.opponent) return {};
  // Тот же итог уже на экране — повторное касание ничего не пишет (пульт не замирает на ожидании своей записи).
  if (winner === "tie" ? r.outcome === "tie" : r.outcome === "win" && r.winner === winner) return {};
  const next = battleScores(tile, r, winner);
  const diff: Record<string, number> = {};
  for (const k of new Set([...Object.keys(next), ...Object.keys(r.scores)])) {
    const d = (next[k] ?? 0) - (r.scores[k] ?? 0);
    if (d !== 0) diff[k] = d;
  }
  const change: SessionChange = { state: { result: write({ ...r, scores: next, outcome: winner === "tie" ? "tie" : "win", winner: winner === "tie" ? null : winner }) } };
  if (Object.keys(diff).length > 0) change.addScore = diff;
  return change;
}

export function nextTurn(session: Session, participants: Participant[] = []): SessionChange {
  const r = parseStageResult(session.state.result);
  if (!r.tile) return {};
  const order = orderOf(session, participants, r);
  const at = r.performer ? order.indexOf(r.performer) : -1;
  const turn = at >= 0 ? at + 1 : r.turn + 1;
  const prev: Prev = { tile: r.tile, performer: r.performer, opponent: r.opponent, turn: r.turn, scores: r.scores, outcome: r.outcome, winner: r.winner, gifts: r.gifts, done: r.done };
  // «Выступили» (и батл) — команда отметилась; «Не вышли» — нет.
  const sides = r.outcome === null || r.outcome === "skip" ? [] : [r.performer, r.opponent].filter((p): p is string => p !== null);
  const done = [...new Set([...r.done, ...sides])];
  return {
    state: {
      step: session.state.step + 1,
      stage: "reveal",
      startedAt: null,
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: write({ ...fresh(r), order, done, played: [...r.played, r.tile], prev, tile: null, performer: null, opponent: null, mode: "pick", turn }),
    },
  };
}

/** Плеер экрана зала: пауза, дальше, −10 с, +10 с, остановить (в начало). */
export function videoCommand(session: Session, cmd: VideoCmd): SessionChange {
  const r = parseStageResult(session.state.result);
  const paused = cmd === "pause" || cmd === "stop" ? true : cmd === "play" ? false : r.video.paused;
  return { state: { result: write({ ...r, video: { n: r.video.n + 1, cmd, paused } }) } };
}

export function toggleFull(session: Session): SessionChange {
  const r = parseStageResult(session.state.result);
  return { state: { result: write({ ...r, full: !r.full }) } };
}

/** Жеребьёвка: выпавший ходит первым (пока идёт выбор плитки). */
export function stageFirstTurn(session: Session, who: string): SessionChange | null {
  const r = parseStageResult(session.state.result);
  if (session.state.stage !== "reveal" || r.mode !== "pick") return null;
  const order = r.order.includes(who) ? r.order : [...r.order, who];
  return { state: { result: write({ ...r, order, turn: order.indexOf(who) }) } };
}

export interface StageBack {
  change: SessionChange;
  clear?: number[];
}

export function stageBack(session: Session, content: StageContent): StageBack | null {
  const { stage, step } = session.state;
  const r = parseStageResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "ready") return null;
  const tile = tileOf(content, r.tile);
  if (r.mode === "perform") {
    // «Назад» (и «Другая плитка»): плитка остаётся на поле, подарки этого выхода убираются.
    return { change: { state: { step: step - 1, stage: "reveal", revealed: false, startedAt: null, timeLimit: null, answered: 0, result: write({ ...fresh(r), mode: "pick", tile: null, performer: null, opponent: null }) } }, clear: [step] };
  }
  if (r.mode === "vote") {
    return { change: { state: { step: step - 1, stage: "question", revealed: false, timeLimit: null, answered: 0, result: write({ ...r, mode: "perform", votes: {}, changeable: false }) } }, clear: [step] };
  }
  if (r.mode === "result") {
    const minus = Object.fromEntries(Object.entries(r.scores).map(([p, n]) => [p, -n]));
    const battle = tile?.kind === "battle";
    const change: SessionChange = {
      state: { stage: "question", revealed: false, result: write({ ...r, mode: battle ? "vote" : "perform", scores: {}, outcome: null, winner: null, changeable: battle }) },
    };
    if (Object.keys(minus).length > 0) change.addScore = minus;
    return { change };
  }
  // Выбор плитки: назад к итогу прошлого выступления; первый выбор — к заставке.
  if (!r.prev) return { change: { state: { stage: "ready", revealed: false, startedAt: null, timeLimit: null, result: {} } } };
  const prev = r.prev;
  return {
    change: {
      state: {
        step: step - 1,
        stage: "reveal",
        revealed: true,
        startedAt: null,
        timeLimit: null,
        result: write({ ...r, played: r.played.filter((t) => t !== prev.tile), tile: prev.tile, performer: prev.performer, opponent: prev.opponent, turn: prev.turn, scores: prev.scores, outcome: prev.outcome, winner: prev.winner, gifts: prev.gifts, done: prev.done, mode: "result", prev: null }),
      },
    },
    clear: [step],
  };
}
