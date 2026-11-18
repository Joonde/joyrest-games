import { describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../../data/types";
import { autopilot, SimRoom } from "./room";

describe("Матрёшка: комната предпросмотра и репетиции", () => {
  it("настоящие правила и боты доходят до пьедестала, сводки идут всем видам", async () => {
    let now = 1_000_000;
    const room = new SimRoom({ content: roomContent(), guests: 12, clock: () => now, seed: "full" });
    const events: RoomStreamEvent[] = [];
    room.hostLink().subscribe((e) => events.push(e), () => undefined, false);
    room.screenLink().subscribe((e) => events.push(e), () => undefined, false);
    room.phoneLink().subscribe((e) => events.push(e), () => undefined, false);
    await Promise.resolve();
    for (let i = 0; i < 7000 && room.s.phase !== "podium"; i += 1) {
      now += 100;
      room.step();
      autopilot(room);
    }
    expect(room.s.phase).toBe("podium");
    expect(room.world.host().standings?.[0]?.place).toBe(1);
    expect(events.some((e) => e.type === "host")).toBe(true);
    expect(events.some((e) => e.type === "screen")).toBe(true);
    expect(events.some((e) => e.type === "snapshot")).toBe(true);
    expect(room.commands.filter((c) => !c.ok && c.error !== "moved")).toEqual([]);
  });

  it("повторяет expect/moved и останавливает отсчёт на паузе", () => {
    let now = 1_000_000;
    const room = new SimRoom({ content: roomContent(), guests: 6, clock: () => now });
    expect(room.command("start").ok).toBe(true);
    const moment = room.world.host().moment;
    expect(room.command("board", undefined, "wrong:0:x:0:0")).toEqual({ ok: false, error: "moved" });
    expect(room.command("board", undefined, moment).ok).toBe(true);
    room.command("pause");
    const endsAt = room.world.host().endsAt;
    now += 5000;
    room.step();
    expect(room.world.host().endsAt).toBe(endsAt);
    expect(room.command("skip-trial")).toEqual({ ok: false, error: "paused" });
    room.command("resume");
    expect(room.world.host().pausedAt).toBeNull();
  });
});

function roomContent() {
  return {
    style: "sunny" as const,
    trials: [
      { kind: "freeze" as const, on: true }, { kind: "ginger" as const, on: true },
      { kind: "chairs" as const, on: true }, { kind: "rope" as const, on: true }, { kind: "hopscotch" as const, on: true },
    ],
    finalists: 4, lives: 2 as const, secondChance: 10 as const, questions: [], tempo: "normal" as const,
    fanBets: true, shapes: ["circle" as const, "star" as const, "tree" as const, "matryoshka" as const],
  };
}
