import { describe, expect, it } from "vitest";
import { mechanics } from "../mechanics/registry";
import { EDITOR_BASICS, EDITOR_GUIDES } from "./editorGuide";
import { EDITOR_GUIDE_SKIP, editorGuideFor } from "./editorGuideSkip";

describe("инструкция «Как создавать игры»", () => {
  it("у каждой игры (кроме «Олимпа» и раскрасок) есть раздел конструктора — новая механика без него не пройдёт", () => {
    for (const m of mechanics) {
      if (EDITOR_GUIDE_SKIP.includes(m.id)) continue;
      expect(EDITOR_GUIDES.some((g) => g.mechanic === m.id), m.id).toBe(true);
      expect(editorGuideFor(m.id), m.id).toBe(true);
    }
    expect(new Set(EDITOR_GUIDES.map((g) => g.mechanic)).size).toBe(EDITOR_GUIDES.length);
    for (const g of EDITOR_GUIDES) expect(mechanics.some((m) => m.id === g.mechanic), g.mechanic).toBe(true);
  });

  it("в каждом разделе — шаги, все поля, примеры «что будет», проверки и советы", () => {
    for (const g of EDITOR_GUIDES) {
      expect(g.steps.length, g.mechanic).toBeGreaterThanOrEqual(4);
      expect(g.fields.length, g.mechanic).toBeGreaterThanOrEqual(3);
      expect(g.examples.length, g.mechanic).toBeGreaterThanOrEqual(3);
      expect(g.ready.length, g.mechanic).toBeGreaterThan(0);
      expect(g.tips.length, g.mechanic).toBeGreaterThan(0);
      for (const e of g.examples) expect(Boolean(e.setup && e.hall && e.phones), `${g.mechanic}: ${e.title}`).toBe(true);
      // Названия полей уникальны — по ним строится список.
      expect(new Set(g.fields.map((f) => f.name)).size, g.mechanic).toBe(g.fields.length);
    }
    expect(new Set(EDITOR_BASICS.map((b) => b.id)).size).toBe(EDITOR_BASICS.length);
  });

  it("кнопки названы как на карточке игры", () => {
    const text = JSON.stringify([EDITOR_BASICS, EDITOR_GUIDES]);
    expect(text).not.toContain("«Запустить»");
    expect(text).not.toContain("«Открыть»");
    expect(text).toContain("«✍️ Редактировать»");
  });
});
