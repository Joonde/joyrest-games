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

  it("Р4: «= 1.665 ступеней» — 1665, а не 1,67; дроби и номер вопроса", () => {
    const { questions, skipped } = importWager("Ступеней? = 1.665 ступеней\nВес? = 1,5 кг\nПи? = 3.14\n1. Высота башни? = 330 м\nДеньги? = 1 000 000 руб");
    expect(skipped).toEqual([]);
    expect(questions.map((q) => [q.text, q.answer, q.unit])).toEqual([
      ["Ступеней?", 1665, "ступеней"],
      ["Вес?", 1.5, "кг"],
      ["Пи?", 3.14, ""],
      ["Высота башни?", 330, "м"],
      ["Деньги?", 1000000, "руб"],
    ]);
  });

  it("третий круг: «Вопрос 1» отдельной строкой пропускается молча, «Вопрос 2: …» — номер снят, «Вопрос 3?» — нет", () => {
    const { questions, skipped } = importWager("Вопрос 1\nВысота башни? = 330 м\nВопрос 2: Вес? = 5 кг\nВопрос 3? = 3");
    expect(skipped).toEqual([]);
    expect(questions.map((q) => q.text)).toEqual(["Высота башни?", "Вес?", "Вопрос 3?"]);
  });
});
