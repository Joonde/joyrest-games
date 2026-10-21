// Предпросмотр игры в студии есть у каждой игры (кроме «Олимпа» со своим видом и «Мероприятия из блоков»):
// все шаблоны библиотеки проходят от начала до итогов в каждом поддержанном режиме и ничего не бросают.
import { describe, expect, it } from "vitest";
import { runPreview } from "./preview";
import { allDemoGames, mechanics } from "./registry";

const WITHOUT = new Set(["olymp", "evening"]);

describe("предпросмотр игры", () => {
  it("есть у всех игр", () => {
    const missing = mechanics.filter((m) => !WITHOUT.has(m.id) && !m.preview).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it("картинки берутся из своей игры: в сценах номер настоящей игры, а не заглушка", () => {
    const mechanic = mechanics.find((m) => m.id === "quiz");
    const demo = allDemoGames.find((d) => d.mechanic === "quiz");
    if (!mechanic?.preview || !demo) throw new Error("нет квиза");
    const { scenes } = runPreview({ mechanic: "quiz", content: mechanic.parse(demo.content), playMode: "teams", themeId: "joyrest", driver: mechanic.preview.driver, teams: 2, limit: 5, gameId: "game-42" });
    expect(scenes.length).toBeGreaterThan(0);
    for (const scene of scenes) expect(scene.session.gameId).toBe("game-42");
  });

  for (const demo of allDemoGames.filter((d) => !WITHOUT.has(d.mechanic))) {
    it(`${demo.title}: от начала до итогов`, () => {
      const mechanic = mechanics.find((m) => m.id === demo.mechanic);
      if (!mechanic?.preview) return;
      const modes = (["solo", "teams"] as const).filter((m) => mechanic.supports[m]);
      for (const playMode of modes) {
        const { driver, teams = 3, limit = 50 } = mechanic.preview;
        const { scenes, phones, participants } = runPreview({ mechanic: mechanic.id, content: mechanic.parse(demo.content), playMode, themeId: "joyrest", driver, teams, limit });
        expect(scenes.length).toBeGreaterThanOrEqual(5);
        expect(scenes.at(-1)?.session.state.phase).toBe("finished");
        expect(phones.length).toBeGreaterThan(0);
        expect(participants.length).toBeGreaterThan(0);
      }
    }, 30000);
  }
});
