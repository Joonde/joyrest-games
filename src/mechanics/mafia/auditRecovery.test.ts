import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session } from "../../data/types";
import { createMafia, parseMafia, type RoleId } from "./content";
import {
  abortGame,
  dealt,
  finishGame,
  mafiaBack,
  morning,
  nightChoices,
  paddedAll,
  parseMafiaResult,
  resolveNight,
  roleCard,
  startDay,
  startDeal,
  startMeet,
  startNight,
  startVote,
  verdict,
  whispers,
} from "./logic";
import { newKey, seal, unseal } from "./seal";

const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
const roles: Record<string, RoleId> = { a: "don", b: "mafia", c: "commissar", d: "doctor", e: "courtesan", f: "maniac", g: "advocate", h: "civilian" };
const participants: Participant[] = ids.map((id, i) => ({ id, name: `Игрок ${id}`, kind: "player", teamId: null, captainUid: id, joinedAt: i + 1 }));

function session(): Session {
  return { id: "recovery", code: "1", hostId: "host", gameId: "game", gameTitle: "Мафия", mechanic: "mafia", gameSnapshot: null, themeId: "joyrest", playMode: "solo", screenMode: "laptop", state: { ...startState(), phase: "playing" }, leaderboard: {}, createdAt: 0 } as Session;
}

function started(): Session {
  let s = session();
  s = applyChange(s, startDeal(s, participants), 1);
  s = applyChange(s, dealt(s, {}, null), 2);
  s = applyChange(s, startMeet(s), 3);
  s = applyChange(s, startDay(s), 4);
  return s;
}

describe("QA: возврат и повторное применение", () => {
  it("возврат из двойного утра восстанавливает живых; повторное утро не дублирует смерти", () => {
    const content = createMafia();
    content.revealOnDeath = true;
    let s = applyChange(started(), startNight(started()), 5);
    const outcome = resolveNight(roles, ids, { a: "h", b: "h", g: "h", f: "c" }, []);
    s = applyChange(s, morning(s, content, outcome, roles), 6);
    expect(parseMafiaResult(s.state.result).deaths).toHaveLength(2);
    const back = mafiaBack(s);
    // Возвращаемся в ту же ночь: её ответы нужны для повторного расчёта и не должны очищаться.
    expect(back?.clearAnswers).toBeUndefined();
    s = applyChange(s, back!.change, 7);
    const restored = parseMafiaResult(s.state.result);
    expect(restored.alive).toEqual(ids);
    expect(restored.killed).toEqual([]);
    expect(restored.deaths).toEqual([]);
    s = applyChange(s, morning(s, content, outcome, roles), 8);
    expect(parseMafiaResult(s.state.result).deaths).toHaveLength(2);
  });

  it("возврат из голосования отменяет выбывание, а досрочный конец не начисляет очки", () => {
    const content = createMafia();
    let s = applyChange(started(), startVote(started(), content, ["f"]), 5);
    const answers: Answer[] = ids.map((pid) => ({ id: `${s.state.step}_${pid}`, step: s.state.step, pid, uid: pid, value: { vote: pid === "f" ? "none" : "f" }, submittedAt: 1 }));
    s = applyChange(s, verdict(s, content, answers, roles), 6);
    expect(parseMafiaResult(s.state.result).out).toBe("f");
    const back = mafiaBack(s);
    s = applyChange(s, back!.change, 7);
    expect(parseMafiaResult(s.state.result).alive).toEqual(ids);
    expect(parseMafiaResult(s.state.result).deaths).toEqual([]);
    const scores = Object.fromEntries(Object.entries(s.leaderboard).map(([pid, entry]) => [pid, entry.score]));
    const aborted = applyChange(s, abortGame(s, roles), 8);
    expect(parseMafiaResult(aborted.state.result).winner).toBeNull();
    expect(Object.fromEntries(Object.entries(aborted.leaderboard).map(([pid, entry]) => [pid, entry.score]))).toEqual(scores);
    expect(mafiaBack(aborted)).not.toBeNull();
  });

  it("после завершённой партии «Назад» не даёт начислить очки повторно; новая партия очищает историю", () => {
    const content = createMafia();
    let s = started();
    s = applyChange(s, { state: { result: { ...parseMafiaResult(s.state.result), alive: ["c", "d", "e", "h"], winner: "city" } } }, 5);
    s = applyChange(s, finishGame(s, content, roles, "city"), 6);
    expect(mafiaBack(s)).toBeNull();
    const score = Object.fromEntries(Object.entries(s.leaderboard).map(([pid, entry]) => [pid, entry.score]));
    s = applyChange(s, startDeal(s, participants), 7);
    const next = parseMafiaResult(s.state.result);
    expect(next.party).toBe(2);
    expect(next.deaths).toEqual([]);
    expect(next.nights).toEqual([]);
    expect(next.killed).toEqual([]);
    expect(next.alive).toEqual(ids);
    expect(Object.fromEntries(Object.entries(s.leaderboard).map(([pid, entry]) => [pid, entry.score]))).toEqual(score);
  });
});

describe("QA: ошибочные ответы и совместимость", () => {
  it("ручной ввод Адвоката и Дона работает вместе, телефон имеет приоритет только для своего поля", () => {
    const answers: Answer[] = [
      { id: "1_a", step: 1, pid: "a", uid: "a", value: { target: "h", check: "c" }, submittedAt: 1 },
      { id: "1_g", step: 1, pid: "g", uid: "g", value: { target: "h" }, submittedAt: 1 },
    ];
    const { choices, donCheck } = nightChoices(answers, ids, { a: "f", g: "f", "a#check": "d", "g#check": "g", ghost: "h" });
    expect(choices.a).toBe("h");
    expect(choices.g).toBe("h");
    expect(choices.ghost).toBeUndefined();
    expect(donCheck.a).toBe("c");
    expect(donCheck.g).toBe("g");
  });

  it("старая строковая жертва сохраняется и внутри undo", () => {
    const r = parseMafiaResult({ mode: "morning", killed: "c", undo: { step: 2, stage: "question", result: { mode: "night", killed: null } } });
    expect(r.killed).toEqual(["c"]);
    expect(r.undo?.result.killed).toEqual([]);
  });

  it("старые настройки не получают новые роли неявно", () => {
    const old = parseMafia({ roles: "custom", counts: { mafia: 2, don: 1, commissar: 1, doctor: 1 } });
    expect(old.counts.courtesan).toBe(0);
    expect(old.counts.maniac).toBe(0);
    expect(old.counts.advocate).toBe(0);
  });

  it("все новые карты шифруются и открываются только своим ключом", async () => {
    const names = Object.fromEntries(ids.map((pid) => [pid, `Игрок ${pid}`]));
    for (const pid of ids) {
      const mine = newKey();
      const other = newKey();
      const card = paddedAll({ [pid]: roleCard(pid, roles, ids, names) })[pid];
      const sealed = await seal(mine, card);
      const opened = (await unseal(mine, sealed)) as { role?: RoleId } | null;
      expect(opened?.role).toBe(roles[pid]);
      expect(await unseal(other, sealed)).toBeNull();
    }
  });

  it("расширенные подсказки имеют одинаковый размер независимо от роли", () => {
    const choices = { a: "h", b: "h", g: "h", c: "g", d: "h", e: "b", f: "c", h: "a" };
    const outcome = resolveNight(roles, ids, choices, [], "c", "g");
    const items = whispers(roles, ids, choices, { a: "c", g: "g" }, ["h"], ["a"], outcome);
    const packed = paddedAll(items);
    const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
    const sizes = Object.values(packed).map(size);
    expect(new Set(sizes).size).toBe(1);
    expect(packed.b?.familyBlocked).toBe(true);
    expect(packed.c?.blocked).toBeUndefined();
    expect(packed.b?.blocked).toBe(true);
  });
});
