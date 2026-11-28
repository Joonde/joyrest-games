import { describe, expect, it } from "vitest";
import { parseContent } from "../rules/content";
import { validateMatryoshka } from "./validate";

const base = () => parseContent(undefined);
const question = (q: string) => ({ q, options: ["Да", "Нет"], correct: 0 });

describe("конструктор Матрёшки: проверка", () => {
  it("настройки по умолчанию годятся", () => {
    expect(validateMatryoshka(base())).toEqual([]);
  });

  it("не даёт молча заменить неполный набор своих вопросов встроенными", () => {
    const c = { ...base(), questions: [question("Один"), question("Два")] };
    expect(validateMatryoshka(c).some((e) => e.path === "questions")).toBe(true);
  });

  it("помечает конкретный вопрос без двух вариантов или верного ответа", () => {
    const c = { ...base(), questions: [question("Один"), question("Два"), { q: "Три", options: ["", ""], correct: 4 }] };
    expect(validateMatryoshka(c).some((e) => e.path === "questions/2")).toBe(true);
  });

  it("находит повторы и неверный набор фигур", () => {
    const c = { ...base(), questions: [question("Один"), question("Два"), question(" один ")], shapes: ["circle"] as MatContentShapes };
    const errors = validateMatryoshka(c);
    expect(errors.some((e) => e.message.includes("повторяются"))).toBe(true);
    expect(errors.some((e) => e.path === "shapes")).toBe(true);
  });
});

type MatContentShapes = ReturnType<typeof base>["shapes"];
