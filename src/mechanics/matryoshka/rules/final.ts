/**
 * Финал «Камень, ножницы, бумага» (docs/matryoshka.md, «Финал»): сетка на 2/4/8 по посеву, лучшие номера без боя, дуэль до
 * двух побед, на третьей ничьей подряд — быстрее выбравший, Матрёшкин жест всегда медленнее, оба — жребий (L24–L27).
 */
import { DUEL_WINS, TIES_RULE } from "./constants";
import type { Duel, FinalState, Gesture } from "./types";

export const GESTURES: readonly Gesture[] = ["r", "p", "s"];

/** Мест в сетке: 2, 4 или 8. */
export function bracketSize(n: number): number {
  return n <= 2 ? 2 : n <= 4 ? 4 : 8;
}

/** Пары первого круга по номерам посева (1-й и 2-й встречаются только в финале). */
export function seedPairs(size: number): Array<[number, number]> {
  if (size === 2) return [[1, 2]];
  if (size === 4) return [[1, 4], [2, 3]];
  return [[1, 8], [4, 5], [2, 7], [3, 6]];
}

export function buildFinal(seeds: string[], t: number): FinalState {
  const size = bracketSize(seeds.length);
  const first = seedPairs(size).map(([a, b]) => [seeds[a - 1] ?? null, seeds[b - 1] ?? null] as [string | null, string | null]);
  const rounds: FinalState["rounds"] = [first];
  const winners: FinalState["winners"] = [first.map(() => null)];
  for (let n = first.length / 2; n >= 1; n /= 2) {
    rounds.push(Array.from({ length: n }, () => [null, null] as [string | null, string | null]));
    winners.push(Array.from({ length: n }, () => null));
  }
  return { stage: "bracket", stageAt: t, seeds, size, rounds, winners, at: null, duel: null, lostIn: {}, champion: null, duels: 0 };
}

/** Победитель матча записан — он идёт в следующий круг; последний круг — чемпион. */
export function setWinner(f: FinalState, round: number, match: number, winner: string | null, loser: string | null): void {
  const w = f.winners[round];
  if (!w) return;
  w[match] = winner;
  if (loser !== null) f.lostIn[loser] = round;
  const next = f.rounds[round + 1];
  if (!next) {
    f.champion = winner;
    return;
  }
  const pair = next[Math.floor(match / 2)];
  if (pair) pair[match % 2] = winner;
}

/** Матч сыгран без боя (нет соперника или ушёл), когда известны оба места. */
function settleByes(f: FinalState, gone: (pid: string) => boolean): void {
  for (let r = 0; r < f.rounds.length; r += 1) {
    const round = f.rounds[r] ?? [];
    const prevDone = r === 0 || (f.winners[r - 1] ?? []).every((w, i) => w !== null || isEmptyMatch(f, r - 1, i));
    if (!prevDone) return;
    round.forEach(([a, b], i) => {
      if ((f.winners[r] ?? [])[i] !== null) return;
      const ga = a === null || gone(a);
      const gb = b === null || gone(b);
      if (ga && gb) {
        if (!(f.winners[r] ?? [])[i]) markEmpty(f, r, i, a, b);
      } else if (ga) setWinner(f, r, i, b, a);
      else if (gb) setWinner(f, r, i, a, b);
    });
  }
}

const EMPTY = "∅";

function isEmptyMatch(f: FinalState, r: number, i: number): boolean {
  return (f.winners[r] ?? [])[i] === EMPTY;
}

function markEmpty(f: FinalState, r: number, i: number, a: string | null, b: string | null): void {
  const w = f.winners[r];
  if (!w) return;
  w[i] = EMPTY;
  if (a !== null) f.lostIn[a] = r;
  if (b !== null) f.lostIn[b] = r;
  const next = f.rounds[r + 1];
  if (!next) {
    f.champion = null;
    return;
  }
  const pair = next[Math.floor(i / 2)];
  if (pair) pair[i % 2] = null;
}

/** Следующая дуэль: первый несыгранный матч с двумя дуэлянтами (матчи без боя закрываются сами). Нет — null. */
export function nextMatch(f: FinalState, gone: (pid: string) => boolean): { round: number; match: number; a: string; b: string } | null {
  settleByes(f, gone);
  for (let r = 0; r < f.rounds.length; r += 1) {
    const round = f.rounds[r] ?? [];
    for (let i = 0; i < round.length; i += 1) {
      const [a, b] = round[i] ?? [null, null];
      if ((f.winners[r] ?? [])[i] !== null) continue;
      if (a !== null && b !== null) return { round: r, match: i, a, b };
      return null;
    }
  }
  return null;
}

/** Финал сыгран: у последнего круга есть победитель (или пусто). */
export function finalDone(f: FinalState): boolean {
  const last = f.winners.at(-1) ?? [];
  return last.every((w) => w !== null);
}

export function champion(f: FinalState): string | null {
  const w = f.winners.at(-1)?.[0] ?? null;
  return w === EMPTY ? null : w;
}

/**
 * Чемпион с учётом убранных и ушедших (`out`; второе ревью 3a): победитель финала убран или ушёл из сессии — чемпион его
 * соперник по финалу без боя, если сам он здесь; убраны оба — чемпиона нет. Финал не сыгран — null. Копилка, пьедестал и места
 * никогда не достаются убранному.
 */
export function championAmong(f: FinalState, out: (pid: string) => boolean): string | null {
  const w = champion(f);
  if (w === null) return null;
  if (!out(w)) return w;
  const [a, b] = f.rounds.at(-1)?.[0] ?? [null, null];
  const other = a === w ? b : a;
  return other !== null && other !== EMPTY && !out(other) ? other : null;
}

/** 1 — победил первый, −1 — второй, 0 — ничья. */
export function rps(a: Gesture, b: Gesture): number {
  if (a === b) return 0;
  return (a === "r" && b === "s") || (a === "s" && b === "p") || (a === "p" && b === "r") ? 1 : -1;
}

export function newDuel(a: string, b: string, t: number, betsEnds: number | null): Duel {
  return { a, b, wins: [0, 0], ties: 0, roundNo: 0, stage: betsEnds === null ? "pick" : "bets", stageAt: t, stageEnds: betsEnds, picks: {}, auto: {}, bets: {}, history: [], winner: null, forfeit: false };
}

/**
 * Итог раунда: жесты (не выбрал — Матрёшкин, `auto`), время выбора (от начала `pick`; Матрёшкин — бесконечность). Ничья —
 * раунд не считается; на третьей ничьей подряд — быстрее выбравший; оба Матрёшкиных или время равно — жребий.
 */
export function resolveRound(d: Duel, ga: Gesture, gb: Gesture, ta: number, tb: number, lot: () => number): string | null {
  const r = rps(ga, gb);
  const ties = d.ties;
  let winner: string | null = null;
  let bySpeed = false;
  if (r !== 0) {
    winner = r > 0 ? d.a : d.b;
    d.ties = 0;
  } else {
    d.ties += 1;
    if (d.ties >= TIES_RULE) {
      bySpeed = true;
      winner = ta < tb ? d.a : tb < ta ? d.b : lot() < 0.5 ? d.a : d.b;
      d.ties = 0;
    }
  }
  d.history.push({ ga, gb, winner, bySpeed, ties });
  if (winner === d.a) d.wins[0] += 1;
  if (winner === d.b) d.wins[1] += 1;
  if (d.wins[0] >= DUEL_WINS) d.winner = d.a;
  if (d.wins[1] >= DUEL_WINS) d.winner = d.b;
  return winner;
}

/**
 * Места финалистов **на любой момент финала** (L27; аудит 3a — места пишет таблица лидеров платформы): кто ещё в сетке — выше
 * всех, кто уже проиграл; между собой — кто прошёл дальше по сетке, потом по посеву (без общих мест). Проигравшие — по кругу,
 * где проиграли (позже — выше): финал — 2-е, полуфиналы — общее место, четвертьфиналы — по посеву. Когда финал сыгран, это
 * ровно «1 — чемпион, 2 — проиграл финал, 3 — полуфиналы (делят), 5–8 — четвертьфиналы по посеву».
 * Убранные (`out`) мест финала не получают: их место — как выбывших в момент «Убрать» (`standings`). Ответ: pid → место.
 */
export function finalPlaces(f: FinalState, out: (pid: string) => boolean = () => false): Map<string, number> {
  const R = f.rounds.length;
  const champ = champion(f);
  const rows: Array<{ pid: string; depth: number; alive: boolean; seed: number }> = [];
  f.seeds.forEach((pid, seed) => {
    if (out(pid)) return;
    const lost = f.lostIn[pid];
    if (pid === champ) rows.push({ pid, depth: R, alive: true, seed });
    else if (lost !== undefined) rows.push({ pid, depth: lost, alive: false, seed });
    else {
      // Ещё в сетке: дальний круг, где он стоит.
      let depth = 0;
      for (let r = R - 1; r >= 0; r -= 1) {
        if ((f.rounds[r] ?? []).some(([a, b]) => a === pid || b === pid)) {
          depth = r;
          break;
        }
      }
      rows.push({ pid, depth, alive: true, seed });
    }
  });
  rows.sort((a, b) => b.depth - a.depth || Number(b.alive) - Number(a.alive) || a.seed - b.seed);
  const places = new Map<string, number>();
  let place = 1;
  for (let i = 0; i < rows.length; ) {
    const row = rows[i] as (typeof rows)[number];
    // Проигравшие финал и полуфиналы одного круга делят место; остальные — каждый своё.
    const shared = !row.alive && row.depth >= R - 2 ? rows.filter((x, j) => j >= i && !x.alive && x.depth === row.depth) : [row];
    for (const x of shared) places.set(x.pid, place);
    place += shared.length;
    i += shared.length;
  }
  return places;
}
