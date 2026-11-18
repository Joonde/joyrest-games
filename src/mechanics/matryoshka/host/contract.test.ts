import { describe, expect, it } from "vitest";
import { World } from "../rules/world.test-kit";

describe("пульт Матрёшки: контракт 3d", () => {
  it("получает стиль, табло, публичный таймер и серверный момент паузы без тайн", () => {
    const w = new World(6);
    expect(w.host().style).toBe("sunny");
    expect(w.host().lives).toBe(2);
    expect(w.host().F).toBe(3);
    expect(w.host().can.board).toBe(false);
    expect(w.cmd("start").ok).toBe(true);
    expect(w.host().can.board).toBe(true);
    expect(w.host().endsAt).not.toBeNull();
    const before = w.host().endsAt as number;
    w.pause();
    const paused = w.host();
    expect(paused.pausedAt).not.toBeNull();
    expect(paused.endsAt).toBe(before);
    expect(w.cmd("skip-trial")).toEqual({ ok: false, error: "paused" });
    expect(w.cmd("next")).toEqual({ ok: false, error: "paused" });
    expect(w.cmd("remove", { pid: "p1" })).toEqual({ ok: false, error: "paused" });
    expect(w.cmd("board").ok).toBe(true);
    expect(w.host().board).toBe(true);
    w.now += 1000;
    w.resume(1000);
    expect(w.host().pausedAt).toBeNull();
    expect(w.host().endsAt).toBe(before + 1000);
    expect(JSON.stringify(w.host())).not.toContain('"solid"');
  });

  it("сервер, а не пульт, меняет момент даже у команды без смены этапа", () => {
    const w = new World(6);
    w.cmd("start");
    const before = w.host().moment;
    expect(w.cmd("board").ok).toBe(true);
    expect(w.host().moment).not.toBe(before);
    expect(w.host().board).toBe(true);
  });
});
