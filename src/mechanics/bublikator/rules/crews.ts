/**
 * Экипажи: выбор в лобби, «Собрать экипажи» (делим поровну, выбранные — как выбрали), игроки и дублёры (больше 10 —
 * дублёры), опоздавшие (дублёр в самом маленьком экипаже, полноценно — со следующего перелёта), объединение и пересадка.
 */
import { CREW_SPLIT, CREWS_MAX, HULL_MAX } from "./constants";
import { crewLook, crewName } from "./names";
import type { BubState, Crew, Member, Roster } from "./types";

export function newCrew(id: number, name: string, look: { color: number; icon: number | null }): Crew {
  return {
    id,
    name,
    color: look.color,
    icon: look.icon,
    gone: false,
    hull: HULL_MAX,
    repair: null,
    clock: 0,
    dist: 0,
    finishedAt: null,
    bonus: { meteor: 0, sos: 0, captain: {}, finish: 0 },
    streak: 0,
    bestStreak: 0,
    done: 0,
    failed: 0,
    fakeDone: 0,
    impulses: [],
    okSeq: 0,
    failSeq: 0,
    salutes: 0,
    saboteur: null,
    shield: null,
    legShield: 0,
    pull: null,
    sos: null,
    legs: [],
    voteBonus: 0,
    guessed: 0,
    merged: 0,
  };
}

/** Сколько экипажей, если делить N гостей: ceil(N / 7), от 2 до 20, но не меньше min человек в каждом (иначе меньше экипажей, хотя бы 1). */
export function crewCountFor(players: number, minSize: number): number {
  if (players <= 0) return 0;
  const k = Math.min(CREWS_MAX, Math.max(2, Math.ceil(players / CREW_SPLIT)));
  return Math.max(1, Math.min(k, Math.floor(players / Math.max(1, minSize))));
}

/**
 * Командная сессия: экипажи команд — по порядку команд платформы (новые — следующими свободными номерами, до 20). Только в
 * лобби: после «Собрать экипажи» новых экипажей не бывает, и команда, появившаяся позже, получает экипаж, где сели её люди
 * (`adoptTeams`). Раньше ей доставался номер несуществующего экипажа — и 0 очков в итогах (проверка 2d, №1).
 */
export function registerTeams(s: BubState, teams: Iterable<string>): void {
  if (!s.teamsMode || s.phase !== "lobby") return;
  const map = (s.teamCrew ??= {});
  // Занятые номера — и экипажи уже в игре: команда, появившаяся после сбора, чужой экипаж не получит.
  const used = new Set([...Object.values(map), ...s.crews.map((c) => c.id)]);
  let next = 0;
  for (const team of teams) {
    if (map[team] !== undefined) continue;
    while (used.has(next) && next < CREWS_MAX) next += 1;
    if (next >= CREWS_MAX) return;
    map[team] = next;
    used.add(next);
  }
}

/** Экипаж есть и в игре (не влит в другой). */
function liveCrew(s: BubState, id: number | undefined): boolean {
  return id !== undefined && s.crews.some((c) => c.id === id && !c.gone);
}

/**
 * Командная сессия после сбора: команда без своего экипажа (появилась после «Собрать экипажи», в лобби была без людей или сверх
 * 20) — в экипаже, где сидит первый по входу её человек. Тот же механизм, что у влитых команд (решение владельца A, 13 ноября
 * 2026): в таблице лидеров у неё общий счёт этого экипажа и его группа — то же место, без лишней строки, «из M» — по экипажам.
 * Следующие её люди садятся туда же (`teamCrewOf`). Убранный гость («Убрать») остаётся в экипаже — команда тоже.
 */
export function adoptTeams(s: BubState): boolean {
  if (!s.teamsMode || s.crews.length === 0) return false;
  const map = (s.teamCrew ??= {});
  let changed = false;
  for (const [team, id] of Object.entries(map)) {
    if (!liveCrew(s, id)) {
      delete map[team];
      changed = true;
    }
  }
  for (const m of roster(s).active) {
    if (m.team === undefined || m.team === null || map[m.team] !== undefined || m.crew === null || !liveCrew(s, m.crew)) continue;
    map[m.team] = m.crew;
    changed = true;
  }
  return changed;
}

/** Названия команд платформы: запоминаем и переименования (экипаж называется как команда). */
export function nameTeams(s: BubState, teams: ReadonlyMap<string, string>): boolean {
  if (!s.teamsMode) return false;
  const names = (s.teamNames ??= {});
  let changed = false;
  for (const [id, name] of teams) {
    if (names[id] === name) continue;
    names[id] = name;
    changed = true;
  }
  if (!changed) return false;
  for (const c of s.crews) {
    const title = c.team !== undefined ? names[c.team] : undefined;
    if (title && title !== c.name) c.name = title;
  }
  return true;
}

/** Командная сессия: название экипажа — название его команды (первой по порядку, если в экипаж влили другие). */
export function teamTitle(s: BubState, crew: number): string | null {
  if (!s.teamsMode || !s.teamCrew) return null;
  for (const [team, id] of Object.entries(s.teamCrew)) {
    if (id !== crew) continue;
    const name = s.teamNames?.[team];
    if (name) return name;
  }
  return null;
}

/** Название экипажа: в командной сессии — как команда, иначе — по теме. */
export function crewTitle(s: BubState, crew: number): string {
  return teamTitle(s, crew) ?? crewName(s.content.theme, crew);
}

/** Экипаж команды (командная сессия); null — не командная сессия, без команды или команда сверх 20. */
export function teamCrewOf(s: BubState, team: string | null | undefined): number | null {
  if (!s.teamsMode || team === null || team === undefined) return null;
  return s.teamCrew?.[team] ?? null;
}

/** Экипажи на выбор в лобби: не меньше 2 и не меньше тех, кого уже выбрали; в командной сессии — экипажи команд. */
export function lobbyCrewCount(s: BubState): number {
  const ix = roster(s);
  if (s.teamsMode) return Math.min(CREWS_MAX, Math.max(1, ix.highestChoice + 1));
  const active = ix.active;
  return Math.min(CREWS_MAX, Math.max(2, crewCountFor(active.length, s.content.crewSize.min), Math.ceil(active.length / s.content.crewSize.max), ix.highestChoice + 1));
}

/**
 * Составы — один раз на изменение (а не на каждый вызов): кто в игре по порядку входа, кто в каком экипаже, игроки, сколько
 * дублёров у каждого игрока. Любое изменение экипажа, роли, ухода или нового участника — `rosterChanged(s)`; в тестах
 * сверяется с пересчётом с нуля (`rosterFresh`).
 */
const EMPTY: readonly Member[] = [];

export function rosterChanged(s: BubState): void {
  s.rt.rosterVer += 1;
}

export function rosterFresh(s: BubState): Roster {
  const all = Object.values(s.members);
  let sorted = true;
  for (let i = 1; i < all.length; i += 1) if ((all[i - 1]?.join ?? 0) > (all[i]?.join ?? 0)) sorted = false;
  if (!sorted) all.sort((a, b) => a.join - b.join);
  const active: Member[] = [];
  const byCrew = new Map<number, Member[]>();
  const players = new Map<number, Member[]>();
  const doublesOf = new Map<string, number>();
  let highestChoice = -1;
  for (const m of all) {
    if (m.gone) continue;
    active.push(m);
    if (m.crew !== null) {
      if (m.crew > highestChoice) highestChoice = m.crew;
      const list = byCrew.get(m.crew);
      if (list) list.push(m);
      else byCrew.set(m.crew, [m]);
      if (m.role === "player") {
        const pl = players.get(m.crew);
        if (pl) pl.push(m);
        else players.set(m.crew, [m]);
      }
    }
    if (m.role === "double" && m.doubleOf !== null) doublesOf.set(m.doubleOf, (doublesOf.get(m.doubleOf) ?? 0) + 1);
  }
  return { ver: s.rt.rosterVer, active, byCrew, players, doublesOf, highestChoice };
}

export function roster(s: BubState): Roster {
  const ix = s.rt.roster;
  if (ix && ix.ver === s.rt.rosterVer) return ix;
  const fresh = rosterFresh(s);
  s.rt.roster = fresh;
  return fresh;
}

/** В игре (не ушли), по порядку входа. Массив общий — не менять. */
export function activeMembers(s: BubState): readonly Member[] {
  return roster(s).active;
}

export function crewMembers(s: BubState, crew: number): readonly Member[] {
  return roster(s).byCrew.get(crew) ?? EMPTY;
}

export function crewPlayers(s: BubState, crew: number): readonly Member[] {
  return roster(s).players.get(crew) ?? EMPTY;
}

export function liveCrews(s: BubState): Crew[] {
  return s.crews.filter((c) => !c.gone);
}

/** Самый маленький экипаж (игроки и дублёры), при равенстве — меньший номер. */
export function smallestCrew(s: BubState, withPlayers = false): Crew | null {
  let best: Crew | null = null;
  let size = Infinity;
  for (const c of liveCrews(s)) {
    if (withPlayers && crewPlayers(s, c.id).length === 0) continue;
    const n = crewMembers(s, c.id).length;
    if (n < size) {
      size = n;
      best = c;
    }
  }
  return best;
}

/** Дублёр делит пульт игрока, у которого меньше всего дублёров (при равенстве — кто раньше вошёл). */
export function pickDoubleOf(s: BubState, crew: number, except: string | null = null): string | null {
  const ix = roster(s);
  let best: string | null = null;
  let fewest = Infinity;
  for (const p of ix.players.get(crew) ?? EMPTY) {
    if (p.pid === except) continue;
    const n = ix.doublesOf.get(p.pid) ?? 0;
    if (n < fewest) {
      fewest = n;
      best = p.pid;
    }
  }
  return best;
}

/**
 * Роли экипажа по порядку входа: первые max (кроме убранных) — игроки, остальные — дублёры. `keepPending` — посреди
 * перелёта опоздавшие остаются дублёрами до следующей раздачи; иначе (до перелёта, между перелётами) — сразу игроки.
 */
export function assignRoles(s: BubState, crew: number, keepPending: boolean, touch = true): void {
  const max = s.content.crewSize.max;
  const members = [...crewMembers(s, crew)];
  let players = 0;
  const doubles: Member[] = [];
  const owners: Member[] = [];
  for (const m of members) {
    if (m.role === "out") continue;
    if (keepPending && m.pending) {
      doubles.push(m);
      continue;
    }
    if (players < max) {
      m.role = "player";
      m.doubleOf = null;
      m.pending = false;
      players += 1;
      owners.push(m);
    } else {
      doubles.push(m);
    }
  }
  // Дублёры — по кругу к игрокам, у кого их меньше (при равенстве — кто раньше вошёл).
  const count = new Map<string, number>(owners.map((o) => [o.pid, 0]));
  for (const d of doubles) {
    d.role = "double";
    let best: Member | null = null;
    let fewest = Infinity;
    for (const o of owners) {
      const n = count.get(o.pid) ?? 0;
      if (n < fewest) {
        fewest = n;
        best = o;
      }
    }
    d.doubleOf = best?.pid ?? null;
    if (best) count.set(best.pid, fewest + 1);
  }
  if (touch) rosterChanged(s);
}

/** Роли во всех экипажах сразу: составы экипажей не меняются, поэтому пересчёт составов — один раз в конце. */
export function assignAllRoles(s: BubState, keepPending: boolean): void {
  for (const c of liveCrews(s)) assignRoles(s, c.id, keepPending, false);
  rosterChanged(s);
}

/** «Собрать экипажи»: выбранные остаются, остальные — в самые маленькие; экипажей ceil(N / 7), но не меньше выбранных. */
export function gatherCrews(s: BubState): void {
  if (s.teamsMode && gatherTeams(s)) return;
  const active = [...activeMembers(s)];
  const chosen = [...new Set(active.map((m) => m.crew).filter((c): c is number => c !== null && c < CREWS_MAX))].sort((a, b) => a - b);
  // Экипажей хватает, чтобы никому не стать дублёром: не меньше ceil(N / max) (до 20 — дальше лишние станут дублёрами).
  const want = Math.min(CREWS_MAX, Math.max(crewCountFor(active.length, s.content.crewSize.min), Math.ceil(active.length / s.content.crewSize.max), chosen.length));
  const ids = [...chosen];
  for (let id = 0; ids.length < want && id < CREWS_MAX; id += 1) if (!ids.includes(id)) ids.push(id);
  ids.sort((a, b) => a - b);
  s.crews = ids.map((id) => newCrew(id, crewName(s.content.theme, id), crewLook(id, ids.length)));
  const max = s.content.crewSize.max;
  // Выбравшие сверх места (не должно случаться — лобби не пускает в полный экипаж) — в общую очередь.
  const count = new Map<number, number>();
  const waiting: Member[] = [];
  for (const m of active) {
    const n = m.crew === null || !ids.includes(m.crew) ? -1 : (count.get(m.crew) ?? 0);
    if (m.crew === null || n < 0 || n >= max) {
      m.crew = null;
      waiting.push(m);
    } else count.set(m.crew, n + 1);
    m.role = "player";
    m.pending = false;
    m.doubleOf = null;
  }
  for (const m of waiting) {
    let best: number | null = null;
    let size = Infinity;
    for (const id of ids) {
      const n = count.get(id) ?? 0;
      if (n < size) {
        size = n;
        best = id;
      }
    }
    if (best === null) continue;
    m.crew = best;
    count.set(best, size + 1);
  }
  rosterChanged(s);
  for (const id of ids) assignRoles(s, id, false, false);
  rosterChanged(s);
}

/**
 * Командная сессия: экипажей — столько, сколько команд с людьми (до 20); вся команда — в своём экипаже, сверх `max` — дублёры
 * (по ТЗ). Без команды — в самый маленький. Ни у кого нет команды — false (обычный сбор).
 */
function gatherTeams(s: BubState): boolean {
  const active = [...activeMembers(s)];
  const ids = [...new Set(active.map((m) => m.crew).filter((c): c is number => c !== null && c < CREWS_MAX))].sort((a, b) => a - b);
  if (ids.length === 0) return false;
  s.crews = ids.map((id) => {
    const c = newCrew(id, crewTitle(s, id), crewLook(id, ids.length));
    const team = Object.entries(s.teamCrew ?? {}).find(([, x]) => x === id)?.[0];
    if (team !== undefined) c.team = team;
    return c;
  });
  const count = new Map<number, number>();
  const waiting: Member[] = [];
  for (const m of active) {
    m.role = "player";
    m.pending = false;
    m.doubleOf = null;
    if (m.crew === null || !ids.includes(m.crew)) {
      m.crew = null;
      waiting.push(m);
    } else count.set(m.crew, (count.get(m.crew) ?? 0) + 1);
  }
  for (const m of waiting) {
    let best = ids[0] ?? 0;
    for (const id of ids) if ((count.get(id) ?? 0) < (count.get(best) ?? 0)) best = id;
    m.crew = best;
    count.set(best, (count.get(best) ?? 0) + 1);
  }
  rosterChanged(s);
  for (const id of ids) assignRoles(s, id, false, false);
  rosterChanged(s);
  adoptTeams(s);
  return true;
}

/** Гость пришёл после сбора экипажей (или вернулся после «Убрать»): дублёр в самом маленьком (своём) экипаже. */
export function seatLate(s: BubState, m: Member, ownCrew: number | null, midLeg: boolean): void {
  const crew = ownCrew !== null && s.crews.some((c) => c.id === ownCrew && !c.gone) ? ownCrew : (smallestCrew(s, true) ?? smallestCrew(s))?.id ?? null;
  m.crew = crew;
  m.pending = true;
  m.role = "double";
  m.doubleOf = null;
  rosterChanged(s);
  m.doubleOf = crew === null ? null : pickDoubleOf(s, crew, m.pid);
  m.order = null;
  rosterChanged(s);
  if (crew !== null && !midLeg) assignRoles(s, crew, false);
  adoptTeams(s);
}

export function moveMember(s: BubState, m: Member, crew: number, midLeg: boolean): void {
  const from = m.crew;
  m.crew = crew;
  m.order = null;
  if (m.role === "out") m.role = "double";
  m.pending = midLeg;
  rosterChanged(s);
  if (from !== null) assignRoles(s, from, midLeg);
  assignRoles(s, crew, midLeg);
}

/** «Объединить экипажи»: все из `from` — в `to` (сверх 10 — дублёры), экипаж `from` исчезает. */
export function mergeCrews(s: BubState, from: Crew, to: Crew): void {
  for (const m of [...crewMembers(s, from.id)]) {
    m.crew = to.id;
    m.order = null;
  }
  from.gone = true;
  // Командная сессия: команда влитого экипажа теперь летит в `to` (смена команды и вход — туда же).
  if (s.teamCrew) for (const [team, id] of Object.entries(s.teamCrew)) if (id === from.id) s.teamCrew[team] = to.id;
  rosterChanged(s);
  assignRoles(s, to.id, false);
}

/** Капитан для «Сигнала SOS»: первый на связи игрок по порядку входа. */
export function captainOf(s: BubState, crew: number, online: (pid: string) => boolean): Member | null {
  return crewPlayers(s, crew).find((p) => online(p.pid)) ?? null;
}
