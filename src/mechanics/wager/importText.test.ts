import { describe, expect, it } from "vitest";
import { importWager } from "./importText";

describe("«Держи пари»: вставка списком", () => {
  it("число и единицы", () => {
    const { questions, skipped } = importWager("Высота Эльбруса? = 5642 м\nСтупеней Эйфелевой башни? = 1 665 ступеней\nПи? = 3,14");
    expect(skipped).toEqual([]);
    expect(questions.map((q) => [q.answer, q.unit])).toEqual([
      [5642, "м"],
      [1665, "ступеней"],
      [3.14, ""],
    ]);
    expect(questions[0]?.text).toBe("Высота Эльбруса?");
  });

  it("«= около 330 м» — не ответ 0, а пропущенная строка", () => {
    const { questions, skipped } = importWager("Высота башни? = около 330 м");
    expect(questions).toEqual([]);
    expect(skipped).toEqual([{ line: 1, text: "Высота башни? = около 330 м" }]);
  });

  it("строки без «=», без вопроса и без числа — в пропущенных с номером", () => {
    const { questions, skipped } = importWager("Вопрос без ответа\n\n= 10\nСколько? = \nГод? = 1799");
    expect(questions.map((q) => q.answer)).toEqual([1799]);
    expect(skipped.map((s) => s.line)).toEqual([1, 3, 4]);
  });

  it("отрицательные числа и неразрывные пробелы", () => {
    const { questions } = importWager("Температура? = −40 °C\nНаселение? = 12 600 000 человек");
    expect(questions.map((q) => q.answer)).toEqual([-40, 12600000]);
    expect(questions[0]?.unit).toBe("°C");
  });
});
