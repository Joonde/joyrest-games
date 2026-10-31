// Ход квиза на пульте: «Показать вопрос» → таймер → «Показать ответ» → «Таблица» →
// следующий вопрос, и «Назад» на шаг. Чистые функции: пульт отправляет результат в базу,
// «Репетиция» и симулятор применяют его в памяти.
import { leaderboardAdditions } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone, podiumLabel } from "../../core/podium";
import { placeMoves, startRoundEntries } from "../../core/rounds";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import { quizRounds, raceBonusOf, roundAt, settingsOf, type QuizContent, type QuizQuestion } from "./content";
import { buzzOrder, buzzRight, buzzWrong, EMPTY_BUZZ, syncBuzz } from "../../core/buzz";
import { auctionAnswers, emptyResult, parseResult, resultOf, score, startResult, steps } from "./logic";
import { auctionBackToBets, isAuctionDraw, openBets } from "./auction";
import { activeLevels, LEVEL_NAMES, levelVoteLeaders, parseLevelVote, parsePickMode, parseSuperVote, superPicks, tallyLevelVote, tallySuperVote, VOTE_TIME, votePassed, voteTied, voteUndecided, type LevelVote, type SuperVote } from "../../core/supergame";
import { drawSlide, drawWinner } from "../../core/draw";
import { pointsLabel } from "../../core/results";

export type QuizAction = "show" | "reveal" | "board" | "total" | "next" | "podium" | "podiumNext" | "finish" | "vote" | "voteDone" | "skip" | "coin" | "levelVote" | "levelVoteDone";

/** Голосование «Играем суперигру?» на этом шаге (из `result`). */
export function superVoteOf(session: Pick<Session, "state">): SuperVote | undefined {
  return parseSuperVote(asRecord(session.state.result).superVote);
}

/** Голосование «Какой уровень играем?» на этом шаге (из `result`). */
export function levelVoteOf(session: Pick<Session, "state">): LevelVote | undefined {
  return parseLevelVote(asRecord(session.state.result).levelVote);
}

/** Уровень, выбранный залом (после итога голосования), иначе null. */
export function chosenLevel(session: Pick<Session, "state">): number | null {
  const vote = levelVoteOf(session);
  return vote?.phase === "done" && vote.level !== undefined ? vote.level : null;
}

/** Суперигру на этом шаге пропустили по итогам голосования. */
export function superSkipped(session: Pick<Session, "state">): boolean {
  return asRecord(session.state.result).skipped === true;
}

/** Какое табло на экране после шага: обычное, итоги раунда или общий счёт после раунда. */
export type BoardView = "plain" | "round" | "total";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function boardView(session: Pick<Session, "state">): BoardView {
  const view = asRecord(session.state.result).board;
  return view === "round" || view === "total" ? view : "plain";
}

/** Шаг закрывает раунд (раунды есть, это его последний вопрос). */
export function endsRound(content: QuizContent, step: number): boolean {
  return roundAt(content, step)?.to === step;
}

/** С этого шага начинается раунд (кроме первого раунда игры). */
export function startsRound(content: QuizContent, step: number): boolean {
  return step > 0 && roundAt(content, step)?.from === step;
}

/**
 * Нужна ли таблица после ответа (настройка игры «Таблица»): после каждого вопроса, только в
 * конце раунда (без раундов — в конце игры) или только по кнопке ведущего.
 */
export function boardAfterReveal(content: QuizContent, step: number): boolean {
  const mode = settingsOf(content).board;
  if (mode === "each") return true;
  if (mode === "manual") return false;
  if (quizRounds(content).length === 0) return step === content.questions.length - 1;
  return endsRound(content, step);
}

/** Действие после ответа без таблицы: следующий вопрос, награждение или конец. */
function afterStep(session: Session, content: QuizContent): QuizAction {
  if (session.state.step < content.questions.length - 1) return "next";
  return hasPodium(session.leaderboard) ? "podium" : "finish";
}

/** Какое действие главное на этом этапе (одна главная кнопка пульта). */
export function primaryAction(session: Session, content: QuizContent): QuizAction {
  const { stage, step } = session.state;
  const q = content.questions[step];
  if (q?.kind === "super") {
    const vote = q.superVote ? superVoteOf(session) : undefined;
    // Голосование: сначала «Играем?», после итога — уровни или пропуск.
    if (q.superVote && stage === "ready") {
      if (!vote || vote.phase === "open") return "vote";
      if (voteUndecided(vote)) return "coin";
      if (!vote.passed) return "skip";
    }
    if (q.superVote && stage === "question" && vote?.phase === "open") return "voteDone";
    // Зал голосует за уровень: «Какой уровень играем?» → итог → вопрос выбранного уровня.
    if (parsePickMode(q.superPick) === "vote") {
      const level = levelVoteOf(session);
      if (stage === "ready" && level?.phase !== "done") return "levelVote";
      if (stage === "question" && level?.phase === "open") return "levelVoteDone";
    }
  }
  if (stage === "ready") return "show";
  if (stage === "question") return "reveal";
  if (stage === "reveal") return boardAfterReveal(content, step) ? "board" : afterStep(session, content);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (boardView(session) === "round") return "total";
  // После таблицы последнего вопроса — награждение, если есть кого награждать.
  return afterStep(session, content);
}

/** Дополнительная кнопка пульта: таблица по желанию, когда главная кнопка её пропускает. */
export function extraAction(session: Session, content: QuizContent): QuizAction | null {
  return session.state.stage === "reveal" && primaryAction(session, content) !== "board" ? "board" : null;
}

export const ACTION_LABELS: Record<QuizAction, string> = {
  show: "Показать вопрос",
  reveal: "Показать ответ",
  board: "Таблица",
  total: "Общий счёт",
  next: "Следующий вопрос",
  podium: "Награждение",
  podiumNext: "Показать место",
  finish: "Завершить игру",
  vote: "Голосование: играем суперигру?",
  voteDone: "Подвести итог голосования",
  skip: "Пропустить суперигру",
  coin: "🪙 Бросить монетку: играем или нет",
  levelVote: "Голосование: какой уровень играем?",
  levelVoteDone: "Подвести итог: какой уровень",
};

/** Подпись главной кнопки: на пьедестале — какое место откроется, в конце раунда — «Итоги раунда». */
export function actionLabel(session: Session, content: QuizContent, action: QuizAction): string {
  if (action === "podiumNext") return podiumLabel(session);
  const q = content.questions[session.state.step];
  if (q?.kind === "super" && action === "show") {
    const level = chosenLevel(session);
    return level !== null ? `Открыть вопрос «${LEVEL_NAMES[level]}»` : "Открыть уровни";
  }
  if (q?.kind === "super" && action === "reveal") return "Показать ответы";
  if (q?.kind === "auction" && action === "show") return "Открыть ставки";
  if (q?.kind === "auction" && action === "reveal" && parseResult(session.state.result).auction?.phase === "bets") return "Ставки сделаны";
  if (action === "next" && content.questions[session.state.step + 1]?.kind === "super") return "Суперигра";
  if (action === "next" && content.questions[session.state.step + 1]?.kind === "auction") return "Аукцион";
  if (action === "board" && endsRound(content, session.state.step)) return "Итоги раунда";
  if (action === "show" && startsRound(content, session.state.step)) return "Начать раунд";
  return ACTION_LABELS[action];
}

/**
 * Старт прошлого раунда (`prevRoundBase`) едет в `result` через все этапы первого вопроса раунда,
 * чтобы «Назад» с любого этапа вернул общий счёт прошлого раунда.
 */
function carry(session: Session): { prevRoundBase?: unknown; history?: unknown; superVote?: unknown; levelVote?: unknown } {
  const result = asRecord(session.state.result);
  // Итоги голосований суперигры («Играем?» и «Какой уровень?») едут через вопрос и ответы: «Назад» не заставит голосовать заново.
  const vote = parseSuperVote(result.superVote);
  const level = parseLevelVote(result.levelVote);
  return {
    ...(result.prevRoundBase === undefined ? {} : { prevRoundBase: result.prevRoundBase }),
    ...(result.history === undefined ? {} : { history: result.history }),
    ...(vote?.phase === "done" ? { superVote: vote } : {}),
    ...(level?.phase === "done" ? { levelVote: level } : {}),
  };
}

// ---------------------------------------------------------------- «Назад» через несколько вопросов

/**
 * Снимок пройденного шага (кладёт «Следующий вопрос» в `result.history`): этап, с которого ушли, итоги шага на экране
 * и прибавки участников (`last`, `move`). «Назад» с заставки возвращает ровно его: очки этого шага снимаются точно,
 * даже если с тех пор показывали другие вопросы, а кнопка гонки, итоги суперигры и «Угадай число» не пропадают.
 */
export interface StepSnapshot {
  step: number;
  stage: "reveal" | "board";
  answered: number;
  result: Record<string, unknown>;
  /** Прибавка за шаг (только ненулевые). */
  last: Record<string, number>;
  /** Сдвиг по местам после шага (только ненулевые). */
  move: Record<string, number>;
}

/** Сколько шагов помним: вся игра, но не больше этого числа и этого размера (state уходит всем телефонам). */
export const HISTORY_MAX = 100;
export const HISTORY_CHARS = 40_000;

function numbers(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(asRecord(value))) if (typeof v === "number" && Number.isFinite(v) && v !== 0) out[k] = v;
  return out;
}

/** Стопка снимков из result; что не похоже на снимок — пропускается (без исключений). */
export function historyOf(result: unknown): StepSnapshot[] {
  const raw = asRecord(result).history;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): StepSnapshot[] => {
    const r = asRecord(item);
    if (typeof r.step !== "number" || !Number.isInteger(r.step) || r.step < 0) return [];
    return [
      {
        step: r.step,
        stage: r.stage === "reveal" ? "reveal" : "board",
        answered: typeof r.answered === "number" ? r.answered : 0,
        result: asRecord(r.result),
        last: numbers(r.last),
        move: numbers(r.move),
      },
    ];
  });
}

/** Снимок текущего шага + прежняя стопка; старые снимки уходят, если стопка слишком велика. */
function pushHistory(session: Session): StepSnapshot[] {
  const { history: _history, ...result } = asRecord(session.state.result);
  const last: Record<string, number> = {};
  const move: Record<string, number> = {};
  for (const [pid, entry] of Object.entries(session.leaderboard)) {
    if (entry.last) last[pid] = entry.last;
    if (entry.move) move[pid] = entry.move;
  }
  const snapshot: StepSnapshot = {
    step: session.state.step,
    stage: session.state.stage === "reveal" ? "reveal" : "board",
    answered: session.state.answered,
    result,
    last,
    move,
  };
  const list = [...historyOf(session.state.result), snapshot];
  while (list.length > 1 && (list.length > HISTORY_MAX || JSON.stringify(list).length > HISTORY_CHARS)) list.shift();
  return list;
}

/** Открыть вопрос: время старта ставит сервер, с ним считается скорость. */
/** Время на ответ: у гонки его нет — шаг идёт, пока кто-то не угадает или ведущий не покажет ответ. */
function limitOf(q: QuizQuestion | undefined): number | null {
  if (!q) return null;
  return q.kind === "buzz" ? null : q.timeLimit;
}

export function showQuestion(session: Session, content: QuizContent): SessionChange {
  const q = content.questions[session.state.step];
  // Аукцион: сначала ставки (вопрос на экране — после «Ставки сделаны»).
  if (q?.kind === "auction") return openBets(q, carry(session));
  return {
    state: {
      ...(isSuperCoin(session) ? { slide: null } : {}),
      stage: "question",
      startedAt: "server",
      timeLimit: limitOf(q),
      revealed: false,
      answered: 0,
      result: { ...startResult(q), ...carry(session) },
    },
  };
}

// ---------------------------------------------------------------- суперигра: голосование «Играем?»

/** «Голосование: играем суперигру?»: каждый телефон голосует за или против, до итога можно передумать. */
export function openSuperVote(session: Session, content: QuizContent): SessionChange {
  const q = content.questions[session.state.step];
  const { superVote: _old, ...rest } = carry(session);
  return {
    state: {
      stage: "question",
      startedAt: "server",
      timeLimit: q?.voteTime ?? VOTE_TIME.def,
      revealed: false,
      answered: 0,
      result: { ...emptyResult(), ...rest, superVote: { phase: "open", yes: 0, no: 0 }, changeable: true },
    },
  };
}

/** Голоса на экран, пока идёт голосование (сколько проголосовало). null — записывать нечего. */
export function superVoteSync(session: Session, answers: Answer[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const vote = superVoteOf(session);
  if (vote?.phase !== "open") return null;
  const { yes, no } = tallySuperVote(answers.filter((a) => a.step === session.state.step), typeof session.state.startedAt === "number" ? session.state.startedAt : null);
  if (yes === vote.yes && no === vote.no) return null;
  return { state: { answered: yes + no, result: { ...asRecord(session.state.result), superVote: { phase: "open", yes, no } } } };
}

/**
 * «Подвести итог голосования»: проценты на экран, решение — «за» больше половины. Этап снова «заставка»: дальше
 * «Открыть уровни» или «Пропустить суперигру». Голоса этого шага пульт стирает (уровни отвечают начисто).
 */
export function closeSuperVote(session: Session, answers: Answer[]): SessionChange {
  const { yes, no } = tallySuperVote(answers.filter((a) => a.step === session.state.step), typeof session.state.startedAt === "number" ? session.state.startedAt : null);
  const { superVote: _old, ...rest } = carry(session);
  return {
    state: {
      stage: "ready",
      startedAt: null,
      timeLimit: null,
      revealed: false,
      answered: 0,
      // Поровну — решения нет: монетка на экране зала или ведущий («Решить самому»).
      result: { ...rest, superVote: voteTied(yes, no) ? { phase: "done", yes, no, tie: true } : { phase: "done", yes, no, passed: votePassed(yes, no) } },
    },
  };
}

/** Сколько монетка стоит на экране после остановки, прежде чем пульт её уберёт. */
export const SUPER_COIN_HOLD_MS = 3500;

/** Слайд жребия суперигры: монетка «играем ли» (id `svc…`) или жребий уровня (`svl…`). */
export function isSuperCoin(session: Pick<Session, "state">): boolean {
  const slide = session.state.slide;
  return slide?.kind === "draw" && (slide.id.startsWith("svc") || slide.id.startsWith("svl"));
}

const COIN_YES = "Играем суперигру";
const COIN_NO = "Не играем";

/**
 * «Бросить монетку»: голоса разделились поровну — монетка решает, играем ли. Решение пишется сразу, на экране зала
 * (если он есть) монетка крутится `DRAW_MS` и показывает его; пульт убирает её сам. null — бросать нечего.
 */
export function coinSuperVote(session: Session, serverNow: number, random?: () => number): SessionChange | null {
  const vote = superVoteOf(session);
  if (!voteUndecided(vote) || !vote) return null;
  const passed = drawWinner([true, false], random) ?? true;
  const state: NonNullable<SessionChange["state"]> = { result: { ...asRecord(session.state.result), superVote: { ...vote, passed, coin: true } } };
  if (session.screenMode !== "none") {
    state.slide = drawSlide(
      `svc${Math.random().toString(36).slice(2, 12)}`,
      [COIN_YES, COIN_NO],
      passed ? COIN_YES : COIN_NO,
      serverNow,
      {
        spinEyebrow: `Голоса поровну · ${vote.yes} на ${vote.no}`,
        spinText: "Монетка решит, играем ли суперигру",
        doneEyebrow: "Монетка решила",
        doneText: passed ? "Открываем уровни!" : "Суперигру пропускаем",
      },
      "coin",
    );
  }
  return { state };
}

/** Монетка ещё крутится (до `endsAt` по часам сервера): телефоны и пульт не выдают решение раньше экрана. */
export function superCoinSpinning(session: Pick<Session, "state">, serverNow: number): boolean {
  return isSuperCoin(session) && serverNow < (session.state.slide?.endsAt ?? 0);
}


/** Ведущий решает иначе, чем голосование: «Всё равно играть» / «Всё равно пропустить». */
export function overrideSuperVote(session: Session, passed: boolean): SessionChange | null {
  const vote = superVoteOf(session);
  if (vote?.phase !== "done") return null;
  const { coin: _coin, ...rest } = vote;
  return { state: { ...(isSuperCoin(session) ? { slide: null } : {}), result: { ...asRecord(session.state.result), superVote: { ...rest, passed } } } };
}

// ---------------------------------------------------------------- суперигра: голосование «Какой уровень?»

/** «Голосование: какой уровень играем?»: каждый телефон касается уровня, до итога можно передумать. */
export function openLevelVote(session: Session, content: QuizContent): SessionChange {
  const q = content.questions[session.state.step];
  const { levelVote: _old, ...rest } = carry(session);
  return {
    state: {
      ...(isSuperCoin(session) ? { slide: null } : {}),
      stage: "question",
      startedAt: "server",
      timeLimit: q?.voteTime ?? VOTE_TIME.def,
      revealed: false,
      answered: 0,
      result: { ...emptyResult(), ...rest, levelVote: { phase: "open", counts: [0, 0, 0, 0] }, changeable: true },
    },
  };
}

/** Голоса за уровни — на экран, пока идёт голосование. null — записывать нечего. */
export function levelVoteSync(session: Session, content: QuizContent, answers: Answer[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const vote = levelVoteOf(session);
  if (vote?.phase !== "open") return null;
  const q = content.questions[session.state.step];
  const counts = tallyLevelVote(answers.filter((a) => a.step === session.state.step), typeof session.state.startedAt === "number" ? session.state.startedAt : null, activeLevels(q?.levels));
  if (counts.every((n, i) => n === vote.counts[i])) return null;
  return { state: { answered: counts.reduce((a, b) => a + b, 0), result: { ...asRecord(session.state.result), levelVote: { phase: "open", counts } } } };
}

/**
 * «Подвести итог: какой уровень»: играем уровень с наибольшим числом голосов. Поровну (или никто не голосовал) — жребий
 * среди лидеров: на экране зала монетка (двое) или колесо (трое и больше), решение пишется сразу. Этап — снова заставка:
 * на экране выбранная картинка, дальше «Открыть вопрос». Голоса шага пульт стирает.
 */
export function closeLevelVote(session: Session, content: QuizContent, answers: Answer[], serverNow: number, random?: () => number): SessionChange {
  const q = content.questions[session.state.step];
  const active = activeLevels(q?.levels);
  const counts = tallyLevelVote(answers.filter((a) => a.step === session.state.step), typeof session.state.startedAt === "number" ? session.state.startedAt : null, active);
  const leaders = levelVoteLeaders(counts, active);
  const level = (leaders.length > 1 ? drawWinner(leaders, random) : leaders[0]) ?? active[0] ?? 0;
  const { levelVote: _old, ...rest } = carry(session);
  const state: NonNullable<SessionChange["state"]> = {
    stage: "ready",
    startedAt: null,
    timeLimit: null,
    revealed: false,
    answered: 0,
    result: { ...rest, levelVote: { phase: "done", counts, level, ...(leaders.length > 1 ? { tie: leaders } : {}) } },
  };
  if (leaders.length > 1 && session.screenMode === "none") {
    const best = counts[leaders[0] ?? 0] ?? 0;
    state.slide = drawSlide(
      `svl${Math.random().toString(36).slice(2, 12)}`,
      leaders.map((i) => LEVEL_NAMES[i] ?? ""),
      LEVEL_NAMES[level] ?? "",
      serverNow,
      {
        spinEyebrow: best > 0 ? `Голоса поровну · по ${best}` : "Никто не выбрал уровень",
        spinText: leaders.length === 2 ? "Монетка решит, какой уровень играем" : "Колесо решит, какой уровень играем",
        doneEyebrow: "Играем уровень",
        doneText: `${pointsLabel(q?.levels?.[level]?.points ?? 0)} за верный ответ`,
      },
      leaders.length === 2 ? "coin" : "wheel",
    );
  }
  return { state };
}

/** Ведущий ставит другой уровень (после итога голосования). null — менять нечего. */
export function chooseLevel(session: Session, content: QuizContent, level: number): SessionChange | null {
  const vote = levelVoteOf(session);
  const q = content.questions[session.state.step];
  if (vote?.phase !== "done" || !activeLevels(q?.levels).includes(level) || (vote.level === level && !isSuperCoin(session))) return null;
  return { state: { ...(isSuperCoin(session) ? { slide: null } : {}), result: { ...asRecord(session.state.result), levelVote: { ...vote, level, host: true } } } };
}

/** «Пропустить суперигру»: очков нет, дальше — как после ответа (таблица или следующий вопрос). */
export function skipSuper(session: Session): SessionChange {
  // Прибавки прошлого вопроса («+100») больше не показываем.
  const leaderboard: Record<string, LeaderboardEntry> = {};
  for (const [pid, entry] of Object.entries(session.leaderboard)) {
    if (entry.last || entry.move) leaderboard[pid] = { ...entry, last: 0, move: 0 };
  }
  return {
    state: { ...(isSuperCoin(session) ? { slide: null } : {}), stage: "reveal", revealed: true, answered: 0, result: { ...emptyResult(), ...carry(session), skipped: true } },
    leaderboard,
  };
}

// ---------------------------------------------------------------- суперигра: выбор уровней

/** Кто какой уровень выбрал — на экран (без текста ответов). null — записывать нечего. */
export function superSync(session: Session, content: QuizContent, answers: Answer[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  if (content.questions[session.state.step]?.kind !== "super") return null;
  if (superVoteOf(session)?.phase === "open" || levelVoteOf(session)?.phase === "open") return null;
  const picks = superPicks(answers.filter((a) => a.step === session.state.step && (a.submittedAt ?? 0) >= (session.state.startedAt ?? 0)));
  const before = parseResult(session.state.result).picks ?? {};
  const same = Object.keys(picks).length === Object.keys(before).length && Object.entries(picks).every(([pid, l]) => before[pid] === l);
  return same ? null : { state: { result: { ...asRecord(session.state.result), picks } } };
}

// ---------------------------------------------------------------- гонка: кнопка

/** Свежие нажатия → у кого слово. null — записывать нечего. */
export function buzzSync(session: Session, answers: Answer[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const result = parseResult(session.state.result);
  if (!result.buzz) return null;
  const next = syncBuzz(result.buzz, buzzOrder(answers, session.state.step));
  return next ? { state: { result: { ...asRecord(session.state.result), buzz: next } } } : null;
}

/** «Неверно»: слово следующему нажавшему; ошибившийся до следующего вопроса не отвечает. */
export function buzzWrongAnswer(session: Session): SessionChange {
  const result = parseResult(session.state.result);
  return { state: { result: { ...asRecord(session.state.result), buzz: buzzWrong(result.buzz ?? EMPTY_BUZZ) } } };
}

/** «Верно»: очки и деления к финишу отвечавшему, на экране — конфетти и припев. */
export function buzzRightAnswer(session: Session, content: QuizContent, answers: Answer[], participants: Participant[]): SessionChange {
  const result = parseResult(session.state.result);
  const buzz = buzzRight(result.buzz ?? EMPTY_BUZZ);
  const judged: Session = { ...session, state: { ...session.state, result: { ...asRecord(session.state.result), buzz } } };
  return reveal(judged, content, answers, participants);
}

/** Засчитать или снять открытый ответ гостя (до показа ответа). */
export function toggleAccepted(session: Session, key: string): SessionChange {
  const result = parseResult(session.state.result);
  const accepted = result.accepted.includes(key) ? result.accepted.filter((k) => k !== key) : [...result.accepted, key];
  // Счётчик «Повторить фрагмент» сохраняем: иначе экран сыграет музыку ещё раз.
  const replay = asRecord(session.state.result).replay;
  return { state: { result: { ...result, accepted, ...carry(session), ...(typeof replay === "number" ? { replay } : {}) } } };
}

/** Суперигра: включить трек уровня на экране зала (повторное касание — сначала). */
export function playLevelTrack(session: Session, level: number): SessionChange {
  const result = asRecord(session.state.result);
  const prev = parseResult(session.state.result).superPlay;
  return { state: { result: { ...result, superPlay: { level, n: (prev?.n ?? 0) + 1 } } } };
}

/** «Повторить фрагмент»: экран зала сыграет музыку вопроса ещё раз. */
export function replayTrack(session: Session): SessionChange {
  const result = asRecord(session.state.result);
  const replay = typeof result.replay === "number" ? result.replay : 0;
  return { state: { result: { ...result, replay: replay + 1 } } };
}

/**
 * Показать ответ: очки за шаг прибавляются к таблице, «last» хранит прибавку, чтобы
 * экран показал «+100», а «Назад» мог её снять. Участники, которых пульт ещё не успел
 * внести в таблицу, вносятся здесь же.
 */
export function reveal(
  session: Session,
  content: QuizContent,
  answers: Answer[],
  participants: Participant[],
): SessionChange {
  const step = steps(content)[session.state.step];
  if (!step) return {};
  const stepAnswers = answers.filter((a) => a.step === session.state.step);
  // Аукцион: ставки того же шага — не ответы на вопрос.
  const own = step.question.kind === "auction" ? auctionAnswers(stepAnswers, session.state.startedAt) : stepAnswers;
  const board: Record<string, LeaderboardEntry> = {
    ...session.leaderboard,
    ...leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
  const deltas = new Map(score(step, own, { state: session.state }).map((d) => [d.pid, d.delta]));
  const after: Record<string, LeaderboardEntry> = {};
  for (const [pid, entry] of Object.entries(board)) {
    const delta = deltas.get(pid) ?? 0;
    after[pid] = { ...entry, score: entry.score + delta, last: delta };
  }
  // Стрелки «↑2»: на сколько мест сдвинулся участник после этого ответа.
  const moves = placeMoves(board, after);
  const leaderboard: Record<string, LeaderboardEntry> = {};
  for (const [pid, entry] of Object.entries(board)) {
    const delta = deltas.get(pid) ?? 0;
    const move = moves.get(pid) ?? 0;
    if (delta === 0 && (entry.last ?? 0) === 0 && (entry.move ?? 0) === move && session.leaderboard[pid]) continue;
    leaderboard[pid] = { ...(after[pid] as LeaderboardEntry), move };
  }
  const before = parseResult(session.state.result);
  // Гонка: победитель проходит деления к финишу (супер-трек — больше).
  const winner = step.question.kind === "buzz" ? (before.buzz?.winner ?? null) : null;
  let raceFinish: { pid: string; bonus: number } | null = null;
  if (winner) {
    const entry = leaderboard[winner] ?? after[winner];
    if (entry) {
      const race = (entry.race ?? 0) + (step.question.steps ?? 1);
      // Первый дошедший до финиша получает бонус (один раз за игру). Бонус входит в «last» — «Назад» снимет его вместе с очками.
      const target = settingsOf(content).raceTarget;
      const bonus = raceBonusOf(content);
      const finishedBefore = Object.values(board).some((e) => (e.race ?? 0) >= target);
      if (!finishedBefore && race >= target && bonus > 0) {
        raceFinish = { pid: winner, bonus };
        leaderboard[winner] = { ...entry, race, score: entry.score + bonus, last: (entry.last ?? 0) + bonus };
      } else {
        leaderboard[winner] = { ...entry, race };
      }
    }
  }
  return {
    state: {
      stage: "reveal",
      revealed: true,
      answered: own.length,
      result: { ...resultOf(step.question, own, before.accepted, before.buzz, session.state.result), ...(before.auction ? { auction: before.auction } : {}), ...(raceFinish ? { raceFinish } : {}), ...carry(session) },
    },
    leaderboard,
  };
}

/** Таблица после шага; в конце раунда — сначала итоги раунда, потом общий счёт. */
export function showBoard(session: Session, content: QuizContent): SessionChange {
  const { board: _view, ...rest } = asRecord(session.state.result);
  const result = endsRound(content, session.state.step) ? { ...rest, board: "round" } : rest;
  return { state: { stage: "board", revealed: true, result } };
}

/** После итогов раунда — общий счёт. */
export function showTotal(session: Session): SessionChange {
  return { state: { result: { ...asRecord(session.state.result), board: "total" } } };
}

/** Следующий вопрос: сначала «готовы?», вопрос показывает ведущий. С новым раундом — счёт раунда с нуля. */
export function nextQuestion(session: Session, content: QuizContent): SessionChange {
  const step = session.state.step + 1;
  const newRound = startsRound(content, step);
  // Старт счёта раунда запоминаем: «Назад» с заставки раунда вернёт его и общий счёт.
  const prevRoundBase: Record<string, number> = {};
  if (newRound) for (const [pid, entry] of Object.entries(session.leaderboard)) prevRoundBase[pid] = entry.roundBase ?? 0;
  // Без заставки «Вопрос N из M» вопрос открывается сразу; заставка нового раунда остаётся.
  const q = content.questions[step];
  // Суперигра всегда с заставкой: лучи, сундуки и музыка.
  // Аукцион — тоже: сначала тема и ставки.
  const direct = !settingsOf(content).intro && !newRound && q !== undefined && q.kind !== "super" && q.kind !== "auction";
  const history = pushHistory(session);
  return {
    ...(newRound ? { leaderboard: startRoundEntries(session.leaderboard) } : {}),
    state: direct
      ? { step, stage: "question", startedAt: "server", timeLimit: limitOf(q), revealed: false, answered: 0, result: { ...startResult(q), history } }
      : {
          step,
          stage: "ready",
          startedAt: null,
          timeLimit: null,
          revealed: false,
          answered: 0,
          result: newRound ? { prevRoundBase, history } : { history },
        },
  };
}

export interface BackPlan {
  change: SessionChange;
  /** Убрать ответы этого шага (вопрос закрыт до показа ответа). */
  clearAnswers?: number;
}

/** «Назад» на один этап. null — назад некуда (первый вопрос ещё не показан). */
export function back(session: Session, content?: QuizContent): BackPlan | null {
  const { stage, step } = session.state;
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "board") {
    const { board: view, ...rest } = asRecord(session.state.result);
    if (view === "total") return { change: { state: { result: { ...rest, board: "round" } } } };
    return { change: { state: { stage: "reveal", revealed: true, result: rest } } };
  }
  if (stage === "reveal" && superSkipped(session)) {
    // Суперигру пропустили — обратно к итогу голосования (очков не было).
    return { change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: carry(session) } } };
  }
  if (stage === "reveal") {
    // Снимаем очки этого шага: при повторном показе ответа они посчитаются заново.
    const leaderboard: Record<string, LeaderboardEntry> = {};
    for (const [pid, entry] of Object.entries(session.leaderboard)) {
      if (entry.last) leaderboard[pid] = { ...entry, score: entry.score - entry.last, last: 0, move: 0 };
    }
    const result = parseResult(session.state.result);
    // Гонка: снимаем и деления победителя; слово снова у него — ведущий решит ещё раз.
    const q = content?.questions[step];
    let buzz = result.buzz;
    if (buzz?.winner) {
      const winner = buzz.winner;
      const entry = leaderboard[winner] ?? session.leaderboard[winner];
      if (entry) leaderboard[winner] = { ...entry, race: Math.max(0, (entry.race ?? 0) - (q?.steps ?? 1)) };
      buzz = { ...buzz, winner: null, current: winner };
    }
    return {
      change: {
        state: {
          stage: "question",
          revealed: false,
          result: { ...emptyResult(), accepted: result.accepted, ...(buzz ? { buzz } : {}), ...(result.auction ? { auction: result.auction } : {}), ...carry(session) },
        },
        leaderboard,
      },
    };
  }
  if (stage === "question" && superVoteOf(session)?.phase === "open") {
    // Голосование отменили — снова заставка, голоса стираются.
    const { superVote: _vote, ...rest } = carry(session);
    return {
      change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: Object.keys(rest).length > 0 ? rest : null } },
      clearAnswers: step,
    };
  }
  if (stage === "question" && levelVoteOf(session)?.phase === "open") {
    // Голосование за уровень отменили — снова заставка (итог «Играем?» остаётся), голоса стираются.
    const { levelVote: _vote, ...rest } = carry(session);
    return {
      change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: Object.keys(rest).length > 0 ? rest : null } },
      clearAnswers: step,
    };
  }
  if (stage === "ready" && levelVoteOf(session)?.phase === "done") {
    // С выбранного уровня — переголосовать за уровень (жребий, если крутился, уходит).
    const { levelVote: _vote, ...rest } = carry(session);
    return { change: { state: { ...(isSuperCoin(session) ? { slide: null } : {}), result: Object.keys(rest).length > 0 ? rest : null } } };
  }
  if (stage === "ready" && superVoteOf(session)?.phase === "done") {
    // С итога голосования — переголосовать: заставка без итога (монетка, если крутилась, уходит).
    const { superVote: _vote, ...rest } = carry(session);
    return { change: { state: { ...(isSuperCoin(session) ? { slide: null } : {}), result: Object.keys(rest).length > 0 ? rest : null } } };
  }
  if (stage === "question") {
    const q = content?.questions[step];
    const auction = parseResult(session.state.result).auction;
    // Аукцион: с ответа — снова ставки (запомненные ставки остаются), жребий уходит с экрана.
    if (q?.kind === "auction" && auction && auction.phase !== "bets") return { change: auctionBackToBets(session, q, carry(session)) };
    return {
      change: { state: { ...(isAuctionDraw(session) ? { slide: null } : {}), stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: Object.keys(carry(session)).length > 0 ? carry(session) : null } },
      clearAnswers: step,
    };
  }
  if (step === 0) return null;
  const prevRoundBase = asRecord(asRecord(session.state.result).prevRoundBase);
  if (Array.isArray(asRecord(session.state.result).history)) {
    // Ровно тот этап, итоги и прибавки, с которыми ушли с прошлого шага.
    const history = historyOf(session.state.result);
    const snap = history[history.length - 1];
    // Снимка нет (ушёл из слишком длинной стопки) — назад дальше нельзя: иначе очки снимутся неверно.
    if (!snap || snap.step !== step - 1) return null;
    const leaderboard: Record<string, LeaderboardEntry> = {};
    for (const [pid, entry] of Object.entries(session.leaderboard)) {
      const base = prevRoundBase[pid];
      const roundBase = typeof base === "number" ? base : (entry.roundBase ?? 0);
      const last = snap.last[pid] ?? 0;
      const move = snap.move[pid] ?? 0;
      if (last !== (entry.last ?? 0) || move !== (entry.move ?? 0) || roundBase !== (entry.roundBase ?? 0)) {
        leaderboard[pid] = { ...entry, last, move, ...(typeof base === "number" ? { roundBase } : {}) };
      }
    }
    return {
      change: {
        state: { step: snap.step, stage: snap.stage, revealed: true, answered: snap.answered, result: { ...snap.result, history: history.slice(0, -1) } },
        leaderboard,
      },
    };
  }
  // Сессии, начатые до снимков шагов.
  if (Object.keys(prevRoundBase).length > 0) {
    // С заставки нового раунда — на «Общий счёт» прошлого, со счётом раунда как был.
    const leaderboard: Record<string, LeaderboardEntry> = {};
    for (const [pid, entry] of Object.entries(session.leaderboard)) {
      const base = prevRoundBase[pid];
      if (typeof base === "number" && base !== (entry.roundBase ?? 0)) leaderboard[pid] = { ...entry, roundBase: base };
    }
    return { change: { state: { step: step - 1, stage: "board", revealed: true, answered: 0, result: { board: "total" } }, leaderboard } };
  }
  // С «готовы?» — на таблицу предыдущего вопроса.
  return { change: { state: { step: step - 1, stage: "board", revealed: true, answered: 0, result: null } } };
}
