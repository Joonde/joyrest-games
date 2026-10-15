import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session } from "../../data/types";
import { newKey, seal, unseal } from "../mafia/seal";
import { createSpy, parseSpy, spiesFor } from "./content";
import { sealDeal, secretFromCards, secretFromHost } from "./deal";
import {
  abortParty,
  addMinute,
  cardOf,
  continueTalk,
  dealSecret,
  dealt,
  finishParty,
  guessOf,
  openAccused,
  paddedAll,
  parseCard,
  parseSpyResult,
  partyPoints,
  pauseTalk,
  pendingGuess,
  resolveGuess,
  resolveLast,
  resumeTalk,
  spyBack,
  spyPrimary,
  startDeal,
  startTalk,
  startVote,
  talkLeftMs,
  tallyVotes,
  timeUp,
  verdict,
  type SpySecret,
} from "./logic";
import { validateSpy } from "./validate";

const ids = ["a", "b", "c", "d", "e", "f"];
const players: Participant[] = ids.map((id, i) => ({ id, name: `Игрок ${id}`, kind: "player", teamId: null, captainUid: id, joinedAt: i + 1 }));
const ans = (step: number, pid: string, value: unknown, at = 10): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: at });

function session(): Session {
  return {
    id: "s",
    code: "1",
    hostId: "h",
    gameId: "g",
    gameTitle: "Шпион",
    mechanic: "spy",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: { ...startState(), phase: "playing" },
    leaderboard: {},
    createdAt: 0,
  } as Session;
}

/** Постоянный жребий для тестов. */
function rnd(seed = 7): () => number {
  let s = seed;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

const content = createSpy();
const secret: SpySecret = { location: 3, spies: ["c"], roles: { a: "Директор", b: "Учитель", d: "Отличник", e: "Завуч", f: "Охранник" } };

describe("шпион: содержимое", () => {
  it("по умолчанию — 24 локации по 6–8 ролей, игра проходит проверку", () => {
    expect(content.locations).toHaveLength(24);
    for (const l of content.locations) {
      expect(l.roles.length).toBeGreaterThanOrEqual(6);
      expect(l.roles.length).toBeLessThanOrEqual(8);
    }
    expect(validateSpy(content)).toEqual([]);
  });

  it("битые данные — значения по умолчанию, лишнее обрезается", () => {
    const p = parseSpy({ spies: 5, roundMinutes: 99, parties: 0, locations: [{ name: 1, roles: ["x", 2] }] });
    expect(p.spies).toBe("auto");
    expect(p.roundMinutes).toBe(15);
    expect(p.parties).toBe(1);
    expect(p.locations[0]).toEqual({ name: "", roles: ["x", ""] });
    expect(validateSpy(p).length).toBeGreaterThan(0);
    expect(parseSpy(null).locations).toHaveLength(24);
  });

  it("проверка: мало локаций, повтор названия, локация без ролей", () => {
    const few = { ...content, locations: content.locations.slice(0, 3) };
    expect(validateSpy(few).some((e) => e.path === "locations")).toBe(true);
    const dup = { ...content, locations: [...content.locations, { name: "ресторан", roles: ["Повар"] }] };
    expect(validateSpy(dup).some((e) => e.message.includes("повторяется"))).toBe(true);
    const empty = { ...content, locations: [...content.locations, { name: "Пустыня", roles: [" "] }] };
    expect(validateSpy(empty).some((e) => e.path.endsWith("/roles"))).toBe(true);
  });

  it("шпионов: один, с 11 игроков — двое; не больше трети", () => {
    expect(spiesFor(content, 4)).toBe(1);
    expect(spiesFor(content, 10)).toBe(1);
    expect(spiesFor(content, 11)).toBe(2);
    expect(spiesFor({ spies: 2 }, 5)).toBe(1);
    expect(spiesFor({ spies: 2 }, 6)).toBe(2);
    expect(spiesFor({ spies: 1 }, 20)).toBe(1);
  });
});

describe("шпион: раздача", () => {
  it("один шпион на 6, у остальных — роли локации; на 12 — двое", () => {
    const s = dealSecret(ids, content, [], rnd());
    expect(s.spies).toHaveLength(1);
    expect(Object.keys(s.roles).sort()).toEqual(ids.filter((p) => !s.spies.includes(p)).sort());
    for (const role of Object.values(s.roles)) expect(content.locations[s.location]?.roles).toContain(role);
    const twelve = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const s12 = dealSecret(twelve, content, [], rnd(3));
    expect(s12.spies).toHaveLength(2);
    expect(Object.keys(s12.roles)).toHaveLength(10);
  });

  it("локация не повторяется, пока есть несыгранные", () => {
    const used: number[] = [];
    const random = rnd(11);
    for (let i = 0; i < content.locations.length; i++) {
      const s = dealSecret(ids, content, used, random);
      expect(used).not.toContain(s.location);
      used.push(s.location);
    }
    // Все сыграны — любая, кроме прошлой.
    const again = dealSecret(ids, content, used, random);
    expect(again.location).not.toBe(used[used.length - 1]);
  });

  it("тайна: карта шпиона без локации, все карты одной длины, свой ключ открывает — чужой нет", async () => {
    const spyCard = cardOf("c", secret, ids, content);
    expect(spyCard).toEqual({ seat: 3, spy: true, location: null, place: "", role: "" });
    const cards: Record<string, ReturnType<typeof cardOf>> = {};
    for (const p of ids) cards[p] = cardOf(p, secret, ids, content);
    const padded = paddedAll(cards);
    const lengths = new Set(Object.values(padded).map((c) => new TextEncoder().encode(JSON.stringify(c)).length));
    expect(lengths.size).toBe(1);

    const keys: Record<string, string> = {};
    for (const p of ids) keys[p] = newKey();
    const host = newKey();
    const { sealed, hostSeal } = await sealDeal(ids, secret, content, keys, host);
    expect(new Set(Object.values(sealed).map((t) => t.length)).size).toBe(1);
    const mine = parseCard(await unseal(keys.a as string, sealed.a));
    expect(mine?.spy).toBe(false);
    expect(mine?.place).toBe(content.locations[3]?.name);
    expect(mine?.role).toBe("Директор");
    expect(parseCard(await unseal(keys.c as string, sealed.c))?.spy).toBe(true);
    expect(await unseal(keys.b as string, sealed.a)).toBeNull();
    expect(await secretFromHost(host, hostSeal)).toEqual(secret);
    expect(await secretFromHost(newKey(), hostSeal)).toBeNull();
    const fromCards = await secretFromCards(ids, sealed, keys);
    expect(fromCards.complete).toBe(true);
    expect(fromCards.secret?.location).toBe(3);
    expect(fromCards.secret?.spies).toEqual(["c"]);
    // Игрок без телефона — второй пульт знает не всё.
    const { e: _e, ...partial } = keys;
    expect((await secretFromCards(ids, sealed, partial)).complete).toBe(false);
    expect(await unseal(newKey(), await seal(newKey(), { x: 1 }))).toBeNull();
  });
});

describe("шпион: голоса и догадки", () => {
  it("обвинить — только единственный лидер и больше половины игроков", () => {
    const votes = (map: Record<string, string>) => Object.entries(map).map(([pid, vote]) => ({ pid, value: { vote } }));
    expect(tallyVotes(votes({ a: "c", b: "c", d: "c", e: "c" }), ids).accused).toBe("c");
    // Ровно половина — мало.
    expect(tallyVotes(votes({ a: "c", b: "c", d: "c" }), ids).accused).toBeNull();
    // Ничья лидеров.
    expect(tallyVotes(votes({ a: "c", b: "c", c: "a", d: "a" }), ids).accused).toBeNull();
    // За себя и за чужих не считается.
    const t = tallyVotes(votes({ a: "a", b: "zzz", c: "d" }), ids);
    expect(t.cast).toBe(1);
    expect(t.counts.a).toBe(0);
  });

  it("догадка — только существующая локация и только от шпиона, первая по времени", () => {
    expect(guessOf({ guess: 3 }, content)).toBe(3);
    expect(guessOf({ guess: 99 }, content)).toBeNull();
    expect(guessOf({ guess: "3" }, content)).toBeNull();
    const list = [ans(2, "a", { guess: 1 }, 5), ans(2, "c", { guess: 7 }, 9), ans(2, "f", { guess: 4 }, 8)];
    expect(pendingGuess(list, 2, ["c", "f"], content)).toEqual({ pid: "f", index: 4 });
    expect(pendingGuess(list, 2, ["b"], content)).toBeNull();
  });

  it("очки: город — всем, кроме шпиона; шпион — свои и бонус за угаданную локацию", () => {
    const town = partyPoints(ids, secret, content, "town", null);
    expect(town.a).toBe(100);
    expect(town.c).toBe(0);
    const spies = partyPoints(ids, secret, content, "spies", { pid: "c", index: 3, correct: true });
    expect(spies.c).toBe(400);
    expect(spies.a).toBe(0);
    expect(partyPoints(ids, secret, content, "spies", null).c).toBe(300);
    expect(Object.values(partyPoints(ids, secret, content, null, null)).every((v) => v === 0)).toBe(true);
  });
});

/** Сессия после раздачи и начала обсуждения (тайна — `secret`). */
function talking(at = 1000): Session {
  let s = session();
  s = applyChange(s, startDeal(s, players), 1);
  s = applyChange(s, dealt(s, {}, null), 2);
  return applyChange(s, startTalk(s, content, at, rnd()), 3);
}

describe("шпион: ход партии на пульте", () => {
  it("раздача → карты → обсуждение: таймер, пауза, +1 минута; первый спрашивающий за столом", () => {
    let s = session();
    expect(spyPrimary(s)).toBe("deal");
    s = applyChange(s, startDeal(s, players), 1);
    expect(parseSpyResult(s.state.result).seats).toEqual(ids);
    expect(Object.keys(s.leaderboard)).toHaveLength(6);
    expect(spyPrimary(s)).toBe("dealt");
    s = applyChange(s, dealt(s, {}, null), 2);
    expect(spyPrimary(s)).toBe("talk");
    const dealStep = s.state.step;
    s = applyChange(s, startTalk(s, content, 1000, rnd()), 3);
    expect(s.state.step).toBe(dealStep + 1);
    expect(s.state.stage).toBe("question");
    let r = parseSpyResult(s.state.result);
    expect(ids).toContain(r.firstAsker);
    expect(talkLeftMs(r, 1000)).toBe(8 * 60_000);
    s = applyChange(s, pauseTalk(s, 61_000), 4);
    r = parseSpyResult(s.state.result);
    expect(r.paused).toBe(true);
    expect(talkLeftMs(r, 999_999)).toBe(7 * 60_000);
    s = applyChange(s, addMinute(s, 70_000), 5);
    expect(talkLeftMs(parseSpyResult(s.state.result), 0)).toBe(8 * 60_000);
    s = applyChange(s, resumeTalk(s, 100_000), 6);
    r = parseSpyResult(s.state.result);
    expect(r.paused).toBe(false);
    expect(talkLeftMs(r, 100_000)).toBe(8 * 60_000);
    expect(spyPrimary(s)).toBe("vote");
    expect(spyPrimary(s, 1, true)).toBe("guess");
  });

  it("шпион угадал во время обсуждения — победа шпиона с бонусом; ошибся — победа города", () => {
    const s = talking();
    const win = applyChange(s, resolveGuess(s, content, secret, "c", 3, 2000), 10);
    const r = parseSpyResult(win.state.result);
    expect(r.mode).toBe("over");
    expect(r.winner).toBe("spies");
    expect(r.reason).toBe("guess-right");
    expect(r.reveal).toEqual(secret);
    expect(r.used).toEqual([3]);
    expect(win.leaderboard.c?.score).toBe(400);
    expect(win.leaderboard.a?.score).toBe(0);
    const lose = applyChange(s, resolveGuess(s, content, secret, "c", 5, 2000), 10);
    expect(parseSpyResult(lose.state.result).winner).toBe("town");
    expect(lose.leaderboard.a?.score).toBe(100);
    expect(lose.leaderboard.c?.score).toBe(0);
  });

  it("голосование: обвинили шпиона — последний шанс; угадал — шпион, нет — город", () => {
    let s = talking();
    s = applyChange(s, startVote(s, content, 61_000), 20);
    let r = parseSpyResult(s.state.result);
    expect(r.mode).toBe("vote");
    expect(r.changeable).toBe(true);
    expect(s.state.timeLimit).toBe(content.voteSeconds);
    expect(r.talkLeft).toBe(7 * 60_000);
    const step = s.state.step;
    s = applyChange(s, verdict(s, ["a", "b", "d", "e"].map((p) => ans(step, p, { vote: "c" }))), 21);
    r = parseSpyResult(s.state.result);
    expect(r.accused).toBe("c");
    expect(spyPrimary(s)).toBe("open");
    s = applyChange(s, openAccused(s, content, secret), 22);
    r = parseSpyResult(s.state.result);
    expect(r.mode).toBe("last");
    expect(s.state.step).toBe(step + 1);
    expect(s.state.timeLimit).toBe(30);
    expect(spyPrimary(s)).toBe("lastCheck");
    const right = applyChange(s, resolveLast(s, content, secret, 3), 23);
    expect(parseSpyResult(right.state.result).winner).toBe("spies");
    expect(parseSpyResult(right.state.result).reason).toBe("caught-right");
    expect(right.leaderboard.c?.score).toBe(400);
    const wrong = applyChange(s, resolveLast(s, content, secret, null), 23);
    expect(parseSpyResult(wrong.state.result).winner).toBe("town");
    expect(wrong.leaderboard.b?.score).toBe(100);
  });

  it("обвинили невиновного — побеждает шпион; не договорились — обсуждение дальше или время вышло", () => {
    let s = talking();
    s = applyChange(s, startVote(s, content, 1000), 20);
    const step = s.state.step;
    const innocent = applyChange(s, verdict(s, ["b", "c", "d", "e"].map((p) => ans(step, p, { vote: "a" }))), 21);
    const after = applyChange(innocent, openAccused(innocent, content, secret), 22);
    expect(parseSpyResult(after.state.result).winner).toBe("spies");
    expect(parseSpyResult(after.state.result).reason).toBe("innocent");
    expect(after.leaderboard.c?.score).toBe(300);

    const split = applyChange(s, verdict(s, [ans(step, "a", { vote: "b" }), ans(step, "c", { vote: "d" })]), 21);
    expect(parseSpyResult(split.state.result).accused).toBeNull();
    expect(spyPrimary(split)).toBe("continue");
    const again = applyChange(split, continueTalk(split, 50_000), 22);
    const r = parseSpyResult(again.state.result);
    expect(r.mode).toBe("talk");
    expect(again.state.step).toBe(step + 1);
    expect(talkLeftMs(r, 50_000)).toBe(8 * 60_000);

    // Время вышло: голосование после конца таймера, не договорились — шпион побеждает.
    const late = applyChange(again, startVote(again, content, 50_000 + 9 * 60_000), 30);
    const lateStep = late.state.step;
    const noDeal = applyChange(late, verdict(late, [ans(lateStep, "a", { vote: "b" })]), 31);
    expect(spyPrimary(noDeal)).toBe("timeUp");
    const end = applyChange(noDeal, timeUp(noDeal, content, secret), 32);
    expect(parseSpyResult(end.state.result).reason).toBe("time");
    expect(end.leaderboard.c?.score).toBe(300);
  });

  it("«Назад»: на одно действие, ответы ушедшего шага убираются, очки итога снимаются", () => {
    let s = talking();
    const talkStep = s.state.step;
    s = applyChange(s, startVote(s, content, 1000), 20);
    const back = spyBack(s);
    expect(back?.clearAnswers).toBe(s.state.step);
    const t = applyChange(s, back?.change ?? {}, 21);
    expect(t.state.step).toBe(talkStep);
    expect(t.state.stage).toBe("question");
    expect(t.state.revealed).toBe(false);
    expect(parseSpyResult(t.state.result).mode).toBe("talk");

    const over = applyChange(t, resolveGuess(t, content, secret, "c", 5, 2000), 30);
    expect(over.leaderboard.a?.score).toBe(100);
    const undone = applyChange(over, spyBack(over)?.change ?? {}, 31);
    expect(undone.leaderboard.a?.score).toBe(0);
    expect(parseSpyResult(undone.state.result).mode).toBe("talk");
    expect(parseSpyResult(undone.state.result).reveal).toBeNull();

    // Досрочный конец — без очков, отменяется «Назад».
    const aborted = applyChange(t, abortParty(t, content, secret), 40);
    expect(parseSpyResult(aborted.state.result).winner).toBeNull();
    expect(Object.values(aborted.leaderboard).every((e) => e.score === 0)).toBe(true);
    expect(parseSpyResult(applyChange(aborted, spyBack(aborted)?.change ?? {}, 41).state.result).mode).toBe("talk");
  });
});

describe("шпион: несколько партий", () => {
  it("следующая партия: новый шаг, номер партии, очки на месте, сыгранная локация запомнена, «Назад» возвращает итог", () => {
    let s = talking();
    s = applyChange(s, finishParty(s, content, secret, "town", "guess-wrong"), 50);
    expect(spyPrimary(s, 3)).toBe("nextParty");
    expect(spyPrimary(s, 1)).toBe("podium");
    const overStep = s.state.step;
    const next = applyChange(s, startDeal(s, players), 51);
    const r = parseSpyResult(next.state.result);
    expect(r.party).toBe(2);
    expect(r.mode).toBe("deal");
    expect(r.used).toEqual([3]);
    expect(next.state.step).toBe(overStep + 1);
    expect(next.leaderboard.a?.score).toBe(100);
    // Новая тайна — не та же локация.
    for (let seed = 1; seed < 30; seed++) expect(dealSecret(r.seats, content, r.used, rnd(seed)).location).not.toBe(3);
    const back = spyBack(next);
    expect(back?.clearAnswers).toBe(next.state.step);
    const returned = applyChange(next, back?.change ?? {}, 52);
    expect(parseSpyResult(returned.state.result).mode).toBe("over");
    expect(returned.leaderboard.a?.score).toBe(100);
  });

  it("три партии подряд — три разные локации", () => {
    let s = session();
    const seen: number[] = [];
    for (let party = 1; party <= 3; party++) {
      s = applyChange(s, startDeal(s, players), party * 10);
      const r = parseSpyResult(s.state.result);
      const sec = dealSecret(r.seats, content, r.used, rnd(party));
      s = applyChange(s, dealt(s, {}, null), party * 10 + 1);
      s = applyChange(s, startTalk(s, content, 0, rnd()), party * 10 + 2);
      s = applyChange(s, timeUp(s, content, sec), party * 10 + 3);
      seen.push(sec.location);
    }
    expect(new Set(seen).size).toBe(3);
    expect(parseSpyResult(s.state.result).used).toEqual(seen);
    expect(parseSpyResult(s.state.result).party).toBe(3);
  });
});
