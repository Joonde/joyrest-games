// Ход «Дурака» на сессии. Пульт ведущего держит партию целиком (колоду и все руки) в `hostSeal`,
// зашифрованном ключом ведущего. Всем видно только `view` (стол, сколько карт у каждого, кто ходит),
// а руку каждый телефон открывает своим ключом из `sealed` (как карты ролей в «Мафии»).
import { leaderboardAdditions } from "../../core/leaderboard";
import type { LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { isDeckStyle, maxSeats, type DeckStyle, type DurakContent } from "./content";
import { isCard, SUITS, type DurakAction, type DurakOptions, type Game, type Pair, type Suit, type TableView } from "./engine";

export type DurakMode = "deal" | "play" | "vote" | "over";

export interface DurakVote {
  /** Куда вернуться после голосования. */
  prev: Exclude<DurakMode, "vote">;
  tally: Record<string, number>;
  total: number;
}

export interface DurakResult {
  mode: DurakMode;
  party: number;
  /** Места за столом по порядку. */
  seats: string[];
  /** Не поместились за стол (мест по правилам меньше). */
  waiting: string[];
  /** Шаг, на котором телефоны прислали ключи. */
  keysStep: number | null;
  view: TableView | null;
  /** Рука каждого места — его ключом. */
  sealed: Record<string, string>;
  /** Вся партия и ключи — ключом ведущего (на устройстве пульта). */
  hostSeal: string | null;
  /** За эти места играет компьютер. */
  bots: string[];
  deckStyle: DeckStyle;
  /** Реплика крупье. */
  line: string;
  /** Последний ход: кто и какие карты (для анимации на экране). */
  last: { pid: string; a: DurakAction["a"]; cards: string[] } | null;
  /** Номер хода в партии. */
  seq: number;
  /** Ход телефона не принят: кому, почему (по номеру хода `n`). */
  reject: { pid: string; n: string; msg: string } | null;
  vote: DurakVote | null;
  /** Порядок выхода в последней партии и дурак. */
  places: string[];
  loser: string | null;
  /** Дурак прошлой партии: от него — первый ход следующей. */
  prevLoser: string | null;
  /** Ответы на шаге можно менять (сервер перезаписывает ответ телефона). */
  changeable: boolean;
}

export type DurakAnswerValue = { key: string } | (DurakAction & { n: string }) | { deck: DeckStyle };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown, max = 40): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, max) : [];
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record(value))) if (typeof v === "string") out[k] = v;
  return out;
}

const MODES: DurakMode[] = ["deal", "play", "vote", "over"];

export function emptyResult(deckStyle: DeckStyle = "classic"): DurakResult {
  return { mode: "deal", party: 1, seats: [], waiting: [], keysStep: null, view: null, sealed: {}, hostSeal: null, bots: [], deckStyle, line: "", last: null, seq: 0, reject: null, vote: null, places: [], loser: null, prevLoser: null, changeable: false };
}

function parseOpts(raw: unknown): DurakOptions {
  const d = record(raw);
  const partners = Array.isArray(d.partners) ? d.partners.map((g) => strings(g)).filter((g) => g.length > 0) : null;
  return { transfer: d.transfer === true, noTransferFirst: d.noTransferFirst !== false, throwers: d.throwers === "neighbors" ? "neighbors" : "all", spades: d.spades === true, partners: partners && partners.length > 0 ? partners : null };
}

function suit(value: unknown): Suit {
  return (SUITS as unknown[]).includes(value) ? (value as Suit) : "H";
}

export function parseView(raw: unknown): TableView | null {
  const d = record(raw);
  if (!Array.isArray(d.seats)) return null;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(record(d.counts))) if (typeof v === "number") counts[k] = v;
  const table: Pair[] = Array.isArray(d.table)
    ? d.table.map((p) => record(p)).filter((p) => isCard(p.a)).map((p) => ({ a: p.a as string, d: isCard(p.d) ? p.d : null }))
    : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    seats: strings(d.seats),
    out: strings(d.out),
    table,
    trump: suit(d.trump),
    trumpCard: isCard(d.trumpCard) ? d.trumpCard : "6H",
    attacker: typeof d.attacker === "string" ? d.attacker : "",
    defender: typeof d.defender === "string" ? d.defender : "",
    taking: d.taking === true,
    passed: strings(d.passed),
    limit: num(d.limit),
    firstBout: d.firstBout === true,
    opts: parseOpts(d.opts),
    counts,
    deckLeft: num(d.deckLeft),
    discard: num(d.discard),
    over: d.over === true,
    loser: typeof d.loser === "string" ? d.loser : null,
    draw: d.draw === true,
    pogony: num(d.pogony),
  };
}

export function parseDurakResult(raw: unknown): DurakResult {
  const d = record(raw);
  const base = emptyResult();
  const vote = record(d.vote);
  const tally: Record<string, number> = {};
  for (const [k, v] of Object.entries(record(vote.tally))) if (typeof v === "number") tally[k] = v;
  const last = record(d.last);
  const reject = record(d.reject);
  return {
    mode: MODES.includes(d.mode as DurakMode) ? (d.mode as DurakMode) : base.mode,
    party: typeof d.party === "number" && d.party >= 1 ? Math.floor(d.party) : 1,
    seats: strings(d.seats),
    waiting: strings(d.waiting, 200),
    keysStep: typeof d.keysStep === "number" ? d.keysStep : null,
    view: d.view ? parseView(d.view) : null,
    sealed: stringMap(d.sealed),
    hostSeal: typeof d.hostSeal === "string" ? d.hostSeal : null,
    bots: strings(d.bots),
    deckStyle: isDeckStyle(d.deckStyle) ? d.deckStyle : base.deckStyle,
    line: typeof d.line === "string" ? d.line.slice(0, 120) : "",
    last: typeof last.pid === "string" && typeof last.a === "string" ? { pid: last.pid, a: last.a as DurakAction["a"], cards: strings(last.cards, 6).filter(isCard) } : null,
    seq: typeof d.seq === "number" ? d.seq : 0,
    reject: typeof reject.pid === "string" && typeof reject.n === "string" ? { pid: reject.pid, n: reject.n, msg: typeof reject.msg === "string" ? reject.msg.slice(0, 120) : "" } : null,
    vote: d.vote && (vote.prev === "deal" || vote.prev === "play" || vote.prev === "over") ? { prev: vote.prev, tally, total: typeof vote.total === "number" ? vote.total : 0 } : null,
    places: strings(d.places),
    loser: typeof d.loser === "string" ? d.loser : null,
    prevLoser: typeof d.prevLoser === "string" ? d.prevLoser : null,
    changeable: d.changeable === true,
  };
}

export function durakSteps(): Step[] {
  return [];
}

export function score(): ScoreDelta[] {
  return [];
}

// ---------------------------------------------------------------- места и имена

export function nameOf(session: Pick<Session, "leaderboard">, pid: string | null): string {
  return pid ? (session.leaderboard[pid]?.name ?? "Игрок") : "";
}

/** Кто садится за стол: игроки (или команды) по порядку входа; добавленные ведущим — в конце. */
export function seatOrder(session: Session, participants: Participant[]): string[] {
  const kind = session.playMode === "teams" ? "team" : "player";
  const own = participants.filter((p) => p.kind === kind);
  const joined = new Map(own.map((p) => [p.id, p.joinedAt ?? 0]));
  const ids = new Set([...Object.keys(session.leaderboard), ...own.map((p) => p.id)]);
  return [...ids].sort((a, b) => (joined.get(a) ?? Number.MAX_SAFE_INTEGER) - (joined.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b));
}

/** Партнёры через одного: две команды (только 4 или 6 мест). */
export function partnerGroups(content: DurakContent, seats: string[]): string[][] | null {
  if (content.seating !== "partners" || (seats.length !== 4 && seats.length !== 6)) return null;
  return [seats.filter((_, i) => i % 2 === 0), seats.filter((_, i) => i % 2 === 1)];
}

export function engineOptions(content: DurakContent, seats: string[]): DurakOptions {
  return {
    transfer: content.variant === "perevodnoy",
    noTransferFirst: content.noTransferFirst,
    throwers: content.throwers,
    spades: content.spades,
    partners: partnerGroups(content, seats),
  };
}

/** Кто ходит первым в новой партии: младший козырь (первая партия, ничья) или от прошлого дурака. */
export function firstAttacker(content: DurakContent, seats: string[], prevLoser: string | null): string | null {
  if (!prevLoser || !seats.includes(prevLoser) || seats.length < 2) return null;
  const i = seats.indexOf(prevLoser);
  const n = seats.length;
  // «Под дурака» — ходит сосед перед дураком, дурак отбивается; «из-под дурака» — ходит сосед после него.
  return content.firstMove === "under" ? (seats[(i - 1 + n) % n] as string) : (seats[(i + 1) % n] as string);
}

// ---------------------------------------------------------------- изменения сессии

/** «Собрать игроков»: телефоны присылают ключи, игроки садятся по порядку входа. */
export function startDeal(session: Session, participants: Participant[], content: DurakContent): SessionChange {
  const additions = leaderboardAdditions(session.leaderboard, participants, session.playMode);
  const board = { ...session.leaderboard, ...additions };
  const order = seatOrder({ ...session, leaderboard: board }, participants);
  const seats = order.slice(0, maxSeats(content));
  const prev = session.state.result === null || session.state.result === undefined ? null : parseDurakResult(session.state.result);
  const next = prev !== null && prev.mode === "over";
  const step = session.state.step + 1;
  return {
    leaderboard: additions,
    state: {
      step,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: {
        ...emptyResult(prev?.deckStyle ?? content.deckStyle),
        mode: "deal",
        party: prev === null ? 1 : next ? prev.party + 1 : prev.party,
        seats,
        waiting: order.slice(seats.length),
        keysStep: step,
        prevLoser: prev === null ? null : next ? prev.loser : prev.prevLoser,
        line: "Садитесь за стол — раздаю карты",
      },
    },
  };
}

/** Публичное состояние после хода (или раздачи): новый шаг для следующих ходов. */
export function playChange(session: Session, content: DurakContent, view: TableView, sealed: Record<string, string>, hostSeal: string, patch: Partial<DurakResult>): SessionChange {
  const r = parseDurakResult(session.state.result);
  if (view.over) return overChange(session, content, view, sealed, hostSeal, patch);
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: content.turnSeconds > 0 ? content.turnSeconds : null,
      revealed: false,
      answered: 0,
      result: { ...r, ...patch, mode: "play", view, sealed, hostSeal, reject: null, vote: null, changeable: true, seq: r.seq + 1 },
    },
  };
}

/** Очки за партию: по порядку выхода, дурак — 0; «Партнёры» — победившей команде. */
export function partyPoints(content: DurakContent, view: TableView): Record<string, number> {
  const out: Record<string, number> = {};
  const n = view.seats.length;
  if (view.opts.partners) {
    if (!view.loser) return out;
    for (const group of view.opts.partners) if (!group.includes(view.loser)) for (const p of group) out[p] = content.teamPoints;
    return out;
  }
  view.out.forEach((pid, i) => {
    const pts = (n - 1 - i) * content.placePoints;
    if (pts > 0) out[pid] = pts;
  });
  return out;
}

function overChange(session: Session, content: DurakContent, view: TableView, sealed: Record<string, string>, hostSeal: string, patch: Partial<DurakResult>): SessionChange {
  const r = parseDurakResult(session.state.result);
  const leaderboard: Record<string, LeaderboardEntry> = {};
  for (const [pid, delta] of Object.entries(partyPoints(content, view))) {
    const entry = session.leaderboard[pid];
    if (entry) leaderboard[pid] = { ...entry, score: entry.score + delta, last: delta };
  }
  const loserName = view.loser ? nameOf(session, view.loser) : "";
  const line = view.draw ? "Ничья — дураков нет!" : view.pogony > 0 ? `Дурак — ${loserName}, с погонами!` : `Дурак — ${loserName}!`;
  return {
    leaderboard,
    state: {
      stage: "reveal",
      revealed: true,
      timeLimit: null,
      result: { ...r, ...patch, mode: "over", view, sealed, hostSeal, reject: null, vote: null, changeable: false, seq: r.seq + 1, places: view.out, loser: view.loser, line },
    },
  };
}

/** Ход не принят: сказать телефону, шаг не меняется (ответ можно прислать заново). */
export function rejectChange(session: Session, reject: DurakResult["reject"]): SessionChange {
  const r = parseDurakResult(session.state.result);
  return { state: { result: { ...r, reject } } };
}

/** Компьютер играет за место (или возвращает место игроку). */
export function toggleBot(session: Session, pid: string): SessionChange {
  const r = parseDurakResult(session.state.result);
  const bots = r.bots.includes(pid) ? r.bots.filter((p) => p !== pid) : [...r.bots, pid];
  return { state: { result: { ...r, bots } } };
}

/** Колода вручную (сразу на всех экранах). */
export function setDeck(session: Session, deckStyle: DeckStyle): SessionChange {
  const r = parseDurakResult(session.state.result);
  return { state: { result: { ...r, deckStyle, line: `Новая колода — играем дальше` } } };
}

/** «Голосование за колоду»: новый шаг, телефоны выбирают колоду. */
export function startVote(session: Session): SessionChange {
  const r = parseDurakResult(session.state.result);
  const prev: DurakVote["prev"] = r.mode === "vote" ? (r.vote?.prev ?? "play") : r.mode;
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: 30,
      revealed: false,
      answered: 0,
      result: { ...r, mode: "vote", changeable: true, reject: null, vote: { prev, tally: {}, total: 0 }, line: "Выбираем колоду — голосуйте на телефонах" },
    },
  };
}

/** Голоса за колоды по ответам. */
export function tallyOf(answers: Array<{ pid: string; value: unknown; step: number }>, step: number): { tally: Record<string, number>; total: number } {
  const tally: Record<string, number> = {};
  let total = 0;
  for (const a of answers) {
    if (a.step !== step) continue;
    const deck = record(a.value).deck;
    if (!isDeckStyle(deck)) continue;
    tally[deck] = (tally[deck] ?? 0) + 1;
    total++;
  }
  return { tally, total };
}

export function voteSync(session: Session, tally: Record<string, number>, total: number): SessionChange {
  const r = parseDurakResult(session.state.result);
  if (!r.vote) return {};
  return { state: { result: { ...r, vote: { ...r.vote, tally, total } } } };
}

/** Победитель голосования: больше голосов; поровну или никто — остаётся текущая. */
export function voteWinner(current: DeckStyle, tally: Record<string, number>): DeckStyle {
  const top = Math.max(0, ...Object.values(tally));
  if (top === 0) return current;
  const leaders = Object.entries(tally).filter(([, n]) => n === top).map(([k]) => k);
  if (leaders.length !== 1) return leaders.includes(current) ? current : (leaders[0] as DeckStyle);
  return leaders[0] as DeckStyle;
}

/** Итог голосования: новая колода, игра продолжается с того же места (новый шаг для ходов). */
export function endVote(session: Session, content: DurakContent, deckStyle: DeckStyle): SessionChange {
  const r = parseDurakResult(session.state.result);
  const prev = r.vote?.prev ?? "play";
  const resume = prev === "play";
  return {
    state: {
      step: session.state.step + 1,
      stage: prev === "over" ? "reveal" : "question",
      startedAt: "server",
      timeLimit: resume && content.turnSeconds > 0 ? content.turnSeconds : null,
      revealed: prev === "over",
      answered: 0,
      result: { ...r, mode: prev, deckStyle, vote: null, changeable: prev === "play", keysStep: prev === "deal" ? session.state.step + 1 : r.keysStep, line: `Играем колодой «${deckTitleShort(deckStyle)}»` },
    },
  };
}

function deckTitleShort(id: DeckStyle): string {
  const names: Record<DeckStyle, string> = { classic: "Классика", gothic: "Готика", greece: "Греция", rome: "Рим", cyber: "Киберпанк", vintage: "Old fashion", russia: "Хохлома", kpop: "K-pop", anime: "Аниме", wedding: "Свадьба" };
  return names[id];
}

/** Закончить партию досрочно: без очков, следующая партия или награждение. */
export function abortParty(session: Session): SessionChange {
  const r = parseDurakResult(session.state.result);
  return { state: { stage: "reveal", revealed: true, timeLimit: null, result: { ...r, mode: "over", changeable: false, vote: null, reject: null, places: r.view?.out ?? [], loser: null, line: "Партия остановлена" } } };
}

/** Можно ли сыграть ещё партию. */
export function moreParties(content: DurakContent, r: DurakResult): boolean {
  return content.parties === 0 || r.party < content.parties;
}

/** Реплика крупье после хода. */
export function lineFor(session: Pick<Session, "leaderboard">, pid: string, action: DurakAction, before: TableView, after: TableView): string {
  const who = nameOf(session, pid);
  const def = nameOf(session, after.defender);
  if (after.over) return "";
  if (before.table.length > 0 && after.table.length === 0) {
    const out = after.out.filter((p) => !before.out.includes(p));
    if (out.length > 0) return `${out.map((p) => nameOf(session, p)).join(", ")} — ${out.length > 1 ? "вышли" : "вышел"} из игры! Ходит ${nameOf(session, after.attacker)}`;
    return before.taking ? `${nameOf(session, before.defender)} забирает карты. Ходит ${nameOf(session, after.attacker)}` : `Бито! Ходит ${nameOf(session, after.attacker)}`;
  }
  if (action.a === "attack") return before.table.length === 0 ? `${who} ходит под ${def}` : `${who} подкидывает`;
  if (action.a === "defend") return `${who} отбивается`;
  if (action.a === "transfer") return `Перевод! Теперь отбивается ${def}`;
  if (action.a === "take") return `${who} берёт`;
  return `${who}: бито`;
}

/** Ключи телефонов из ответов шага раздачи. */
export function keysFrom(answers: Array<{ pid: string; value: unknown; step: number }>, step: number | null, isKey: (v: unknown) => v is string): Record<string, string> {
  const out: Record<string, string> = {};
  if (step === null) return out;
  for (const a of answers) {
    if (a.step !== step) continue;
    const k = record(a.value).key;
    if (isKey(k)) out[a.pid] = k;
  }
  return out;
}

export type HostPack = { game: Game; keys: Record<string, string> };
