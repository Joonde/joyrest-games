import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../src/data/types";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { Hub } from "./live";
import { migrate } from "./migrate";
import {
  HOST_STREAMS_PER_ROOM,
  MEMBER_RECHECK_MS,
  openRoomStream,
  ROOM_BACKLOG_BYTES,
  ROOMS_BACKLOG_BYTES,
  RoomManager,
  roomKey,
  SCREENS_PER_IP,
  SCREENS_PER_ROOM,
  STREAMS_PER_DEVICE,
  type StreamPool,
} from "./room";
import { roomCheck, TAPS_BURST, TAPS_PER_SECOND, type CheckState } from "./rooms/check";
import {
  FRESH_AGO_SLACK_MS,
  MAX_AGO_MS,
  parseInput,
  parseSnapshotData,
  REQUESTS_BURST,
  Room,
  seededRandom,
  SeqWindow,
  STREAMS_PER_PLAYER,
  timedEvent,
  type RoomEvent,
  type RoomGame,
  type RoomListener,
} from "./rooms/engine";
import { roomCheckEnabled, roomGames } from "./rooms/registry";

const game = roomCheck as RoomGame<unknown>;

function newRoom(now: number, players = [{ pid: "a", name: "Аня", team: null }, { pid: "b", name: "Боря", team: null }], g: RoomGame<unknown> = game, onError?: (where: string, e: unknown) => void) {
  return new Room({ id: "s1", key: g.id, hostId: "h", game: g, players, teams: [], snapshot: null, playMode: "solo", now, onError });
}

function batch(seq: number | null, events: object[] = [], stream = "p1", retry = false) {
  const parsed = parseInput(seq === null ? { stream, events } : retry ? { stream, seq, retry, events } : { stream, seq, events });
  if (!parsed) throw new Error("пачка не разобралась");
  return parsed;
}

function collector() {
  const got: RoomStreamEvent[] = [];
  let ended = 0;
  const listener: RoomListener = { send: (e) => got.push(e), end: () => (ended += 1) };
  return { got, listener, ended: () => ended };
}

const total = (room: Room) => (room.state as CheckState).total;

/** Игра с назначенным моментом (дедлайн шага): пауза сдвигает его. */
interface DeadlineState {
  deadline: number;
  hits: number;
}
const deadlineGame: RoomGame<DeadlineState> = {
  id: "deadline",
  offlineMs: 3000,
  eventsPerSecond: 10,
  batchMs: () => 1000,
  create: ({ now }) => ({ deadline: now + 30_000, hits: 0 }),
  onInput(state, _player, events: RoomEvent[], ctx) {
    for (const e of events) {
      if (e.t === "boom") throw new Error("сбой игры");
      if (e.at <= state.deadline) state.hits += 1;
    }
    ctx.changed();
  },
  onCommand: () => ({ ok: true }),
  onResume(state, pausedMs) {
    state.deadline += pausedMs;
  },
  screen: (state) => ({ deadline: state.deadline }),
  personal: () => null,
  host: (state) => state,
  snapshot: (state) => state,
  restore: (data) => (typeof data === "object" && data !== null ? (data as DeadlineState) : null),
};

describe("быстрый канал: комната без базы", () => {
  it("пачка: проверка формы; у пустой номер не нужен, у пачки с событиями — обязателен", () => {
    expect(parseInput({ events: [] })).toEqual({ stream: "", retry: false, seq: null, events: [] });
    expect(parseInput({ seq: 1, events: [] })).toEqual({ stream: "", retry: false, seq: 1, events: [] });
    expect(parseInput({ seq: 1, retry: true, events: [] })).toMatchObject({ retry: true });
    expect(parseInput({ seq: 1, retry: "да", events: [] })).toBeNull();
    expect(parseInput({ events: [{ t: "tap" }] })).toBeNull();
    expect(parseInput({ seq: -1, events: [] })).toBeNull();
    expect(parseInput({ seq: 1.5, events: [] })).toBeNull();
    expect(parseInput({ seq: 1, events: [{ t: "Tap" }] })).toBeNull();
    expect(parseInput({ seq: 1, events: [{ t: "tap", ago: -5 }] })).toBeNull();
    expect(parseInput({ seq: 1, stream: "../x", events: [] })).toBeNull();
    expect(parseInput({ seq: 1, events: Array.from({ length: 65 }, () => ({ t: "tap" })) })).toBeNull();
  });

  it("время события — по часам сервера; старше допустимого — не раньше now − предел и с пометкой late", () => {
    expect(timedEvent({ t: "hold", ago: 300 }, 10_000)).toEqual({ t: "hold", at: 9700, late: false, delayed: false });
    expect(timedEvent({ t: "hold", ago: 9000, at: 1, late: false }, 10_000)).toEqual({ t: "hold", at: 10_000 - MAX_AGO_MS, late: true, delayed: false });
    expect(timedEvent({ t: "hold", ago: 3000, delayed: false }, 10_000, 1500, true)).toEqual({ t: "hold", at: 8500, late: true, delayed: true });
  });

  /** Комната-шпион: что игра получила. */
  function spyRoom(now: number, players?: Parameters<typeof newRoom>[1], g: RoomGame<unknown> = game) {
    const seen: RoomEvent[] = [];
    const spy: RoomGame<unknown> = { ...g, onInput: (s, p, events, ctx) => (seen.push(...events), g.onInput(s, p, events, ctx)) };
    return { room: newRoom(now, players, spy), seen };
  }

  it("первая пачка потока: `ago` не дальше интервала пачки + 0,5 с (подделка «нажал первым»)", () => {
    const { room, seen } = spyRoom(10_000);
    room.input("a", batch(5, [{ t: "tap", ago: 3000 }]), 10_000);
    expect(seen.at(-1)).toMatchObject({ at: 10_000 - (1000 + FRESH_AGO_SLACK_MS), late: true, delayed: false });
  });

  it("подделка номерами: 1000, потом 999 и 998 с `ago` 4000 — времени раньше интервала не даёт", () => {
    const { room, seen } = spyRoom(0);
    room.input("a", batch(1000, [{ t: "tap", ago: 4000 }]), 10_000);
    room.input("a", batch(999, [{ t: "tap", ago: 4000 }]), 10_010);
    room.input("a", batch(998, [{ t: "tap", ago: 4000 }]), 10_020);
    expect(seen.map((e) => e.at)).toEqual([10_000 - 1500, 10_010 - 1500, 10_020 - 1500]);
    expect(seen.every((e) => e.late)).toBe(true);
    // Пачка не по порядку позже интервала после самой свежей и без меньшей принятой — тоже предел свежей, и `delayed`.
    room.input("a", batch(997, [{ t: "tap", ago: 4000 }]), 15_000);
    expect(seen.at(-1)).toMatchObject({ at: 15_000 - 1500, late: true, delayed: true });
  });

  it("честный обгон: «сейчас» и обычная пачка пришли в другом порядке — как свежая, без `delayed`", () => {
    const { room, seen } = spyRoom(0);
    room.input("a", batch(1, [{ t: "tap" }]), 0);
    room.input("a", batch(3, [{ t: "move", id: "m" }]), 1000);
    room.input("a", batch(2, [{ t: "tap", ago: 1200 }]), 1050);
    expect(seen.at(-1)).toMatchObject({ at: 1050 - 1200, late: false, delayed: false });
    // Та же пачка с пометкой повтора — `delayed` (её мог задержать и сам телефон).
    room.input("a", batch(4, [{ t: "move", id: "n" }]), 2000);
    room.input("a", batch(2, [{ t: "tap" }], "p2"), 2000);
    room.input("a", batch(5, [{ t: "tap", ago: 100 }], "p1", true), 2050);
    expect(seen.at(-1)).toMatchObject({ delayed: true });
  });

  it("пачка в свой черёд: `ago` до интервала с прошлого запроса (и «я на связи»); честный повтор потерянной пачки через 8 с — до 4 с, `delayed`", () => {
    const { room, seen } = spyRoom(0);
    room.input("a", batch(1, [{ t: "tap" }]), 0);
    room.input("a", batch(null), 1000);
    room.input("a", batch(2, [{ t: "tap", ago: 1200 }]), 2000);
    expect(seen.at(-1)).toMatchObject({ at: 800, late: false, delayed: false });
    // Пачка 3 потерялась; «я на связи» идут; через 8 с телефон повторяет её с пометкой retry.
    for (let t = 3000; t <= 10_000; t += 1000) room.input("a", batch(null), t);
    room.input("a", batch(3, [{ t: "tap", ago: 3500 }], "p1", true), 10_500);
    expect(seen.at(-1)).toMatchObject({ at: 7000, late: false, delayed: true });
    // Без пометки повтора та же пачка в свой черёд обрезалась бы — так ведёт себя только подделка.
    room.input("a", batch(4, [{ t: "tap", ago: 3500 }]), 11_000);
    expect(seen.at(-1)).toMatchObject({ at: 11_000 - 1500, late: true, delayed: false });
  });

  it("телефон молчал 5 с и прислал пачку с `ago` 4000 — принято до 4 с, но с пометкой `delayed`", () => {
    const { room, seen } = spyRoom(0);
    room.input("a", batch(1, [{ t: "tap" }]), 0);
    room.input("a", batch(2, [{ t: "tap", ago: 4000 }]), 5000);
    expect(seen.at(-1)).toMatchObject({ at: 1000, late: false, delayed: true });
  });

  it("порог числа игроков: телефон шлёт по прошлому интервалу — честный `ago` не обрезается", () => {
    const slowWhenMany: RoomGame<unknown> = { ...game, batchMs: (n) => (n > 2 ? 2000 : 1000) };
    const three = [{ pid: "a", name: "Аня", team: null }, { pid: "b", name: "Боря", team: null }, { pid: "c", name: "Вика", team: null }];
    const { room, seen } = spyRoom(0, three, slowWhenMany);
    expect(room.input("a", batch(null), 0)).toMatchObject({ every: 2000 });
    room.removeParticipant("c", 100);
    // «Сейчас»-событие отдельно, сразу за ним — обычная пачка, собранная по интервалу 2 с.
    room.input("a", batch(1, [{ t: "move", id: "m" }]), 1900);
    room.input("a", batch(2, [{ t: "tap", ago: 1900 }]), 2000);
    expect(seen.at(-1)).toMatchObject({ at: 100, late: false });
  });

  it("повтор номера не обрабатывается; не по порядку — обрабатывается; ушедший из окна — «stale», не «dup»; новая страница — новый поток", () => {
    const w = new SeqWindow();
    expect([w.take(5), w.take(5), w.take(3), w.take(4), w.take(3)]).toEqual([true, false, true, true, false]);
    expect(w.take(500)).toBe(true);
    expect(w.check(10)).toBe("stale");
    expect(w.check(500)).toBe("dup");
    expect(w.check(501)).toBe("newest");
    expect(w.check(499)).toBe("new");

    const room = newRoom(1000);
    expect(room.input("a", batch(1, [{ t: "tap", n: 3 }]), 1000)).toMatchObject({ ok: true, dup: false, stale: false });
    expect(room.input("a", batch(1, [{ t: "tap", n: 3 }]), 1100)).toMatchObject({ ok: true, dup: true });
    expect(total(room)).toBe(3);
    room.input("a", batch(200, [{ t: "tap", n: 1 }]), 1200);
    expect(room.input("a", batch(2, [{ t: "tap", n: 9 }]), 1300)).toMatchObject({ ok: true, dup: false, stale: true });
    expect(total(room)).toBe(4);
    // Перезагрузка страницы: номера с нуля, но поток другой — пачки идут.
    expect(room.input("a", batch(1, [{ t: "tap", n: 2 }], "p2"), 3000)).toMatchObject({ ok: true, dup: false });
    expect(total(room)).toBe(6);
  });

  it("пустые пачки не тратят номера: после долгого «я на связи» пачка с событиями не считается повтором", () => {
    const room = newRoom(0);
    for (let t = 0; t < 100; t++) room.input("a", batch(null), t * 1000);
    expect(room.input("a", batch(1, [{ t: "tap", n: 2 }]), 100_000)).toMatchObject({ ok: true, dup: false, stale: false });
    expect(total(room)).toBe(2);
  });

  it("потоков номеров на телефон — 3: вытесняется давно молчащий, а не первый", () => {
    const room = newRoom(0);
    room.input("a", batch(1, [{ t: "tap", n: 1 }], "s1"), 0);
    room.input("a", batch(1, [{ t: "tap", n: 1 }], "s2"), 100);
    room.input("a", batch(1, [{ t: "tap", n: 1 }], "s3"), 200);
    // s1 снова в деле — давно молчит s2.
    room.input("a", batch(2, [{ t: "tap", n: 1 }], "s1"), 1300);
    room.input("a", batch(1, [{ t: "tap", n: 1 }], "s4"), 1400);
    expect(STREAMS_PER_PLAYER).toBe(3);
    // s1 помнится (повтор — dup), s2 забыт (повтор — снова «новый»).
    expect(room.input("a", batch(2, [{ t: "tap", n: 1 }], "s1"), 2500)).toMatchObject({ dup: true });
    expect(room.input("a", batch(1, [{ t: "tap", n: 1 }], "s2"), 2600)).toMatchObject({ dup: false });
  });

  it("не участник — отказ; касаний — запас 30 и дальше не больше 15 в секунду; лишние события срезаются, запросы — 429", () => {
    const room = newRoom(0);
    expect(room.input("zz", batch(1), 0)).toMatchObject({ ok: false, status: 403 });
    room.input("a", batch(1, [{ t: "tap", n: 999 }]), 500);
    expect(total(room)).toBe(TAPS_BURST);
    // Запас кончился: через 0,4 с — ещё 6 касаний, сколько бы ни прислал в нескольких событиях.
    room.input("a", batch(2, [{ t: "tap", n: 10 }, { t: "tap", n: 10 }]), 900);
    expect(total(room)).toBe(TAPS_BURST + 6);
    // Дальше 10 секунд по 20 в секунду — засчитывается по 15.
    for (let sec = 1; sec <= 10; sec++) room.input("a", batch(2 + sec, [{ t: "tap", n: 20 }]), 900 + sec * 1000);
    expect(total(room)).toBe(TAPS_BURST + 6 + TAPS_PER_SECOND * 10);
    // Событий — до 30 в секунду с запасом вдвое: 64 в одной пачке — 60 проходят.
    const many = Array.from({ length: 64 }, () => ({ t: "ping", id: "x" }));
    expect(room.input("b", batch(1, many), 0)).toMatchObject({ ok: true, dropped: 4 });
    const replies = Array.from({ length: REQUESTS_BURST + 2 }, (_, i) => room.input("b", batch(10 + i), 0));
    expect(replies.find((r) => !r.ok)).toMatchObject({ status: 429 });
    expect(room.input("b", batch(100), 1000)).toMatchObject({ ok: true });
  });

  it("честный игрок: две пачки по 9, попавшие в одну секунду (сдвиг отправки), не срезаются; минута по 9 в секунду — всё засчитано", () => {
    const room = newRoom(0);
    room.input("b", batch(1, [{ t: "tap", n: 9 }]), 1000);
    room.input("b", batch(2, [{ t: "tap", n: 9 }]), 1900);
    expect((room.state as CheckState).taps.b).toBe(18);
    for (let sec = 1; sec <= 60; sec++) room.input("b", batch(2 + sec, [{ t: "tap", n: 9 }]), 1900 + sec * 1000 + (sec % 2) * 280);
    expect((room.state as CheckState).taps.b).toBe(18 + 9 * 60);
  });

  it("«без связи» — кто ничего не прислал 3 с; пустая пачка — «я на связи»", () => {
    const room = newRoom(0);
    const host = collector();
    room.listen("host", host.listener, 0);
    room.input("a", batch(null), 0);
    room.tick(0);
    expect(room.hostEvent(0)).toMatchObject({ players: 2, online: 1, offline: [{ pid: "b", name: "Боря" }] });
    room.tick(2900);
    expect(room.hostEvent(2900)).toMatchObject({ online: 1 });
    room.tick(3100);
    expect(room.hostEvent(3100)).toMatchObject({ online: 0 });
    room.tick(4000);
    expect(host.got.at(-1)).toMatchObject({ type: "host", online: 0 });
  });

  it("на паузе жетоны лимита событий не тратятся: после продолжения — полный запас", () => {
    const room = newRoom(0);
    room.command("pause", null, null, 0);
    const many = Array.from({ length: 64 }, () => ({ t: "ping", id: "x" }));
    for (let i = 1; i <= 5; i++) expect(room.input("a", batch(i, many), i * 10)).toMatchObject({ dropped: 64 });
    room.command("resume", null, null, 100);
    // Запас — 60 (30 в секунду вдвое): из 64 срезаются 4, а не все.
    expect(room.input("a", batch(6, many), 110)).toMatchObject({ dropped: 4 });
  });

  it("пульт получает сводку раз в секунду и без перемен в игре (задержка цикла и память)", () => {
    let lag = 0;
    const room = new Room({ id: "s1", key: game.id, hostId: "h", game, players: [], teams: [], snapshot: null, playMode: "solo", now: 0, loop: () => ({ lagMs: lag, maxLagMs: lag, memoryMb: 50 }) });
    const host = collector();
    room.listen("host", host.listener, 0);
    room.tick(0);
    lag = 7;
    room.tick(1000);
    room.tick(1500);
    lag = 9;
    room.tick(2000);
    const hosts = host.got.filter((e) => e.type === "host");
    expect(hosts.map((e) => (e as { loop: { lagMs: number } }).loop.lagMs)).toEqual([0, 0, 7, 9]);
  });

  it("время последней игры — в снимке: восстановленная комната помнит его, а не время подъёма", () => {
    const room = newRoom(0);
    room.input("a", batch(1, [{ t: "tap" }]), 5000);
    room.input("a", batch(null), 60_000);
    const data = parseSnapshotData(JSON.parse(JSON.stringify(room.snapshotData(70_000, true))));
    expect(data?.activeAt).toBe(5000);
    const again = new Room({ id: "s1", key: "room-check", hostId: "h", game, players: [], teams: [], snapshot: null, playMode: "solo", now: 10_000_000, restoreFrom: data });
    expect(again.activeAt).toBe(5000);
    expect(again.lastActivity).toBe(10_000_000);
    // Старый снимок без метки — от времени снимка.
    expect(parseSnapshotData({ v: 1, game: "g", key: "k", seed: "s", savedAt: 42 })?.activeAt).toBe(42);
    expect(room.onlinePids()).toEqual(["a"]);
  });

  it("создание комнаты — не активность; «я на связи» — тоже; пачка с событиями и команда — да", () => {
    const room = newRoom(0);
    expect(room.activityCount).toBe(0);
    room.input("a", batch(null), 10);
    expect(room.activityCount).toBe(0);
    room.input("a", batch(1, [{ t: "tap" }]), 20);
    room.command("echo", null, null, 30);
    expect(room.activityCount).toBe(2);
  });

  it("места потоков: у ведущего свой запас; устройство с полным набором вытесняет своё и при полной комнате; буфер комнаты ограничен", () => {
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as FastifyBaseLogger;
    const manager = new RoomManager({} as never, new Hub(), log, { loopMs: 0 });
    const room = newRoom(0);
    const open = (device: string, pool: StreamPool = "me", backlog = 0, ip = "") => {
      let destroyed = false;
      const listener: RoomListener = { send: () => undefined, end: () => undefined, backlog: () => (destroyed ? 0 : backlog), destroy: () => (destroyed = true) };
      manager.attachStream(room, device, listener, () => room.listen("me", listener, 0, device), pool, ip);
      return { destroyed: () => destroyed };
    };
    for (let i = 0; i < 4; i++) open(`me:g${i}`);
    // Предел 4 занят игроками: новое устройство — нет, ведущий — да (свой запас).
    expect(manager.streamAllowed(room, "me:g9", "me", { limit: 4 })).toBe(false);
    expect(manager.streamAllowed(room, "host:s:pult", "host", { limit: 4 })).toBe(true);
    for (let i = 0; i < HOST_STREAMS_PER_ROOM; i++) open(`host:s:p${i}`, "host");
    expect(manager.streamAllowed(room, "host:s:pnew", "host", { limit: 4 })).toBe(false);
    // Устройство, у которого уже 3 потока (один повис), переподключается и при полной комнате — старый вытеснится.
    open("me:g0");
    open("me:g0");
    expect(manager.streamAllowed(room, "me:g0", "me", { limit: 4 })).toBe(true);
    // Буфер: два отставших потока по 10 и 11 МБ — у комнаты больше 16 МБ: обрывается самый отставший, и его место свободно.
    const slow = open("me:slow", "me", 10 * 1024 * 1024);
    const slower = open("me:slower", "me", 11 * 1024 * 1024);
    expect(ROOM_BACKLOG_BYTES).toBe(16 * 1024 * 1024);
    const before = manager.streamCount(room.id);
    expect(manager.trimBacklog()).toBe(1);
    expect([slower.destroyed(), slow.destroyed()]).toEqual([true, false]);
    expect(manager.streamCount(room.id)).toBe(before - 1);
    // Пульт ведущего не обрывается, сколько бы ни ждало у него.
    const pult = open("host:s:big", "host", 40 * 1024 * 1024);
    manager.trimBacklog();
    expect(pult.destroyed()).toBe(false);
  });

  it("экраны не ведущего — свой запас: 400 выданных устройств открывают экраны, а личный поток игрока и пульт открываются", () => {
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as FastifyBaseLogger;
    const manager = new RoomManager({} as never, new Hub(), log, { loopMs: 0 });
    const room = newRoom(0);
    let opened = 0;
    for (let i = 0; i < 400; i++) {
      const ip = `10.0.${Math.floor(i / 40)}.${i % 40}`;
      if (!manager.streamAllowed(room, `screen:u:d${i}`, "screen", { ip })) continue;
      manager.attachStream(room, `screen:u:d${i}`, collector().listener, () => () => undefined, "screen", ip);
      opened += 1;
    }
    expect(opened).toBe(SCREENS_PER_ROOM);
    expect(manager.streamAllowed(room, "me:u:a", "me")).toBe(true);
    expect(manager.streamAllowed(room, "host:s:x", "host")).toBe(true);
    // С одного адреса — не больше SCREENS_PER_IP экранов.
    const other = new Room({ id: "s2", key: game.id, hostId: "h", game, players: [], teams: [], snapshot: null, playMode: "solo", now: 0 });
    let fromOne = 0;
    for (let i = 0; i < 30; i++) {
      if (!manager.streamAllowed(other, `screen:u:z${i}`, "screen", { ip: "192.168.1.5" })) continue;
      manager.attachStream(other, `screen:u:z${i}`, collector().listener, () => () => undefined, "screen", "192.168.1.5");
      fromOne += 1;
    }
    expect(fromOne).toBe(SCREENS_PER_IP);
  });

  it("общий буфер всех комнат — 48 МБ: обрываются самые отставшие из разных комнат", () => {
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as FastifyBaseLogger;
    const manager = new RoomManager({} as never, new Hub(), log, { loopMs: 0 });
    expect(ROOMS_BACKLOG_BYTES).toBe(48 * 1024 * 1024);
    const flags: Array<() => boolean> = [];
    for (let r = 0; r < 5; r++) {
      const room = new Room({ id: `s${r}`, key: game.id, hostId: "h", game, players: [], teams: [], snapshot: null, playMode: "solo", now: 0 });
      // В каждой комнате меньше 10 МБ — меньше 16 МБ комнаты, но всего 48,5 МБ.
      let destroyed = false;
      const size = (9.5 + r * 0.1) * 1024 * 1024;
      const listener: RoomListener = { send: () => undefined, end: () => undefined, backlog: () => (destroyed ? 0 : size), destroy: () => (destroyed = true) };
      manager.attachStream(room, `me:u:${r}`, listener, () => () => undefined, "me");
      flags.push(() => destroyed);
    }
    expect(manager.trimBacklog()).toBe(1);
    expect(flags.map((f) => f())).toEqual([false, false, false, false, true]);
  });

  it("вытеснение потока: старый сначала отписан от комнаты, потом «закрыто» — сводки в закрытый поток больше не пишутся", () => {
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as FastifyBaseLogger;
    const manager = new RoomManager({} as never, new Hub(), log, { loopMs: 0 });
    const room = newRoom(0);
    const streams = Array.from({ length: STREAMS_PER_DEVICE + 1 }, () => {
      let ended = false;
      let afterEnd = 0;
      const got: RoomStreamEvent[] = [];
      const listener: RoomListener = {
        send: (e) => {
          if (ended) afterEnd += 1;
          got.push(e);
        },
        end: () => {
          ended = true;
        },
      };
      return { listener, got, afterEnd: () => afterEnd, ended: () => ended };
    });
    for (const s of streams) manager.attachStream(room, "screen:dev", s.listener, () => room.listen("screen", s.listener, 0));
    expect(streams[0]?.ended()).toBe(true);
    expect(streams[0]?.got.at(-1)).toMatchObject({ type: "closed", reason: "replaced" });
    for (let t = 1; t <= 10; t++) {
      room.input("a", batch(t, [{ t: "tap" }]), t * 1000);
      room.tick(t * 1000);
    }
    expect(streams[0]?.afterEnd()).toBe(0);
    expect(streams[3]?.got.filter((e) => e.type === "screen").length).toBeGreaterThan(5);
    expect(room.listeners).toBe(STREAMS_PER_DEVICE);
    // Другой вид того же устройства и другое устройство — свои места.
    manager.attachStream(room, "host:dev", collector().listener, () => () => undefined);
    manager.attachStream(room, "screen:other", collector().listener, () => () => undefined);
    expect(streams[1]?.ended()).toBe(false);
  });

  it("поток комнаты по HTTP: закрытый и недочитанный поток обрывается через запас времени; сводки на медленной сети не копятся", async () => {
    let listener: RoomListener | null = null;
    let raw: import("node:http").ServerResponse | null = null;
    const server = createServer((_req, res) => {
      raw = res;
      const reply = { getHeader: () => undefined, hijack: () => undefined, raw: res } as unknown as FastifyReply;
      openRoomStream(reply, 60_000, (l) => {
        listener = l;
        return () => undefined;
      }, 80);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as { port: number };
    const req = httpRequest({ host: "127.0.0.1", port, path: "/" });
    req.on("response", (res) => res.pause());
    req.on("error", () => undefined);
    req.end();
    for (let i = 0; i < 50 && !listener; i++) await new Promise((r) => setTimeout(r, 10));
    const l = listener as RoomListener | null;
    const res = raw as import("node:http").ServerResponse | null;
    try {
      // Наполняем буфер личными событиями, пока ядро не перестанет принимать (буфер Node станет ненулевым).
      // Запись асинхронная: ядро забирает буфер на следующем витке, поэтому ждём, пока его буфер заполнится и Node
      // попросит подождать (`writableNeedDrain`).
      for (let i = 0; i < 4000 && !res?.writableNeedDrain; i++) {
        l?.send({ type: "event", at: i, data: { pad: "x".repeat(32 * 1024) } });
        await new Promise((r) => setImmediate(r));
      }
      expect(res?.writableNeedDrain).toBe(true);
      expect(res?.writableLength ?? 0).toBeGreaterThan(0);
      // Сводки экрана, пока сеть не успевает, не копятся: держится одна последняя.
      const before = res?.writableLength ?? 0;
      for (let i = 0; i < 50; i++) l?.send({ type: "screen", at: i, version: i, paused: false, players: 0, online: 0, data: { pad: "y".repeat(2000) } });
      expect(res?.writableLength ?? 0).toBe(before);
      l?.end();
      // Закрыт, но не дописан: буфер в счёте, пока не оборвётся.
      expect(l?.backlog?.() ?? 0).toBeGreaterThan(0);
      expect(l?.closed?.()).toBe(false);
      await new Promise((r) => setTimeout(r, 200));
      expect(res?.destroyed).toBe(true);
      expect(l?.closed?.()).toBe(true);
      expect(l?.backlog?.()).toBe(0);
    } finally {
      // Упавшая проверка не оставляет открытый сервер (иначе прогон не завершится).
      res?.destroy();
      req.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("поток комнаты по HTTP: сеть догнала (drain) — приходит только последняя сводка из придержанных", async () => {
    let listener: RoomListener | null = null;
    let raw: import("node:http").ServerResponse | null = null;
    const server = createServer((_req, res) => {
      raw = res;
      const reply = { getHeader: () => undefined, hijack: () => undefined, raw: res } as unknown as FastifyReply;
      openRoomStream(reply, 60_000, (l) => {
        listener = l;
        return () => undefined;
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as { port: number };
    let text = "";
    let client: import("node:http").IncomingMessage | null = null;
    const req = httpRequest({ host: "127.0.0.1", port, path: "/" });
    req.on("response", (res) => {
      client = res;
      res.pause();
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (text += chunk));
    });
    req.on("error", () => undefined);
    req.end();
    for (let i = 0; i < 50 && !(listener && client); i++) await new Promise((r) => setTimeout(r, 10));
    const l = listener as RoomListener | null;
    const res = raw as import("node:http").ServerResponse | null;
    try {
      for (let i = 0; i < 4000 && !res?.writableNeedDrain; i++) {
        l?.send({ type: "event", at: i, data: { pad: "x".repeat(32 * 1024) } });
        await new Promise((r) => setImmediate(r));
      }
      expect(res?.writableNeedDrain).toBe(true);
      for (let v = 1; v <= 30; v++) l?.send({ type: "screen", at: v, version: v, paused: false, players: 0, online: 0, data: { mark: `v${v}v` } });
      (client as import("node:http").IncomingMessage | null)?.resume();
      for (let i = 0; i < 300 && !text.includes("v30v"); i++) await new Promise((r) => setTimeout(r, 10));
      expect(text.includes("v30v")).toBe(true);
      // Придержанные раньше сводки заменены последней — ни одна не ушла.
      expect(/"v(?:[1-9]|[12]\d)v"/.test(text)).toBe(false);
    } finally {
      res?.destroy();
      req.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("поток комнаты по HTTP: запись после закрытия не роняет процесс (ни сводка, ни «я жив»)", async () => {
    let listener: RoomListener | null = null;
    const server = createServer((_req, res) => {
      const reply = { getHeader: () => undefined, hijack: () => undefined, raw: res } as unknown as FastifyReply;
      openRoomStream(reply, 20, (l) => {
        listener = l;
        return () => undefined;
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as { port: number };
    // Клиент не читает поток (плохая сеть): «close» придёт не сразу.
    const req = httpRequest({ host: "127.0.0.1", port, path: "/" });
    req.on("response", (res) => res.pause());
    req.on("error", () => undefined);
    req.end();
    for (let i = 0; i < 50 && !listener; i++) await new Promise((r) => setTimeout(r, 10));
    const l = listener as RoomListener | null;
    expect(l).not.toBeNull();
    l?.end();
    for (let i = 0; i < 20; i++) l?.send({ type: "screen", at: i, version: i, paused: false, players: 0, online: 0, data: { pad: "x".repeat(1000) } });
    l?.end();
    await new Promise((r) => setTimeout(r, 80));
    req.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("активность — только пачки с событиями и команды; «я на связи» — нет", () => {
    const room = newRoom(0);
    room.input("a", batch(null), 60_000);
    expect(room.lastActivity).toBe(0);
    expect(room.input("a", batch(null), 61_000)).toMatchObject({ ok: true });
    room.input("a", batch(1, [{ t: "tap", n: 1 }]), 62_000);
    expect(room.lastActivity).toBe(62_000);
    // Пачка на паузе — не игра.
    room.command("pause", null, null, 63_000);
    room.input("a", batch(2, [{ t: "tap", n: 1 }]), 64_000);
    expect(room.lastActivity).toBe(63_000);
    // Повтор — тоже не новая активность.
    room.command("resume", null, null, 65_000);
    room.input("a", batch(2, [{ t: "tap", n: 1 }]), 66_000);
    expect(room.lastActivity).toBe(65_000);
  });

  it("сводка экрана — не чаще 5 раз в секунду; личное событие — сразу и только своему телефону; зерно не уходит никуда", () => {
    const room = newRoom(0);
    const screen = collector();
    const meA = collector();
    const meB = collector();
    const host = collector();
    room.listen("screen", screen.listener, 0);
    room.listen("me", meA.listener, 0, "a");
    room.listen("me", meB.listener, 0, "b");
    room.listen("host", host.listener, 0);
    expect(meA.got[0]).toMatchObject({ type: "snapshot", every: 1000, offlineMs: 3000, data: { taps: 0 } });
    // «Движения» каждые 10 мс (сколько пропустит лимит запросов): сводка меняется всё время.
    for (let t = 0; t < 1000; t += 10) {
      room.input("a", batch(t + 1, [{ t: "move", id: `m${t}` }]), t);
      room.tick(t);
    }
    const screens = screen.got.filter((e) => e.type === "screen").length;
    expect(screens).toBeLessThanOrEqual(6);
    expect(screens).toBeGreaterThanOrEqual(4);
    room.input("a", batch(5000, [{ t: "ping", id: "x1" }]), 1500);
    expect(meA.got.at(-1)).toEqual({ type: "event", at: 1500, data: { t: "pong", id: "x1", late: false } });
    expect(meB.got.filter((e) => e.type === "event")).toEqual([]);
    const everything = JSON.stringify([screen.got, meA.got, meB.got, host.got, room.screenEvent(2000), room.hostEvent(2000), room.meEvent("a", 2000)]);
    expect(everything).not.toContain(room.seed);
    expect(everything).not.toContain("window");
  });

  it("убрали участника: «на связи» уменьшается, его личный поток закрыт («removed»), пачки — 403; вернули — снова играет", () => {
    const room = newRoom(0);
    const me = collector();
    room.listen("me", me.listener, 0, "a");
    room.input("a", batch(null), 0);
    room.input("b", batch(null), 0);
    room.tick(0);
    expect(room.online).toBe(2);
    room.removeParticipant("a", 10);
    expect(room.online).toBe(1);
    expect(room.hostEvent(10)).toMatchObject({ players: 1, online: 1 });
    expect(me.got.at(-1)).toEqual({ type: "closed", at: 10, reason: "removed" });
    expect(me.ended()).toBe(1);
    expect(room.input("a", batch(null), 20)).toMatchObject({ ok: false, status: 403 });
    // Через 3 с без связи число не уходит в минус.
    room.tick(5000);
    expect(room.online).toBe(0);
    room.upsertParticipant({ id: "a", name: "Аня", kind: "player", teamId: null }, 6000);
    expect(room.input("a", batch(1, [{ t: "tap", n: 2 }]), 6000)).toMatchObject({ ok: true });
    expect(room.online).toBe(1);
  });

  it("за игрока вошёл другой телефон: прежний личный поток закрыт, номера пачек — с чистого листа", () => {
    const room = newRoom(0);
    const me = collector();
    room.listen("me", me.listener, 0, "a");
    room.input("a", batch(7, [{ t: "tap", n: 1 }]), 0);
    room.deviceMoved("a", 100);
    expect(me.got.at(-1)).toMatchObject({ type: "closed", reason: "removed" });
    // Новый телефон начинает свой поток пачек — номер 7 того же потока снова принимается.
    expect(room.input("a", batch(7, [{ t: "tap", n: 1 }]), 1200)).toMatchObject({ dup: false });
  });

  it("состав: новый участник, переименование, команда — без перезагрузки комнаты; «я на связи» медленного пути не пересылает сводки", () => {
    const room = newRoom(0, []);
    expect(room.input("v", batch(1), 0)).toMatchObject({ ok: false, status: 403 });
    room.upsertParticipant({ id: "t1", name: "Лисы", kind: "team", teamId: null }, 0);
    room.upsertParticipant({ id: "v", name: "Вера", kind: "player", teamId: "t1" }, 0);
    expect(room.input("v", batch(1, [{ t: "tap", n: 2 }]), 0)).toMatchObject({ ok: true });
    room.upsertParticipant({ id: "v", name: "Вера К.", kind: "player", teamId: "t1" }, 0);
    expect((room.hostEvent(0) as { data: { top: Array<{ name: string }> } }).data.top[0]?.name).toBe("Вера К.");
    const version = room.version;
    room.upsertParticipant({ id: "v", name: "Вера К.", kind: "player", teamId: "t1" }, 0);
    room.upsertParticipant({ id: "t1", name: "Лисы", kind: "team", teamId: null }, 0);
    expect(room.version).toBe(version);
  });

  it("пауза: события не идут в игру, пачки — «я на связи»; продолжение — с пульта; повтор команды по id — прежний итог", () => {
    const room = newRoom(0);
    const me = collector();
    room.listen("me", me.listener, 0, "a");
    expect(room.command("pause", null, "c1", 0)).toEqual({ ok: true });
    expect(me.got.at(-1)).toEqual({ type: "room", at: 0, paused: true });
    expect(room.input("a", batch(1, [{ t: "tap", n: 5 }]), 10)).toMatchObject({ ok: true, paused: true, dropped: 1 });
    expect(total(room)).toBe(0);
    expect(room.command("resume", null, "c2", 1020)).toEqual({ ok: true });
    expect(me.got.at(-1)).toEqual({ type: "room", at: 1020, paused: false });
    room.input("a", batch(2, [{ t: "tap", n: 5 }]), 1030);
    expect(total(room)).toBe(5);
    room.command("reset", null, "c3", 1040);
    room.input("a", batch(3, [{ t: "tap", n: 2 }]), 2050);
    expect(room.command("reset", null, "c3", 2060)).toEqual({ ok: true });
    expect(total(room)).toBe(2);
    expect(room.command("nonsense", null, null, 2070)).toEqual({ ok: false, error: "invalid-argument" });
    expect(room.command("BAD!", null, null, 2070)).toEqual({ ok: false, error: "invalid-argument" });
  });

  it("команда с этапом: этап тот же — выполняется; игра ушла дальше — отказ «moved», ничего не сделано", () => {
    const room = newRoom(0);
    expect(room.moment()).toBe("r0");
    expect(room.command("reset", null, "x1", 0, "r0")).toEqual({ ok: true });
    expect(room.moment()).toBe("r1");
    // Второй пульт нажал «сброс» по старому этапу — повторно не сбрасывается.
    expect(room.command("reset", null, "x2", 0, "r0")).toEqual({ ok: false, error: "moved" });
    expect((room.state as CheckState).resets).toBe(1);
    expect(room.hostEvent(0)).toMatchObject({ moment: "r1" });
    expect(room.command("reset", null, null, 0, "плохой этап!")).toEqual({ ok: false, error: "invalid-argument" });
  });

  it("контрольная точка: команда игры и пауза просят снимок вне очереди 10 с", () => {
    const room = newRoom(0);
    expect(room.checkpointWanted).toBe(false);
    room.command("checkpoint", null, null, 0);
    expect(room.checkpointWanted).toBe(true);
    room.checkpointWanted = false;
    room.command("pause", null, null, 1);
    expect(room.checkpointWanted).toBe(true);
  });

  it("снимок → «перезапуск» → пауза → продолжение: тот же счёт, тот же номер изменения, другой блок — с чистого листа", () => {
    const room = newRoom(0);
    room.input("a", batch(1, [{ t: "tap", n: 7 }]), 0);
    const data = parseSnapshotData(JSON.parse(JSON.stringify(room.snapshotData(5000))));
    expect(data).toMatchObject({ savedAt: 5000, version: room.version, clean: false, paused: false });
    const again = new Room({ id: "s1", key: "room-check", hostId: "h", game, players: [{ pid: "a", name: "Аня", team: null }], teams: [], snapshot: null, playMode: "solo", now: 9000, restoreFrom: data });
    expect(again).toMatchObject({ paused: true, restored: true, seed: room.seed, version: room.version });
    expect(total(again)).toBe(7);
    again.command("resume", null, null, 9500);
    again.input("a", batch(2, [{ t: "tap", n: 3 }]), 9600);
    expect(total(again)).toBe(10);
    expect(again.restored).toBe(false);
    const other = new Room({ id: "s1", key: "room-check#1", hostId: "h", game, players: [], teams: [], snapshot: null, playMode: "solo", now: 5000, restoreFrom: data });
    expect(other).toMatchObject({ paused: false, restored: false });
    expect(total(other)).toBe(0);
  });

  it("после перезапуска простой считается от снимка: дедлайн шага сдвигается на всё время простоя", () => {
    const g = deadlineGame as RoomGame<unknown>;
    const room = newRoom(0, [{ pid: "a", name: "Аня", team: null }], g);
    expect((room.state as DeadlineState).deadline).toBe(30_000);
    // Снимок за 20 с до дедлайна; сервер лежал 100 с; ведущий продолжил через 10 с после подъёма.
    const data = parseSnapshotData(JSON.parse(JSON.stringify(room.snapshotData(10_000))));
    const again = new Room({ id: "s1", key: "deadline", hostId: "h", game: g, players: [{ pid: "a", name: "Аня", team: null }], teams: [], snapshot: null, playMode: "solo", now: 110_000, restoreFrom: data });
    again.command("resume", null, null, 120_000);
    // До дедлайна снова 20 с — как в момент снимка.
    expect((again.state as DeadlineState).deadline).toBe(140_000);
    // Был на паузе ещё до снимка — простой с начала паузы.
    const paused = newRoom(0, [{ pid: "a", name: "Аня", team: null }], g);
    paused.command("pause", null, null, 5000);
    const pausedData = parseSnapshotData(JSON.parse(JSON.stringify(paused.snapshotData(10_000))));
    const back = new Room({ id: "s1", key: "deadline", hostId: "h", game: g, players: [], teams: [], snapshot: null, playMode: "solo", now: 50_000, restoreFrom: pausedData });
    back.command("resume", null, null, 60_000);
    expect((back.state as DeadlineState).deadline).toBe(85_000);
  });

  it("спокойная выгрузка: после загрузки не на паузе (если и не была), без пометки «восстановлена»", () => {
    const room = newRoom(0);
    room.input("a", batch(1, [{ t: "tap", n: 4 }]), 0);
    const data = parseSnapshotData(JSON.parse(JSON.stringify(room.snapshotData(1000, true))));
    const again = new Room({ id: "s1", key: "room-check", hostId: "h", game, players: [], teams: [], snapshot: null, playMode: "solo", now: 2_000_000, restoreFrom: data });
    expect(again).toMatchObject({ paused: false, restored: false });
    expect(total(again)).toBe(4);
    // На паузе до выгрузки — на паузе и после.
    room.command("pause", null, null, 2000);
    const pausedData = parseSnapshotData(JSON.parse(JSON.stringify(room.snapshotData(3000, true))));
    const back = new Room({ id: "s1", key: "room-check", hostId: "h", game, players: [], teams: [], snapshot: null, playMode: "solo", now: 4000, restoreFrom: pausedData });
    expect(back).toMatchObject({ paused: true, restored: false });
  });

  it("ошибка в коде игры: комната живёт, номер учтён (повтор — «уже было»), события — в `dropped`, ошибка — в журнал", () => {
    const errors: string[] = [];
    const g = deadlineGame as RoomGame<unknown>;
    const room = newRoom(0, [{ pid: "a", name: "Аня", team: null }], g, (where) => errors.push(where));
    expect(room.input("a", batch(1, [{ t: "boom" }, { t: "hit" }]), 100)).toMatchObject({ ok: true, dropped: 2, dup: false });
    expect(room.input("a", batch(1, [{ t: "boom" }, { t: "hit" }]), 200)).toMatchObject({ ok: true, dup: true });
    expect(errors).toEqual(["input"]);
    expect(room.input("a", batch(2, [{ t: "hit" }]), 300)).toMatchObject({ ok: true, dropped: 0 });
    expect((room.state as DeadlineState).hits).toBe(1);
    // Сбой сводки — тоже не валит комнату.
    const broken: RoomGame<unknown> = { ...g, screen: () => { throw new Error("экран"); } };
    const b = newRoom(0, [], broken, (where) => errors.push(where));
    expect(b.screenEvent(0)).toMatchObject({ type: "screen", data: null });
    expect(errors).toContain("screen");
  });

  it("случайность из зерна: повторяется по ключу, разная для разных ключей", () => {
    expect(seededRandom("s", "step1")).toBe(seededRandom("s", "step1"));
    expect(seededRandom("s", "step1")).not.toBe(seededRandom("s", "step2"));
    const v = seededRandom("s", "x");
    expect(v >= 0 && v < 1).toBe(true);
  });

  it("ключ комнаты: механика и блок вечера", () => {
    expect(roomKey("room-check", null)).toBe("room-check");
    expect(roomKey("room-check", { title: "В", blocks: [{ title: "a", mechanic: "room-check", gameId: null }], index: 0, at: "block", results: [], totals: {} })).toBe("room-check#0");
  });

  it("проверочная игра room-check — только на тестовой версии (ROOM_CHECK=on или адреса test.*)", () => {
    expect(roomCheckEnabled(undefined, ["test.joy-rest.ru"])).toBe(true);
    expect(roomCheckEnabled(undefined, ["joy-rest.ru"])).toBe(false);
    expect(roomCheckEnabled(undefined, [])).toBe(false);
    expect(roomCheckEnabled("on", ["joy-rest.ru"])).toBe(true);
    expect(roomCheckEnabled("off", ["test.joy-rest.ru"])).toBe(false);
    expect(roomCheckEnabled("onn", ["test.joy-rest.ru"])).toBe(false);
    expect(roomGames().has("room-check")).toBe(false);
    expect(roomGames({ check: true }).has("room-check")).toBe(true);
  });

  it("задержка общего цикла меряется настоящим таймером: занятый процесс — задержка в сводке пульта", async () => {
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as FastifyBaseLogger;
    const own = new RoomManager({} as never, new Hub(), log, { loopMs: 20 });
    await new Promise((r) => setTimeout(r, 60));
    const until = Date.now() + 200;
    while (Date.now() < until) {
      // занят: цикл не может выполниться вовремя
    }
    await new Promise((r) => setTimeout(r, 60));
    expect(own.loopStats().maxLagMs).toBeGreaterThanOrEqual(100);
    expect(own.loopStats().memoryMb).toBeGreaterThan(0);
    await own.close();
  });
});

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("быстрый канал на PostgreSQL", () => {
  const SCHEMA = "room_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 4, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  let clock = 1_900_000_000_000;
  let manager: RoomManager | null = null;
  const media = mkdtempSync(join(tmpdir(), "joyrest-media-"));
  const make = (onManager: (m: RoomManager) => void, check = true, limits: { streamsPerRoom?: number; screensPerRoom?: number; screensPerIp?: number } = {}) =>
    buildApp({
      version: "t",
      publicDir: null,
      checkDatabase: async () => true,
      sql,
      mediaDir: media,
      auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
      live: { now: () => clock, keepAliveMs: 60_000 },
      rooms: { now: () => clock, loopMs: 0, keepAliveMs: 60_000, onManager, check, ...limits },
    });
  const app = make((m) => (manager = m));
  const rooms = () => {
    if (!manager) throw new Error("нет комнат");
    return manager;
  };
  let host = "";
  let address = "";
  /** Потоки читаем настоящим HTTP: основное приложение слушает один раз на весь набор тестов. */
  async function listening(target: FastifyInstance = app): Promise<string> {
    if (target !== app) return target.listen({ host: "127.0.0.1", port: 0 });
    address ||= await app.listen({ host: "127.0.0.1", port: 0 });
    return address;
  }

  function cookieOf(res: { headers: Record<string, unknown> }): string {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  }

  const call = (method: "GET" | "POST" | "DELETE", path: string, cookie: string, payload?: object, target: FastifyInstance = app) =>
    target.inject({
      method,
      url: path,
      headers: method === "GET" ? { host: HOST, cookie } : { host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie },
      payload,
    });

  async function device(target: FastifyInstance = app): Promise<{ cookie: string; uid: string }> {
    const res = await call("POST", "/api/auth/device", "", undefined, target);
    return { cookie: cookieOf(res), uid: res.json().uid };
  }

  async function newSession(id: string, mechanic = "room-check", target: FastifyInstance = app): Promise<void> {
    const res = await call("POST", "/api/sessions", host, { id, gameTitle: "Проверка", playMode: "solo", screenMode: "laptop", themeId: "joyrest", mechanic, gameSnapshot: { content: {} } }, target);
    expect(res.statusCode, res.body).toBe(200);
  }

  async function guestIn(sessionId: string, name: string, target: FastifyInstance = app) {
    const g = await device(target);
    expect((await call("POST", `/api/sessions/${sessionId}/participants/${g.uid}/join`, g.cookie, { name, teamId: null }, target)).statusCode).toBe(200);
    return g;
  }

  let seqs = 0;
  /** Пачка с событиями (свой номер) или пустая «я на связи» (без номера). */
  const input = (sessionId: string, cookie: string, events: object[] = [], target: FastifyInstance = app) =>
    call("POST", `/api/rooms/${sessionId}/input`, cookie, events.length > 0 ? { stream: "t1", seq: ++seqs, events } : { stream: "t1", events }, target);

  async function settle(check: () => Promise<boolean>): Promise<boolean> {
    for (let i = 0; i < 100; i++) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  }

  const savedTotal = async (id: string) => (await sql<{ data: { state: { total: number } } }[]>`select data from room_snapshots where session_id = ${id}`)[0]?.data.state.total;

  /** Читатель потока событий по настоящему HTTP. */
  async function openReader(base: string, path: string, cookie: string) {
    const controller = new AbortController();
    const res = await fetch(`${base}${path}`, { headers: { cookie }, signal: controller.signal });
    if (res.status !== 200) return { status: res.status, next: async () => null, controller };
    const r = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const next = async (): Promise<RoomStreamEvent | Record<string, unknown> | null> => {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (data) return JSON.parse(data.slice(6)) as RoomStreamEvent;
          continue;
        }
        const { value, done } = await r.read().catch(() => ({ value: undefined, done: true }));
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    };
    return { status: 200, next, controller };
  }

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    host = cookieOf(await call("POST", "/api/auth/login", "", { email: "owner@example.com", password: "пароль-владельца-12" }));
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("пачки: только игрок этой сессии; повтор номера — без обработки; неверная пачка — 400, больше 4 КБ — 413", async () => {
    await newSession("r1");
    const anya = await guestIn("r1", "Аня");
    const stranger = await device();
    expect((await input("r1", "")).statusCode).toBe(401);
    expect((await input("r1", stranger.cookie)).statusCode).toBe(403);
    const first = await call("POST", "/api/rooms/r1/input", anya.cookie, { stream: "x", seq: 1, events: [{ t: "tap", n: 4 }] });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ at: clock, every: 1000, paused: false, dropped: 0, dup: false, stale: false });
    expect((await call("POST", "/api/rooms/r1/input", anya.cookie, { stream: "x", seq: 1, events: [{ t: "tap", n: 4 }] })).json()).toMatchObject({ dup: true });
    expect((await call("POST", "/api/rooms/r1/input", anya.cookie, { seq: "x", events: [] })).statusCode).toBe(400);
    expect((await call("POST", "/api/rooms/r1/input", anya.cookie, { events: [{ t: "tap" }] })).statusCode).toBe(400);
    expect((await input("r1", anya.cookie, [{ t: "tap", pad: "x".repeat(5000) }])).statusCode).toBe(413);
    expect((rooms().loaded("r1")?.state as CheckState).total).toBe(4);
    const bare = await app.inject({ method: "POST", url: "/api/rooms/r1/input", headers: { host: HOST, cookie: anya.cookie }, payload: { events: [] } });
    expect(bare.statusCode).toBe(403);
  });

  it("гость, вошедший после создания комнаты, сразу шлёт пачки; отказ «не игрок» не держится дольше секунды", async () => {
    await newSession("r2");
    const anya = await guestIn("r2", "Аня");
    await input("r2", anya.cookie);
    const late = await guestIn("r2", "Вера");
    expect(rooms().loaded("r2")?.has(late.uid)).toBe(true);
    expect((await input("r2", late.cookie, [{ t: "tap", n: 2 }])).statusCode).toBe(200);
    // Запись входа «мимо» события Hub (как если бы событие не дошло): сначала 403, через секунду — уже игрок.
    const quiet = await device();
    expect((await input("r2", quiet.cookie)).statusCode).toBe(403);
    await sql`insert into participants (session_id, id, name, kind, team_id, captain_uid) values ('r2', ${quiet.uid}, 'Тихий', 'player', null, ${quiet.uid})`;
    expect((await input("r2", quiet.cookie)).statusCode).toBe(403);
    clock += MEMBER_RECHECK_MS + 100;
    expect((await input("r2", quiet.cookie)).statusCode).toBe(200);
  });

  it("команды — только ведущий; повтор по id не выполняется; этап `expect`: игра ушла дальше — 409; завершённая — 409 и комната выгружена", async () => {
    await newSession("r3");
    const anya = await guestIn("r3", "Аня");
    expect((await call("POST", "/api/rooms/r3/command", anya.cookie, { cmd: "reset" })).statusCode).toBe(403);
    const echo = await call("POST", "/api/rooms/r3/command", host, { cmd: "echo", args: { x: 1 }, id: "e1" });
    expect(echo.json()).toEqual({ ok: true, result: { x: 1 }, moment: "r0" });
    expect((await call("POST", "/api/rooms/r3/command", host, { cmd: "echo", args: { x: 2 }, id: "e1" })).json()).toMatchObject({ result: { x: 1 } });
    // Два пульта жмут «сброс» по одному этапу: второй — 409, сброс один.
    expect((await call("POST", "/api/rooms/r3/command", host, { cmd: "reset", id: "s1", expect: "r0" })).statusCode).toBe(200);
    const second = await call("POST", "/api/rooms/r3/command", host, { cmd: "reset", id: "s2", expect: "r0" });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "failed-precondition", reason: "moved" });
    expect((rooms().loaded("r3")?.state as CheckState).resets).toBe(1);
    expect((await call("POST", "/api/rooms/r3/command", host, { cmd: "nope" })).statusCode).toBe(400);
    expect((await call("POST", "/api/rooms/r3/command", host, { cmd: "pause", id: "../x" })).statusCode).toBe(400);
    expect((await call("POST", "/api/rooms/r3/command", host, { cmd: "pause", expect: 5 })).statusCode).toBe(400);
    expect((await call("GET", "/api/rooms/r3/host", anya.cookie)).statusCode).toBe(403);
    expect((await call("GET", "/api/rooms/r3/host", host)).json()).toMatchObject({ type: "host", players: 1, paused: false, moment: "r1" });
    expect((await call("GET", "/api/rooms/r3/screen", anya.cookie)).json()).toMatchObject({ type: "screen", data: { total: 0 } });
    expect((await call("GET", "/api/rooms/r3/me", anya.cookie)).json()).toMatchObject({ type: "snapshot", data: { taps: 0 } });

    await newSession("q1", "quiz");
    const guest = await guestIn("q1", "Аня");
    expect((await input("q1", guest.cookie)).statusCode).toBe(404);
    expect((await input("nosuch", guest.cookie)).statusCode).toBe(404);

    expect(rooms().loaded("r3")).not.toBeNull();
    expect((await call("POST", "/api/sessions/r3/finish", host, { participantsCount: 1 })).statusCode).toBe(200);
    expect(rooms().loaded("r3")).toBeNull();
    const after = await input("r3", anya.cookie);
    expect(after.statusCode).toBe(409);
    expect(after.json()).toEqual({ error: "failed-precondition", reason: "finished" });
  });

  it("фаза комнаты — по событиям сессии: «Начать игру» видна комнате", async () => {
    await newSession("r3p");
    const anya = await guestIn("r3p", "Аня");
    await input("r3p", anya.cookie);
    expect(rooms().loaded("r3p")?.phase).toBe("lobby");
    expect((await call("POST", "/api/sessions/r3p/phase", host, { phase: "playing" })).statusCode).toBe(200);
    expect(rooms().loaded("r3p")?.phase).toBe("playing");
  });

  it("пока в комнате пачки с событиями — раз в минуту обновляется sessions.updated_at (выкладка ждёт конца игры)", async () => {
    await newSession("r4");
    const anya = await guestIn("r4", "Аня");
    await sql`update sessions set updated_at = now() - interval '2 hours' where id = 'r4'`;
    const stale = async () => (await sql<{ stale: boolean }[]>`select updated_at < now() - interval '30 minutes' as stale from sessions where id = 'r4'`)[0]?.stale;
    expect(await stale()).toBe(true);
    await input("r4", anya.cookie, [{ t: "tap", n: 1 }]);
    rooms().step(clock);
    expect(await settle(async () => (await stale()) === false)).toBe(true);
    // Та же проверка, что у `joyrest deploy`: есть активная игра.
    const [active] = await sql<{ n: number }[]>`
      select count(*)::int as n from sessions s where s.id = 'r4' and s.phase in ('lobby', 'playing') and s.updated_at > now() - interval '30 minutes'`;
    expect(active?.n).toBe(1);
  });

  it("брошенная вкладка: 40 минут «я на связи» и опросов — updated_at не трогается и после выгрузки (комната поднимается снова)", async () => {
    await newSession("r4b");
    const anya = await guestIn("r4b", "Аня");
    await input("r4b", anya.cookie, [{ t: "tap", n: 1 }]);
    rooms().step(clock);
    await new Promise((r) => setTimeout(r, 100));
    await sql`update sessions set updated_at = now() - interval '2 hours' where id = 'r4b'`;
    const start = clock;
    let unloaded = 0;
    for (let minute = 1; minute <= 40; minute++) {
      clock = start + minute * 60_000;
      // Без условия «комната в памяти»: пустая пачка и опрос поднимают выгруженную комнату — и это не активность.
      if (!rooms().loaded("r4b")) unloaded += 1;
      expect((await input("r4b", anya.cookie)).statusCode).toBe(200);
      expect((await call("GET", "/api/rooms/r4b/screen", anya.cookie)).statusCode).toBe(200);
      rooms().step(clock);
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(unloaded).toBeGreaterThan(0);
    const [row] = await sql<{ stale: boolean }[]>`select updated_at < now() - interval '30 minutes' as stale from sessions where id = 'r4b'`;
    expect(row?.stale).toBe(true);
  });

  it("метка «жив»: не на паузе и без перемен — savedAt снимка раз в 10 с; на паузе — нет", async () => {
    await newSession("r4a");
    const anya = await guestIn("r4a", "Аня");
    await input("r4a", anya.cookie, [{ t: "tap", n: 2 }]);
    await call("POST", "/api/rooms/r4a/command", host, { cmd: "checkpoint" });
    rooms().step(clock);
    const savedAt = async () => Number((await sql<{ at: string }[]>`select data->>'savedAt' as at from room_snapshots where session_id = 'r4a'`)[0]?.at);
    expect(await settle(async () => (await savedAt()) === clock)).toBe(true);
    clock += 11_000;
    rooms().step(clock);
    expect(await settle(async () => (await savedAt()) === clock)).toBe(true);
    expect(await savedTotal("r4a")).toBe(2);
    await call("POST", "/api/rooms/r4a/command", host, { cmd: "pause" });
    rooms().step(clock);
    await settle(async () => (await sql<{ p: boolean }[]>`select (data->>'paused')::boolean as p from room_snapshots where session_id = 'r4a'`)[0]?.p === true);
    const pausedAt = await savedAt();
    clock += 30_000;
    rooms().step(clock);
    await new Promise((r) => setTimeout(r, 100));
    expect(await savedAt()).toBe(pausedAt);
  });

  it("снимок на контрольной точке и раз в 10 с; после перезапуска — та же комната на паузе; продолжение; остановка — снимок", async () => {
    await newSession("r5");
    const anya = await guestIn("r5", "Аня");
    await input("r5", anya.cookie, [{ t: "tap", n: 9 }]);
    clock += 11_000;
    rooms().step(clock);
    expect(await settle(async () => (await savedTotal("r5")) === 9)).toBe(true);
    clock += 1100;
    await input("r5", anya.cookie, [{ t: "tap", n: 1 }]);
    await call("POST", "/api/rooms/r5/command", host, { cmd: "checkpoint" });
    rooms().step(clock);
    expect(await settle(async () => (await savedTotal("r5")) === 10)).toBe(true);
    // Основное приложение выгружает r5, как при остановке (иначе две копии комнаты писали бы один снимок).
    await rooms().unload("r5", "unloaded");

    let second: RoomManager | null = null;
    const restarted = make((m) => (second = m));
    const view = await call("GET", "/api/rooms/r5/host", host, undefined, restarted);
    expect(view.json()).toMatchObject({ type: "host", paused: true, restored: true, data: { total: 10 } });
    clock += 1100;
    await call("POST", "/api/rooms/r5/input", anya.cookie, { stream: "t2", seq: 1, events: [{ t: "tap", n: 3 }] }, restarted);
    expect(((second as RoomManager | null)?.loaded("r5")?.state as CheckState).total).toBe(10);
    expect((await call("POST", "/api/rooms/r5/command", host, { cmd: "resume" }, restarted)).statusCode).toBe(200);
    await call("POST", "/api/rooms/r5/input", anya.cookie, { stream: "t2", seq: 2, events: [{ t: "tap", n: 3 }] }, restarted);
    expect(((second as RoomManager | null)?.loaded("r5")?.state as CheckState).total).toBe(13);
    await restarted.close();
    expect(await savedTotal("r5")).toBe(13);
  });

  it("остановка приложения при открытых потоках (комнаты и сессии): закрывается сразу, снимок записан, загрузки — 503", async () => {
    let own: RoomManager | null = null;
    const other = make((m) => (own = m));
    await newSession("r5c", "room-check", other);
    const anya = await guestIn("r5c", "Аня", other);
    await input("r5c", anya.cookie, [{ t: "tap", n: 5 }], other);
    const base = await listening(other);
    const me = await openReader(base, "/api/stream/room/r5c/me", anya.cookie);
    expect(await me.next()).toMatchObject({ type: "snapshot" });
    const session = await openReader(base, "/api/stream/session/r5c", anya.cookie);
    expect(await session.next()).toMatchObject({ type: "snapshot" });
    const started = Date.now();
    // Пока идёт остановка, события сессии продолжают приходить (пульт, Hub): в закрытые потоки они не пишутся,
    // процесс не падает (необработанной ошибки записи после конца нет), остановка доходит до конца.
    let done = false;
    const closing = other.close().finally(() => {
      done = true;
    });
    let n = 0;
    const hub = (own as RoomManager | null)?.hub;
    while (!done && n < 2000) {
      hub?.publish("session:r5c", { type: "patch", version: 100 + n, state: { phase: "playing" }, leaderboard: {} });
      n += 1;
      await new Promise((r) => setImmediate(r));
    }
    await Promise.race([closing, new Promise((_, reject) => setTimeout(() => reject(new Error("закрытие висит")), 4000))]);
    expect(Date.now() - started).toBeLessThan(4000);
    // Загрузка во время и после остановки — «closing» (по HTTP — 503, повторяемо), а не «нет такой игры».
    expect(await (own as RoomManager | null)?.get("r5c")).toBe("closing");
    expect(await me.next()).toMatchObject({ type: "closed", reason: "unloaded" });
    // Оба потока закрыты до конца: после «закрыто» и снимка сессии — только конец потока, ничего больше.
    expect(await me.next()).toBeNull();
    let event = await session.next();
    let after = 0;
    while (event) {
      after += 1;
      event = await session.next();
    }
    expect(after).toBeLessThan(2000);
    expect(await savedTotal("r5c")).toBe(5);
  });

  it("15 минут без пачек, команд и подписчиков — выгрузка со снимком; следующая пачка поднимает комнату как была (не на паузе)", async () => {
    await newSession("r6");
    const anya = await guestIn("r6", "Аня");
    await input("r6", anya.cookie, [{ t: "tap", n: 2 }]);
    rooms().step(clock + 14 * 60_000);
    expect(rooms().loaded("r6")).not.toBeNull();
    rooms().step(clock + 15 * 60_000);
    expect(rooms().loaded("r6")).toBeNull();
    expect(await settle(async () => (await savedTotal("r6")) === 2)).toBe(true);
    expect((await input("r6", anya.cookie)).json()).toMatchObject({ paused: false });
    expect((rooms().loaded("r6")?.state as CheckState).total).toBe(2);
    expect((await call("GET", "/api/rooms/r6/host", host)).json()).toMatchObject({ restored: false, paused: false });
  });

  it("с открытым экраном лобби комната не выгружается через 15 минут; забытая на 12 часов — выгружается, поток получает «closed»", async () => {
    await newSession("r6s");
    const anya = await guestIn("r6s", "Аня");
    const base = await listening();
    const screen = await openReader(base, "/api/stream/room/r6s/screen", anya.cookie);
    expect(await screen.next()).toMatchObject({ type: "screen" });
    rooms().step(clock + 20 * 60_000);
    expect(rooms().loaded("r6s")).not.toBeNull();
    rooms().step(clock + 13 * 60 * 60_000);
    expect(rooms().loaded("r6s")).toBeNull();
    // Сводки, разосланные шагами цикла, пропускаем — дальше «закрыто» (`abandoned` — не переподключаться) и конец потока.
    let event = await screen.next();
    while (event && event.type === "screen") event = await screen.next();
    expect(event).toMatchObject({ type: "closed", reason: "abandoned" });
    expect(await screen.next()).toBeNull();
  });

  it("забытая комната: экран, опрос и «я на связи» её не поднимают (409 abandoned), пачка с событиями и команда — поднимают", async () => {
    await newSession("r6a");
    const anya = await guestIn("r6a", "Аня");
    await input("r6a", anya.cookie, [{ t: "tap", n: 2 }]);
    clock += 13 * 60 * 60_000;
    rooms().step(clock);
    expect(rooms().loaded("r6a")).toBeNull();
    await settle(async () => (await savedTotal("r6a")) === 2);
    // Пульт тоже 12 часов ничего не делал (иначе комната не забыта — см. следующий тест); отметка комнаты уже ушла.
    await new Promise((r) => setTimeout(r, 50));
    await sql`update sessions set updated_at = now() - interval '13 hours' where id = 'r6a'`;
    const base = await listening();
    for (let i = 0; i < 3; i++) {
      const screen = await openReader(base, "/api/stream/room/r6a/screen", anya.cookie);
      expect(screen.status).toBe(409);
      const poll = await call("GET", "/api/rooms/r6a/screen", anya.cookie);
      expect(poll.json()).toEqual({ error: "failed-precondition", reason: "abandoned" });
      expect((await input("r6a", anya.cookie)).statusCode).toBe(409);
      clock += 60_000;
    }
    expect(rooms().loaded("r6a")).toBeNull();
    // Подписка и пачка с событиями одновременно: пачка не получает «забыта» от чужой загрузки — грузит сама.
    const [quiet, loud] = await Promise.all([rooms().get("r6a"), rooms().get("r6a", true)]);
    expect(quiet).toBe("abandoned");
    expect(typeof loud).toBe("object");
    await rooms().unload("r6a", "unloaded");
    await sql`update room_snapshots set data = data || jsonb_build_object('activeAt', ${clock - 13 * 60 * 60_000}::bigint, 'clean', true) where session_id = 'r6a'`;
    expect((await input("r6a", anya.cookie, [{ t: "tap", n: 1 }])).statusCode).toBe(200);
    expect((rooms().loaded("r6a")?.state as CheckState).total).toBe(3);
    await rooms().unload("r6a", "unloaded");
    clock += 13 * 60 * 60_000;
    expect((await call("POST", "/api/rooms/r6a/command", host, { cmd: "echo" })).statusCode).toBe(200);
  });

  it("лобби с утра, игра вечером: действие пульта — не забыта; забытая оживает после «Начать игру», экран подписывается снова", async () => {
    await newSession("r6l");
    const base = await listening();
    const screen = await openReader(base, "/api/stream/room/r6l/screen", host);
    expect(await screen.next()).toMatchObject({ type: "screen" });
    clock += 11 * 60 * 60_000;
    expect((await call("POST", "/api/sessions/r6l/phase", host, { phase: "playing" })).statusCode).toBe(200);
    clock += 2 * 60 * 60_000;
    rooms().step(clock);
    expect(rooms().loaded("r6l")).not.toBeNull();
    screen.controller.abort();

    // Без единого действия 13 часов — забыта; экран не подписывается, пока ведущий не начнёт игру.
    await newSession("r6m");
    const s1 = await openReader(base, "/api/stream/room/r6m/screen", host);
    expect(await s1.next()).toMatchObject({ type: "screen" });
    await sql`update sessions set updated_at = now() - interval '13 hours' where id = 'r6m'`;
    clock += 13 * 60 * 60_000;
    rooms().step(clock);
    let event = await s1.next();
    while (event && event.type === "screen") event = await s1.next();
    expect(event).toMatchObject({ type: "closed", reason: "abandoned" });
    await settle(async () => rooms().loaded("r6m") === null);
    expect((await openReader(base, "/api/stream/room/r6m/screen", host)).status).toBe(409);
    expect((await call("POST", "/api/sessions/r6m/phase", host, { phase: "playing" })).statusCode).toBe(200);
    const s2 = await openReader(base, "/api/stream/room/r6m/screen", host);
    expect(s2.status).toBe(200);
    expect(await s2.next()).toMatchObject({ type: "screen" });
    s2.controller.abort();
  });

  it("выгрузка сразу освобождает места потоков (новая комната не видит закрытые)", async () => {
    await newSession("r6r");
    const anya = await guestIn("r6r", "Аня");
    const base = await listening();
    const me = await openReader(base, "/api/stream/room/r6r/me", anya.cookie);
    expect(await me.next()).toMatchObject({ type: "snapshot" });
    expect(rooms().streamCount("r6r")).toBe(1);
    const unloading = rooms().unload("r6r", "unloaded");
    expect(rooms().streamCount("r6r")).toBe(0);
    await unloading;
    me.controller.abort();
  });

  it("экраны не ведущего: с одного адреса — не больше предела (429), а личный поток игрока и экран ведущего открываются", async () => {
    let own: RoomManager | null = null;
    const small = make((m) => (own = m), true, { screensPerRoom: 3, screensPerIp: 2 });
    await newSession("r8s", "room-check", small);
    const anya = await guestIn("r8s", "Аня", small);
    const base = await listening(small);
    const readers = [];
    const codes = [];
    for (let i = 0; i < 4; i++) {
      const d = await device(small);
      const r = await openReader(base, "/api/stream/room/r8s/screen", d.cookie);
      codes.push(r.status);
      readers.push(r);
    }
    expect(codes).toEqual([200, 200, 429, 429]);
    const me = await openReader(base, "/api/stream/room/r8s/me", anya.cookie);
    expect(me.status).toBe(200);
    const hostScreen = await openReader(base, "/api/stream/room/r8s/screen", host);
    expect(hostScreen.status).toBe(200);
    expect((own as RoomManager | null)?.streamCount("r8s")).toBe(4);
    for (const r of [...readers, me, hostScreen]) r.controller.abort();
    await small.close();
  });

  it("метка «жив» снимает «спокойную выгрузку»: после подъёма из спокойного снимка и жизни комнаты сбой — на паузе", async () => {
    await newSession("r6c");
    const anya = await guestIn("r6c", "Аня");
    await input("r6c", anya.cookie, [{ t: "tap", n: 2 }]);
    clock += 16 * 60_000;
    rooms().step(clock);
    const cleanOf = async () => (await sql<{ c: boolean }[]>`select (data->>'clean')::boolean as c from room_snapshots where session_id = 'r6c'`)[0]?.c;
    expect(await settle(async () => (await cleanOf()) === true)).toBe(true);
    // Поднимаем опросом (без «я на связи»: иначе смена «на связи» записала бы полный снимок, а не метку).
    expect((await call("GET", "/api/rooms/r6c/screen", anya.cookie)).statusCode).toBe(200);
    expect(rooms().loaded("r6c")?.paused).toBe(false);
    clock += 11_000;
    rooms().step(clock);
    expect(await settle(async () => (await cleanOf()) === false)).toBe(true);
  });

  it("переподключение: новый поток сразу получает свежий снимок с текущим счётом", async () => {
    await newSession("r8");
    const anya = await guestIn("r8", "Аня");
    const base = await listening();
    const first = await openReader(base, "/api/stream/room/r8/me", anya.cookie);
    expect(await first.next()).toMatchObject({ type: "snapshot", data: { taps: 0 } });
    first.controller.abort();
    await input("r8", anya.cookie, [{ t: "tap", n: 6 }]);
    const second = await openReader(base, "/api/stream/room/r8/me", anya.cookie);
    expect(await second.next()).toMatchObject({ type: "snapshot", data: { taps: 6, total: 6 } });
    second.controller.abort();
  });

  it("потоков у телефона — не больше 3: четвёртый закрывает самый старый («replaced»); опрос снимка — не чаще раза в секунду", async () => {
    await newSession("r8l");
    const anya = await guestIn("r8l", "Аня");
    const base = await listening();
    const streams = [];
    for (let i = 0; i < STREAMS_PER_DEVICE + 1; i++) {
      const s = await openReader(base, "/api/stream/room/r8l/me", anya.cookie);
      expect(await s.next()).toMatchObject({ type: "snapshot" });
      streams.push(s);
    }
    expect(await streams[0]?.next()).toMatchObject({ type: "closed", reason: "replaced" });
    expect(await settle(async () => rooms().loaded("r8l")?.listeners === STREAMS_PER_DEVICE)).toBe(true);
    for (const s of streams) s.controller.abort();
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await call("GET", "/api/rooms/r8l/me", anya.cookie)).statusCode);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    clock += 2000;
    expect((await call("GET", "/api/rooms/r8l/me", anya.cookie)).statusCode).toBe(200);
  });

  it("гость со случайной cookie сеанса — всё равно одно устройство: больше 3 экранов не открыть", async () => {
    await newSession("r8g");
    const anya = await guestIn("r8g", "Аня");
    const base = await listening();
    const readers = [];
    for (let i = 0; i < 6; i++) {
      const r = await openReader(base, "/api/stream/room/r8g/screen", `${anya.cookie}; __Host-jr_s=fake${i}x${Date.now()}`);
      expect(r.status).toBe(200);
      readers.push(r);
    }
    expect(await settle(async () => rooms().loaded("r8g")?.listeners === STREAMS_PER_DEVICE)).toBe(true);
    for (const r of readers) r.controller.abort();
  });

  it("устройство — по cookie, а не uid: у ведущего пульт на другом устройстве не вытесняет экран; опрос — по виду и устройству", async () => {
    await newSession("r8d");
    const base = await listening();
    const laptop = cookieOf(await call("POST", "/api/auth/login", "", { email: "owner@example.com", password: "пароль-владельца-12" }));
    const screen = await openReader(base, "/api/stream/room/r8d/screen", laptop);
    expect(await screen.next()).toMatchObject({ type: "screen" });
    // Пульт на телефоне переподключается пять раз — экран на ноутбуке работает.
    const pults = [];
    for (let i = 0; i < 5; i++) {
      const p = await openReader(base, "/api/stream/room/r8d/host", host);
      expect(await p.next()).toMatchObject({ type: "host" });
      pults.push(p);
    }
    // И три пульта на самом ноутбуке — другой вид, экран не трогают.
    for (let i = 0; i < 3; i++) {
      const p = await openReader(base, "/api/stream/room/r8d/host", laptop);
      expect(await p.next()).toMatchObject({ type: "host" });
      pults.push(p);
    }
    clock += 1000;
    rooms().step(clock);
    expect(await screen.next()).toMatchObject({ type: "screen" });
    expect(rooms().loaded("r8d")?.listeners).toBe(1 + STREAMS_PER_DEVICE * 2);
    // Опрос: пульт телефона упёрся в лимит — экран ноутбука и пульт ноутбука опрашивают.
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await call("GET", "/api/rooms/r8d/host", host)).statusCode);
    expect(codes).toContain(429);
    expect((await call("GET", "/api/rooms/r8d/host", laptop)).statusCode).toBe(200);
    expect((await call("GET", "/api/rooms/r8d/screen", host)).statusCode).toBe(200);
    for (const p of [screen, ...pults]) p.controller.abort();
  });

  it("потоков у комнаты больше предела — 429 до ответа; ведущему — свой запас; своё повисшее место — и при полной комнате", async () => {
    let own: RoomManager | null = null;
    const small = make((m) => (own = m), true, { streamsPerRoom: 3 });
    await newSession("r8f", "room-check", small);
    const anya = await guestIn("r8f", "Аня", small);
    const boris = await guestIn("r8f", "Боря", small);
    const base = await listening(small);
    const a = [];
    for (let i = 0; i < 3; i++) {
      const r = await openReader(base, "/api/stream/room/r8f/me", anya.cookie);
      expect(r.status).toBe(200);
      a.push(r);
    }
    // Комната полна (3): чужой — 429, ведущий — проходит в свой запас.
    expect((await openReader(base, "/api/stream/room/r8f/me", boris.cookie)).status).toBe(429);
    const pult = await openReader(base, "/api/stream/room/r8f/host", host);
    expect(pult.status).toBe(200);
    // Аня переподключается в четвёртый раз (один поток повис) — проходит, старый получает «replaced».
    const again = await openReader(base, "/api/stream/room/r8f/me", anya.cookie);
    expect(again.status).toBe(200);
    expect(await a[0]?.next()).toMatchObject({ type: "snapshot" });
    expect(await a[0]?.next()).toMatchObject({ type: "closed", reason: "replaced" });
    expect((own as RoomManager | null)?.loaded("r8f")?.listeners).toBe(4);
    for (const r of [...a, pult, again]) r.controller.abort();
    await small.close();
  });

  it("играющий в комнате — «на связи» и для «Вы уже играли?»: новый телефон за него не войдёт; замолчал — войдёт", async () => {
    await newSession("r9s");
    const vera = await guestIn("r9s", "Вера");
    const fresh = await device();
    const seenAt = async () => (await sql<{ at: Date | null }[]>`select seen_at as at from participants where session_id = 'r9s' and id = ${vera.uid}`)[0]?.at?.getTime() ?? 0;
    for (let t = 0; t < 6; t++) {
      clock += 30_000;
      await input("r9s", vera.cookie, [{ t: "tap", n: 1 }]);
      rooms().step(clock);
      // Запись `seen_at` идёт фоном: ждём её по базе, а не по часам.
      if (t > 0) expect(await settle(async () => (await seenAt()) === clock)).toBe(true);
    }
    const offline = (await call("GET", "/api/sessions/r9s/offline", fresh.cookie)).json() as Array<{ pid: string }>;
    expect(offline.map((p) => p.pid)).not.toContain(vera.uid);
    expect((await call("POST", `/api/sessions/r9s/participants/${vera.uid}/claim`, fresh.cookie)).statusCode).toBe(409);
    // Вера замолчала: комната перестаёт отмечать её, через 75 с медленный путь считает её не на связи.
    for (let t = 0; t < 4; t++) {
      clock += 30_000;
      rooms().step(clock);
    }
    expect(await seenAt()).toBe(clock - 120_000);
    const later = (await call("GET", "/api/sessions/r9s/offline", fresh.cookie)).json() as Array<{ pid: string }>;
    expect(later.map((p) => p.pid)).toContain(vera.uid);
  });

  it("«Вы уже играли?» при выгруженной комнате: прежний телефон сразу больше не принимается (кэш входа сброшен)", async () => {
    await newSession("r9u");
    const vera = await guestIn("r9u", "Вера");
    expect((await input("r9u", vera.cookie)).statusCode).toBe(200);
    await rooms().unload("r9u", "unloaded");
    clock += 120_000;
    const fresh = await device();
    expect((await call("POST", `/api/sessions/r9u/participants/${vera.uid}/claim`, fresh.cookie)).statusCode).toBe(200);
    expect((await input("r9u", vera.cookie)).statusCode).toBe(401);
  });

  it("пауза и продолжение с пульта по HTTP: касания на паузе не считаются, после — считаются", async () => {
    await newSession("r9");
    const anya = await guestIn("r9", "Аня");
    expect((await call("POST", "/api/rooms/r9/command", host, { cmd: "pause", id: "p1" })).json()).toMatchObject({ ok: true, result: null });
    expect((await call("GET", "/api/rooms/r9/host", host)).json()).toMatchObject({ paused: true });
    expect((await input("r9", anya.cookie, [{ t: "tap", n: 5 }])).json()).toMatchObject({ paused: true });
    expect((await call("GET", "/api/rooms/r9/screen", anya.cookie)).json()).toMatchObject({ paused: true, data: { total: 0 } });
    expect((await call("POST", "/api/rooms/r9/command", host, { cmd: "resume", id: "p2" })).statusCode).toBe(200);
    clock += 1100;
    expect((await input("r9", anya.cookie, [{ t: "tap", n: 5 }])).json()).toMatchObject({ paused: false });
    expect((await call("GET", "/api/rooms/r9/me", anya.cookie)).json()).toMatchObject({ paused: false, data: { taps: 5 } });
  });

  it("убрали гостя с пульта: его поток закрыт («removed»), пачки — 403; «Вы уже играли?» — поток прежнего телефона закрыт", async () => {
    await newSession("r9r");
    const anya = await guestIn("r9r", "Аня");
    const vera = await guestIn("r9r", "Вера");
    const base = await listening();
    const anyaMe = await openReader(base, "/api/stream/room/r9r/me", anya.cookie);
    expect(await anyaMe.next()).toMatchObject({ type: "snapshot" });
    await input("r9r", anya.cookie);
    expect((await call("DELETE", `/api/sessions/r9r/participants/${anya.uid}`, host)).statusCode).toBe(200);
    expect(await anyaMe.next()).toMatchObject({ type: "closed", reason: "removed" });
    expect((await input("r9r", anya.cookie)).statusCode).toBe(403);
    // Вера ушла со связи; новый телефон входит за неё.
    const veraMe = await openReader(base, "/api/stream/room/r9r/me", vera.cookie);
    expect(await veraMe.next()).toMatchObject({ type: "snapshot" });
    await input("r9r", vera.cookie);
    clock += 120_000;
    const fresh = await device();
    const claim = await call("POST", `/api/sessions/r9r/participants/${vera.uid}/claim`, fresh.cookie);
    expect(claim.statusCode, claim.body).toBe(200);
    expect(await veraMe.next()).toMatchObject({ type: "closed", reason: "removed" });
    // Прежний телефон больше не Вера: кэш входа сброшен — пачка проверяется заново и не проходит.
    expect((await input("r9r", vera.cookie)).statusCode).toBe(401);
    expect((await input("r9r", cookieOf(claim))).statusCode).toBe(200);
  });

  it("события сессии: смена блока вечера — выгрузка; та же — остаётся; завершение — выгрузка; два запроса сразу — одна комната", async () => {
    await newSession("r10");
    const anya = await guestIn("r10", "Аня");
    const hub = new Hub();
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as FastifyBaseLogger;
    const own = new RoomManager(sql, hub, log, { now: () => clock, loopMs: 0, check: true });
    const [a, b] = await Promise.all([own.get("r10"), own.get("r10")]);
    expect(typeof a).toBe("object");
    expect(a).toBe(b);
    const room = own.loaded("r10");
    expect(room?.has(anya.uid)).toBe(true);
    hub.publish("participants:r10", { type: "remove", id: anya.uid });
    expect(room?.has(anya.uid)).toBe(false);
    hub.publish("participants:r10", { type: "upsert", participant: { id: anya.uid, name: "Аня", kind: "player", teamId: null } });
    expect(room?.has(anya.uid)).toBe(true);
    hub.publish("session:r10", { type: "snapshot", session: { mechanic: "room-check", program: null, state: { phase: "playing" } } });
    expect(own.loaded("r10")).toBe(room);
    expect(room?.phase).toBe("playing");
    hub.publish("session:r10", { type: "snapshot", session: { mechanic: "room-check", program: { title: "В", blocks: [{ title: "a", mechanic: "room-check" }, { title: "b", mechanic: "room-check" }], index: 1, at: "block" }, state: { phase: "playing" } } });
    expect(own.loaded("r10")).toBeNull();
    await own.get("r10");
    expect(own.loaded("r10")).not.toBeNull();
    hub.publish("session:r10", { type: "patch", version: 9, state: { phase: "finished" }, leaderboard: {} });
    expect(own.loaded("r10")).toBeNull();
    await own.close();
  });

  it("сессию удалили, пока комната в памяти: снимок не пишется (внешний ключ) — комната выгружается", async () => {
    await newSession("r11");
    const anya = await guestIn("r11", "Аня");
    await input("r11", anya.cookie, [{ t: "tap", n: 1 }]);
    await sql`delete from participants where session_id = 'r11'`;
    await sql`delete from room_snapshots where session_id = 'r11'`;
    await sql`delete from sessions where id = 'r11'`;
    await call("POST", "/api/rooms/r11/command", host, { cmd: "checkpoint" });
    rooms().step(clock);
    expect(await settle(async () => rooms().loaded("r11") === null)).toBe(true);
  });

  it("на основной версии проверочной игры нет: сессия room-check — без комнаты (404)", async () => {
    const prod = make(() => undefined, false);
    await newSession("r12", "room-check", prod);
    const anya = await guestIn("r12", "Аня", prod);
    expect((await input("r12", anya.cookie, [], prod)).statusCode).toBe(404);
    await prod.close();
  });

  it("задержка цикла больше 100 мс — в журнал (не чаще раза в минуту) и в сводку пульта", async () => {
    const warns: object[] = [];
    const log = { info: () => undefined, warn: (o: object) => warns.push(o), error: () => undefined } as unknown as FastifyBaseLogger;
    const own = new RoomManager(sql, new Hub(), log, { now: () => clock, loopMs: 0 });
    own.lag(20);
    own.lag(150);
    own.lag(300);
    expect(warns).toEqual([{ roomLoopLagMs: 150, rooms: 0 }]);
    expect(own.loopStats()).toMatchObject({ lagMs: 300, maxLagMs: 300 });
    await own.close();
  });

  it("личный поток: снимок сразу, на «движение» — личное событие; экран — сводка", async () => {
    await newSession("r7");
    const anya = await guestIn("r7", "Аня");
    const base = await listening();
    const me = await openReader(base, "/api/stream/room/r7/me", anya.cookie);
    expect(await me.next()).toMatchObject({ type: "snapshot", paused: false, data: { taps: 0 } });
    const screen = await openReader(base, "/api/stream/room/r7/screen", anya.cookie);
    expect(await screen.next()).toMatchObject({ type: "screen", data: { total: 0 } });
    await input("r7", anya.cookie, [{ t: "move", id: "m1" }, { t: "tap", n: 3 }]);
    expect(await me.next()).toMatchObject({ type: "event", data: { t: "pong", id: "m1" } });
    clock += 300;
    rooms().step(clock);
    expect(await screen.next()).toMatchObject({ type: "screen", data: { total: 3 } });
    me.controller.abort();
    screen.controller.abort();
  });
});
