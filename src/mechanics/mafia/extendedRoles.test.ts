import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Participant, Session } from "../../data/types";
import { activeCount, autoCounts, createMafia, familyCount, parseMafia, type RoleId } from "./content";
import {
  canVisit,
  dealRoles,
  emptyResult,
  finishGame,
  healHistory,
  mafiaChoice,
  morning,
  parseMafiaResult,
  parseRoleCard,
  parseWhisper,
  resolveNight,
  startDay,
  startDeal,
  startNight,
  visitHistory,
  whispers,
  winnerOf,
} from "./logic";

const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
const roles: Record<string, RoleId> = { a: "don", b: "mafia", c: "commissar", d: "doctor", e: "courtesan", f: "maniac", g: "advocate", h: "civilian" };
const players: Participant[] = ids.map((id, i) => ({ id, name: `Игрок ${id}`, kind: "player", teamId: null, captainUid: id, joinedAt: i + 1 }));

function session(): Session {
  return {
    id: "s",
    code: "1",
    hostId: "host",
    gameId: "g",
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

describe("расширенные роли: набор и совместимость", () => {
  it("новые роли появляются на согласованных порогах и не превышают число мест", () => {
    expect(autoCounts(9).courtesan).toBe(0);
    expect(autoCounts(10).courtesan).toBe(1);
    expect(autoCounts(11).maniac).toBe(0);
    expect(autoCounts(12).maniac).toBe(1);
    expect(autoCounts(13).advocate).toBe(0);
    expect(autoCounts(14).advocate).toBe(1);
    for (const n of [10, 12, 14, 20, 30]) {
      const counts = autoCounts(n);
      expect(activeCount(counts)).toBeLessThanOrEqual(n);
      expect(familyCount(counts)).toBeLessThan(n / 2);
    }
  });

  it("раздача на 14 игроков содержит каждую новую роль ровно один раз", () => {
    const seats = Array.from({ length: 14 }, (_, i) => `p${i}`);
    const dealt = dealRoles(seats, autoCounts(14), () => 0.42);
    expect(Object.values(dealt).filter((r) => r === "courtesan")).toHaveLength(1);
    expect(Object.values(dealt).filter((r) => r === "maniac")).toHaveLength(1);
    expect(Object.values(dealt).filter((r) => r === "advocate")).toHaveLength(1);
    expect(Object.keys(dealt)).toHaveLength(14);
  });

  it("старые настройки без новых полей и старая одна жертва читаются без ошибок", () => {
    const content = parseMafia({ roles: "custom", counts: { mafia: 2, don: 1, commissar: 1, doctor: 1 } });
    expect(content.counts).toMatchObject({ advocate: 0, courtesan: 0, maniac: 0 });
    const result = parseMafiaResult({ ...emptyResult(), killed: "c", winner: "maniac" });
    expect(result.killed).toEqual(["c"]);
    expect(result.winner).toBe("maniac");
  });

  it("новые роли проходят через шифрованную карту и подсказку", () => {
    for (const role of ["advocate", "courtesan", "maniac"] as const) {
      expect(parseRoleCard({ role, seat: 3, family: [] })?.role).toBe(role);
    }
    expect(parseWhisper({ lastVisit: "a", blocked: true, familyBlocked: true })).toMatchObject({ lastVisit: "a", blocked: true, familyBlocked: true });
  });
});

describe("расширенные роли: ночные взаимодействия", () => {
  it("Красотка отменяет выстрел при визите к любому члену семьи, включая Адвоката", () => {
    for (const target of ["a", "b", "g"]) {
      const night = resolveNight(roles, ids, { a: "h", b: "h", g: "h", e: target, f: "c" }, [], "c", "g");
      expect(night.familyBlocked).toBe(true);
      expect(night.mafiaTarget).toBeNull();
      expect(night.victims).toEqual(["c"]);
    }
  });

  it("Красотка блокирует Маньяка, Доктора, Комиссара, Дона и защиту Адвоката", () => {
    const maniac = resolveNight(roles, ids, { a: "h", b: "h", g: "h", e: "f", f: "c" }, []);
    expect(maniac.maniacTarget).toBeNull();
    expect(maniac.victims).toEqual(["h"]);

    const doctor = resolveNight(roles, ids, { a: "h", b: "h", g: "h", d: "h", e: "d", f: "h" }, []);
    expect(doctor.healed).toBeNull();
    expect(doctor.victims).toEqual(["h"]);

    const checks = resolveNight(roles, ids, { a: "h", b: "h", g: "h", c: "g", e: "c" }, [], "c", "g");
    expect(checks.comCheck).toBeNull();

    const don = resolveNight(roles, ids, { a: "h", b: "h", g: "h", e: "a" }, [], "c", "g");
    expect(don.donCheck).toBeNull();

    const advocate = resolveNight(roles, ids, { a: "h", b: "h", g: "h", c: "g", e: "g" }, [], "c", "g");
    expect(advocate.advocateProtect).toBeNull();
    expect(advocate.familyBlocked).toBe(true);
  });

  it("повторный визит и визит к себе не работают; история не ломает следующую ночь", () => {
    expect(canVisit("e", "e", [])).toBe(false);
    expect(canVisit("e", "a", ["a"])).toBe(false);
    expect(canVisit("e", "a", ["a", "b"])).toBe(true);
    expect(visitHistory("e", [{ e: "a" }, { e: "a" }, { e: "a" }])).toEqual(["a", null, "a"]);
    const night = resolveNight(roles, ids, { a: "h", b: "h", g: "h", e: "b", f: "c" }, [], null, null, ["b"]);
    expect(night.courtesanTarget).toBeNull();
    expect(night.victims).toEqual(["h", "c"]);
  });

  it("Адвокат даёт ложный «не мафия» только на одну проверку, не меняя сторону игрока", () => {
    const night = resolveNight(roles, ids, { a: "h", b: "h", g: "h", c: "g", e: "h" }, [], null, "g");
    expect(night.comCheck).toEqual({ target: "g", yes: false });
    expect(night.advocateProtect).toBe("g");
    expect(winnerOf(roles, ["a", "b", "g", "h"])).toBe("mafia");
  });

  it("Доктор спасает от любого одного выстрела; две разные жертвы остаются двумя", () => {
    const savedMafia = resolveNight(roles, ids, { a: "h", b: "h", g: "h", d: "h", f: "c" }, []);
    expect(savedMafia.victims).toEqual(["c"]);
    const savedManiac = resolveNight(roles, ids, { a: "h", b: "h", g: "h", d: "c", f: "c" }, []);
    expect(savedManiac.victims).toEqual(["h"]);
    const two = resolveNight(roles, ids, { a: "h", b: "h", g: "h", f: "c" }, []);
    expect(two.victims).toEqual(["h", "c"]);
  });

  it("общая цель мафии и Маньяка даёт одну смерть, а стрелять в свою семью нельзя", () => {
    expect(resolveNight(roles, ids, { a: "h", b: "h", g: "h", f: "h" }, []).victims).toEqual(["h"]);
    expect(mafiaChoice(roles, ids, { a: "g", b: "g", g: "g" })).toBeNull();
  });

  it("история Доктора не расходуется, если его заблокировала Красотка", () => {
    expect(healHistory("d", [{ d: "h" }, { d: "h" }], ["d", null])).toEqual([null, "h"]);
  });
});

describe("расширенные роли: подсказки, утро и победа", () => {
  it("подсказки сообщают блокировку и применяют защиту Адвоката", () => {
    const choices = { a: "h", b: "h", g: "h", c: "g", d: "h", e: "c", f: "h" };
    const extra = { a: "c", g: "g" };
    const outcome = resolveNight(roles, ids, choices, [], "c", "g");
    const w = whispers(roles, ids, choices, extra, [], ["b"], outcome);
    expect(w.c).toMatchObject({ blocked: true, check: null });
    expect(w.e).toMatchObject({ lastVisit: "b" });
    expect(w.a?.familyBlocked).toBeUndefined();
  });

  it("Маньяк побеждает один на один, город ждёт его устранения, мафия проверяет паритет", () => {
    expect(winnerOf(roles, ["f"])).toBe("maniac");
    expect(winnerOf(roles, ["f", "h"])).toBe("maniac");
    expect(winnerOf(roles, ["c", "d", "e", "f", "h"])).toBeNull();
    expect(winnerOf(roles, ["c", "d", "e", "h"])).toBe("city");
    expect(winnerOf(roles, ["a", "b", "g", "f", "h"])).toBe("mafia");
  });

  it("утро удаляет двух разных погибших и сохраняет обе смерти", () => {
    const content = createMafia();
    content.revealOnDeath = true;
    let s = session();
    s = applyChange(s, startDeal(s, players), 1);
    s = applyChange(s, startDay(s), 2);
    s = applyChange(s, startNight(s), 3);
    const outcome = resolveNight(roles, ids, { a: "h", b: "h", g: "h", f: "c" }, []);
    s = applyChange(s, morning(s, content, outcome, roles), 4);
    const r = parseMafiaResult(s.state.result);
    expect(r.killed).toEqual(["h", "c"]);
    expect(r.alive).toEqual(["a", "b", "d", "e", "f", "g"]);
    expect(r.deaths.map((d) => d.pid)).toEqual(["h", "c"]);
    expect(r.deaths.map((d) => d.role)).toEqual(["civilian", "commissar"]);
  });

  it("очки начисляются Маньяку и семье с Адвокатом по их собственным сторонам", () => {
    let s = session();
    s = applyChange(s, startDeal(s, players), 1);
    s = applyChange(s, { state: { result: { ...parseMafiaResult(s.state.result), mode: "morning", alive: ["f", "h"] } } }, 2);
    s = applyChange(s, finishGame(s, createMafia(), roles, "maniac"), 3);
    expect(s.leaderboard.f?.score).toBe(150);
    expect(s.leaderboard.h?.score).toBe(0);
    expect(s.leaderboard.g?.score).toBe(0);
  });
});
