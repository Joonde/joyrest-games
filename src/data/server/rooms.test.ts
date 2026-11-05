import { describe, expect, it } from "vitest";
import { isPermanentError } from "../retry";
import { firebaseRoomsRepository } from "../rooms";
import { ApiError } from "./api";
import { createRoomSender, ROOM_BATCH_MAX, type SenderDeps } from "./rooms";

/** Часы и таймеры понарошку: `advance(ms)` двигает время и запускает созревшие таймеры. */
function fakeDeps(post: SenderDeps["post"]) {
  let now = 1000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const deps: SenderDeps = {
    post,
    now: () => now,
    random: () => 0.5,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (handle) => timers.delete(handle as number),
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  async function advance(ms: number) {
    const end = now + ms;
    await settle();
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await settle();
    }
    now = end;
    await settle();
  }
  return { deps, advance };
}

type Body = { stream: string; seq: number; events: Array<{ t: string; ago: number }> };

describe("быстрый канал: отправитель пачек телефона", () => {
  it("пустая пачка раз в секунду — «я на связи»; первая — со сдвигом до 0,3 с", async () => {
    const sent: Body[] = [];
    const { deps, advance } = fakeDeps(async (_path, body) => {
      sent.push(body as Body);
      return { at: 0, every: 1000, paused: false, dropped: 0, dup: false };
    });
    const sender = createRoomSender("s1", {}, deps);
    await advance(149);
    expect(sent).toHaveLength(0);
    await advance(1);
    expect(sent).toHaveLength(1);
    await advance(2000);
    expect(sent).toHaveLength(3);
    expect(sent.every((b) => b.events.length === 0)).toBe(true);
    expect(new Set(sent.map((b) => b.seq)).size).toBe(3);
    expect(new Set(sent.map((b) => b.stream)).size).toBe(1);
    sender.stop();
    await advance(5000);
    expect(sent).toHaveLength(3);
  });

  it("события копятся до пачки, `ago` — сколько мс назад; «сейчас» — отдельным запросом сразу", async () => {
    const sent: Body[] = [];
    const { deps, advance } = fakeDeps(async (_path, body) => {
      sent.push(body as Body);
      return {};
    });
    const sender = createRoomSender("s1", {}, deps);
    sender.push({ t: "tap", n: 3 });
    await advance(100);
    sender.push({ t: "move", id: "m1" }, { now: true });
    expect(sent.at(-1)?.events).toEqual([{ t: "move", id: "m1", ago: 0 }]);
    await advance(50);
    expect(sent.at(-1)?.events).toEqual([{ t: "tap", n: 3, ago: 150 }]);
    sender.stop();
  });

  it("пачка с событиями повторяется с тем же номером, пока не дойдёт; пустая — нет", async () => {
    const sent: Body[] = [];
    let failing = true;
    const { deps, advance } = fakeDeps(async (_path, body) => {
      sent.push(JSON.parse(JSON.stringify(body)) as Body);
      if (failing) throw new ApiError("unavailable", 0);
      return {};
    });
    const sender = createRoomSender("s1", {}, deps);
    await advance(150); // пустая — упала, не повторяется
    sender.push({ t: "tap", n: 1 });
    sender.flush();
    const seq = sent.at(-1)?.seq;
    await advance(500);
    expect(sent.at(-1)).toMatchObject({ seq, events: [{ t: "tap", ago: 500 }] });
    failing = false;
    await advance(1000);
    const withTap = sent.filter((b) => b.events.length > 0);
    expect(withTap.every((b) => b.seq === seq)).toBe(true);
    const count = withTap.length;
    await advance(10_000);
    expect(sent.filter((b) => b.events.length > 0)).toHaveLength(count);
    sender.stop();
  });

  it("настоящая ошибка (не игрок, игра завершена) — отправка останавливается; 429 — повтор", async () => {
    const errors: Error[] = [];
    let status: "limit" | "finished" = "limit";
    const sent: Body[] = [];
    const { deps, advance } = fakeDeps(async (_path, body) => {
      sent.push(body as Body);
      throw status === "limit" ? new ApiError("resource-exhausted", 429) : new ApiError("failed-precondition", 409, "finished");
    });
    createRoomSender("s1", { onError: (e) => errors.push(e) }, deps).push({ t: "tap" });
    await advance(150);
    await advance(600);
    expect(errors).toEqual([]);
    expect(sent.filter((b) => b.events.length > 0).length).toBeGreaterThanOrEqual(2);
    status = "finished";
    await advance(3000);
    expect(errors).toHaveLength(1);
    const before = sent.length;
    await advance(5000);
    expect(sent.length).toBe(before);
  });

  it("сервер задаёт интервал пачек (`every`); больше 64 событий — пачка уходит сразу", async () => {
    const sent: Body[] = [];
    const { deps, advance } = fakeDeps(async (_path, body) => {
      sent.push(body as Body);
      return { every: 2000 };
    });
    const sender = createRoomSender("s1", {}, deps);
    await advance(150);
    expect(sent).toHaveLength(1);
    // Следующая пачка уже назначена по-старому, дальше — раз в 2 с.
    await advance(1000);
    expect(sent).toHaveLength(2);
    await advance(1000);
    expect(sent).toHaveLength(2);
    await advance(1000);
    expect(sent).toHaveLength(3);
    for (let i = 0; i < ROOM_BATCH_MAX; i++) sender.push({ t: "tap" });
    expect(sent.at(-1)?.events).toHaveLength(ROOM_BATCH_MAX);
    sender.stop();
  });

  it("Firebase-версия комнат не умеет: всё — настоящая ошибка unimplemented, без повторов", async () => {
    const errors: Error[] = [];
    const sender = firebaseRoomsRepository.sender("s1", { onError: (e) => errors.push(e) });
    sender.push({ t: "tap" });
    await Promise.resolve();
    expect(errors).toHaveLength(1);
    expect(isPermanentError(errors[0])).toBe(true);
    expect(isPermanentError(await firebaseRoomsRepository.command("s1", "pause").catch((e: unknown) => e))).toBe(true);
    const got: Error[] = [];
    firebaseRoomsRepository.subscribe("s1", "screen", () => undefined, (e) => got.push(e));
    await Promise.resolve();
    expect(got).toHaveLength(1);
    // Отписались раньше — ошибки нет.
    const late: Error[] = [];
    firebaseRoomsRepository.subscribe("s1", "me", () => undefined, (e) => late.push(e))();
    await Promise.resolve();
    expect(late).toEqual([]);
  });
});
