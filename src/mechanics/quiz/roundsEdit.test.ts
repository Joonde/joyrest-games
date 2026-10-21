import { describe, expect, it } from "vitest";
import { newQuestion, quizRounds, type QuizContent, type QuizQuestion } from "./content";
import { insertAfter, moveKeepingRounds, nextRoundTitle, removeKeepingRound, removeRoundAt, startRoundAt } from "./roundsEdit";

function game(...rounds: Array<string | null>): QuizQuestion[] {
  return rounds.map((round, i) => ({ ...newQuestion("choice"), id: `q${i + 1}`, text: `Вопрос ${i + 1}`, round }));
}
const ids = (qs: QuizQuestion[]) => qs.map((q) => q.id);
const marks = (qs: QuizQuestion[]) => qs.map((q) => q.round);
const groups = (qs: QuizQuestion[]) => quizRounds({ questions: qs } as QuizContent).map((r) => [r.title, r.from, r.to]);

describe("раунды — блоки в списке вопросов", () => {
  it("вопрос переезжает, блоки раундов остаются на местах", () => {
    const qs = game("Кино", null, null, "Музыка", null);
    // Первый вопрос «Музыки» поднимается выше блока — он уходит в «Кино», блок остаётся на 4-м месте.
    const up = moveKeepingRounds(qs, 3, 2);
    expect(ids(up)).toEqual(["q1", "q2", "q4", "q3", "q5"]);
    expect(marks(up)).toEqual(["Кино", null, null, "Музыка", null]);
    expect(groups(up)).toEqual([["Кино", 0, 2], ["Музыка", 3, 4]]);
    // Последний вопрос «Кино» опускается за блок — он теперь первый в «Музыке».
    const down = moveKeepingRounds(qs, 2, 3);
    expect(ids(down)).toEqual(["q1", "q2", "q4", "q3", "q5"]);
    expect(groups(down)).toEqual([["Кино", 0, 2], ["Музыка", 3, 4]]);
  });

  it("без раундов перенос — обычный, ничего не появляется", () => {
    const qs = game(null, null, null);
    const moved = moveKeepingRounds(qs, 0, 2);
    expect(ids(moved)).toEqual(["q2", "q3", "q1"]);
    expect(marks(moved)).toEqual([null, null, null]);
    expect(moveKeepingRounds(qs, 1, 1)).toBe(qs);
  });

  it("удалили первый вопрос раунда — раунд начинается со следующего", () => {
    const qs = game("Кино", null, "Музыка", null);
    expect(groups(removeKeepingRound(qs, "q1"))).toEqual([["Кино", 0, 0], ["Музыка", 1, 2]]);
    // Раунд из одного вопроса: следующий уже начинает свой раунд — блок пропадает.
    expect(groups(removeKeepingRound(game("Кино", "Музыка", null), "q1"))).toEqual([["Музыка", 0, 1]]);
    expect(removeKeepingRound(qs, "нет")).toBe(qs);
  });

  it("новый раунд с вопроса: название по номеру, вопросы выше — «Раунд 1»", () => {
    const flat = game(null, null, null, null);
    expect(nextRoundTitle(flat, 0)).toBe("Раунд 1");
    expect(nextRoundTitle(flat, 2)).toBe("Раунд 2");
    const split = startRoundAt(flat, 2);
    expect(groups(split)).toEqual([["", 0, 1], ["Раунд 2", 2, 3]]);
    expect(nextRoundTitle(game("Кино", null, "Музыка", null, null), 4)).toBe("Раунд 3");
    expect(marks(startRoundAt(flat, 1, "  Кино "))).toEqual([null, "Кино", null, null]);
  });

  it("убрать блок — его вопросы уходят в раунд выше", () => {
    const qs = game("Кино", null, "Музыка", null);
    expect(groups(removeRoundAt(qs, 2))).toEqual([["Кино", 0, 3]]);
    expect(groups(removeRoundAt(removeRoundAt(qs, 2), 0))).toEqual([]);
  });

  it("новый вопрос после последнего вопроса раунда остаётся в этом раунде", () => {
    const qs = game("Кино", null, "Музыка", null);
    const added = insertAfter(qs, 1, { ...newQuestion("choice"), id: "new" });
    expect(ids(added)).toEqual(["q1", "q2", "new", "q3", "q4"]);
    expect(groups(added)).toEqual([["Кино", 0, 2], ["Музыка", 3, 4]]);
    expect(ids(insertAfter(qs, -1, { ...newQuestion("choice"), id: "first" }))[0]).toBe("first");
  });
});
