/** Игроки и болельщики «Игр Матрёшки»: кто в игре, вылет, «Убрать», «Вернуть», Копилка, места и очки (docs/matryoshka.md). */
import { JUST_OUT_MAX, LIVES_RETURN, POINTS_STEP } from "./constants";
import { champion, finalPlaces } from "./final";
import type { MatState, Member } from "./types";

export function newMember(pid: string, name: string, num: number): Member {
  return { pid, name, num, role: "lobby", late: false, gone: false, removed: false, hearts: 0, outSeq: null, outAt: null, everOut: false, returned: false, coins: 0, places: [], fanScore: 0, fanSince: null };
}

const byNum = (a: Member, b: Member) => a.num - b.num;

/** Кто в игре (игроки, не ушедшие), по номеру. */
export function inGame(s: MatState): Member[] {
  return Object.values(s.members)
    .filter((m) => m.role === "player" && !m.gone)
    .sort(byNum);
}

export function inGamePids(s: MatState): string[] {
  return inGame(s).map((m) => m.pid);
}

/** Болельщики (выбывшие и опоздавшие), по номеру. */
export function fans(s: MatState): Member[] {
  return Object.values(s.members)
    .filter((m) => m.role === "fan" && !m.gone)
    .sort(byNum);
}

/** Выбывшие игрой (для «Второго шанса»): болельщики, кто выбыл игрой и не убран. */
export function knockedOut(s: MatState): Member[] {
  return fans(s).filter((m) => m.everOut && !m.removed && !m.late);
}

/** Вылет игрой: болельщик, монета в Копилку, номер вылета (больше — позже), «только что в сугробе». */
export function eliminate(s: MatState, m: Member, where: string): void {
  m.role = "fan";
  m.hearts = 0;
  s.outSeq += 1;
  m.outSeq = s.outSeq;
  m.outAt = where;
  m.everOut = true;
  m.fanSince = s.outSeq;
  s.piggy += 1;
  s.justOut = [m.pid, ...s.justOut.filter((p) => p !== m.pid)].slice(0, JUST_OUT_MAX);
}

/** «Убрать игрока» (или ушёл из сессии): болельщик без монеты, место — как выбывший сейчас. */
export function removePlayer(s: MatState, m: Member): void {
  m.role = "fan";
  m.removed = true;
  m.hearts = 0;
  s.outSeq += 1;
  m.outSeq = s.outSeq;
  m.outAt = "removed";
  m.fanSince ??= s.outSeq;
}

/** «Вернуть игрока» и «Второй шанс»: снова в игре с одним сердечком. */
export function bringBack(m: Member): void {
  m.role = "player";
  m.hearts = LIVES_RETURN;
  m.removed = false;
  m.returned = true;
  m.outSeq = null;
  m.outAt = null;
}

/** Сумма мест во всех сыгранных испытаниях (не играл — число участников + 1). */
export function placeSum(s: MatState, m: Member): number {
  let sum = 0;
  s.plan.forEach((_, i) => {
    if (!s.playedTrials[i]) return;
    const p = m.places[i];
    sum += p ?? (s.trialSizes[i] ?? 0) + 1;
  });
  return sum;
}

export interface Standing {
  pid: string;
  num: number;
  name: string;
  place: number;
  points: number;
}

/**
 * Места и очки для таблицы лидеров (L28): финалисты — по финалу; остальные игроки — по вылету (позже — выше); ещё в игре —
 * над выбывшими. Опоздавшие (никогда не игравшие) в таблице не играют. Очки = (N − место + 1) × 10; равные места — равные очки.
 */
export function standings(s: MatState): Standing[] {
  const ranked = Object.values(s.members).filter((m) => !m.late && m.role !== "lobby");
  const N = ranked.length;
  const placed = new Map<string, number>();
  if (s.final) for (const [pid, place] of finalPlaces(s.final)) placed.set(pid, place);
  const finalists = s.final ? new Set(s.final.seeds) : new Set<string>();
  // Места финала — как в спорте (1, 2, 3, 3 → следующий 5): следующее место — число уже поставленных + 1.
  let next = placed.size + 1;
  // Ещё в игре, не финалисты (игра не дошла до финала): по сердечкам и сумме мест.
  const alive = ranked.filter((m) => m.role === "player" && !finalists.has(m.pid)).sort((a, b) => b.hearts - a.hearts || placeSum(s, a) - placeSum(s, b) || a.num - b.num);
  for (const m of alive) placed.set(m.pid, next++);
  // Финалисты без места (финал не доигран) — следом, по посеву.
  for (const pid of s.final?.seeds ?? []) if (!placed.has(pid)) placed.set(pid, next++);
  const out = ranked.filter((m) => !placed.has(m.pid)).sort((a, b) => (b.outSeq ?? 0) - (a.outSeq ?? 0) || a.num - b.num);
  for (const m of out) placed.set(m.pid, next++);
  return ranked
    .map((m) => {
      const place = placed.get(m.pid) ?? N;
      return { pid: m.pid, num: m.num, name: m.name, place, points: (N - place + 1) * POINTS_STEP };
    })
    .sort((a, b) => a.place - b.place || a.num - b.num);
}

/** Чемпион игры (null — финала нет или без чемпиона). */
export function championOf(s: MatState): string | null {
  return s.final ? (s.final.champion ?? champion(s.final)) : null;
}

/**
 * «Лучший болельщик»: больше всех очков болельщика (> 0); равенство — кто болел дольше (опоздавший — дольше всех, выбывший —
 * кто выбыл раньше, L31), дальше — жребий.
 */
export function bestFanOf(s: MatState, lot: (pid: string) => number): string | null {
  const list = Object.values(s.members).filter((m) => m.fanScore > 0 && m.role !== "lobby");
  if (list.length === 0) return null;
  list.sort((a, b) => b.fanScore - a.fanScore || (a.late ? -1 : a.fanSince ?? 0) - (b.late ? -1 : b.fanSince ?? 0) || lot(a.pid) - lot(b.pid));
  return list[0]?.pid ?? null;
}
