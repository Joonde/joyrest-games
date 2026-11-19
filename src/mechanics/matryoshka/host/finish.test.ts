import { describe, expect, it } from "vitest";
import { World } from "../rules/world.test-kit";
import { prepareMatryoshkaFinish } from "./finish";

function setup(phase: "podium" | "finished" = "podium") {
  const w = new World(6);
  let view = { ...w.host(), phase };
  const flags: boolean[] = [];
  return {
    flags,
    view: () => view,
    finish() { view = { ...view, phase: "finished" }; },
    setFinishing(value: boolean) { flags.push(value); },
  };
}

describe("завершение Матрёшки: повтор после сбоя", () => {
  it("ждёт комнату, пишет итоги и всегда отпускает кнопку", async () => {
    const s = setup();
    let synced = 0;
    await prepareMatryoshkaFinish({
      before: s.view(), current: s.view,
      command: async () => { s.finish(); },
      waitForFinished: async () => { s.finish(); },
      sync: async () => { synced += 1; }, setFinishing: s.setFinishing,
    });
    expect(synced).toBe(1);
    expect(s.flags).toEqual([true, false]);
  });

  it("при сбое команды не ждёт таймер и разрешает повтор", async () => {
    const s = setup();
    let waiting = 0;
    await expect(prepareMatryoshkaFinish({
      before: s.view(), current: s.view,
      command: async () => { throw new Error("network"); },
      waitForFinished: async () => { waiting += 1; },
      sync: async () => undefined, setFinishing: s.setFinishing,
    })).rejects.toThrow("network");
    expect(waiting).toBe(0);
    expect(s.flags).toEqual([true, false]);
  });

  it("если комната уже finished, повтор не шлёт finish и отпускает кнопку даже при сбое записи", async () => {
    const s = setup("finished");
    let commands = 0;
    await expect(prepareMatryoshkaFinish({
      before: s.view(), current: s.view,
      command: async () => { commands += 1; },
      waitForFinished: async () => undefined,
      sync: async () => { throw new Error("write failed"); }, setFinishing: s.setFinishing,
    })).rejects.toThrow("write failed");
    expect(commands).toBe(0);
    expect(s.flags).toEqual([true, false]);
    await expect(prepareMatryoshkaFinish({
      before: s.view(), current: s.view,
      command: async () => { commands += 1; },
      waitForFinished: async () => undefined,
      sync: async () => undefined, setFinishing: s.setFinishing,
    })).resolves.toBeUndefined();
    expect(commands).toBe(0);
    expect(s.flags).toEqual([true, false, true, false]);
  });
});
