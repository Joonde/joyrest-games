// Музыкальное лото: карточки игроков, проверка «Лото!», очки и ход игры на пульте. Чистые функции:
// пульт отправляет результат в базу, репетиция и тесты применяют его в памяти.
import { leaderboardAdditions } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreContext, ScoreDelta, Step } from "../types";
import { cardCells, LOTTO_LIMITS, type LottoContent, type LottoSong, type WinRule } from "./content";

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
  const all = cardLines(size);
  // Ряды — первые size линий, столбцы — следующие size, дальше — две диагонали.
  const lines = rule === "row" ? all.slice(0, size) : rule === "column" ? all.slice(size, 2 * size) : all;
  const done = lines.filter((line) => line.every((cell) => marked.has(card[cell] ?? ""))).length;
  return done >= (rule === "twoLines" ? 2 : 1);
}

/**
 * Порядок песен игры: номера песен списка (0…N−1) по шагам. С барабаном — случайный, закреплённый на
 * игру (`result.order`, ставит первая песня); без барабана и у старых сессий — по списку.
 */
export function orderOf(content: Pick<LottoContent, "songs">, raw: unknown): number[] {
  const n = content.songs.length;
  const order = Array.isArray(raw) ? raw : [];
  if (order.length === n && new Set(order).size === n && order.every((i) => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < n)) return order as number[];
  return Array.from({ length: n }, (_, i) => i);
}

/** Случайный порядок песен для этой игры: зависит только от id сессии и списка песен. */
export function shuffledOrder(content: Pick<LottoContent, "songs">, seed: string): number[] {
  const order = content.songs.map((_, i) => i);
  const next = random(hash(`drum|${seed}|${content.songs.map((s) => s.id).join(",")}`));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}

/** Номер песни в списке (0…N−1), которая звучит на шаге `step`. */
export function songIndexAt(order: number[], step: number): number {
  return order[step] ?? step;
}

/** Песня шага с учётом порядка. */
export function songAt(content: LottoContent, order: number[], step: number): LottoSong | undefined {
  return content.songs[songIndexAt(order, step)];
}

/** Песни, которые уже прозвучали к этому шагу (включая текущую). */
export function playedUpTo(content: LottoContent, step: number, order?: number[]): Set<string> {
  const ord = order ?? orderOf(content, null);
  return new Set(
    ord.slice(0, step + 1).flatMap((i) => {
      const song = content.songs[i];
      return song ? [song.id] : [];
    }),
  );
}

/**
 * Песни, название которых уже открыто: до прошлой песни, а на показе названия, в «Последний шанс» и на
 * награждении — и текущая. Пока песня звучит, её название ещё не открыто — отметка на неё только догадка.
 */
export function revealedUpTo(content: LottoContent, state: { stage: string; step: number; result: unknown }): Set<string> {
  const result = parseLottoResult(state.result);
  const order = orderOf(content, result.order);
  if (state.stage === "ready") return new Set();
  const open = state.stage !== "question" || result.call > 0;
  return playedUpTo(content, open ? state.step : state.step - 1, order);
}

/**
 * Отметки гостя: подтверждённые — песня уже открыта, «карандаш» — догадка (песня ещё не открыта).
 * С подсказкой «Лото!» считается только по подтверждённым, и на показе названия догадки снимаются.
 */
export function splitMarks(marks: string[], revealed: Set<string>): { confirmed: string[]; pencil: string[] } {
  const confirmed: string[] = [];
  const pencil: string[] = [];
  for (const id of marks) (revealed.has(id) ? confirmed : pencil).push(id);
  return { confirmed, pencil };
}

/** Номера (1…N) песен, прозвучавших до шага `upTo` включительно — для табло экрана зала. */
export function playedNumbers(order: number[], upTo: number): number[] {
  return order.slice(0, Math.max(0, upTo + 1)).map((i) => i + 1);
}

// ---------------------------------------------------------------- итоги шага

export interface LottoResult {
  /** Победители по порядку (за всю игру). */
  winners: string[];
  /** Новые победители этой песни. */
  last: string[];
  /** Заявки этой песни, которые не подтвердились. */
  rejected: string[];
  /** «Повторить песню» — экран зала сыграет фрагмент (или видео) ещё раз с начала. */
  replay: number;
  /** Видео песни на экране зала: команда пульта `n` (новая — выполнить), пауза сейчас. */
  video: LottoVideo;
  /** Порядок песен игры (номера списка по шагам) — с барабаном; пусто — по списку. */
  order: number[];
  /** «Остановить песню» с пульта (после названия): новое число — экран глушит музыку. */
  hush: number;
  /** Текст песни на экране: по настройке песни, или ведущий включил / убрал его кнопкой. */
  lyrics: LyricsMode;
  /**
   * «Последний шанс «Лото!»» после названия последней песни: 0 — нет, больше — ведущий снова открыл приём
   * заявок по этой песне (название уже показано, песня не перезапускается).
   */
  call: number;
  /**
   * Победы по песням: номер шага и приз каждого победителя. «Назад» через несколько песен снимает ровно эти очки и
   * победы (по `last` в таблице нельзя — следующий показ его обнуляет). Нет у сессий, начатых до этого поля.
   */
  wins: LottoWin[];
}

export type LyricsMode = "auto" | "on" | "off";

export interface LottoWin {
  step: number;
  prizes: Record<string, number>;
}

/** Команды видео с пульта — как у «Танцуй как звезда»: пауза, дальше, −10 с, +10 с, остановить. */
export type LottoVideoCmd = "play" | "pause" | "back" | "fwd" | "stop";

export interface LottoVideo {
  n: number;
  cmd: LottoVideoCmd;
  paused: boolean;
}

const VIDEO_CMDS: LottoVideoCmd[] = ["play", "pause", "back", "fwd", "stop"];
const VIDEO_START: LottoVideo = { n: 0, cmd: "play", paused: false };

function parseVideo(raw: unknown): LottoVideo {
  const v = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    n: typeof v.n === "number" && Number.isInteger(v.n) ? v.n : 0,
    cmd: VIDEO_CMDS.includes(v.cmd as LottoVideoCmd) ? (v.cmd as LottoVideoCmd) : "play",
    paused: v.paused === true,
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parseWins(value: unknown): LottoWin[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): LottoWin[] => {
    const w = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    if (typeof w.step !== "number" || !Number.isInteger(w.step) || w.step < 0) return [];
    const prizes: Record<string, number> = {};
    const raw = typeof w.prizes === "object" && w.prizes !== null && !Array.isArray(w.prizes) ? (w.prizes as Record<string, unknown>) : {};
    for (const [pid, n] of Object.entries(raw)) if (typeof n === "number" && Number.isFinite(n)) prizes[pid] = n;
    return [{ step: w.step, prizes }];
  });
}

export function parseLottoResult(raw: unknown): LottoResult {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    winners: strings(r.winners),
    last: strings(r.last),
    rejected: strings(r.rejected),
    replay: typeof r.replay === "number" ? r.replay : 0,
    video: parseVideo(r.video),
    wins: parseWins(r.wins),
    order: Array.isArray(r.order) ? r.order.filter((i): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0).slice(0, LOTTO_LIMITS.songs) : [],
    hush: typeof r.hush === "number" && Number.isInteger(r.hush) ? r.hush : 0,
    lyrics: r.lyrics === "on" || r.lyrics === "off" ? r.lyrics : "auto",
    call: typeof r.call === "number" && Number.isInteger(r.call) && r.call > 0 ? r.call : 0,
  };
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
  const parsed = parseLottoResult(state.result);
  const prior = new Set(parsed.winners);
  const played = playedUpTo(step.content, step.index, orderOf(step.content, parsed.order));
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

function carryWinners(session: Session): Pick<LottoResult, "winners" | "wins" | "order"> {
  const r = parseLottoResult(session.state.result);
  return { winners: r.winners, wins: r.wins, order: r.order };
}

/** Новая песня: заявок, повторов, «стоп» и ручного текста ещё нет. */
const FRESH = { last: [], rejected: [], replay: 0, video: VIDEO_START, hush: 0, lyrics: "auto" as LyricsMode, call: 0 };

/**
 * Включить первую песню: заявки принимаются, пока она звучит, и до показа названия. С барабаном порядок
 * песен перемешивается здесь один раз на игру (по id сессии) — «Назад» и повтор его не меняют.
 */
export function playSong(session: Session, content?: LottoContent): SessionChange {
  const carried = carryWinners(session);
  const order = content && content.drum !== "off" && carried.order.length !== content.songs.length ? shuffledOrder(content, session.id) : carried.order;
  return {
    state: { stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: { ...carried, order, ...FRESH } },
  };
}

/** Остановить песню на экране зала (после названия, когда она играет дальше). */
export function hushSong(session: Session): SessionChange {
  const result = parseLottoResult(session.state.result);
  return { state: { result: { ...result, hush: result.hush + 1 } } };
}

/** Текст песни на экран (on), убрать (off) или по настройке песни (auto). */
export function lyricsCommand(session: Session, mode: LyricsMode): SessionChange {
  const result = parseLottoResult(session.state.result);
  return { state: { result: { ...result, lyrics: mode } } };
}

/** Повторить песню на экране зала: трек или видео — заново с начала. */
export function replaySong(session: Session): SessionChange {
  const result = parseLottoResult(session.state.result);
  return { state: { result: { ...result, replay: result.replay + 1, video: { ...result.video, paused: false } } } };
}

/** Команда видео песни с пульта (пауза, дальше, перемотка, остановить). */
export function lottoVideoCommand(session: Session, cmd: LottoVideoCmd): SessionChange {
  const result = parseLottoResult(session.state.result);
  const paused = cmd === "pause" || cmd === "stop" ? true : cmd === "play" ? false : result.video.paused;
  return { state: { result: { ...result, video: { n: result.video.n + 1, cmd, paused } } } };
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
      // Видео дальше идёт как шло: название появляется поверх, караоке не обрывается.
      result: {
        winners: [...prior.winners, ...deltas.map((d) => d.pid)],
        last: deltas.map((d) => d.pid),
        rejected: claimed.filter((pid) => !won.has(pid) && !prior.winners.includes(pid)),
        replay: prior.replay,
        video: prior.video,
        order: prior.order,
        hush: prior.hush,
        lyrics: prior.lyrics,
        call: prior.call,
        // После «Последнего шанса» победители первого показа этой песни остаются в её победах.
        wins: mergeWins(prior.wins, session.state.step, Object.fromEntries(won)),
      },
    },
    leaderboard,
  };
}

function mergeWins(wins: LottoWin[], step: number, prizes: Record<string, number>): LottoWin[] {
  const before = wins.find((w) => w.step === step)?.prizes ?? {};
  const all = { ...before, ...prizes };
  const rest = wins.filter((w) => w.step !== step);
  return Object.keys(all).length > 0 ? [...rest, { step, prizes: all }] : rest;
}

/** Кнопка «Последний шанс «Лото!»»: название последней песни показано, шанса ещё не было. */
export function canLastCall(session: Session, content: LottoContent): boolean {
  const { stage, step, phase } = session.state;
  return phase === "playing" && stage === "reveal" && step === content.songs.length - 1 && parseLottoResult(session.state.result).call === 0;
}

/**
 * «Последний шанс»: после названия последней песни снова принимаем «Лото!» по этой же песне — гости, которые
 * собрали карточку, когда название уже открылось, успевают нажать. Название остаётся на экране, песня не
 * перезапускается (время начала то же), прежние победители и их очки остаются.
 */
export function lastCall(session: Session): SessionChange {
  const result = parseLottoResult(session.state.result);
  return { state: { stage: "question", revealed: false, answered: 0, result: { ...result, last: [], rejected: [], call: result.call + 1 } } };
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
      result: { ...carryWinners(session), ...FRESH },
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
    const win = result.wins.find((w) => w.step === step);
    // Победы записаны по песням — снимаем ровно их; у старых сессий — по `last` в таблице.
    const prizes: Record<string, number> = win
      ? win.prizes
      : Object.fromEntries(Object.entries(session.leaderboard).flatMap(([pid, e]) => (e.last ? [[pid, e.last]] : [])));
    const lost = win ? Object.keys(win.prizes) : result.last;
    for (const [pid, entry] of Object.entries(session.leaderboard)) {
      const prize = prizes[pid] ?? 0;
      if (prize !== 0 || entry.last) leaderboard[pid] = { ...entry, score: entry.score - prize, last: 0 };
    }
    const winners = result.winners.filter((pid) => !lost.includes(pid));
    const wins = result.wins.filter((w) => w.step !== step);
    return { change: { state: { stage: "question", revealed: false, result: { winners, last: [], rejected: [], replay: result.replay, video: result.video, wins, order: result.order, hush: result.hush, lyrics: result.lyrics } }, leaderboard } };
  }
  if (stage === "question" && parseLottoResult(session.state.result).call > 0) {
    // «Последний шанс» закрываем без проверки: снова название песни, как было (её победители остаются).
    const result = parseLottoResult(session.state.result);
    const win = result.wins.find((w) => w.step === step);
    return { change: { state: { stage: "reveal", revealed: true, result: { ...result, call: 0, last: win ? Object.keys(win.prizes) : [] } } } };
  }
  if (stage === "question") {
    if (step === 0) {
      // Порядок песен остаётся: «Включить первую песню» сыграет ту же первую.
      return { change: { state: { stage: "ready", startedAt: null, revealed: false, answered: 0, result: carryWinners(session) } }, clearAnswers: step };
    }
    // Песня ещё не дозвучала — на название прошлой песни (её победители остаются).
    const result = parseLottoResult(session.state.result);
    const winners = result.winners;
    const win = result.wins.find((w) => w.step === step - 1);
    const leaderboard: Record<string, LeaderboardEntry> = {};
    let last: string[];
    if (win) {
      // Победители прошлой песни и их «+300» на экране — как были при показе её названия.
      last = winners.filter((pid) => win.prizes[pid] !== undefined);
      for (const [pid, entry] of Object.entries(session.leaderboard)) {
        const want = win.prizes[pid] ?? 0;
        if ((entry.last ?? 0) !== want) leaderboard[pid] = { ...entry, last: want };
      }
    } else {
      // Старые сессии: победители прошлой песни — у кого в таблице её очки (`last`).
      last = Object.entries(session.leaderboard)
        .filter(([pid, e]) => (e.last ?? 0) > 0 && winners.includes(pid))
        .map(([pid]) => pid);
    }
    // Видео прошлой песни — на паузе: ведущий сам решит, включать ли его снова.
    return {
      change: {
        // Музыка прошлой песни не возвращается: «стоп» — сразу (hush), видео — на паузе.
        state: { step: step - 1, stage: "reveal", revealed: true, answered: 0, result: { winners, last, rejected: [], replay: 0, video: { n: 0, cmd: "pause", paused: true }, wins: result.wins, order: result.order, hush: 1, lyrics: "auto" } },
        ...(Object.keys(leaderboard).length > 0 ? { leaderboard } : {}),
      },
      clearAnswers: step,
    };
  }
  // «ready» бывает только перед первой песней.
  return null;
}

/**
 * Звучит ли песня на экране зала (ревью 29 октября 2026). На вопросе — после барабана; на названии — только если
 * песня уже звучала на вопросе (`sounded`): название открыли, пока крутился барабан, — песня не начинается с начала
 * на полную громкость. `quiet` — название показали без «играет после ответа», песня затихла: ни название, ни
 * «Назад» на вопрос, ни «Последний шанс» её снова не включают (для этого — «Повторить песню»). «Стоп» с пульта — тишина.
 */
export function lottoMusicOn(m: { stage: string; inDrum: boolean; hush: number; quiet: boolean; sounded: boolean }): boolean {
  if (m.inDrum || m.hush !== 0 || m.quiet) return false;
  return m.stage === "question" || (m.stage === "reveal" && m.sounded);
}
