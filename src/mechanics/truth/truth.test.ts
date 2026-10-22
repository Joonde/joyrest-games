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

describe("правда или действие: очередь и колода (QA 23 октября 2026)", () => {
  const mk = (list: string[]): Participant[] => list.map((id, i) => ({ id, name: id, kind: "player", teamId: null, captainUid: id, joinedAt: i + 1 }));
  const content = { ...parseTruth({}), cards: parseCardList("Правда: 1\n2\n3\nДействие: 4\n5"), rounds: 0 };

  /** Сыграть ход и перейти к следующему с данным составом. */
  function play(s: Session, parts: Participant[]): Session {
    let n = applyChange(s, choose(s, content, "truth", first), 1_000_000);
    n = applyChange(n, resolve(n, content, "done"), 1_000_000);
    return applyChange(n, nextTurn(n, parts), 1_000_000);
  }

  it("опоздавший встаёт в конец круга: никто не ходит дважды и никого не пропускают", () => {
    let s = applyChange(session(), startTruth(session(), mk(["a", "b", "c"])), 1_000_000);
    const seq: string[] = [];
    for (let t = 0; t < 8; t++) {
      seq.push(turnPid(parseTruthResult(s.state.result)) ?? "");
      s = play(s, t >= 4 ? mk(["a", "b", "c", "d"]) : mk(["a", "b", "c"]));
    }
    expect(seq).toEqual(["a", "b", "c", "a", "b", "c", "d", "a"]);
    expect(parseTruthResult(s.state.result).round).toBe(3);
  });

  it("опоздавший в середине круга ходит в этом же круге, после последнего", () => {
    let s = applyChange(session(), startTruth(session(), mk(["a", "b", "c"])));
    s = play(s, mk(["a", "b", "c", "d"]));
    const seq = [turnPid(parseTruthResult(s.state.result))];
    for (let t = 0; t < 3; t++) {
      s = play(s, mk(["a", "b", "c", "d"]));
      seq.push(turnPid(parseTruthResult(s.state.result)));
    }
    expect(seq).toEqual(["b", "c", "d", "a"]);
    expect(parseTruthResult(s.state.result).round).toBe(2);
  });

  it("ведущий убрал того, кто ходил, или следующего — очередь идёт дальше без пропусков", () => {
    let s = applyChange(session(), startTruth(session(), mk(["a", "b", "c", "d"])));
    s = play(s, mk(["a", "b", "c", "d"])); // ходит b
    const lb = { ...s.leaderboard };
    delete lb.b;
    s = { ...s, leaderboard: lb };
    s = play(s, mk(["a", "c", "d"])); // b убрали во время своего хода
    expect(turnPid(parseTruthResult(s.state.result))).toBe("c");
    const lb2 = { ...s.leaderboard };
    delete lb2.d;
    s = play({ ...s, leaderboard: lb2 }, mk(["a", "c"])); // d убрали до его хода
    expect(turnPid(parseTruthResult(s.state.result))).toBe("a");
    expect(parseTruthResult(s.state.result).round).toBe(2);
  });

  it("круги считаются по проходу очереди: 2 круга по 3 игрока — 6 ходов, с опоздавшим — 7", () => {
    const two = { ...content, rounds: 2 };
    let s = applyChange(session(), startTruth(session(), mk(["a", "b", "c"])));
    let turns = 1;
    for (; turns < 20; turns++) {
      let n = applyChange(s, choose(s, two, "truth", first));
      n = applyChange(n, resolve(n, two, "done"));
      if (roundsDone(two, parseTruthResult(n.state.result))) break;
      s = applyChange(n, nextTurn(n, turns >= 4 ? mk(["a", "b", "c", "d"]) : mk(["a", "b", "c"])));
    }
    expect(turns).toBe(7);
  });

  it("старая сессия без `who` и `round` читается по номеру хода", () => {
    const r = parseTruthResult({ order: ["a", "b", "c"], turn: 4 });
    expect(turnPid(r)).toBe("b");
    expect(r.round).toBe(2);
  });

  it("колода кончилась — только что выпавшая не выпадает сразу снова", () => {
    const two = { ...parseTruth({}), cards: parseCardList("Правда: 1\n2") };
    let r = parseTruthResult({});
    const seq: string[] = [];
    for (const v of [0, 0, 0.99, 0, 0.99]) {
      const d = draw(two, r, "truth", () => v);
      seq.push(d.card?.text ?? "");
      r = { ...r, used: d.used, extra: d.extra };
    }
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    // В колоде одна карточка — она и выпадает снова.
    const one = { ...parseTruth({}), cards: parseCardList("Правда: 1") };
    const d1 = draw(one, parseTruthResult({}), "truth", first);
    expect(draw(one, { ...parseTruthResult({}), used: d1.used }, "truth", first).card?.text).toBe("1");
  });
});
