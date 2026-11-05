import { afterEach, describe, expect, it, vi } from "vitest";
import { isPermanentError } from "../retry";
import { firebaseRoomsRepository } from "../rooms";
import type { RoomStreamEvent } from "../types";
import { ApiError } from "./api";
import { createRoomSender, ROOM_BATCH_BYTES, ROOM_BATCH_MAX, ROOM_FORBIDDEN_BEATS, ROOM_RETRY_MAX, serverRoomsRepository, splitBatches, subscribeRoom, type SenderDeps, type SubscribeDeps } from "./rooms";
import type { StreamOptions } from "./stream";

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
  return { deps, advance, pending: () => timers.size };
}

type Body = { stream: string; seq?: number; retry?: boolean; events: Array<{ t: string; ago: number; [k: string]: unknown }> };

describe("быстрый канал: отправитель пачек телефона", () => {
  it("пустая пачка раз в секунду — «я на связи», без номера; первая — со сдвигом до 0,3 с", async () => {
    const sent: Body[] = [];
    const { deps, advance } = fakeDeps(async (_path, body) => {
      sent.push(body as Body);
      return { at: 0, every: 1000, paused: false, dropped: 0, dup: false, stale: false };
    });
    const sender = createRoomSender("s1", {}, deps);
    await advance(149);
    expect(sent).toHaveLength(0);
    await advance(1);
    expect(sent).toHaveLength(1);
    await advance(2000);
    expect(sent).toHaveLength(3);
    expect(sent.every((b) => b.events.length === 0 && b.seq === undefined)).toBe(true);
    expect(new Set(sent.map((b) => b.stream)).size).toBe(1);
    sender.stop();
    await advance(5000);
    expect(sent).toHaveLength(3);
  });

  it("события копятся до пачки, `ago` — сколько мс назад; «сейчас» — отдельным запросом сразу; номера — только у пачек с событиями", async () => {
    const sent: Body[] = [];
    const { deps, advance } = fakeDeps(async (_path, body) => {
      sent.push(body as Body);
      return {};
    });
    const sender = createRoomSender("s1", {}, deps);
    sender.push({ t: "tap", n: 3 });
    await advance(100);
    sender.push({ t: "move", id: "m1" }, { now: true });
    expect(sent.at(-1)).toMatchObject({ seq: 1, events: [{ t: "move", id: "m1", ago: 0 }] });
    await advance(50);
    expect(sent.at(-1)).toMatchObject({ seq: 2, events: [{ t: "tap", n: 3, ago: 150 }] });
    await advance(1000);
    expect(sent.at(-1)?.seq).toBeUndefined();
    sender.push({ t: "tap", n: 1 });
    sender.flush();
    expect(sent.at(-1)?.seq).toBe(3);
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

  it("настоящая ошибка (игра завершена) — отправка останавливается; 429 — повтор", async () => {
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

  it("«не игрок» (вход ещё не дошёл) — два повтора той же пачки, потом остановка; удался — счётчик с нуля", async () => {
    const errors: Error[] = [];
    // Сначала «не игрок» только у пачек с событиями (дважды), потом — у всего (участника убрали).
    let forbiddenEvents = 2;
    let forbiddenAll = false;
    const sent: Body[] = [];
    const { deps, advance } = fakeDeps(async (_path, body) => {
      const b = JSON.parse(JSON.stringify(body)) as Body;
      sent.push(b);
      if (forbiddenAll || (b.events.length > 0 && forbiddenEvents > 0)) {
        if (!forbiddenAll) forbiddenEvents -= 1;
        throw new ApiError("permission-denied", 403);
      }
      return {};
    });
    const sender = createRoomSender("s1", { onError: (e) => errors.push(e) }, deps);
    sender.push({ t: "tap", n: 1 }, { now: true });
    await advance(4000);
    expect(errors).toEqual([]);
    expect(sent.filter((b) => b.seq === 1)).toHaveLength(3);
    // Теперь «не игрок» насовсем: два повтора — и стоп.
    forbiddenAll = true;
    await advance(10_000);
    expect(errors).toHaveLength(1);
    expect(isPermanentError(errors[0])).toBe(true);
    const after = sent.length;
    await advance(10_000);
    expect(sent.length).toBe(after);
  });

  it("повтор пачки помечен `retry` (первая попытка — без пометки); `stale` в ответе — без повтора", async () => {
    const sent: Body[] = [];
    let fails = 1;
    const replies: unknown[] = [];
    const { deps, advance } = fakeDeps(async (_path, body) => {
      sent.push(JSON.parse(JSON.stringify(body)) as Body);
      if ((body as Body).events.length > 0 && fails-- > 0) throw new ApiError("unavailable", 0);
      return (body as Body).events.length > 0 ? { stale: true } : {};
    });
    const sender = createRoomSender("s1", { onReply: (r) => replies.push(r) }, deps);
    sender.push({ t: "tap" }, { now: true });
    await advance(600);
    const taps = sent.filter((b) => b.events.length > 0);
    expect(taps.map((b) => b.retry)).toEqual([undefined, true]);
    expect(replies.some((r) => (r as { stale?: boolean }).stale === true)).toBe(true);
    await advance(10_000);
    expect(sent.filter((b) => b.events.length > 0)).toHaveLength(2);
    sender.stop();
  });

  it("«не игрок» у «я на связи» не тратит повторы пачек с событиями; 5 раз подряд у пустых — остановка", async () => {
    const errors: Error[] = [];
    let beatsForbidden = true;
    let tapForbidden = 2;
    const sent: Body[] = [];
    const { deps, advance } = fakeDeps(async (_path, body) => {
      const b = JSON.parse(JSON.stringify(body)) as Body;
      sent.push(b);
      if (b.events.length === 0 && beatsForbidden) throw new ApiError("permission-denied", 403);
      if (b.events.length > 0 && tapForbidden-- > 0) throw new ApiError("permission-denied", 403);
      return {};
    });
    const sender = createRoomSender("s1", { onError: (e) => errors.push(e) }, deps);
    // Три «я на связи» с отказом (вход ещё не дошёл), потом пачка с событиями — у неё свои два повтора.
    await advance(150 + 2000);
    beatsForbidden = false;
    sender.push({ t: "tap" }, { now: true });
    await advance(4000);
    expect(errors).toEqual([]);
    expect(sent.filter((b) => b.events.length > 0)).toHaveLength(3);
    // Участника убрали: пустые пачки получают 403 подряд — остановка.
    beatsForbidden = true;
    await advance((ROOM_FORBIDDEN_BEATS + 1) * 1000);
    expect(errors).toHaveLength(1);
    sender.stop();
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

  it("большие события делятся на пачки до 3,5 КБ; 413 — эту пачку не повторяем, отправка идёт дальше", async () => {
    const big = { t: "draw", data: "x".repeat(1500) };
    const items = [big, big, big, big, big].map((event) => ({ event, at: 0 }));
    const batches = splitBatches(items);
    expect(batches.length).toBe(3);
    for (const b of batches) expect(new TextEncoder().encode(JSON.stringify(b.map((i) => i.event))).length).toBeLessThan(ROOM_BATCH_BYTES + 200);

    const sent: Body[] = [];
    const errors: Error[] = [];
    const { deps, advance } = fakeDeps(async (_path, body) => {
      sent.push(body as Body);
      if ((body as Body).events.some((e) => e.t === "huge")) throw new ApiError("Payload Too Large", 413);
      return {};
    });
    const sender = createRoomSender("s1", { onError: (e) => errors.push(e) }, deps);
    sender.push({ t: "huge", data: "y".repeat(5000) }, { now: true });
    await advance(10_000);
    expect(sent.filter((b) => b.events.some((e) => e.t === "huge"))).toHaveLength(1);
    expect(errors).toEqual([]);
    sender.push({ t: "tap" }, { now: true });
    expect(sent.at(-1)?.events[0]?.t).toBe("tap");
    sender.stop();
  });

  it("очередь повтора не больше 30: при переполнении уходит самая старая, новые события не теряются", async () => {
    const sent: Body[] = [];
    let online = false;
    const { deps, advance } = fakeDeps(async (_path, body) => {
      sent.push(JSON.parse(JSON.stringify(body)) as Body);
      if (!online) throw new ApiError("unavailable", 0);
      return {};
    });
    const sender = createRoomSender("s1", {}, deps);
    for (let i = 0; i < ROOM_RETRY_MAX + 5; i++) sender.push({ t: "tap", n: i }, { now: true });
    online = true;
    await advance(1000);
    const delivered = new Set(sent.slice(ROOM_RETRY_MAX + 5).filter((b) => b.seq !== undefined).map((b) => b.seq));
    // Пять самых старых ушли, самые новые — дошли.
    expect(delivered.has(1)).toBe(false);
    expect(delivered.has(ROOM_RETRY_MAX + 5)).toBe(true);
    expect(delivered.size).toBe(ROOM_RETRY_MAX);
    sender.stop();
  });
});

describe("быстрый канал: поток и команды на клиенте", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeOpen() {
    let captured: StreamOptions<unknown> | null = null;
    let closed = false;
    const open = ((options: StreamOptions<unknown>) => {
      captured = options;
      return () => {
        closed = true;
      };
    }) as SubscribeDeps["open"];
    return { open, options: () => captured as unknown as StreamOptions<unknown>, closed: () => closed };
  }

  it("снимок и события доходят; «closed: finished» — без остановки (дальше 409 решит), «removed» — остановка", () => {
    const f = fakeOpen();
    const got: RoomStreamEvent[] = [];
    const errors: Error[] = [];
    subscribeRoom("s1", "me", (e) => got.push(e), (e) => errors.push(e), { get: async () => null, open: f.open });
    expect(f.options().url).toBe("/api/stream/room/s1/me");
    f.options().onEvent({ type: "snapshot", at: 1, paused: false, every: 1000, offlineMs: 3000, data: {} });
    f.options().onEvent({ type: "closed", at: 2, reason: "unloaded" });
    f.options().onEvent({ type: "nonsense" });
    expect(got.map((e) => e.type)).toEqual(["snapshot", "closed"]);
    expect(errors).toEqual([]);
    f.options().onEvent({ type: "closed", at: 3, reason: "removed" });
    expect(errors).toHaveLength(1);
    expect(isPermanentError(errors[0])).toBe(true);
    expect(f.closed()).toBe(true);
    f.options().onEvent({ type: "event", at: 4, data: {} });
    expect(got).toHaveLength(3);
  });

  it("«closed: replaced»: личный поток останавливается (новая вкладка), экран и пульт — нет (переподключатся сами)", () => {
    for (const kind of ["me", "screen", "host"] as const) {
      const f = fakeOpen();
      const errors: Error[] = [];
      subscribeRoom("s1", kind, () => undefined, (e) => errors.push(e), { get: async () => null, open: f.open });
      f.options().onEvent({ type: "closed", at: 1, reason: "replaced" });
      expect(errors.length).toBe(kind === "me" ? 1 : 0);
      expect(f.closed()).toBe(kind === "me");
    }
  });

  it("опрос: снимок через GET; «не игрок» дважды и лимит — повторяемо, 409 и третий 403 — окончательно", async () => {
    const f = fakeOpen();
    const got: RoomStreamEvent[] = [];
    let answer: unknown = { type: "screen", at: 5, version: 1, paused: false, players: 0, online: 0, data: {} };
    subscribeRoom("s1", "screen", (e) => got.push(e), () => undefined, {
      get: async (path) => {
        expect(path).toBe("/api/rooms/s1/screen");
        if (answer instanceof Error) throw answer;
        return answer;
      },
      open: f.open,
    });
    await f.options().poll();
    expect(got).toHaveLength(1);
    answer = new ApiError("resource-exhausted", 429);
    const limited = await f.options().poll().catch((e: unknown) => e);
    expect(isPermanentError(limited)).toBe(false);
    answer = new ApiError("permission-denied", 403);
    for (let i = 0; i < 2; i++) expect(isPermanentError(await f.options().poll().catch((e: unknown) => e))).toBe(false);
    expect(isPermanentError(await f.options().poll().catch((e: unknown) => e))).toBe(true);
    answer = new ApiError("failed-precondition", 409, "finished");
    expect(isPermanentError(await f.options().poll().catch((e: unknown) => e))).toBe(true);
  });

  it("команда: повтор после обрыва — с тем же id; этап `expect` уходит на сервер", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        calls += 1;
        if (calls === 1) throw new TypeError("network");
        return new Response(JSON.stringify({ ok: true, result: { x: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    const result = await serverRoomsRepository.command("s1", "next", { a: 1 }, { expect: "r0" });
    expect(result).toEqual({ x: 1 });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.id).toBe(bodies[1]?.id);
    expect(bodies[0]).toMatchObject({ cmd: "next", args: { a: 1 }, expect: "r0" });
  });

  it("команда: игра ушла дальше (409) — ошибка сразу, без повторов", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "failed-precondition", reason: "moved" }), { status: 409, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await serverRoomsRepository.command("s1", "next", null, { expect: "r0" }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "failed-precondition", reason: "moved" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const late: Error[] = [];
    firebaseRoomsRepository.subscribe("s1", "me", () => undefined, (e) => late.push(e))();
    await Promise.resolve();
    expect(late).toEqual([]);
  });
});
