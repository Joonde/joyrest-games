import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session } from "../../data/types";
import { countsFor, createMafia, type MafiaContent, type RoleId } from "./content";
import {
  canHeal,
  dealRoles,
  dealt,
  finishGame,
  isMafia,
  morning,
  parseMafiaResult,
  resolveNight,
  startDay,
  startDeal,
  startMeet,
  startNight,
  startVote,
  verdict,
  type MafiaResult,
} from "./logic";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function session(): Session {
  return {
    id: "stress",
    code: "000000",
    hostId: "host",
    gameId: "game",
    gameTitle: "Мафия",
    mechanic: "mafia",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: { ...startState(), phase: "playing" },
    leaderboard: {},
    createdAt: 0,
  } as Session;
}

function participantsOf(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Игрок ${i + 1}`, kind: "player", teamId: null, captainUid: `p${i}`, joinedAt: i + 1 }));
}

function checkState(r: MafiaResult, roles: Record<string, RoleId>): void {
  expect(new Set(r.seats).size).toBe(r.seats.length);
  expect(new Set(r.alive).size).toBe(r.alive.length);
  for (const pid of r.alive) expect(r.seats).toContain(pid);
  for (const pid of r.seats) expect(roles[pid]).toBeDefined();
  const dead = r.deaths.map((d) => d.pid);
  expect(new Set(dead).size).toBe(dead.length);
  for (const pid of dead) {
    expect(r.seats).toContain(pid);
    expect(r.alive).not.toContain(pid);
  }
  expect(r.alive.length + dead.length).toBe(r.seats.length);
  for (const pid of r.killed) {
    expect(dead).toContain(pid);
    expect(r.alive).not.toContain(pid);
  }
  if (r.winner) expect(["city", "mafia", "maniac"]).toContain(r.winner);
}

function playParty(base: Session, participants: Participant[], content: MafiaContent, seed: number): { session: Session; rounds: number; winner: NonNullable<MafiaResult["winner"]> } {
  const random = mulberry32(seed);
  let s = applyChange(base, startDeal(base, participants), 1);
  let r = parseMafiaResult(s.state.result);
  const roles = dealRoles(r.seats, countsFor(content, r.seats.length), random);
  s = applyChange(s, dealt(s, {}, null), 2);
  s = applyChange(s, startMeet(s), 3);
  const healHistory: Array<string | null> = [];
  const visitHistory: Array<string | null> = [];
  let rounds = 0;

  for (let guard = 0; guard < 100; guard++) {
    rounds = guard + 1;
    r = parseMafiaResult(s.state.result);
    checkState(r, roles);
    s = applyChange(s, startDay(s), 10 + guard * 10);
    r = parseMafiaResult(s.state.result);

    // Часть дней голосование пропускается, чтобы ночные взаимодействия тоже решали исход.
    if ((guard + seed) % 3 !== 0 && r.alive.length > 1) {
      const priority = seed % 3 === 0 ? ["maniac", "mafia", "civilian"] : seed % 3 === 1 ? ["mafia", "maniac", "civilian"] : ["civilian", "maniac", "mafia"];
      let suspect: string | null = null;
      for (const wanted of priority) {
        suspect = wanted === "mafia" ? (r.alive.find((p) => isMafia(roles[p])) ?? null) : (r.alive.find((p) => roles[p] === wanted) ?? null);
        if (suspect) break;
      }
      suspect ??= r.alive[Math.floor(random() * r.alive.length)] ?? null;
      if (suspect) {
        s = applyChange(s, startVote(s, content, [suspect]), 11 + guard * 10);
        const step = s.state.step;
        const answers: Answer[] = r.alive.map((pid) => ({ id: `${step}_${pid}`, step, pid, uid: pid, value: { vote: pid === suspect ? "none" : suspect }, submittedAt: 1 }));
        s = applyChange(s, verdict(s, content, answers, roles), 12 + guard * 10);
        r = parseMafiaResult(s.state.result);
        checkState(r, roles);
        if (r.winner) {
          s = applyChange(s, finishGame(s, content, roles, r.winner), 13 + guard * 10);
          return { session: s, rounds, winner: r.winner };
        }
      }
    }

    s = applyChange(s, startNight(s), 14 + guard * 10);
    r = parseMafiaResult(s.state.result);
    const family = r.alive.filter((p) => isMafia(roles[p]));
    const maniac = r.alive.find((p) => roles[p] === "maniac") ?? null;
    const commissar = r.alive.find((p) => roles[p] === "commissar") ?? null;
    const doctor = r.alive.find((p) => roles[p] === "doctor") ?? null;
    const advocate = r.alive.find((p) => roles[p] === "advocate") ?? null;
    const courtesan = r.alive.find((p) => roles[p] === "courtesan") ?? null;
    const mafiaTarget = maniac ?? commissar ?? r.alive.find((p) => !isMafia(roles[p])) ?? null;
    const maniacTarget = family[0] ?? commissar ?? r.alive.find((p) => p !== maniac) ?? null;
    const visit = courtesan ? ((guard + seed) % 2 === 0 ? (family[0] ?? maniac) : (maniac ?? family[0])) ?? null : null;
    const healWanted = doctor ? ((guard + seed) % 2 === 0 ? mafiaTarget : (maniacTarget ?? mafiaTarget)) : null;
    const choices: Record<string, string | null> = {};
    for (const pid of r.alive) {
      const role = roles[pid];
      if (isMafia(role)) choices[pid] = mafiaTarget;
      else if (role === "maniac") choices[pid] = maniacTarget;
      else if (role === "courtesan") choices[pid] = visit;
      else if (role === "doctor") choices[pid] = healWanted && canHeal(pid, healWanted, healHistory) ? healWanted : null;
      else if (role === "commissar") choices[pid] = family[0] ?? maniac;
      else choices[pid] = r.alive.find((p) => p !== pid) ?? null;
    }
    const outcome = resolveNight(roles, r.alive, choices, healHistory, commissar, advocate, visitHistory);
    healHistory.push(outcome.healed);
    visitHistory.push(outcome.courtesanTarget);
    s = applyChange(s, morning(s, content, outcome, roles), 15 + guard * 10);
    r = parseMafiaResult(s.state.result);
    checkState(r, roles);
    if (r.winner) {
      s = applyChange(s, finishGame(s, content, roles, r.winner), 16 + guard * 10);
      return { session: s, rounds, winner: r.winner };
    }
  }
  throw new Error(`Партия не завершилась за 100 раундов: ${r.seats.length} игроков, seed=${seed}`);
}

describe("QA-стресс: полные партии без зависаний", () => {
  it("520 партий на 5–30 игроков завершаются и сохраняют инварианты", () => {
    let totalRounds = 0;
    const winners = new Set<string>();
    for (let n = 5; n <= 30; n++) {
      for (let variant = 0; variant < 20; variant++) {
        const seed = n * 1000 + variant;
        const content = createMafia();
        content.revealOnDeath = variant % 2 === 0;
        const result = playParty(session(), participantsOf(n), content, seed);
        totalRounds += result.rounds;
        winners.add(result.winner);
        expect(result.rounds, `n=${n}, seed=${seed}`).toBeLessThanOrEqual(100);
        const r = parseMafiaResult(result.session.state.result);
        expect(r.mode).toBe("over");
        expect(r.winner).toBe(result.winner);
        for (const entry of Object.values(result.session.leaderboard)) {
          expect(Number.isFinite(entry.score)).toBe(true);
          expect(entry.score).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(totalRounds).toBeGreaterThan(520);
    expect(winners.size).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("серии из трёх партий сохраняют очки и не переносят смерти и ночные ответы", () => {
    for (const n of [10, 14, 20]) {
      const participants = participantsOf(n);
      const content = createMafia();
      content.parties = 3;
      let s = session();
      for (let party = 1; party <= 3; party++) {
        const result = playParty(s, participants, content, n * 100 + party);
        s = result.session;
        const r = parseMafiaResult(s.state.result);
        expect(r.party).toBe(party);
        expect(r.mode).toBe("over");
        expect(r.deaths.length).toBeLessThanOrEqual(n);
        for (const entry of Object.values(s.leaderboard)) expect(Number.isFinite(entry.score)).toBe(true);
      }
      expect(Object.values(s.leaderboard).some((entry) => entry.score > 0)).toBe(true);
    }
  }, 30000);
});
