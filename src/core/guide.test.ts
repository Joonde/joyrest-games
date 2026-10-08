import { describe, expect, it } from "vitest";
import { mechanics } from "../mechanics/registry";
import { GAME_GUIDES, guideFor } from "./guide";

describe("инструкция «Как проводить игры»", () => {
  it("у каждой игры из реестра есть раздел — новая механика без инструкции не пройдёт", () => {
    for (const m of mechanics) expect(guideFor(m.id), m.id).toBeDefined();
    expect(new Set(GAME_GUIDES.map((g) => g.mechanic)).size).toBe(GAME_GUIDES.length);
  });

  it("схема: шаги пульта и телефонов парами, повтор ведёт на существующий шаг", () => {
    for (const g of GAME_GUIDES) {
      expect(g.flow.host.length, g.mechanic).toBe(g.flow.phones.length);
      expect(g.flow.loop.to, g.mechanic).toBeGreaterThanOrEqual(1);
      expect(g.flow.loop.to, g.mechanic).toBeLessThanOrEqual(g.flow.host.length);
      expect(g.host.length, g.mechanic).toBeGreaterThan(2);
      expect(g.players.length, g.mechanic).toBeGreaterThan(0);
      for (const t of g.tables ?? []) for (const r of t.rows) expect(r.length, `${g.mechanic}: ${t.title}`).toBe(t.head.length);
    }
  });
});
