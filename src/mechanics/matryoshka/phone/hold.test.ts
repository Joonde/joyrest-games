/**
 * Удержание зоны «Замри!» (решение владельца 14 ноября 2026): любой сбой — «отпустил», второй палец и ладонь не в счёт, после
 * сбоя бежать — только новым касанием. Те же последовательности стенд проигрывает настоящими событиями указателя в браузере.
 */
import { describe, expect, it } from "vitest";
import { holding, newHold, runHold, type HoldGlitch, type HoldInput } from "./hold";

const on = newHold(true);

describe("«Замри!»: удержание зоны", () => {
  it("коснулся — «держу», поднял — «отпустил»", () => {
    const r = runHold(on, [
      { type: "down", id: 1 },
      { type: "up", id: 1 },
    ]);
    expect(r.sent).toEqual([true, false]);
    expect(holding(r.state)).toBe(false);
  });

  it("любой сбой во время бега — «отпустил», а не поимка; лежащий палец «сгорел» — бежать только новым касанием", () => {
    const glitches: HoldGlitch[] = ["scroll", "hidden", "blur", "sleep", "offline", "pause", "disabled", "unmount", "cancel", "leave"];
    for (const reason of glitches) {
      const r = runHold(on, [{ type: "down", id: 7 }, { type: "glitch", reason }, { type: "down", id: 7 }]);
      expect(r.sent, reason).toEqual([true, false]);
      expect(holding(r.state), reason).toBe(false);
      // Палец поднят и поставлен заново — снова бежит.
      const again = runHold(r.state, [{ type: "up", id: 7 }, { type: "down", id: 8 }]);
      expect(again.sent, reason).toEqual([true]);
    }
  });

  it("pointercancel и палец съехал с зоны — «отпустил»", () => {
    for (const type of ["cancel", "leave"] as const) {
      const r = runHold(on, [{ type: "down", id: 3 }, { type, id: 3 }]);
      expect(r.sent, type).toEqual([true, false]);
    }
  });

  it("второй палец и ладонь не в счёт: держит первый; поднял первый — «стою», ладонь на зоне не держит", () => {
    const steps: HoldInput[] = [
      { type: "down", id: 1 },
      { type: "down", id: 2 },
      { type: "up", id: 2 },
      { type: "down", id: 3 },
      { type: "up", id: 1 },
      { type: "down", id: 3 },
    ];
    const r = runHold(on, steps);
    expect(r.sent).toEqual([true, false]);
    expect(holding(r.state)).toBe(false);
    // Ладонь подняли — следующее чистое касание бежит.
    const after = runHold(r.state, [{ type: "up", id: 3 }, { type: "down", id: 4 }]);
    expect(after.sent).toEqual([true]);
  });

  it("выключенная зона (до бега, финиш, пауза, нет связи) касания не принимает; включили — палец, лежавший с выключения, не бежит", () => {
    const off = newHold(false);
    const r = runHold(off, [{ type: "down", id: 1 }, { type: "enable", on: true }, { type: "down", id: 1 }]);
    expect(r.sent).toEqual([]);
    const fresh = runHold(r.state, [{ type: "up", id: 1 }, { type: "down", id: 2 }]);
    expect(fresh.sent).toEqual([true]);
  });

  it("выключение зоны посреди бега — «отпустил» один раз; повторные сбои ничего не шлют", () => {
    const r = runHold(on, [
      { type: "down", id: 1 },
      { type: "enable", on: false },
      { type: "glitch", reason: "hidden" },
      { type: "glitch", reason: "offline" },
      { type: "up", id: 1 },
    ]);
    expect(r.sent).toEqual([true, false]);
  });

  it("случайная последовательность: «держу» и «отпустил» чередуются, сбой всегда кончается «отпустил»", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const kinds = ["down", "up", "cancel", "leave", "glitch", "enable"] as const;
    for (let round = 0; round < 200; round += 1) {
      const steps: HoldInput[] = [];
      for (let i = 0; i < 30; i += 1) {
        const k = kinds[Math.floor(rand() * kinds.length)] ?? "down";
        const id = 1 + Math.floor(rand() * 3);
        if (k === "glitch") steps.push({ type: "glitch", reason: "scroll" });
        else if (k === "enable") steps.push({ type: "enable", on: rand() < 0.7 });
        else steps.push({ type: k, id });
      }
      steps.push({ type: "glitch", reason: "hidden" });
      const r = runHold(on, steps);
      for (let i = 0; i < r.sent.length; i += 1) expect(r.sent[i]).toBe(i % 2 === 0);
      expect(holding(r.state)).toBe(false);
    }
  });
});
