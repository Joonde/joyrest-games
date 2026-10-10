// Движок правил «Дурака» (подкидной и переводной). Чистые функции без базы и сети: пульт ведущего
// держит партию целиком, телефоны и экран видят только `TableView` (без чужих карт и колоды).
// Карта — строка «ранг + масть»: "6S", "TH" (десятка), "QD", "AC". Масти: S ♠, H ♥, D ♦, C ♣.

export type Suit = "S" | "H" | "D" | "C";
export const SUITS: Suit[] = ["S", "H", "D", "C"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];

export function rankOf(card: string): number {
  return RANKS.indexOf(card.slice(0, -1)) + 2;
}

export function suitOf(card: string): Suit {
  return card.slice(-1) as Suit;
}

export function isCard(value: unknown): value is string {
  return typeof value === "string" && value.length === 2 && RANKS.includes(value[0] as string) && (SUITS as string[]).includes(value[1] as string);
}

/** Колода 36 (6–A) или 52 (2–A) карты. */
export function newDeck(size: 36 | 52): string[] {
  const from = size === 36 ? 4 : 0;
  const out: string[] = [];
  for (const s of SUITS) for (const r of RANKS.slice(from)) out.push(r + s);
  return out;
}

/** Перемешать (Фишер — Йетс). `random` — 0..1; на пульте — криптостойкий. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return (buf[0] as number) / 2 ** 32;
}

export interface DurakOptions {
  /** Переводной: защитник переводит атаку картой того же достоинства. */
  transfer: boolean;
  /** В первом отбое партии переводить нельзя. */
  noTransferFirst: boolean;
  /** Кто подкидывает: все или только соседи защитника. */
  throwers: "all" | "neighbors";
  /** «Пики пиками»: пику бьют только пикой. */
  spades: boolean;
  /** Партнёры: группы мест; партнёру не подкидывают, проигрывает команда дурака. */
  partners: string[][] | null;
}

export interface Pair {
  a: string;
  d: string | null;
}

/** Что видят все: стол, кто ходит, сколько карт у каждого. */
export interface TableView {
  seats: string[];
  out: string[];
  table: Pair[];
  trump: Suit;
  trumpCard: string;
  attacker: string;
  defender: string;
  taking: boolean;
  passed: string[];
  limit: number;
  firstBout: boolean;
  opts: DurakOptions;
  counts: Record<string, number>;
  deckLeft: number;
  discard: number;
  over: boolean;
  loser: string | null;
  draw: boolean;
  pogony: number;
}

export interface Game extends Omit<TableView, "counts" | "deckLeft"> {
  hands: Record<string, string[]>;
  /** Колода: берут с конца, deck[0] — открытый козырь (уходит последним). */
  deck: string[];
  /** Кто подкидывал в этом отбое — порядок добора. */
  contributors: string[];
  /** Последние сыгранные карты каждого: по ним — погоны. */
  lastPlayed: Record<string, string[]>;
  lastExit: { pid: string; cards: string[] } | null;
}

export type DurakAction =
  | { a: "attack"; c: string[] }
  | { a: "defend"; c: string; t: number }
  | { a: "transfer"; c: string[] }
  | { a: "take" }
  | { a: "pass" };

export const HAND = 6;

export function viewOf(g: Game): TableView {
  const counts: Record<string, number> = {};
  for (const p of g.seats) counts[p] = g.hands[p]?.length ?? 0;
  const { hands: _h, deck, contributors: _c, lastPlayed: _l, lastExit: _e, ...rest } = g;
  return { ...rest, counts, deckLeft: deck.length };
}

// ---------------------------------------------------------------- места

export function active(v: Pick<TableView, "seats" | "out">): string[] {
  return v.seats.filter((p) => !v.out.includes(p));
}

/** Следующий по часовой (активный, кроме `pid`). */
export function nextActive(v: Pick<TableView, "seats" | "out">, pid: string): string {
  const n = v.seats.length;
  const i = v.seats.indexOf(pid);
  for (let k = 1; k <= n; k++) {
    const p = v.seats[(i + k) % n] as string;
    if (!v.out.includes(p) && p !== pid) return p;
  }
  return pid;
}

export function partnersOf(opts: DurakOptions, pid: string): string[] {
  const group = opts.partners?.find((g) => g.includes(pid));
  return group ? group.filter((p) => p !== pid) : [];
}

/** Кто может подкидывать защитнику сейчас. */
export function throwers(v: TableView): string[] {
  const act = active(v).filter((p) => p !== v.defender && !partnersOf(v.opts, v.defender).includes(p));
  if (v.opts.throwers === "all") return act;
  const after = nextActive(v, v.defender);
  return act.filter((p) => p === v.attacker || p === after);
}

export function uncovered(v: Pick<TableView, "table">): number[] {
  return v.table.map((p, i) => (p.d === null ? i : -1)).filter((i) => i >= 0);
}

export function tableRanks(v: Pick<TableView, "table">): Set<number> {
  const out = new Set<number>();
  for (const p of v.table) {
    out.add(rankOf(p.a));
    if (p.d) out.add(rankOf(p.d));
  }
  return out;
}

/** Бьёт ли карта `d` карту `a`. */
export function beats(a: string, d: string, trump: Suit, spades: boolean): boolean {
  const sa = suitOf(a);
  const sd = suitOf(d);
  if (spades && sa === "S") return sd === "S" && rankOf(d) > rankOf(a);
  if (sa === sd) return rankOf(d) > rankOf(a);
  return sd === trump && sa !== trump;
}

/** Сколько ещё карт можно подкинуть. */
export function room(v: TableView): number {
  return Math.max(0, v.limit - v.table.length);
}

/** Может ли игрок что-то подкинуть из своей руки. */
export function canThrow(v: TableView, pid: string, hand: string[]): boolean {
  if (v.table.length === 0 || room(v) === 0 || !throwers(v).includes(pid)) return false;
  const ranks = tableRanks(v);
  return hand.some((c) => ranks.has(rankOf(c)));
}

/** Можно ли перевести этими картами. */
export function canTransfer(v: TableView, pid: string, cards: string[]): boolean {
  if (!v.opts.transfer || pid !== v.defender || v.taking || v.table.length === 0) return false;
  if (v.opts.noTransferFirst && v.firstBout) return false;
  if (v.table.some((p) => p.d !== null) || cards.length === 0) return false;
  const rank = rankOf((v.table[0] as Pair).a);
  if (!cards.every((c) => rankOf(c) === rank)) return false;
  const next = nextActive(v, v.defender);
  const total = v.table.length + cards.length;
  const maxBout = v.firstBout ? 5 : HAND;
  return total <= maxBout && (v.counts[next] ?? 0) >= total;
}

/** Отбой закончен: всё покрыто (или защитник берёт) и все, кто мог подкинуть, отказались. */
export function boutDone(v: TableView, hands: Record<string, string[]>): boolean {
  if (v.table.length === 0) return false;
  if (!v.taking && uncovered(v).length > 0) return false;
  return throwers(v).every((p) => v.passed.includes(p) || !canThrow(v, p, hands[p] ?? []));
}

// ---------------------------------------------------------------- раздача

export function lowestTrumpHolder(g: Pick<Game, "seats" | "hands" | "trump">): string | null {
  let best: string | null = null;
  let rank = 99;
  for (const p of g.seats) {
    for (const c of g.hands[p] ?? []) {
      if (suitOf(c) === g.trump && rankOf(c) < rank) {
        rank = rankOf(c);
        best = p;
      }
    }
  }
  return best;
}

export interface DealOptions {
  deck: 36 | 52;
  opts: DurakOptions;
  /** Кто ходит первым: null — младший козырь. */
  first: string | null;
}

export function deal(seats: string[], o: DealOptions, random: () => number): Game {
  const deck = shuffle(newDeck(o.deck), random);
  const trumpCard = deck[0] as string;
  const hands: Record<string, string[]> = {};
  for (const p of seats) hands[p] = [];
  for (let k = 0; k < HAND; k++) for (const p of seats) if (deck.length > 0) (hands[p] as string[]).push(deck.pop() as string);
  const base = { seats, hands, trump: suitOf(trumpCard) };
  const attacker = o.first && seats.includes(o.first) ? o.first : (lowestTrumpHolder(base) ?? (seats[0] as string));
  const g: Game = {
    seats,
    out: [],
    table: [],
    trump: suitOf(trumpCard),
    trumpCard,
    attacker,
    defender: attacker,
    taking: false,
    passed: [],
    limit: 0,
    firstBout: true,
    opts: o.opts,
    discard: 0,
    over: false,
    loser: null,
    draw: false,
    pogony: 0,
    hands,
    deck,
    contributors: [],
    lastPlayed: {},
    lastExit: null,
  };
  g.defender = nextActive(g, attacker);
  g.limit = Math.min(5, hands[g.defender]?.length ?? 0);
  return g;
}

// ---------------------------------------------------------------- ходы

function clone(g: Game): Game {
  return {
    ...g,
    seats: [...g.seats],
    out: [...g.out],
    table: g.table.map((p) => ({ ...p })),
    passed: [...g.passed],
    hands: Object.fromEntries(Object.entries(g.hands).map(([k, v]) => [k, [...v]])),
    deck: [...g.deck],
    contributors: [...g.contributors],
    lastPlayed: { ...g.lastPlayed },
  };
}

function takeFromHand(g: Game, pid: string, cards: string[]): boolean {
  const hand = g.hands[pid] ?? [];
  if (new Set(cards).size !== cards.length || !cards.every((c) => hand.includes(c))) return false;
  g.hands[pid] = hand.filter((c) => !cards.includes(c));
  g.lastPlayed[pid] = cards;
  return true;
}

/** Ход игрока: новая партия или текст ошибки. */
export function apply(game: Game, pid: string, action: DurakAction): Game | string {
  if (game.over) return "Партия окончена";
  const g = clone(game);
  const v = viewOf(g);
  if (action.a === "attack") {
    const cards = action.c;
    if (!Array.isArray(cards) || cards.length === 0 || !cards.every(isCard)) return "Нет карт";
    if (g.table.length === 0) {
      if (pid !== g.attacker) return "Сейчас ходит другой игрок";
      if (!cards.every((c) => rankOf(c) === rankOf(cards[0] as string))) return "Первым ходом — карты одного достоинства";
      if (cards.length > g.limit) return `Можно положить не больше ${g.limit}`;
    } else {
      if (!throwers(v).includes(pid)) return "Вы не подкидываете этому игроку";
      const ranks = tableRanks(g);
      if (!cards.every((c) => ranks.has(rankOf(c)))) return "Подкидывать можно только достоинства со стола";
      if (cards.length > room(v)) return room(v) === 0 ? "Больше подкидывать нельзя" : `Можно подкинуть не больше ${room(v)}`;
    }
    if (!takeFromHand(g, pid, cards)) return "Таких карт нет";
    for (const c of cards) g.table.push({ a: c, d: null });
    if (!g.contributors.includes(pid)) g.contributors.push(pid);
    g.passed = [];
    return settle(g);
  }
  if (action.a === "defend") {
    if (pid !== g.defender) return "Сейчас отбивается другой игрок";
    if (g.taking) return "Вы уже берёте";
    const pair = g.table[action.t];
    if (!pair || pair.d !== null) return "Эта карта уже покрыта";
    if (!isCard(action.c) || !beats(pair.a, action.c, g.trump, g.opts.spades)) return "Эта карта не бьёт";
    if (!takeFromHand(g, pid, [action.c])) return "Такой карты нет";
    pair.d = action.c;
    g.passed = [];
    return settle(g);
  }
  if (action.a === "transfer") {
    if (!canTransfer(v, pid, action.c)) return "Перевести нельзя";
    if (!takeFromHand(g, pid, action.c)) return "Таких карт нет";
    for (const c of action.c) g.table.push({ a: c, d: null });
    const next = nextActive(g, g.defender);
    g.attacker = g.defender;
    g.defender = next;
    g.limit = Math.min(g.firstBout ? 5 : HAND, Math.max(g.table.length, g.hands[next]?.length ?? 0));
    if (!g.contributors.includes(pid)) g.contributors.push(pid);
    g.passed = [];
    return settle(g);
  }
  if (action.a === "take") {
    if (pid !== g.defender) return "Брать может только отбивающийся";
    if (g.taking || uncovered(g).length === 0) return "Нечего брать";
    g.taking = true;
    g.passed = [];
    return settle(g);
  }
  if (action.a === "pass") {
    if (!throwers(v).includes(pid)) return "Вам нечего делать";
    if (g.table.length === 0) return "Сначала нужен ход";
    if (!g.passed.includes(pid)) g.passed.push(pid);
    return settle(g);
  }
  return "Неизвестный ход";
}

/** Отбой закончен — карты в бито или защитнику, добор, кто вышел, следующий отбой. */
function settle(g: Game): Game {
  if (!boutDone(viewOf(g), g.hands)) return g;
  const all = g.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]));
  const took = g.taking;
  const defender = g.defender;
  if (took) (g.hands[defender] as string[]).push(...all);
  else g.discard += all.length;
  // Добор: главный атакующий, остальные подкидывавшие по часовой, защитник последним.
  const order: string[] = [g.attacker];
  let p = g.attacker;
  for (let k = 0; k < g.seats.length; k++) {
    p = nextActive(g, p);
    if (p !== defender && !order.includes(p) && g.contributors.includes(p)) order.push(p);
  }
  for (const q of active(g)) if (q !== defender && !order.includes(q)) order.push(q);
  order.push(defender);
  for (const q of order) {
    const hand = g.hands[q] as string[];
    while (hand.length < HAND && g.deck.length > 0) hand.push(g.deck.pop() as string);
  }
  g.table = [];
  g.taking = false;
  g.passed = [];
  g.contributors = [];
  g.firstBout = false;
  // Колода кончилась — у кого нет карт, тот вышел.
  if (g.deck.length === 0) {
    for (const q of g.seats) {
      if (!g.out.includes(q) && (g.hands[q]?.length ?? 0) === 0) {
        g.out.push(q);
        g.lastExit = { pid: q, cards: g.lastPlayed[q] ?? [] };
      }
    }
  }
  const left = active(g);
  if (left.length <= 1) {
    g.over = true;
    g.loser = left[0] ?? null;
    g.draw = left.length === 0;
    if (g.loser && g.lastExit && g.lastExit.cards.length > 0 && g.lastExit.cards.every((c) => rankOf(c) === 6)) g.pogony = g.lastExit.cards.length;
    return g;
  }
  let attacker = took ? nextActive(g, defender) : defender;
  if (g.out.includes(attacker)) attacker = nextActive(g, attacker);
  g.attacker = attacker;
  g.defender = nextActive(g, attacker);
  g.limit = Math.min(HAND, g.hands[g.defender]?.length ?? 0);
  return g;
}

// ---------------------------------------------------------------- подсказки, таймер, компьютер

/** Карты, которыми игрок может сыграть сейчас (подсветка на телефоне). */
export function playable(v: TableView, pid: string, hand: string[]): string[] {
  if (v.over || v.out.includes(pid)) return [];
  if (pid === v.defender && !v.taking) {
    const open = uncovered(v).map((i) => (v.table[i] as Pair).a);
    if (open.length === 0) return [];
    return hand.filter((c) => open.some((a) => beats(a, c, v.trump, v.opts.spades)) || canTransfer(v, pid, [c]));
  }
  if (v.table.length === 0) return pid === v.attacker ? [...hand] : [];
  if (!throwers(v).includes(pid) || room(v) === 0) return [];
  const ranks = tableRanks(v);
  return hand.filter((c) => ranks.has(rankOf(c)));
}

/** Кому сейчас нужно действовать. */
export function waitingFor(v: TableView, hands?: Record<string, string[]>): string[] {
  if (v.over) return [];
  if (v.table.length === 0) return [v.attacker];
  const out: string[] = [];
  if (!v.taking && uncovered(v).length > 0) out.push(v.defender);
  else for (const p of throwers(v)) if (!v.passed.includes(p) && (!hands || canThrow(v, p, hands[p] ?? []))) out.push(p);
  return out;
}

function lowest(cards: string[], trump: Suit): string | null {
  const sorted = [...cards].sort((x, y) => Number(suitOf(x) === trump) - Number(suitOf(y) === trump) || rankOf(x) - rankOf(y));
  return sorted[0] ?? null;
}

/** Ход компьютера (место без телефона или «доиграет компьютер»); null — ему нечего делать. */
export function botAction(g: Game, pid: string): DurakAction | null {
  const v = viewOf(g);
  const hand = g.hands[pid] ?? [];
  if (v.over || v.out.includes(pid)) return null;
  if (v.table.length === 0) {
    if (pid !== v.attacker) return null;
    const c = lowest(hand, v.trump);
    return c ? { a: "attack", c: [c] } : null;
  }
  if (pid === v.defender) {
    if (v.taking) return null;
    const open = uncovered(v);
    if (open.length === 0) return null;
    const t = open[0] as number;
    const a = (v.table[t] as Pair).a;
    const options = hand.filter((c) => beats(a, c, v.trump, v.opts.spades));
    const c = lowest(options, v.trump);
    return c ? { a: "defend", c, t } : { a: "take" };
  }
  if ((v.taking || uncovered(v).length === 0) && throwers(v).includes(pid) && !v.passed.includes(pid)) return { a: "pass" };
  return null;
}

/** Время хода вышло: что сделать за тех, кого ждали. */
export function timeoutActions(g: Game): Array<{ pid: string; action: DurakAction }> {
  const v = viewOf(g);
  if (v.over) return [];
  if (v.table.length === 0) {
    const c = lowest(g.hands[v.attacker] ?? [], v.trump);
    return c ? [{ pid: v.attacker, action: { a: "attack", c: [c] } }] : [];
  }
  if (!v.taking && uncovered(v).length > 0) return [{ pid: v.defender, action: { a: "take" } }];
  return throwers(v)
    .filter((p) => !v.passed.includes(p))
    .map((pid) => ({ pid, action: { a: "pass" } as DurakAction }));
}

export function parseAction(raw: unknown): DurakAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const cards = Array.isArray(d.c) ? d.c.filter(isCard).slice(0, 6) : [];
  if (d.a === "attack" && cards.length > 0) return { a: "attack", c: cards };
  if (d.a === "transfer" && cards.length > 0) return { a: "transfer", c: cards };
  if (d.a === "defend" && isCard(d.c) && typeof d.t === "number" && Number.isInteger(d.t)) return { a: "defend", c: d.c, t: d.t };
  if (d.a === "take") return { a: "take" };
  if (d.a === "pass") return { a: "pass" };
  return null;
}

/** Сортировка руки: по мастям, козыри справа, внутри — по старшинству. */
export function sortHand(hand: string[], trump: Suit): string[] {
  const order = (c: string) => (suitOf(c) === trump ? 4 : SUITS.indexOf(suitOf(c)));
  return [...hand].sort((x, y) => order(x) - order(y) || rankOf(x) - rankOf(y));
}
