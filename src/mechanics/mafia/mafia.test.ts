import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session } from "../../data/types";
import { autoCounts, countsFor, createMafia, parseMafia, type RoleId } from "./content";
import {
  abortGame,
  canHeal,
  healHistory,
  isTie,
  nightChoices,
  paddedAll,
  whispers,
  dealRoles,
  dealt,
  finishGame,
  mafiaBack,
  familyVotes,
  mafiaChoice,
  mafiaPrimary,
  morning,
  padded,
  PAD_TO,
  parseMafiaResult,
  resolveNight,
  roleCard,
  startDay,
  startDeal,
  startNight,
  startVote,
  tallyVotes,
  toggleNominee,
  verdict,
  winnerOf,
} from "./logic";
import { newKey, seal, unseal } from "./seal";
import { mafia } from "./index";

const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
const roles: Record<string, RoleId> = { a: "don", b: "mafia", c: "commissar", d: "doctor", e: "civilian", f: "civilian", g: "civilian", h: "civilian" };

function session(): Session {
  const leaderboard: Session["leaderboard"] = {};
  return {
    id: "s",
    code: "1",
    hostId: "h",
    gameId: "g",
    gameTitle: "Мафия",
    mechanic: "mafia",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: { ...startState(), phase: "playing" },
    leaderboard,
    createdAt: 0,
  } as Session;
}

const players: Participant[] = ids.map((id, i) => ({ id, name: `Игрок ${id}`, kind: "player", teamId: null, captainUid: id, joinedAt: i + 1 }));
const ans = (step: number, pid: string, value: unknown): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: 10 });

describe("мафия: роли", () => {
  it("число ролей по числу игроков", () => {
    expect(autoCounts(6)).toEqual({ mafia: 1, don: 0, commissar: 1, doctor: 0 });
    expect(autoCounts(8)).toEqual({ mafia: 1, don: 1, commissar: 1, doctor: 1 });
    expect(autoCounts(12)).toEqual({ mafia: 2, don: 1, commissar: 1, doctor: 1 });
    expect(autoCounts(20)).toEqual({ mafia: 4, don: 1, commissar: 1, doctor: 1 });
    const custom = countsFor({ ...createMafia(), roles: "custom", counts: { mafia: 9, don: 1, commissar: 1, doctor: 1 } }, 8);
    expect(custom.mafia + custom.don).toBeLessThan(4);
  });

  it("раздача: все роли ровно один раз, остальные мирные", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const dealtRoles = dealRoles(ids, autoCounts(8), rnd);
    const list = Object.values(dealtRoles);
    expect(list.filter((r) => r === "don")).toHaveLength(1);
    expect(list.filter((r) => r === "mafia")).toHaveLength(1);
    expect(list.filter((r) => r === "commissar")).toHaveLength(1);
    expect(list.filter((r) => r === "doctor")).toHaveLength(1);
    expect(list.filter((r) => r === "civilian")).toHaveLength(4);
  });

  it("карта мафии знает семью, мирного — нет; все карты одной длины", () => {
    const names = Object.fromEntries(ids.map((i) => [i, `Игрок ${i}`]));
    expect(roleCard("b", roles, ids, names).family.map((f) => f.pid)).toEqual(["a"]);
    expect(roleCard("e", roles, ids, names).family).toEqual([]);
    expect(JSON.stringify(padded(roleCard("b", roles, ids, names))).length).toBe(PAD_TO);
    expect(JSON.stringify(padded(roleCard("e", roles, ids, names))).length).toBe(PAD_TO);
  });

  it("шифр: свой ключ открывает, чужой — нет", async () => {
    const mine = newKey();
    const other = newKey();
    const sealed = await seal(mine, { role: "don" });
    expect(await unseal(mine, sealed)).toEqual({ role: "don" });
    expect(await unseal(other, sealed)).toBeNull();
    expect(await unseal(mine, "мусор")).toBeNull();
  });
});

describe("мафия: ночь", () => {
  it("выбор семьи: убийство только если все мафиози выбрали одного", () => {
    expect(mafiaChoice(roles, ids, { a: "e", b: "e" })).toBe("e");
    expect(mafiaChoice(roles, ids, { a: "e", b: "f" })).toBeNull();
    expect(mafiaChoice(roles, ids, { b: "f" })).toBeNull();
    expect(mafiaChoice(roles, ids, {})).toBeNull();
    // Мафиози выбыл — решает оставшийся.
    expect(mafiaChoice(roles, ids.filter((p) => p !== "a"), { b: "f" })).toBe("f");
    expect(familyVotes(roles, ids, { a: "e", b: "e", c: "e" })).toEqual({ e: 2 });
    // Голос мирного в выбор мафии не входит.
    expect(mafiaChoice(roles, ids, { e: "c" })).toBeNull();
  });

  it("Доктор: не того же две ночи подряд, себя — один раз", () => {
    expect(canHeal("d", "e", [])).toBe(true);
    expect(canHeal("d", "e", ["e"])).toBe(false);
    expect(canHeal("d", "e", ["e", "f"])).toBe(true);
    expect(canHeal("d", "d", [])).toBe(true);
    expect(canHeal("d", "d", ["d", "e"])).toBe(false);
  });

  it("ночь: лечение спасает, проверки Дона и Комиссара", () => {
    const saved = resolveNight(roles, ids, { a: "e", b: "e", d: "e", c: "b", f: "a" }, []);
    expect(saved).toMatchObject({ mafiaTarget: "e", healed: "e", victim: null, comCheck: { target: "b", yes: true }, donCheck: null });
    const shot = resolveNight(roles, ids, { a: "c", b: "c", d: "e", c: "f" }, []);
    expect(shot.victim).toBe("c");
    expect(shot.comCheck).toEqual({ target: "f", yes: false });
    expect(resolveNight(roles, ids, { a: "e" }, [], "c").donCheck).toEqual({ target: "c", yes: true });
    expect(resolveNight(roles, ids, { a: "e" }, [], "f").donCheck).toEqual({ target: "f", yes: false });
    // Тот же пациент вторую ночь — лечение не действует.
    expect(resolveNight(roles, ids, { a: "e", b: "e", d: "e" }, ["e"]).victim).toBe("e");
  });

  it("победа: мафии нет — город, мафии не меньше остальных — мафия", () => {
    expect(winnerOf(roles, ids)).toBeNull();
    expect(winnerOf(roles, ["c", "d", "e"])).toBe("city");
    expect(winnerOf(roles, ["a", "b", "e", "f"])).toBe("mafia");
    expect(winnerOf(roles, ["a", "e", "f"])).toBeNull();
  });
});

describe("мафия: музыка ночи", () => {
  it("играет на раздаче, знакомстве и ночью, днём — нет", () => {
    let s = session();
    expect(mafia.music?.(s, createMafia())).toBeNull();
    s = applyChange(s, startDeal(s, players), 1);
    expect(mafia.music?.(s, createMafia())).toBe("mafiaNight");
    s = applyChange(s, dealt(s, {}, null), 2);
    expect(mafia.music?.(s, createMafia())).toBe("mafiaNight");
    s = applyChange(s, startDay(s), 3);
    expect(mafia.music?.(s, createMafia())).toBeNull();
    s = applyChange(s, startNight(s), 4);
    expect(mafia.music?.(s, createMafia())).toBe("mafiaNight");
  });
});

describe("мафия: ночные подсказки", () => {
  it("мафия видит выбор семьи, Дон и Комиссар — свои проверки, Доктор — прошлое лечение", () => {
    const { choices, donCheck } = nightChoices([ans(3, "a", { target: "e", check: "c" }), ans(3, "b", { target: "f" }), ans(3, "c", { target: "b" }), ans(3, "d", { target: "e" }), ans(3, "z", { target: "e" })], ids);
    expect(choices.z).toBeUndefined();
    const w = whispers(roles, ids, choices, donCheck, ["d"]);
    expect(w.a?.family).toEqual({ a: "e", b: "f" });
    expect(w.b?.family).toEqual({ a: "e", b: "f" });
    expect(w.a?.check).toEqual({ target: "c", yes: true });
    expect(w.c?.check).toEqual({ target: "b", yes: true });
    expect(w.d).toEqual({ lastHeal: "d", selfHealed: true });
    expect(w.e).toEqual({});
    expect(w.c?.family).toBeUndefined();
  });

  it("ручной ввод за игроков без телефона, телефон важнее", () => {
    const { choices, donCheck } = nightChoices([ans(3, "b", { target: "f" })], ids, { a: "e", "a#check": "c", b: "g" });
    expect(choices).toMatchObject({ a: "e", b: "f" });
    expect(donCheck.a).toBe("c");
  });

  it("история Доктора и одинаковая длина подсказок", () => {
    expect(healHistory("d", [{ d: "e" }, { d: null }, { d: "d" }])).toEqual(["e", null, "d"]);
    expect(healHistory(null, [{ d: "e" }])).toEqual([]);
    const big = paddedAll({ x: { family: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`player-with-long-id-${i}`, `target-with-long-id-${i}`])) }, y: {} });
    expect(JSON.stringify(big.x).length).toBe(JSON.stringify(big.y).length);
    expect(JSON.stringify(big.x).length).toBeGreaterThan(PAD_TO);
  });
});

describe("мафия: голосование", () => {
  it("ничья — только если равных лидеров с голосами двое и больше", () => {
    expect(isTie({ e: 2, f: 2, none: 0 }, ["e", "f"])).toBe(true);
    expect(isTie({ e: 0, f: 0, none: 3 }, ["e", "f"])).toBe(false);
    expect(isTie({ e: 2, f: 1, none: 3 }, ["e", "f"])).toBe(false);
    expect(isTie(null, ["e", "f"])).toBe(false);
  });

  it("больше голосов — уходит, ничья — никто, «никого» побеждает — никто; за себя не считается", () => {
    const a = (pid: string, vote: string) => ({ pid, value: { vote } });
    expect(tallyVotes([a("a", "e"), a("b", "e"), a("c", "f")], ["e", "f"], ids).out).toBe("e");
    expect(tallyVotes([a("a", "e"), a("c", "f")], ["e", "f"], ids)).toMatchObject({ out: null, tied: ["e", "f"] });
    expect(tallyVotes([a("a", "e"), a("c", "none"), a("d", "none")], ["e"], ids).out).toBeNull();
    expect(tallyVotes([a("e", "e")], ["e"], ids).counts.e).toBe(0);
    // Голос выбывшего не считается.
    expect(tallyVotes([a("z", "e")], ["e"], ids).counts.e).toBe(0);
  });
});

describe("мафия: ход партии на пульте", () => {
  it("раздача → день → голосование → ночь → утро → итог; «Назад» возвращает шаг", () => {
    const content = parseMafia({ revealOnDeath: true });
    let s = session();
    expect(mafiaPrimary(s)).toBe("deal");
    s = applyChange(s, startDeal(s, players), 1);
    expect(Object.keys(s.leaderboard)).toHaveLength(8);
    expect(parseMafiaResult(s.state.result)).toMatchObject({ mode: "deal", dealStep: 0 });
    expect(s.state.stage).toBe("question");
    s = applyChange(s, dealt(s, { a: "x" }, null), 2);
    expect(mafiaPrimary(s)).toBe("day");
    s = applyChange(s, startDay(s), 3);
    expect(parseMafiaResult(s.state.result).round).toBe(1);
    s = applyChange(s, toggleNominee(s, "e"), 4);
    s = applyChange(s, toggleNominee(s, "f"), 5);
    s = applyChange(s, startVote(s, content, ["e", "f"]), 6);
    expect(s.state).toMatchObject({ step: 1, stage: "question", timeLimit: 30 });
    s = applyChange(s, verdict(s, content, [ans(1, "a", { vote: "e" }), ans(1, "b", { vote: "f" })], roles), 7);
    expect(mafiaPrimary(s)).toBe("revote");
    s = applyChange(s, startVote(s, content, ["e", "f"], true), 8);
    s = applyChange(s, verdict(s, content, [ans(2, "a", { vote: "e" }), ans(2, "b", { vote: "e" })], roles), 9);
    let r = parseMafiaResult(s.state.result);
    expect(r).toMatchObject({ out: "e", alive: ids.filter((p) => p !== "e") });
    expect(r.deaths[0]).toEqual({ pid: "e", round: 1, by: "vote", role: "civilian" });
    expect(mafiaPrimary(s)).toBe("night");
    s = applyChange(s, startNight(s), 10);
    expect(s.state.step).toBe(3);
    const back = mafiaBack(s);
    expect(back?.clearAnswers).toBe(3);
    const undone = applyChange(s, back!.change, 11);
    expect(undone.state.step).toBe(2);
    expect(parseMafiaResult(undone.state.result).mode).toBe("verdict");
    const outcome = resolveNight(roles, r.alive, { a: "c", b: "c" }, []);
    s = applyChange(s, morning(s, content, outcome, roles), 12);
    r = parseMafiaResult(s.state.result);
    expect(r.killed).toBe("c");
    expect(r.nights).toEqual([3]);
    expect(mafiaPrimary(s)).toBe("day");
    s = applyChange(s, startDay(s), 13);
    expect(parseMafiaResult(s.state.result).round).toBe(2);
    s = applyChange(s, finishGame(s, content, roles, "city"), 14);
    r = parseMafiaResult(s.state.result);
    expect(r.reveal?.a).toBe("don");
    expect(s.leaderboard.d?.score).toBe(150);
    expect(s.leaderboard.e?.score).toBe(100);
    expect(s.leaderboard.a?.score).toBe(0);
  });

  it("день без кандидатов — сразу ночь; «никого» не даёт переголосовать; досрочный конец можно отменить", () => {
    const content = parseMafia({});
    let s = session();
    s = applyChange(s, startDeal(s, players), 1);
    s = applyChange(s, dealt(s, {}, null), 2);
    s = applyChange(s, startDay(s), 3);
    expect(mafiaPrimary(s)).toBe("night");
    s = applyChange(s, toggleNominee(s, "e"), 4);
    s = applyChange(s, toggleNominee(s, "f"), 5);
    s = applyChange(s, startVote(s, content, ["e", "f"]), 6);
    s = applyChange(s, verdict(s, content, [ans(1, "a", { vote: "none" }), ans(1, "b", { vote: "none" })], roles), 7);
    expect(mafiaPrimary(s)).toBe("night");
    const over = applyChange(s, abortGame(s, roles), 8);
    expect(parseMafiaResult(over.state.result)).toMatchObject({ mode: "over", winner: null });
    expect(mafiaPrimary(over)).toBe("podium");
    const back = mafiaBack(over);
    expect(back).not.toBeNull();
    expect(parseMafiaResult(applyChange(over, back!.change, 9).state.result).mode).toBe("verdict");
  });
});

describe("мафия: несколько партий", () => {
  it("после итога — следующая партия: новый шаг, номер партии, очки на месте, «Назад» возвращает итог", async () => {
    const { startDeal: deal, mafiaPrimary: primary, parseMafiaResult: parse, mafiaBack: back } = await import("./logic");
    const { applyChange: ap, startState: st } = await import("../../core/session");
    const ps = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, name: id, kind: "player" as const, teamId: null, captainUid: id, joinedAt: i + 1 }));
    let s = { id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "М", mechanic: "mafia", gameSnapshot: null, themeId: "joyrest", playMode: "solo", screenMode: "laptop", state: { ...st(), phase: "playing" }, leaderboard: {}, createdAt: 0 } as unknown as import("../../data/types").Session;
    s = ap(s, deal(s, ps), 1);
    expect(parse(s.state.result).party).toBe(1);
    s = ap(s, { addScore: {}, state: { stage: "reveal", result: { ...parse(s.state.result), mode: "over", winner: null } } }, 2);
    s = ap(s, { addScore: { a: 100 } }, 3);
    expect(primary(s, 3)).toBe("nextParty");
    expect(primary(s, 1)).toBe("podium");
    const step = s.state.step;
    s = ap(s, deal(s, ps), 4);
    expect(parse(s.state.result)).toMatchObject({ party: 2, mode: "deal", dealStep: step + 1 });
    expect(s.state.step).toBe(step + 1);
    expect(s.leaderboard.a?.score).toBe(100);
    s = ap(s, back(s)?.change ?? {}, 5);
    expect(parse(s.state.result)).toMatchObject({ party: 1, mode: "over" });
  });
});
