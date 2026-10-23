import { describe, expect, it } from "vitest";
import { quiz } from "./index";
import { DEMO_MELODY, DEMO_QUIZ } from "./demo";
import { DEFAULT_SETTINGS, parseContent, parseSettings, QUIZ_ARTS } from "./content";

// Нарисованный фон экрана зала (решение владельца 23 октября 2026): по умолчанию «Узнай по нотам» — рояль,
// остальные квизы — стол с кубком; в «Настройках показа» ведущий выбирает любую картину квизов.
describe("фон квиза", () => {
  it("шаблон «Узнай по нотам» без треков — melody-notes", () => {
    expect(quiz.art?.(parseContent(DEMO_MELODY.content))).toBe("melody-notes");
  });
  it("обычный квиз — quiz-office", () => {
    expect(quiz.art?.(parseContent(DEMO_QUIZ.content))).toBe("quiz-office");
  });
  it("выбранный фон — его картина, «Сам по игре» — как по умолчанию", () => {
    for (const a of QUIZ_ARTS) {
      const content = parseContent({ ...DEMO_QUIZ.content, settings: { ...DEFAULT_SETTINGS, art: a.id } });
      expect(quiz.art?.(content)).toBe(a.id === "auto" ? "quiz-office" : a.id);
    }
  });
  it("мусор и старые игры — без поля, фон по игре", () => {
    expect(parseSettings({ art: "../../etc/passwd" }).art).toBeUndefined();
    expect(parseSettings({ art: 5 }).art).toBeUndefined();
    expect(parseSettings({}).art).toBeUndefined();
    expect(parseSettings({ art: "quiz-games" }).art).toBe("quiz-games");
  });
});
