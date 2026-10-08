import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Participant, Session } from "../../data/types";
import { createBunker, parseBunker, placesFor, quotaNow } from "./content";
import { openPhoneCard, padAll, sealAll, secretsFromHost } from "./deal";
import { cardText, CATS, isRef } from "./decks";
import { applyUse, bunkerBack, bunkerPrimary, countVotes, dealSecrets, dealt, finishBunker, hasPair, judgeThreat, nextSpeaker, nextThreat, openable, openCard, parseBunkerResult, quota, startDeal, startDiscuss, startFinal, startOpening, startRound, startVote, tallyVotes, type Secrets } from "./logic";
import { newKey } from "../mafia/seal";
import type { Character } from "./specials";

const N = 6;
const players: Participant[] = Array.from({ length: N }, (_, i) => ({ id: `p${i + 1}`, name: `Игрок ${i + 1}`, kind: "player", teamId: null, captainUid: `p${i + 1}`, joinedAt: i + 1 }));
const name = (pid: string) => `И${pid.slice(1)}`;
let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

function session(): Session {
  return { id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "Б", mechanic: "bunker", gameSnapshot: null, themeId: "joyrest", playMode: "solo", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 } as Session;
}
const scores = (s: Session) => Object.fromEntries(Object.entries(s.leaderboard).map(([k, v]) => [k, v.score]));
const R = (s: Session) => parseBunkerResult(s.state.result);

describe("бункер: правила", () => {
  it("мест — половина игроков, как в таблице правил", () => {
    expect([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(placesFor)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8]);
  });

  it("изгнания по раундам: остаток — в последние раунды", () => {
    const plan = (n: number) => {
      let alive = n;
      const out: number[] = [];
      for (let r = 1; r <= 5; r++) {
        const k = quotaNow(r, 5, alive, placesFor(n), 0);
        out.push(k);
        alive -= k;
      }
      return out;
    };
    expect(plan(4)).toEqual([0, 0, 0, 1, 1]);
    expect(plan(6)).toEqual([0, 0, 1, 1, 1]);
    expect(plan(10)).toEqual([1, 1, 1, 1, 1]);
    expect(plan(16)).toEqual([1, 1, 2, 2, 2]);
    expect(plan(16).reduce((a, b) => a + b, 0)).toBe(8);
  });

  it("раздача: у всех разные карты, тексты известны", () => {
    const sec = dealSecrets(players.map((p) => p.id), createBunker(), rnd);
    const refs = Object.values(sec.chars).flatMap((c) => CATS.filter((k) => k !== "biology").map((k) => (k === "profession" ? c[k].split(":").slice(0, 2).join(":") : c[k])));
    expect(new Set(refs).size).toBe(refs.length);
    for (const c of Object.values(sec.chars)) for (const k of CATS) {
      expect(isRef(k, c[k])).toBe(true);
      expect(cardText(c[k])).not.toBe("?");
    }
    expect(new Set(Object.values(sec.chars).map((c) => c.special)).size).toBe(N);
    expect(sec.bunker).toHaveLength(5);
    expect(sec.threats).toHaveLength(2);
    expect(parseBunker({ threats: 9, exiledVote: "x" })).toMatchObject({ threats: 3, exiledVote: "none" });
  });
});

describe("бункер: тайные карты", () => {
  it("каждый телефон открывает только свою карту, все шифры одной длины", async () => {
    const sec = dealSecrets(["p1", "p2"], createBunker(), rnd);
    sec.notes.p1 = ["Игрок 2 · Здоровье|h:3"];
    const k1 = newKey();
    const k2 = newKey();
    const host = newKey();
    const { sealed, hostSeal } = await sealAll(sec, { p1: k1, p2: k2 }, host);
    expect(sealed.p1?.length).toBe(sealed.p2?.length);
    expect((await openPhoneCard(k1, sealed.p1))?.char).toEqual(sec.chars.p1);
    expect((await openPhoneCard(k1, sealed.p1))?.notes).toEqual(["Игрок 2 · Здоровье|h:3"]);
    expect(await openPhoneCard(k1, sealed.p2)).toBeNull();
    expect(await secretsFromHost(host, hostSeal)).toEqual(sec);
    const pads = padAll({ a: { t: "я" }, b: { t: "abc" } });
    expect(new TextEncoder().encode(JSON.stringify(pads.a)).length).toBe(new TextEncoder().encode(JSON.stringify(pads.b)).length);
  });
});

/** Игра до раунда 1 с известными картами. */
function setup(content = createBunker()) {
  let s = session();
  s = applyChange(s, startDeal(s, players), 1);
  const r = R(s);
  const sec: Secrets = dealSecrets(r.seats, content, rnd);
  s = applyChange(s, dealt(s, content, {}, "seal", rnd), 2);
  return { s, sec, content };
}

describe("бункер: ход игры", () => {
  it("раздача → катастрофа → раунд → круг открытия (в первом раунде профессия) → обсуждение", () => {
    let { s, sec, content } = setup();
    expect(R(s).places).toBe(3);
    expect(bunkerPrimary(s, content)).toBe("round");
    s = applyChange(s, startRound(s, content, sec), 3);
    expect(R(s).bunkerShown).toEqual([sec.bunker[0]]);
    expect(bunkerPrimary(s, content)).toBe("opening");
    s = applyChange(s, startOpening(s), 4);
    const first = R(s).speaker as string;
    expect(openable(R(s), first)).toEqual(["profession"]);
    s = applyChange(s, openCard(s, content, first, "profession", sec.chars, 1000), 5);
    expect(R(s).shown[first]?.profession).toBe(sec.chars[first]?.profession);
    expect(R(s).speakEndsAt).toBe(1000 + content.firstSpeechSeconds * 1000);
    for (let i = 1; i < N; i++) s = applyChange(s, nextSpeaker(s), 6 + i);
    expect(bunkerPrimary(s, content)).toBe("discuss");
    s = applyChange(s, startDiscuss(s, content, 0), 20);
    // 6 игроков: в первом раунде без изгнания.
    expect(quota(content, R(s))).toBe(0);
    expect(bunkerPrimary(s, content)).toBe("round");
    s = applyChange(s, startRound(s, content, sec), 21);
    expect(scores(s)).toMatchObject({ p1: content.roundPoints, p6: content.roundPoints });
    s = applyChange(s, bunkerBack(s)?.change ?? {}, 22);
    expect(scores(s).p1).toBe(0);
    expect(R(s).round).toBe(1);
  });

  it("голосование: изгнание, ничья → оправдание → переголосование → жребий", () => {
    let { s, sec, content } = setup();
    s = applyChange(s, startRound(s, content, sec), 3);
    s = applyChange(s, startRound(s, content, sec), 4);
    s = applyChange(s, startRound(s, content, sec), 5);
    expect(R(s).round).toBe(3);
    s = applyChange(s, startVote(s, content, 0), 6);
    expect(bunkerPrimary(s, content)).toBe("count");
    // Ничья p1 и p2.
    s = applyChange(s, countVotes(s, content, { p3: "p1", p4: "p2", p5: "p1", p6: "p2" }, sec.chars, rnd), 7);
    expect(R(s).mode).toBe("justify");
    expect(R(s).candidates.sort()).toEqual(["p1", "p2"]);
    s = applyChange(s, startVote(s, content, 0, R(s).candidates), 8);
    expect(R(s).revote).toBe(true);
    s = applyChange(s, countVotes(s, content, { p3: "p1", p4: "p2" }, sec.chars, () => 0.9), 9);
    expect(R(s).tally?.random).toBe(true);
    expect(R(s).exiled).toEqual(["p2"]);
    expect(R(s).open.p2).toEqual(CATS);
    expect(R(s).alive).not.toContain("p2");
    expect(bunkerPrimary(s, content)).toBe("round");
  });

  it("голос против себя не считается, изгнанные — одним общим голосом", () => {
    const { s, content } = setup({ ...createBunker(), exiledVote: "common" });
    const r = { ...R(s), alive: ["p1", "p2", "p3"], exiled: ["p4", "p5", "p6"], candidates: ["p1", "p2", "p3"] };
    const t = tallyVotes(r, { ...content, exiledVote: "common" }, { p1: "p1", p2: "p1", p3: "p2", p4: "p2", p5: "p2", p6: "p1" });
    expect(t.counts).toEqual({ p1: 1, p2: 2, p3: 0 });
    expect(t.exiledPick).toBe("p2");
    expect(t.out).toBe("p2");
  });

  it("финал: «Возрождение» и угрозы решают исход, очки спасшимся", () => {
    let { s, sec, content } = setup({ ...createBunker(), rebirth: true });
    for (let i = 0; i < 5; i++) s = applyChange(s, startRound(s, content, sec), 3 + i);
    s = applyChange(s, startFinal(s, content, sec), 10);
    expect(R(s).bunkerShown).toEqual(sec.bunker);
    for (const p of R(s).alive) expect(R(s).open[p]).toEqual(CATS);
    expect(bunkerPrimary(s, content)).toBe("threat");
    s = applyChange(s, nextThreat(s, sec), 11);
    expect(bunkerPrimary(s, content)).toBe("judge");
    s = applyChange(s, judgeThreat(s, true), 12);
    s = applyChange(s, nextThreat(s, sec), 13);
    s = applyChange(s, judgeThreat(s, true), 14);
    expect(bunkerPrimary(s, content)).toBe("outcome");
    const pairChars: Record<string, Character> = { ...sec.chars, p1: { ...(sec.chars.p1 as Character), biology: "b:m:30", health: "h:0" }, p2: { ...(sec.chars.p2 as Character), biology: "b:f:28", health: "h:1" } };
    expect(hasPair(pairChars, ["p1", "p2"])).toBe(true);
    expect(hasPair({ ...pairChars, p2: { ...(pairChars.p2 as Character), health: "h:12" } }, ["p1", "p2"])).toBe(false);
    const before = scores(s).p1 ?? 0;
    s = applyChange(s, finishBunker(s, content, pairChars), 15);
    expect(R(s).outcome).toMatchObject({ won: true, rebirth: true, beaten: 2 });
    expect(scores(s).p1).toBe(before + content.winPoints);
    expect(bunkerPrimary(s, content)).toBe("podium");
  });
});

describe("бункер: особые условия", () => {
  function withSpecial(special: Character["special"]) {
    const g = setup();
    let { s } = g;
    s = applyChange(s, startRound(s, g.content, g.sec), 3);
    const sec: Secrets = { ...g.sec, chars: { ...g.sec.chars, p1: { ...(g.sec.chars.p1 as Character), special } } };
    return { ...g, s, sec };
  }

  it("обмен багажом меняет карты, повторно сыграть нельзя", () => {
    const { s, sec, content } = withSpecial("swapBaggage");
    const out = applyUse(s, content, sec, "p1", { target: "p2", cat: null }, name);
    if ("refusal" in out) throw new Error(out.refusal);
    expect(out.secrets.chars.p1?.baggage).toBe(sec.chars.p2?.baggage);
    expect(out.secrets.chars.p2?.baggage).toBe(sec.chars.p1?.baggage);
    const s2 = applyChange(s, out.change, 5);
    expect(R(s2).used.p1).toBe("swapBaggage");
    expect(R(s2).log.at(-1)).toContain("Обмен багажом");
    const again = applyUse(s2, content, out.secrets, "p1", { target: "p3", cat: null }, name);
    expect("refusal" in again && again.refusal).toBe("used");
  });

  it("шпион видит закрытую карту, допрос открывает её всем", () => {
    const a = withSpecial("peek");
    const peek = applyUse(a.s, a.content, a.sec, "p1", { target: "p2", cat: "health" }, name);
    if ("refusal" in peek) throw new Error(peek.refusal);
    expect(peek.secrets.notes.p1?.[0]).toBe(`И2 · Здоровье|${a.sec.chars.p2?.health}`);
    expect(R(applyChange(a.s, peek.change, 5)).shown.p2).toBeUndefined();
    const b = withSpecial("forceReveal");
    const force = applyUse(b.s, b.content, b.sec, "p1", { target: "p2", cat: "fact" }, name);
    if ("refusal" in force) throw new Error(force.refusal);
    expect(R(applyChange(b.s, force.change, 5)).shown.p2?.fact).toBe(b.sec.chars.p2?.fact);
  });

  it("неприкосновенность и решающий голос — только на голосовании; отмена переносит изгнание", () => {
    const a = withSpecial("immunity");
    expect(applyUse(a.s, a.content, a.sec, "p1", { target: null, cat: null }, name)).toMatchObject({ refusal: "time" });
    let s = applyChange(a.s, startVote(a.s, a.content, 0), 5);
    const imm = applyUse(s, a.content, a.sec, "p1", { target: null, cat: null }, name);
    if ("refusal" in imm) throw new Error(imm.refusal);
    s = applyChange(s, imm.change, 6);
    const t = tallyVotes(R(s), a.content, { p2: "p1", p3: "p1", p4: "p1", p5: "p2" });
    expect(t.counts.p1).toBe(0);
    expect(t.out).toBe("p2");

    const c = withSpecial("cancelVote");
    let s3 = applyChange(c.s, startVote(c.s, c.content, 0), 5);
    const can = applyUse(s3, c.content, c.sec, "p1", { target: null, cat: null }, name);
    if ("refusal" in can) throw new Error(can.refusal);
    s3 = applyChange(s3, can.change, 6);
    s3 = applyChange(s3, countVotes(s3, c.content, { p2: "p3" }, c.sec.chars), 7);
    expect(R(s3).tally?.cancelled).toBe(true);
    expect(R(s3).exiled).toEqual([]);
    expect(bunkerPrimary(s3, c.content)).toBe("round");
  });

  it("лишняя койка и второй шанс меняют план изгнаний", () => {
    const a = withSpecial("extraBed");
    const bed = applyUse(a.s, a.content, a.sec, "p1", { target: null, cat: null }, name);
    if ("refusal" in bed) throw new Error(bed.refusal);
    expect(R(applyChange(a.s, bed.change, 5)).places).toBe(4);
    const b = withSpecial("returnExiled");
    let s = applyChange(b.s, startVote(b.s, b.content, 0), 5);
    s = applyChange(s, countVotes(s, b.content, { p1: "p4", p2: "p4" }, b.sec.chars), 6);
    expect(R(s).exiled).toEqual(["p4"]);
    const back = applyUse(s, b.content, b.sec, "p1", { target: null, cat: null }, name);
    if ("refusal" in back) throw new Error(back.refusal);
    s = applyChange(s, back.change, 7);
    expect(R(s).alive).toContain("p4");
    expect(R(s).exiled).toEqual([]);
  });

  it("все особые условия играются без ошибок", () => {
    const g = setup();
    let s = applyChange(g.s, startRound(g.s, g.content, g.sec), 3);
    s = applyChange(s, startVote(s, g.content, 0), 4);
    s = applyChange(s, countVotes(s, g.content, { p2: "p6", p3: "p6" }, g.sec.chars), 5);
    s = applyChange(s, startVote(s, g.content, 0), 6);
    for (const sp of ["swapBaggage", "swapHealth", "swapHobby", "swapFact", "swapProfession", "newProfession", "newHealthOther", "healSelf", "healOther", "infect", "stealBaggage", "peek", "forceReveal", "revealFacts", "immunity", "doubleVote", "cancelVote", "extraBed", "collapse", "returnExiled", "shuffleHealth", "shuffleBaggage", "newBunker"] as const) {
      const sec: Secrets = { ...g.sec, chars: { ...g.sec.chars, p1: { ...(g.sec.chars.p1 as Character), special: sp } } };
      const out = applyUse(s, g.content, sec, "p1", { target: "p2", cat: "hobby" }, name, rnd);
      expect("refusal" in out ? `${sp}: ${out.refusal}` : sp).toBe(sp);
      if (!("refusal" in out)) for (const c of Object.values(out.secrets.chars)) for (const k of CATS) expect(isRef(k, c[k])).toBe(true);
    }
  });
});
