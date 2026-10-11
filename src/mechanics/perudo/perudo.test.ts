import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session } from "../../data/types";
import { createPerudo, parsePerudo } from "./content";
import { diceOf, hostCupKey } from "./dice";
import { bidText, diceWord } from "./text";
import { aliveCups, countFace, isLegalBid, keysFrom, minQty, moveFromAnswers, parsePerudoResult, perudoBack, perudoPrimary, placeBid, resolveCall, startDeal, startRound, totalDice } from "./logic";

const players: Participant[] = ["a", "b", "c"].map((id, i) => ({ id, name: `Игрок ${id}`, kind: "player", teamId: null, captainUid: id, joinedAt: i + 1 }));
const ans = (step: number, pid: string, value: unknown): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: 1 });
let time = 1000;
const apply = (s: Session, change: object | null) => applyChange(s, (change ?? {}) as never, (time += 1000));

function session(): Session {
  return { id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "П", mechanic: "perudo", gameSnapshot: null, themeId: "joyrest", playMode: "solo", screenMode: "laptop", state: { ...startState(), phase: "playing" }, leaderboard: {}, createdAt: 0 } as Session;
}

describe("перудо: ставки", () => {
  it("поднять: больше костей или старше грань; единицы — половина, обратно — вдвое плюс одна; открыть единицами нельзя", () => {
    expect(minQty(null, 1, false)).toBeNull();
    expect(minQty(null, 3, false)).toBe(1);
    const five3 = { q: 5, f: 3 };
    expect(minQty(five3, 3, false)).toBe(6);
    expect(minQty(five3, 4, false)).toBe(5);
    expect(minQty(five3, 2, false)).toBe(6);
    expect(minQty(five3, 1, false)).toBe(3);
    expect(minQty({ q: 3, f: 1 }, 1, false)).toBe(4);
    expect(minQty({ q: 3, f: 1 }, 5, false)).toBe(7);
    expect(isLegalBid(five3, { q: 5, f: 4 }, false, 15)).toBe(true);
    expect(isLegalBid(five3, { q: 5, f: 2 }, false, 15)).toBe(false);
    expect(isLegalBid(five3, { q: 16, f: 4 }, false, 15)).toBe(false);
  });

  it("подписи ставок и костей по-русски", () => {
    expect(bidText({ q: 1, f: 6 })).toBe("одна шестёрка");
    expect(bidText({ q: 2, f: 1 })).toBe("2 единицы");
    expect(bidText({ q: 6, f: 3 })).toBe("6 троек");
    expect(bidText({ q: 21, f: 4 })).toBe("21 четвёрка");
    expect(diceWord(5)).toBe("5 костей");
    expect(diceWord(3)).toBe("3 кости");
    expect(diceWord(1)).toBe("1 кость");
  });

  it("палифико: открыть можно любой гранью, дальше грань не меняется", () => {
    expect(minQty(null, 1, true)).toBe(1);
    expect(minQty({ q: 2, f: 4 }, 4, true)).toBe(3);
    expect(minQty({ q: 2, f: 4 }, 5, true)).toBeNull();
  });

  it("подсчёт: единицы — джокеры, кроме палифико и ставки на сами единицы", () => {
    const shown = { a: [1, 3, 3], b: [1, 5], c: [3] };
    expect(countFace(shown, 3, false)).toBe(5);
    expect(countFace(shown, 3, true)).toBe(3);
    expect(countFace(shown, 1, false)).toBe(2);
  });

  it("кости: по ключу и числу раунда, 1…6, свои у каждого и каждый раунд", () => {
    const a = diceOf("ключ-а-1234567890", "n1", 5);
    expect(a).toHaveLength(5);
    expect(a.every((d) => d >= 1 && d <= 6)).toBe(true);
    expect(diceOf("ключ-а-1234567890", "n1", 5)).toEqual(a);
    expect(diceOf("ключ-а-1234567890", "n2", 5)).not.toEqual(a);
    // Распределение ровное.
    const hist = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 600; i++) for (const d of diceOf(`k${i}`, "r", 5)) hist[d - 1]++;
    expect(Math.min(...hist)).toBeGreaterThan(400);
    expect(hostCupKey("H", "p")).toBe("H:p");
  });
});

describe("перудо: партия", () => {
  it("раздача → ставки → «Не верю» → кость теряет ошибившийся → до последнего стакана; очки; «Назад»", () => {
    const content = { ...createPerudo(), startDice: 2, placePoints: 50, winPoints: 200 };
    let s = session();
    expect(perudoPrimary(s, content)).toBe("deal");
    s = apply(s, startDeal(s, players, content));
    let r = parsePerudoResult(s.state.result);
    expect(r).toMatchObject({ mode: "deal", seats: ["a", "b", "c"], keysStep: 0, dice: { a: 2, b: 2, c: 2 }, starter: "a" });
    expect(keysFrom([ans(0, "a", { key: "k".repeat(20) }), ans(0, "b", { key: "x" })], 0)).toEqual({ a: "k".repeat(20) });
    expect(perudoPrimary(s, content)).toBe("roll");
    s = apply(s, startRound(s, "n1"));
    r = parsePerudoResult(s.state.result);
    expect(r).toMatchObject({ mode: "bid", round: 1, turn: "a", changeable: true });
    expect(s.state.step).toBe(1);
    // Ход не того, чья очередь, и неверная ставка — не принимаются.
    expect(placeBid(s, "b", { q: 2, f: 3 })).toBeNull();
    expect(placeBid(s, "a", { q: 2, f: 1 })).toBeNull();
    // Ход с телефона — по номеру хода.
    const move = moveFromAnswers(s, [ans(1, "a", { n: String(r.seq), bid: { q: 2, f: 3 } })]);
    expect(move).toEqual({ pid: "a", bid: { q: 2, f: 3 } });
    expect(moveFromAnswers(s, [ans(1, "a", { n: "старый", bid: { q: 2, f: 3 } })])).toBeNull();
    s = apply(s, placeBid(s, "a", { q: 2, f: 3 }));
    r = parsePerudoResult(s.state.result);
    expect(r).toMatchObject({ turn: "b", bid: { q: 2, f: 3 }, bidder: "a" });
    // b не верит: троек с джокерами 3 — ставка подтвердилась, кость теряет b.
    const shown = { a: [3, 6], b: [1, 2], c: [3, 4] };
    s = apply(s, resolveCall(s, content, "dudo", shown));
    r = parsePerudoResult(s.state.result);
    expect(r.call).toMatchObject({ kind: "dudo", by: "b", count: 3, ok: true, loser: "b", out: null });
    expect(r.dice).toEqual({ a: 2, b: 1, c: 2 });
    // У b осталась одна кость — следующий раунд «Палифико», начинает b.
    expect(r).toMatchObject({ mode: "reveal", palificoNext: true, starter: "b", palificoDone: ["b"] });
    // «Назад» — к ставке b, кости и очки как были.
    const back = perudoBack(s);
    const undone = apply(s, back?.change ?? null);
    expect(parsePerudoResult(undone.state.result)).toMatchObject({ mode: "bid", turn: "b", dice: { a: 2, b: 2, c: 2 } });

    // Раунд 2 — палифико: b открывает; c не верит — ставка ложная, b выбывает (очки за выбывших раньше — 0).
    s = apply(s, startRound(s, "n2"));
    r = parsePerudoResult(s.state.result);
    expect(r).toMatchObject({ palifico: true, turn: "b", round: 2 });
    s = apply(s, placeBid(s, "b", { q: 2, f: 1 }));
    s = apply(s, resolveCall(s, content, "dudo", { a: [1, 5], b: [4], c: [6, 6] }));
    r = parsePerudoResult(s.state.result);
    expect(r.call).toMatchObject({ count: 1, ok: false, loser: "b", out: "b" });
    expect(r.out).toEqual(["b"]);
    expect(aliveCups(r)).toEqual(["a", "c"]);
    // b выбыл — следующий раунд начинает c.
    expect(r.starter).toBe("c");

    // Раунд 3: «Ровно!» — a угадывает точно: кость назад нельзя (у a полный стакан), никто не теряет.
    s = apply(s, startRound(s, "n3"));
    s = apply(s, placeBid(s, "c", { q: 2, f: 5 }));
    s = apply(s, resolveCall(s, content, "calza", { a: [5, 2], c: [1, 3] }));
    r = parsePerudoResult(s.state.result);
    expect(r.call).toMatchObject({ kind: "calza", by: "a", count: 2, ok: true, loser: null, gainer: null });
    expect(r.dice.a).toBe(2);

    // Раунд 4: a ставит, c не верит — ставка ложная, a теряет; ещё раунд — a выбывает, c побеждает.
    s = apply(s, startRound(s, "n4"));
    expect(parsePerudoResult(s.state.result).turn).toBe("a");
    s = apply(s, placeBid(s, "a", { q: 3, f: 6 }));
    s = apply(s, resolveCall(s, content, "dudo", { a: [2, 2], c: [6, 3] }));
    s = apply(s, startRound(s, "n5"));
    s = apply(s, placeBid(s, "a", { q: 2, f: 4 }));
    s = apply(s, resolveCall(s, content, "dudo", { a: [3], c: [2, 2] }));
    r = parsePerudoResult(s.state.result);
    expect(r).toMatchObject({ mode: "over", winner: "c", out: ["b", "a"] });
    expect(s.leaderboard.b?.score).toBe(0);
    expect(s.leaderboard.a?.score).toBe(50);
    expect(s.leaderboard.c?.score).toBe(50 * 2 + 200);
    expect(totalDice(r)).toBe(2);
    expect(perudoPrimary(s, content)).toBe("podium");
    expect(perudoPrimary(s, { ...content, parties: 2 })).toBe("nextParty");
    // Следующая партия: все с полным стаканом, начинает победитель, очки остаются.
    const p2 = apply(s, startDeal(s, players, content));
    expect(parsePerudoResult(p2.state.result)).toMatchObject({ party: 2, starter: "c", dice: { a: 2, b: 2, c: 2 }, mode: "deal" });
    expect(p2.leaderboard.c?.score).toBe(300);
    // «Назад» с победы снимает очки победителю.
    const unwon = apply(s, perudoBack(s)?.change ?? null);
    expect(unwon.leaderboard.c?.score).toBe(0);
  });

  it("за столом не больше 10 стаканов; разбор битого состояния без ошибок", () => {
    const many: Participant[] = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `П${i}`, kind: "player", teamId: null, captainUid: `p${i}`, joinedAt: i }));
    const s = apply(session(), startDeal(session(), many, createPerudo()));
    const r = parsePerudoResult(s.state.result);
    expect(r.seats).toHaveLength(10);
    expect(r.waiting).toEqual(["p10", "p11"]);
    expect(parsePerudoResult({ mode: "x", dice: { a: 99 }, bid: { q: -1 } })).toMatchObject({ mode: "deal", dice: {}, bid: null });
    expect(parsePerudo({ startDice: 40 }).startDice).toBe(6);
  });
});
