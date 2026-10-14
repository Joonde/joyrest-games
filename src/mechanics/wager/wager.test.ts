import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { cleanNumber, createWager, formatNumber, layoutSlots, parseWager, winningSlot } from "./content";
import { DEMO_WAGER } from "./demo";
import { betsFrom, guessesOf, liveProgress, nextQuestion, openBets, parseWagerResult, payoutsOf, revealAnswer, showQuestion, wagerBack, wagerPrimary } from "./logic";
import { validateWager } from "./validate";

const content = parseWager({
  questions: [
    { id: "q1", text: "Высота Эйфелевой башни?", answer: 330, unit: "м" },
    { id: "q2", text: "Сколько костей у взрослого человека?", answer: 206 },
  ],
  guessTime: 60,
  betTime: 45,
  chipPoints: 10,
  authorBonus: 30,
});
const teams: Participant[] = ["A", "B", "C", "D"].map((id, i) => ({ id, name: `Команда ${id}`, kind: "team", teamId: null, captainUid: `u${id}`, joinedAt: i }));
const session = (): Session => ({ id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "wager", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 });
let t = 1000;
const apply = (s: Session, c: SessionChange) => applyChange(s, c, (t += 1000));
const ans = (pid: string, step: number, value: unknown): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: t + 500 });

describe("поле и выигрыш", () => {
  it("коэффициенты: середина 2:1, при чётном числе две средние 3:1, к краям до 5:1; одинаковые — в одной ячейке", () => {
    const odd = layoutSlots([1, 2, 3, 4, 5].map((v, i) => ({ pid: `p${i}`, value: v })));
    expect(odd.map((s) => s.odds)).toEqual([4, 3, 2, 3, 4]);
    const even = layoutSlots([10, 20, 30, 40].map((v, i) => ({ pid: `p${i}`, value: v })));
    expect(even.map((s) => s.odds)).toEqual([4, 3, 3, 4]);
    const seven = layoutSlots([1, 2, 3, 4, 5, 6, 7].map((v, i) => ({ pid: `p${i}`, value: v })));
    expect(seven.map((s) => s.odds)).toEqual([5, 4, 3, 2, 3, 4, 5]);
    const same = layoutSlots([{ pid: "a", value: 5 }, { pid: "b", value: 5 }, { pid: "c", value: 9 }]);
    expect(same).toHaveLength(2);
    expect(same[0]?.authors).toEqual(["a", "b"]);
    // Больше 11 догадок — на поле 11 ближайших к середине.
    expect(layoutSlots(Array.from({ length: 15 }, (_, i) => ({ pid: `p${i}`, value: i }))).map((s) => s.value)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("выигрывает ближайшая, но не больше правды; все больше — «меньше всех»", () => {
    const slots = layoutSlots([100, 300, 400].map((v, i) => ({ pid: `p${i}`, value: v })));
    expect(winningSlot(slots, 330)).toBe(1);
    expect(winningSlot(slots, 300)).toBe(1);
    expect(winningSlot(slots, 50)).toBe(-1);
    expect(winningSlot(slots, 1000)).toBe(2);
  });

  it("числа: запятая, пробелы, предел", () => {
    expect(cleanNumber("1 250,5")).toBe(1250.5);
    expect(cleanNumber("abc")).toBeNull();
    expect(cleanNumber(1e13)).toBeNull();
    expect(formatNumber(1250.5)).toBe("1 250,5");
    expect(formatNumber(-3)).toBe("−3");
  });
});

describe("Держи пари: вопрос целиком", () => {
  it("догадки → поле → ставки → ответ: фишки по коэффициенту, свои очки сгорают, автору бонус; «Назад» снимает очки", () => {
    let s = session();
    expect(wagerPrimary(s, content)).toBe("show");
    s = apply(s, showQuestion(s, content, teams));
    expect(s.state.timeLimit).toBe(60);
    // У C уже есть очки — поставит сверху.
    s = apply(s, { addScore: { C: 100 } });
    const g = s.state.step;
    const guesses = [ans("A", g, { guess: 300 }), ans("B", g, { guess: 500 }), ans("C", g, { guess: "250" }), ans("D", g, { guess: 300 })];
    expect(guessesOf(s, guesses)).toHaveLength(4);
    expect(liveProgress(s, content, guesses)?.state?.answered).toBe(4);
    s = apply(s, openBets(s, content, guesses));
    let r = parseWagerResult(s.state.result);
    expect(r.mode).toBe("bet");
    // 250, 300 (A и D), 500 — три ячейки: 3:1, 2:1, 3:1.
    expect(r.slots.map((x) => [x.value, x.odds, x.authors])).toEqual([[250, 3, ["C"]], [300, 2, ["A", "D"]], [500, 3, ["B"]]]);
    const b = s.state.step;
    const bets = [
      ans("A", b, { bets: [{ slot: 1, stake: 0 }, { slot: 1, stake: 0 }] }),
      ans("B", b, { bets: [{ slot: 2, stake: 0 }, { slot: -1, stake: 0 }] }),
      // C ставит 80 своих на 300 и ещё 80 на 500 — хватает только на 20.
      ans("C", b, { bets: [{ slot: 1, stake: 80 }, { slot: 2, stake: 80 }] }),
      ans("D", b, { bets: [{ slot: 9, stake: 0 }] }),
    ];
    expect(betsFrom(s, bets, r.slots, true).C).toEqual([{ slot: 1, stake: 80 }, { slot: 2, stake: 20 }]);
    s = apply(s, revealAnswer(s, content, bets));
    r = parseWagerResult(s.state.result);
    expect(r.win).toBe(1);
    // A: две фишки ×2 по 10 = 40 + автор 30; B: 0; C: 10×2 + 80×2 − 20 = 160; D: автор 30 (ставка мимо поля не считается).
    expect(s.leaderboard.A?.score).toBe(70);
    expect(s.leaderboard.B?.score ?? 0).toBe(0);
    expect(s.leaderboard.C?.score).toBe(260);
    expect(s.leaderboard.D?.score).toBe(30);
    expect(wagerPrimary(s, content)).toBe("next");
    // «Назад» с ответа — очки сняты, снова ставки.
    s = apply(s, wagerBack(s, content)?.change ?? {});
    expect(parseWagerResult(s.state.result).mode).toBe("bet");
    expect(s.leaderboard.A?.score).toBe(0);
    expect(s.leaderboard.C?.score).toBe(100);
    // «Назад» со ставок — к догадкам, догадки на месте.
    const back = wagerBack(s, content);
    expect(back?.clear).toEqual([b]);
    s = apply(s, back?.change ?? {});
    expect(parseWagerResult(s.state.result).mode).toBe("guess");
    expect(guessesOf(s, guesses)).toHaveLength(4);
    s = apply(s, openBets(s, content, guesses));
    s = apply(s, revealAnswer(s, content, bets));
    s = apply(s, nextQuestion(s));
    expect(s.state.stage).toBe("ready");
    expect(parseWagerResult(s.state.result).q).toBe(1);
    // «Назад» с заставки — снова ответ прошлого вопроса, очки не трогаются.
    const before = s.leaderboard.A?.score;
    s = apply(s, wagerBack(s, content)?.change ?? {});
    expect(parseWagerResult(s.state.result).mode).toBe("answer");
    expect(s.leaderboard.A?.score).toBe(before);
  });

  it("все догадки больше правды — выигрывает «меньше всех» 6:1, авторам ничего", () => {
    const slots = layoutSlots([{ pid: "A", value: 50 }]);
    expect(payoutsOf(content, slots, { A: [{ slot: -1, stake: 10 }], B: [{ slot: 0, stake: 5 }] }, -1)).toEqual({ A: 120, B: -5 });
  });

  it("последний вопрос — награждение; репетиция без команд проходит до конца", () => {
    let s = session();
    for (let q = 0; q < content.questions.length; q++) {
      s = apply(s, showQuestion(s, content, []));
      s = apply(s, openBets(s, content, []));
      expect(parseWagerResult(s.state.result).slots).toEqual([]);
      s = apply(s, revealAnswer(s, content, []));
      if (q + 1 < content.questions.length) s = apply(s, nextQuestion(s));
    }
    expect(wagerPrimary(s, content)).toBe("finish");
  });

  it("шаблон и новая игра проходят проверку; без ответа и вопроса — ошибки", () => {
    expect(validateWager(DEMO_WAGER.content)).toEqual([]);
    expect(DEMO_WAGER.content.questions.length).toBeGreaterThanOrEqual(7);
    expect(validateWager(createWager()).length).toBeGreaterThan(0);
    expect(validateWager(parseWager({ questions: [] })).length).toBeGreaterThan(0);
  });
});
