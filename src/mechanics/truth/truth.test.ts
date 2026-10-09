import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session } from "../../data/types";
import { deckOf, parseCardList, parseTruth } from "./content";
import { DEMO_TRUTH, DEMO_TRUTH_ADULT } from "./demo";
import { choose, chooseFromAnswers, draw, handleSuggestion, nextTurn, parseTruthResult, pendingSuggestions, redraw, resolve, roundsDone, startTruth, truthBack, truthPrimary, turnPid } from "./logic";
import { validateTruth } from "./validate";

const players: Participant[] = ["a", "b", "c"].map((id, i) => ({ id, name: `Игрок ${id}`, kind: "player", teamId: null, captainUid: id, joinedAt: i + 1 }));
const ans = (step: number, pid: string, value: unknown): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: 1 });
const first = () => 0;

function session(): Session {
  return { id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "П", mechanic: "truth", gameSnapshot: null, themeId: "joyrest", playMode: "solo", screenMode: "laptop", state: { ...startState(), phase: "playing" }, leaderboard: {}, createdAt: 0 } as Session;
}

describe("правда или действие: колода", () => {
  it("список строками: вид по пометке, 18+", () => {
    const cards = parseCardList("Правда: Раз\nДва\nДействие: Три\n18+ Правда: Четыре\nПять");
    expect(cards.map((c) => [c.kind, c.text, c.adult])).toEqual([
      ["truth", "Раз", false],
      ["truth", "Два", false],
      ["dare", "Три", false],
      ["truth", "Четыре", true],
      ["truth", "Пять", false],
    ]);
  });

  it("18+ не выпадают без галочки; шаблоны проходят проверку", () => {
    expect(deckOf(DEMO_TRUTH_ADULT, "truth").length).toBeGreaterThan(deckOf({ ...DEMO_TRUTH_ADULT, adult: false }, "truth").length);
    expect(DEMO_TRUTH.cards.some((c) => c.adult)).toBe(false);
    expect(validateTruth(DEMO_TRUTH)).toEqual([]);
    expect(validateTruth(DEMO_TRUTH_ADULT)).toEqual([]);
    expect(validateTruth(parseTruth({}))).toHaveLength(2);
  });

  it("карточки не повторяются, пока колода не кончится; гостевые — первыми", () => {
    const content = { ...parseTruth({}), cards: parseCardList("Правда: 1\n2\n3") };
    let r = parseTruthResult({});
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const d = draw(content, r, "truth", () => 0.5);
      seen.add(d.card?.text ?? "");
      r = { ...r, used: d.used };
    }
    expect(seen.size).toBe(3);
    expect(draw(content, r, "truth", first).card).not.toBeNull();
    const withGuest = { ...r, extra: [{ id: "g1", kind: "truth" as const, text: "От гостя", from: "b" }] };
    expect(draw(content, withGuest, "truth").card).toMatchObject({ text: "От гостя", from: "b" });
    expect(draw(content, withGuest, "dare").card).toBeNull();
  });
});

describe("правда или действие: ход", () => {
  it("выбор с телефона, очки, отказ, следующий, круги, назад", () => {
    const content = { ...DEMO_TRUTH, rounds: 1, refusePenalty: 20 };
    let s = session();
    expect(truthPrimary(s, content)).toBe("start");
    s = applyChange(s, startTruth(s, players), 1);
    let r = parseTruthResult(s.state.result);
    expect(turnPid(r)).toBe("a");
    expect(truthPrimary(s, content)).toBe("waitChoice");
    // Чужой выбор не считается — только того, чья очередь.
    expect(chooseFromAnswers(s, content, [ans(0, "b", { choice: "dare" })])).toBeNull();
    s = applyChange(s, chooseFromAnswers(s, content, [ans(0, "a", { choice: "dare" })], first)!, 2);
    r = parseTruthResult(s.state.result);
    expect(r).toMatchObject({ mode: "card", choice: "dare" });
    const old = r.card?.id;
    s = applyChange(s, redraw(s, content, first), 3);
    expect(parseTruthResult(s.state.result).card?.id).not.toBe(old);
    s = applyChange(s, resolve(s, content, "done"), 4);
    expect(s.leaderboard.a?.score).toBe(100);
    const back = truthBack(s)!;
    const undone = applyChange(s, back.change, 5);
    expect(undone.leaderboard.a?.score).toBe(0);
    expect(parseTruthResult(undone.state.result).mode).toBe("card");
    s = applyChange(s, nextTurn(s, players), 6);
    expect(turnPid(parseTruthResult(s.state.result))).toBe("b");
    s = applyChange(s, choose(s, content, "truth", first), 7);
    s = applyChange(s, resolve(s, content, "refused"), 8);
    expect(s.leaderboard.b?.score).toBe(-20);
    // «Назад» с выбора следующего — к итогу прошлого хода.
    const n = applyChange(s, nextTurn(s, players), 9);
    const b2 = truthBack(n)!;
    expect(b2.clearAnswers).toBe(n.state.step);
    expect(parseTruthResult(applyChange(n, b2.change, 10).state.result)).toMatchObject({ mode: "done", outcome: "refused" });
    s = applyChange(n, choose(n, content, "truth", first), 11);
    s = applyChange(s, resolve(s, content, "done"), 12);
    expect(roundsDone(content, parseTruthResult(s.state.result))).toBe(true);
    expect(truthPrimary(s, content)).toBe("podium");
  });

  it("задания гостей: в колоду или нет, выпадают первыми", () => {
    let s = session();
    s = applyChange(s, startTruth(s, players), 1);
    const list = [ans(0, "b", { suggest: { kind: "dare", text: "Спеть гимн" } }), ans(0, "c", { suggest: { kind: "truth", text: "  " } })];
    const pending = pendingSuggestions(parseTruthResult(s.state.result), list, 0);
    expect(pending).toHaveLength(1);
    s = applyChange(s, handleSuggestion(s, pending[0]!, true), 2);
    expect(pendingSuggestions(parseTruthResult(s.state.result), list, 0)).toHaveLength(0);
    s = applyChange(s, choose(s, DEMO_TRUTH, "dare", first), 3);
    expect(parseTruthResult(s.state.result).card).toMatchObject({ text: "Спеть гимн", from: "b" });
    // «Назад» с карточки — гостевая возвращается в очередь.
    const back = truthBack(s)!;
    expect(parseTruthResult(applyChange(s, back.change, 4).state.result).extra).toHaveLength(1);
  });
});
