import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { boardOf, createWine, parseWine, winningKeys } from "./content";
import { DEMO_WINE } from "./demo";
import { betsOf, cleanChips, liveChips, nextWine, openBets, openBottle, parseWineResult, wineBack, winePrimary } from "./logic";
import { validateWine } from "./validate";

const content = parseWine({
  ...createWine(),
  yearFrom: 2015,
  wines: [
    { id: "v1", name: "Кьянти", color: "red", world: "old", sweetness: "dry", country: "италия", grape: "Санджовезе", year: 2020 },
    { id: "v2", name: "Гренаш", color: "rose", world: "old", sweetness: "dry", country: "Франция", grape: "Гренаш", year: 2010 },
  ],
});
const YEAR = 2026;
const guests: Participant[] = ["A", "B", "C"].map((id, i) => ({ id, name: `Гость ${id}`, kind: "player", teamId: null, captainUid: `u${id}`, joinedAt: i }));
const session = (): Session => ({ id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "wine", gameSnapshot: null, themeId: "joyrest", playMode: "solo", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 });
let t = 1000;
const apply = (s: Session, c: SessionChange) => applyChange(s, c, (t += 1000));
const ans = (pid: string, step: number, chips: Record<string, number>): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value: { chips }, submittedAt: t + 500 });

describe("поле и паспорт", () => {
  it("верные ячейки: страна без учёта регистра, сорт не из списка — «Другой», год раньше поля — «Старше», без года — «Без года»", () => {
    expect(winningKeys(content, content.wines[0]!, YEAR)).toMatchObject({ color: "color:red", country: "country:Италия", grape: "grape:Санджовезе", year: "year:2020" });
    expect(winningKeys(content, content.wines[1]!, YEAR)).toMatchObject({ grape: "grape:other", year: "year:older", color: "color:rose" });
    expect(winningKeys(content, { ...content.wines[1]!, year: null }, YEAR).year).toBe("year:nv");
    const board = boardOf(content, YEAR);
    expect(board.year[0]?.key).toBe("year:older");
    expect(board.year.at(-1)?.key).toBe("year:nv");
    expect(board.country.at(-1)?.key).toBe("country:other");
  });

  it("фишек не больше положенного, только ячейки поля", () => {
    const chips = cleanChips(content, { chips: { "color:red": 3, "year:1999": 2, "country:Италия": 4, "grape:Мерло": -1 } }, YEAR);
    expect(chips).toEqual({ "color:red": 3, "country:Италия": 2 });
  });
});

describe("Винное казино: бутылка целиком", () => {
  it("ставки → фишки на экране → открыть бутылку: цена фишки × коэффициент; «Назад» снимает очки", () => {
    let s = session();
    expect(winePrimary(s, content)).toBe("bets");
    s = apply(s, openBets(s, content, guests, YEAR));
    expect(s.state.timeLimit).toBe(90);
    const step = s.state.step;
    const bets = [
      ans("A", step, { "color:red": 2, "country:Италия": 1, "year:2020": 1, "grape:Мерло": 1 }),
      ans("B", step, { "color:white": 5 }),
      ans("C", step, { "world:old": 1, "sweetness:dry": 1, "grape:Санджовезе": 3 }),
    ];
    expect(Object.keys(betsOf(s, content, bets))).toHaveLength(3);
    const live = liveChips(s, content, bets);
    expect(live?.state?.answered).toBe(3);
    s = apply(s, live ?? {});
    expect(parseWineResult(s.state.result).chips["color:red"]).toBe(2);
    s = apply(s, openBottle(s, content, bets));
    // A: 2×10×2 + 1×10×4 + 1×10×8 = 160; B: 0; C: 10×2 + 10×3 + 3×10×5 = 200.
    expect(s.leaderboard.A?.score).toBe(160);
    expect(s.leaderboard.B?.score ?? 0).toBe(0);
    expect(s.leaderboard.C?.score).toBe(200);
    expect(winePrimary(s, content)).toBe("next");
    s = apply(s, wineBack(s)?.change ?? {});
    expect(parseWineResult(s.state.result).mode).toBe("bet");
    expect(s.leaderboard.A?.score).toBe(0);
    s = apply(s, openBottle(s, content, bets));
    s = apply(s, nextWine(s));
    expect(s.state.stage).toBe("ready");
    expect(parseWineResult(s.state.result).w).toBe(1);
    s = apply(s, wineBack(s)?.change ?? {});
    expect(parseWineResult(s.state.result).mode).toBe("open");
    expect(s.leaderboard.A?.score).toBe(160);
  });

  it("репетиция без гостей доходит до конца", () => {
    let s = session();
    for (let w = 0; w < content.wines.length; w++) {
      s = apply(s, openBets(s, content, [], YEAR));
      s = apply(s, openBottle(s, content, []));
      if (w + 1 < content.wines.length) s = apply(s, nextWine(s));
    }
    expect(winePrimary(s, content)).toBe("finish");
  });

  it("шаблон проходит проверку, пустое вино — нет", () => {
    expect(validateWine(DEMO_WINE.content)).toEqual([]);
    expect(validateWine(parseWine({ wines: [{ id: "x" }] })).length).toBeGreaterThan(0);
  });
});

describe("винное казино: год вина (QA 23 октября 2026)", () => {
  it("год позже текущего — проверка просит исправить; текущий и «без года» — можно, и ячейка есть на поле", () => {
    const c = createWine();
    const later = { ...c.wines[0]!, name: "X", year: 2027 };
    expect(validateWine({ ...c, wines: [later] }, 2026).map((e) => e.path)).toEqual([`wines/${later.id}/year`]);
    for (const year of [2026, null]) {
      const w = { ...later, year };
      expect(validateWine({ ...c, wines: [w] }, 2026)).toEqual([]);
      const key = winningKeys(c, w, 2026).year;
      expect(boardOf(c, 2026).year.some((o) => o.key === key)).toBe(true);
    }
  });
});
