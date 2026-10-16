import { describe, expect, it } from "vitest";
import { quiz } from "./index";
import { DEMO_MELODY, DEMO_QUIZ } from "./demo";
import { parseContent } from "./content";

// Нарисованный фон экрана зала: «Угадай мелодию» — микрофон и клавиши, остальные квизы — стол с кубком.
describe("фон квиза", () => {
  it("шаблон «Угадай мелодию» без треков — melody", () => {
    expect(quiz.art?.(parseContent(DEMO_MELODY.content))).toBe("melody");
  });
  it("обычный квиз — quiz-office", () => {
    expect(quiz.art?.(parseContent(DEMO_QUIZ.content))).toBe("quiz-office");
  });
});
