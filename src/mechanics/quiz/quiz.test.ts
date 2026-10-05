import { describe, expect, it } from "vitest";
import {
  changeKind,
  duplicateQuestion,
  mediaIds,
  moveItem,
  newQuestion,
  parseContent,
  type QuizQuestion,
} from "./content";
import { IMPORT_EXAMPLE, parseImport } from "./importText";
import { isCorrect, score, steps } from "./logic";
import { matchesAnswer, normalizeAnswer } from "./normalize";
import { errorsFor, validateContent, validateQuestion } from "./validate";

function choice(patch: Partial<QuizQuestion> = {}): QuizQuestion {
  return { ...newQuestion("choice"), text: "Вопрос?", options: ["Да", "Нет"], correct: 0, ...patch };
}

describe("parseContent", () => {
  it("мусор из базы превращается в пустой квиз", () => {
    expect(parseContent(null)).toEqual({ questions: [] });
    expect(parseContent("x")).toEqual({ questions: [] });
    expect(parseContent({ questions: "x" })).toEqual({ questions: [] });
  });

  it("битые поля вопроса заменяются значениями по умолчанию", () => {
    const { questions } = parseContent({
      questions: [{ id: "a", kind: "weird", text: 5, options: ["1", 2], correct: 7, timeLimit: 9999, points: -3 }],
    });
    expect(questions[0]).toMatchObject({
      id: "a",
      kind: "choice",
      text: "",
      options: ["1", ""],
      correct: -1,
      timeLimit: 300,
      points: 1,
      imageId: null,
    });
  });

  it("одинаковые id вопросов становятся разными", () => {
    const { questions } = parseContent({ questions: [{ id: "a" }, { id: "a" }] });
    expect(new Set(questions.map((q) => q.id)).size).toBe(2);
  });

  it("сохранённый квиз читается без изменений", () => {
    const content = { questions: [choice({ imageId: "img1" }), { ...newQuestion("open"), text: "Ответ?", answers: ["ёлка"] }] };
    expect(parseContent(JSON.parse(JSON.stringify(content)))).toEqual(content);
  });
});

describe("mediaIds", () => {
  it("картинки без повторов", () => {
    const q = choice({ imageId: "m1" });
    expect(mediaIds({ questions: [q, duplicateQuestion(q), choice()] })).toEqual(["m1"]);
  });
});

describe("правка вопросов", () => {
  it("дубль — новый id и те же поля", () => {
    const q = choice();
    const copy = duplicateQuestion(q);
    expect(copy.id).not.toBe(q.id);
    expect({ ...copy, id: q.id }).toEqual(q);
  });

  it("порядок меняется перемещением", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("смена типа сохраняет верный вариант как открытый ответ", () => {
    const open = changeKind(choice({ correct: 1 }), "open");
    expect(open.kind).toBe("open");
    expect(open.answers).toEqual(["Нет"]);
    expect(open.timeLimit).toBe(45);
  });

  it("смена типа не трогает время и очки, которые ведущий поменял сам", () => {
    const speed = changeKind(choice({ timeLimit: 20, points: 100 }), "speed");
    expect(speed.timeLimit).toBe(20);
    expect(speed.points).toBe(200);
  });
});

describe("normalizeAnswer", () => {
  it("регистр, ё/е, пробелы и пунктуация не важны", () => {
    expect(normalizeAnswer(" Ёлка! ")).toBe("елка");
    expect(normalizeAnswer("Санкт-Петербург")).toBe(normalizeAnswer("санкт петербург"));
    expect(matchesAnswer("ЕЛКА", ["ёлка"])).toBe(true);
    expect(matchesAnswer("елки", ["ёлка"])).toBe(false);
    expect(matchesAnswer("!!!", ["!!!"])).toBe(false);
  });
});

describe("validate", () => {
  it("пустая игра не запускается", () => {
    expect(validateContent({ questions: [] })).toEqual([{ path: "questions", message: "Добавьте хотя бы один вопрос." }]);
  });

  it("готовый вопрос без ошибок", () => {
    expect(validateQuestion(choice())).toEqual([]);
    expect(validateQuestion({ ...newQuestion("open"), text: "Как?", answers: ["так"] })).toEqual([]);
  });

  it("подсказки привязаны к полю вопроса", () => {
    const q = choice({ text: " ", options: ["Да", ""], correct: -1, timeLimit: 2 });
    const errors = validateQuestion(q);
    expect(errorsFor(errors, q.id, "text")).toHaveLength(1);
    expect(errorsFor(errors, q.id, "options")[0]?.message).toMatch(/Заполните/);
    expect(errorsFor(errors, q.id, "correct")).toHaveLength(1);
    expect(errorsFor(errors, q.id, "timeLimit")).toHaveLength(1);
    expect(errorsFor(errors, q.id)).toHaveLength(4);
  });

  it("варианты: от 2 до 6 и без совпадений", () => {
    expect(validateQuestion(choice({ options: ["Да"] })).map((e) => e.message)).toContain("Нужно хотя бы 2 варианта ответа.");
    expect(validateQuestion(choice({ options: ["Да", " да!"] }))[0]?.message).toMatch(/совпадают/);
    expect(validateQuestion(choice({ options: ["1", "2", "3", "4", "5", "6", "7"] }))[0]?.message).toMatch(/Не больше 6/);
  });

  it("открытый вопрос без верного ответа", () => {
    const q = { ...newQuestion("open"), text: "Как?", answers: [" ", "?"] };
    expect(validateQuestion(q).map((e) => e.message)).toEqual(["Добавьте хотя бы один верный ответ."]);
  });
});

describe("parseImport", () => {
  it("пример из интерфейса распознаётся без замечаний", () => {
    const { questions, skipped } = parseImport(IMPORT_EXAMPLE);
    expect(skipped).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0]?.question).toMatchObject({
      kind: "choice",
      text: "Какой город называют Северной столицей?",
      options: ["Москва", "Санкт-Петербург", "Казань"],
      correct: 1,
    });
    expect(questions[1]?.question).toMatchObject({ kind: "open", answers: ["30", "тридцать"] });
    expect(questions.flatMap((q) => q.problems)).toEqual([]);
  });

  it("верный вариант можно пометить по-разному, нумерация вопросов убирается", () => {
    const { questions } = parseImport("1. Раз?\n-* а\n- б\n2) Два?\n- а\n- б *");
    expect(questions.map((q) => [q.question.text, q.question.correct])).toEqual([
      ["Раз?", 0],
      ["Два?", 1],
    ]);
  });

  it("замечания: нет верного, нет вариантов, лишние варианты", () => {
    const { questions } = parseImport("Без верного?\n- а\n- б\nБез вариантов?\nМного?\n* 1\n- 2\n- 3\n- 4\n- 5\n- 6\n- 7");
    expect(questions[0]?.problems).toEqual(["Отметьте правильный вариант."]);
    expect(questions[1]?.problems).toEqual(["Нет ни вариантов («-»), ни ответа («=»)."]);
    expect(questions[2]?.question.options).toHaveLength(6);
    expect(questions[2]?.problems[0]).toMatch(/Больше 6/);
  });

  it("строки до первого вопроса пропускаются с номером", () => {
    expect(parseImport("- а\n\nВопрос?\n= да").skipped).toEqual([1]);
  });
});

describe("steps и score", () => {
  const open = { ...newQuestion("open"), text: "Что зелёное?", answers: ["ёлка", "трава"], points: 50 };
  const content = { questions: [choice({ points: 100 }), open] };

  it("один шаг на вопрос", () => {
    expect(steps(content).map((s) => [s.id, s.answerable])).toEqual([
      [content.questions[0]?.id, true],
      [open.id, true],
    ]);
  });

  it("очки только за верные ответы", () => {
    const [first, second] = steps(content);
    if (!first || !second) throw new Error("нет шагов");
    const answer = (pid: string, value: unknown) => ({ id: pid, step: 0, pid, uid: pid, value, submittedAt: 1 });
    expect(score(first, [answer("a", 0), answer("b", 1), answer("c", "0")])).toEqual([{ pid: "a", delta: 100 }]);
    expect(score(second, [answer("a", "Елка!"), answer("b", "ель")])).toEqual([{ pid: "a", delta: 50 }]);
    expect(isCorrect(open, 3)).toBe(false);
  });
});
