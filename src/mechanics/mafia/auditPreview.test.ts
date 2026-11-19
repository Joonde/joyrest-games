import { describe, expect, it } from "vitest";
import { runPreview } from "../preview";
import { allDemoGames, getMechanic, mechanics } from "../registry";
import { createMafia } from "./content";

 describe("QA: предпросмотр новых ролей и других игр", () => {
  it("Мафия на 14 игроков доходит до итога и раскрывает все новые роли", () => {
    const mechanic = getMechanic("mafia");
    if (!mechanic?.preview) throw new Error("Нет предпросмотра Мафии");
    const content = createMafia();
    const { scenes } = runPreview({ mechanic: "mafia", content, playMode: "solo", themeId: "joyrest", driver: mechanic.preview.driver, teams: 14, limit: 250, gameId: "mafia-extended" });
    expect(scenes.length).toBeGreaterThan(8);
    expect(scenes.length).toBeLessThan(250);
    expect(scenes.at(-1)?.session.state.phase).toBe("finished");
    const over = [...scenes].reverse().find((scene) => scene.session.state.result && typeof scene.session.state.result === "object" && "reveal" in scene.session.state.result);
    const reveal = (over?.session.state.result as { reveal?: Record<string, string> } | undefined)?.reveal ?? {};
    expect(Object.values(reveal)).toContain("courtesan");
    expect(Object.values(reveal)).toContain("maniac");
    expect(Object.values(reveal)).toContain("advocate");
  });

  it("все демо-игры завершают предпросмотр без превышения лимита и пустых участников", () => {
    for (const demo of allDemoGames.filter((d) => !new Set(["olymp", "evening", "bublikator"]).has(d.mechanic))) {
      const mechanic = getMechanic(demo.mechanic);
      if (!mechanic?.preview) continue;
      for (const playMode of (["solo", "teams"] as const).filter((mode) => mechanic.supports[mode])) {
        const { driver, teams = 3, limit = 50 } = mechanic.preview;
        const result = runPreview({ mechanic: mechanic.id, content: mechanic.parse(demo.content), playMode, themeId: "joyrest", driver, teams, limit });
        expect(result.scenes.at(-1)?.session.state.phase, `${demo.mechanic}/${playMode}`).toBe("finished");
        expect(result.participants.length, `${demo.mechanic}/${playMode}`).toBeGreaterThan(0);
        expect(result.phones.length, `${demo.mechanic}/${playMode}`).toBeGreaterThan(0);
      }
    }
  }, 30000);

  it("каждая механика имеет рабочий способ предпросмотра или осознанное исключение", () => {
    for (const mechanic of mechanics) {
      if (["olymp", "evening"].includes(mechanic.id)) continue;
      expect(mechanic.preview || mechanic.roomPreview, mechanic.id).toBeDefined();
    }
  });
});
