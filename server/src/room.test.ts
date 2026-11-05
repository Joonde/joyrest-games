import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../src/data/types";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";
import type { FastifyBaseLogger } from "fastify";
import { Hub } from "./live";
import { RoomManager, roomKey } from "./room";
import { roomCheck, type CheckState } from "./rooms/check";
import { MAX_AGO_MS, parseInput, REQUESTS_BURST, Room, seededRandom, SeqWindow, timedEvent, type RoomGame } from "./rooms/engine";

const game = roomCheck as RoomGame<unknown>;

function newRoom(now: number, players = [{ pid: "a", name: "Аня", team: null }, { pid: "b", name: "Боря", team: null }]) {
  return new Room({ id: "s1", key: "room-check", hostId: "h", game, players, teams: [], snapshot: null, playMode: "solo", now });
}

function batch(seq: number, events: object[] = [], stream = "p1") {
  const parsed = parseInput({ stream, seq, events });
  if (!parsed) throw new Error("пачка не разобралась");
  return parsed;
}

const total = (room: Room) => (room.state as CheckState).total;

describe("быстрый канал: комната без базы", () => {
  it("пачка: проверка формы; неверная — null", () => {
    expect(parseInput({ seq: 1, events: [] })).toEqual({ stream: "", seq: 1, events: [] });
    expect(parseInput({ seq: -1, events: [] })).toBeNull();
    expect(parseInput({ seq: 1.5, events: [] })).toBeNull();
    expect(parseInput({ seq: 1, events: [{ t: "Tap" }] })).toBeNull();
    expect(parseInput({ seq: 1, events: [{ t: "tap", ago: -5 }] })).toBeNull();
    expect(parseInput({ seq: 1, stream: "../x", events: [] })).toBeNull();
    expect(parseInput({ seq: 1, events: Array.from({ length: 65 }, () => ({ t: "tap" })) })).toBeNull();
  });

  it("время события — по часам сервера; старше 4 с — не раньше now − 4 с и с пометкой late", () => {
    expect(timedEvent({ t: "hold", ago: 300 }, 10_000)).toEqual({ t: "hold", at: 9700, late: false });
    expect(timedEvent({ t: "hold", ago: 9000, at: 1, late: false }, 10_000)).toEqual({ t: "hold", at: 10_000 - MAX_AGO_MS, late: true });
  });

  it("повтор номера пачки не обрабатывается; пачки не по порядку — обрабатываются; новая страница — новый поток", () => {
    const w = new SeqWindow();
    expect([w.take(5), w.take(5), w.take(3), w.take(4), w.take(3)]).toEqual([true, false, true, true, false]);
    expect(w.take(500)).toBe(true);
    expect(w.take(10)).toBe(false);

    const room = newRoom(1000);
    expect(room.input("a", batch(1, [{ t: "tap", n: 3 }]), 1000)).toMatchObject({ ok: true, dup: false });
    expect(room.input("a", batch(1, [{ t: "tap", n: 3 }]), 1100)).toMatchObject({ ok: true, dup: true });
    expect(total(room)).toBe(3);
    // Перезагрузка страницы: номера с нуля, но поток другой — пачки идут.
    expect(room.input("a", batch(1, [{ t: "tap", n: 2 }], "p2"), 1200)).toMatchObject({ ok: true, dup: false });
    expect(total(room)).toBe(5);
  });

  it("не участник — отказ; касаний за событие не больше 15; лишние события срезаются, запросы — 429", () => {
    const room = newRoom(0);
    expect(room.input("zz", batch(1), 0)).toMatchObject({ ok: false, status: 403 });
    room.input("a", batch(1, [{ t: "tap", n: 999 }]), 0);
    expect(total(room)).toBe(15);
    // Событий — до 30 в секунду с запасом вдвое: 64 в одной пачке — 60 проходят.
    const many = Array.from({ length: 64 }, () => ({ t: "tap", n: 1 }));
    const reply = room.input("b", batch(1, many), 0);
    expect(reply).toMatchObject({ ok: true, dropped: 4 });
    // Запросов: запас REQUESTS_BURST сразу, дальше — 429.
    const replies = Array.from({ length: REQUESTS_BURST + 2 }, (_, i) => room.input("b", batch(10 + i), 0));
    expect(replies.filter((r) => !r.ok).length).toBeGreaterThan(0);
    expect(replies.find((r) => !r.ok)).toMatchObject({ status: 429 });
    // Через секунду — снова можно.
    expect(room.input("b", batch(100), 1000)).toMatchObject({ ok: true });
  });

  it("«без связи» — кто ничего не прислал 3 с; пустая пачка — «я на связи»", () => {
    const room = newRoom(0);
    const host: RoomStreamEvent[] = [];
    room.listen("host", { send: (e) => host.push(e), end: () => undefined }, 0);
    room.input("a", batch(1), 0);
    room.tick(0);
    expect(room.hostEvent(0)).toMatchObject({ players: 2, online: 1, offline: [{ pid: "b", name: "Боря" }] });
    room.tick(2900);
    expect(room.hostEvent(2900)).toMatchObject({ online: 1 });
    room.tick(3100);
    expect(room.hostEvent(3100)).toMatchObject({ online: 0 });
    // Пульту — не чаще раза в секунду: изменение уходит со следующим окном.
    room.tick(4000);
    expect(host.at(-1)).toMatchObject({ type: "host", online: 0 });
  });

  it("сводка экрана — не чаще 5 раз в секунду; личное событие — сразу и только своему телефону", () => {
    const room = newRoom(0);
    const screen: RoomStreamEvent[] = [];
    const meA: RoomStreamEvent[] = [];
    const meB: RoomStreamEvent[] = [];
    room.listen("screen", { send: (e) => screen.push(e), end: () => undefined }, 0);
    room.listen("me", { send: (e) => meA.push(e), end: () => undefined }, 0, "a");
    room.listen("me", { send: (e) => meB.push(e), end: () => undefined }, 0, "b");
    expect(meA[0]).toMatchObject({ type: "snapshot", every: 1000, offlineMs: 3000, data: { taps: 0 } });
    for (let t = 0; t < 1000; t += 10) {
      room.input("a", batch(t + 1, [{ t: "tap", n: 1 }]), t);
      room.tick(t);
    }
    const screens = screen.filter((e) => e.type === "screen").length;
    expect(screens).toBeLessThanOrEqual(6);
    expect(screens).toBeGreaterThanOrEqual(4);
    room.input("a", batch(5000, [{ t: "ping", id: "x1" }]), 1500);
    expect(meA.at(-1)).toEqual({ type: "event", at: 1500, data: { t: "pong", id: "x1", late: false } });
    expect(meB.filter((e) => e.type === "event")).toEqual([]);
  });

  it("пауза: события не идут в игру, пачки — «я на связи»; продолжение — с пульта", () => {
    const room = newRoom(0);
    const me: RoomStreamEvent[] = [];
    room.listen("me", { send: (e) => me.push(e), end: () => undefined }, 0, "a");
    expect(room.command("pause", null, "c1", 0)).toEqual({ ok: true });
    expect(me.at(-1)).toEqual({ type: "room", at: 0, paused: true });
    expect(room.input("a", batch(1, [{ t: "tap", n: 5 }]), 10)).toMatchObject({ ok: true, paused: true });
    expect(total(room)).toBe(0);
    expect(room.command("resume", null, "c2", 20)).toEqual({ ok: true });
    room.input("a", batch(2, [{ t: "tap", n: 5 }]), 30);
    expect(total(room)).toBe(5);
    // Повтор команды по id — прежний итог, без повторного выполнения.
    room.command("reset", null, "c3", 40);
    room.input("a", batch(3, [{ t: "tap", n: 2 }]), 50);
    expect(room.command("reset", null, "c3", 60)).toEqual({ ok: true });
    expect(total(room)).toBe(2);
    expect(room.command("nonsense", null, null, 70)).toEqual({ ok: false, error: "invalid-argument" });
    expect(room.command("BAD!", null, null, 70)).toEqual({ ok: false, error: "invalid-argument" });
  });

  it("снимок: после «перезапуска» комната поднимается на паузе с тем же счётом; другой блок — с чистого листа", () => {
    const room = newRoom(0);
    room.input("a", batch(1, [{ t: "tap", n: 7 }]), 0);
    const data = JSON.parse(JSON.stringify(room.snapshotData()));
    const again = new Room({ id: "s1", key: "room-check", hostId: "h", game, players: [], teams: [], snapshot: null, playMode: "solo", now: 5000, restoreFrom: data });
    expect(again).toMatchObject({ paused: true, restored: true, seed: room.seed });
    expect(total(again)).toBe(7);
    const other = new Room({ id: "s1", key: "room-check#1", hostId: "h", game, players: [], teams: [], snapshot: null, playMode: "solo", now: 5000, restoreFrom: data });
    expect(other).toMatchObject({ paused: false, restored: false });
    expect(total(other)).toBe(0);
  });

  it("состав: новый участник, переименование, команда, ушедший — без перезагрузки комнаты", () => {
    const room = newRoom(0, []);
    expect(room.input("v", batch(1), 0)).toMatchObject({ ok: false, status: 403 });
    room.upsertParticipant({ id: "t1", name: "Лисы", kind: "team", teamId: null }, 0);
    room.upsertParticipant({ id: "v", name: "Вера", kind: "player", teamId: "t1" }, 0);
    expect(room.input("v", batch(1, [{ t: "tap", n: 2 }]), 0)).toMatchObject({ ok: true });
    room.upsertParticipant({ id: "v", name: "Вера К.", kind: "player", teamId: "t1" }, 0);
    expect((room.hostEvent(0) as { data: { top: Array<{ name: string }> } }).data.top[0]?.name).toBe("Вера К.");
    room.removeParticipant("v");
    expect(room.input("v", batch(2), 0)).toMatchObject({ ok: false, status: 403 });
  });

  it("выгрузка: всем потокам «закрыто», потоки закрываются; отписка работает", () => {
    const room = newRoom(0);
    const got: RoomStreamEvent[] = [];
    let ended = 0;
    const listener = { send: (e: RoomStreamEvent) => got.push(e), end: () => (ended += 1) };
    room.listen("screen", listener, 0);
    room.listen("host", listener, 0);
    const off = room.listen("me", listener, 0, "a");
    expect(room.listeners).toBe(3);
    off();
    expect(room.listeners).toBe(2);
    room.close("finished", 10);
    expect(got.filter((e) => e.type === "closed")).toEqual([
      { type: "closed", at: 10, reason: "finished" },
      { type: "closed", at: 10, reason: "finished" },
    ]);
    expect(ended).toBe(2);
    expect(room.listeners).toBe(0);
  });

  it("контрольная точка: команда игры просит снимок вне очереди 10 с", () => {
    const room = newRoom(0);
    expect(room.checkpointWanted).toBe(false);
    room.command("checkpoint", null, null, 0);
    expect(room.checkpointWanted).toBe(true);
    // Пауза и продолжение — тоже контрольные точки.
    room.checkpointWanted = false;
    room.command("pause", null, null, 1);
    expect(room.checkpointWanted).toBe(true);
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
  const make = (onManager: (m: RoomManager) => void) =>
    buildApp({
      version: "t",
      publicDir: null,
      checkDatabase: async () => true,
      sql,
      mediaDir: media,
      auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
      live: { now: () => clock, keepAliveMs: 60_000 },
      rooms: { now: () => clock, loopMs: 0, keepAliveMs: 60_000, onManager },
    });
  const app = make((m) => (manager = m));
  const rooms = () => {
    if (!manager) throw new Error("нет комнат");
    return manager;
  };
  let host = "";
  let address = "";
  /** Потоки читаем настоящим HTTP: приложение слушает один раз на весь набор тестов. */
  async function listening(): Promise<string> {
    address ||= await app.listen({ host: "127.0.0.1", port: 0 });
    return address;
  }

  function cookieOf(res: { headers: Record<string, unknown> }): string {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  }

  const call = (method: "GET" | "POST", path: string, cookie: string, payload?: object, target = app) =>
    target.inject({
      method,
      url: path,
      headers: method === "GET" ? { host: HOST, cookie } : { host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie },
      payload,
    });

  async function device(): Promise<{ cookie: string; uid: string }> {
    const res = await call("POST", "/api/auth/device", "");
    return { cookie: cookieOf(res), uid: res.json().uid };
  }

  async function newSession(id: string, mechanic = "room-check"): Promise<void> {
    const res = await call("POST", "/api/sessions", host, { id, gameTitle: "Проверка", playMode: "solo", screenMode: "laptop", themeId: "joyrest", mechanic, gameSnapshot: { content: {} } });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function guestIn(sessionId: string, name: string) {
    const g = await device();
    expect((await call("POST", `/api/sessions/${sessionId}/participants/${g.uid}/join`, g.cookie, { name, teamId: null })).statusCode).toBe(200);
    return g;
  }

  const input = (sessionId: string, cookie: string, seq: number, events: object[] = []) => call("POST", `/api/rooms/${sessionId}/input`, cookie, { stream: "t1", seq, events });

  async function settle(check: () => Promise<boolean>): Promise<boolean> {
    for (let i = 0; i < 50; i++) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
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
    expect((await input("r1", "", 1)).statusCode).toBe(401);
    expect((await input("r1", stranger.cookie, 1)).statusCode).toBe(403);
    const first = await input("r1", anya.cookie, 1, [{ t: "tap", n: 4 }]);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ at: clock, every: 1000, paused: false, dropped: 0, dup: false });
    expect((await input("r1", anya.cookie, 1, [{ t: "tap", n: 4 }])).json()).toMatchObject({ dup: true });
    expect((await call("POST", "/api/rooms/r1/input", anya.cookie, { seq: "x", events: [] })).statusCode).toBe(400);
    expect((await input("r1", anya.cookie, 2, [{ t: "tap", pad: "x".repeat(5000) }])).statusCode).toBe(413);
    expect((rooms().loaded("r1")?.state as CheckState).total).toBe(4);
    // Без X-JoyRest — отказ, как у остальных изменений.
    const bare = await app.inject({ method: "POST", url: "/api/rooms/r1/input", headers: { host: HOST, cookie: anya.cookie }, payload: { seq: 9, events: [] } });
    expect(bare.statusCode).toBe(403);
  });

  it("гость, вошедший после создания комнаты, сразу шлёт пачки (событие участников)", async () => {
    await newSession("r2");
    const anya = await guestIn("r2", "Аня");
    await input("r2", anya.cookie, 1);
    const late = await guestIn("r2", "Вера");
    expect(rooms().loaded("r2")?.has(late.uid)).toBe(true);
    expect((await input("r2", late.cookie, 1, [{ t: "tap", n: 2 }])).statusCode).toBe(200);
  });

  it("команды — только ведущий сессии; сессия без комнатной игры — 404; завершённая — 409 и комната выгружена", async () => {
    await newSession("r3");
    const anya = await guestIn("r3", "Аня");
    expect((await call("POST", "/api/rooms/r3/command", anya.cookie, { cmd: "reset" })).statusCode).toBe(403);
    const echo = await call("POST", "/api/rooms/r3/command", host, { cmd: "echo", args: { x: 1 }, id: "e1" });
    expect(echo.json()).toEqual({ ok: true, result: { x: 1 } });
    // Повтор команды с тем же id (обрыв связи) — прежний итог, второй раз не выполняется.
    expect((await call("POST", "/api/rooms/r3/command", host, { cmd: "echo", args: { x: 2 }, id: "e1" })).json()).toEqual({ ok: true, result: { x: 1 } });
    expect((await call("POST", "/api/rooms/r3/command", host, { cmd: "nope" })).statusCode).toBe(400);
    expect((await call("POST", "/api/rooms/r3/command", host, { cmd: "pause", id: "../x" })).statusCode).toBe(400);
    expect((await call("GET", "/api/rooms/r3/host", anya.cookie)).statusCode).toBe(403);
    expect((await call("GET", "/api/rooms/r3/host", host)).json()).toMatchObject({ type: "host", players: 1, paused: false });
    expect((await call("GET", "/api/rooms/r3/screen", anya.cookie)).json()).toMatchObject({ type: "screen", data: { total: 0 } });
    expect((await call("GET", "/api/rooms/r3/me", anya.cookie)).json()).toMatchObject({ type: "snapshot", data: { taps: 0 } });

    await newSession("q1", "quiz");
    const guest = await guestIn("q1", "Аня");
    expect((await input("q1", guest.cookie, 1)).statusCode).toBe(404);
    expect((await input("nosuch", guest.cookie, 1)).statusCode).toBe(404);

    expect(rooms().loaded("r3")).not.toBeNull();
    expect((await call("POST", "/api/sessions/r3/finish", host, { participantsCount: 1 })).statusCode).toBe(200);
    expect(rooms().loaded("r3")).toBeNull();
    const after = await input("r3", anya.cookie, 5);
    expect(after.statusCode).toBe(409);
    expect(after.json()).toEqual({ error: "failed-precondition", reason: "finished" });
  });

  it("пока в комнате активность — раз в минуту обновляется sessions.updated_at (выкладка ждёт конца игры)", async () => {
    await newSession("r4");
    const anya = await guestIn("r4", "Аня");
    await sql`update sessions set updated_at = now() - interval '2 hours' where id = 'r4'`;
    const stale = async () => (await sql<{ stale: boolean }[]>`select updated_at < now() - interval '30 minutes' as stale from sessions where id = 'r4'`)[0]?.stale;
    expect(await stale()).toBe(true);
    await input("r4", anya.cookie, 1);
    rooms().step(clock);
    expect(await settle(async () => (await stale()) === false)).toBe(true);
    // Та же проверка, что у `joyrest deploy`: есть активная игра.
    const [active] = await sql<{ n: number }[]>`
      select count(*)::int as n from sessions s where s.id = 'r4' and s.phase in ('lobby', 'playing') and s.updated_at > now() - interval '30 minutes'`;
    expect(active?.n).toBe(1);
    // Без активности больше не трогаем: через минуту без пачек — не обновляем.
    await sql`update sessions set updated_at = now() - interval '2 hours' where id = 'r4'`;
    clock += 61_000;
    rooms().step(clock);
    await new Promise((r) => setTimeout(r, 100));
    expect(await stale()).toBe(true);
  });

  it("снимок на контрольной точке и раз в 10 с; после перезапуска — та же комната на паузе", async () => {
    await newSession("r5");
    const anya = await guestIn("r5", "Аня");
    await input("r5", anya.cookie, 1, [{ t: "tap", n: 9 }]);
    const saved = async () => (await sql<{ data: { state: { total: number } } }[]>`select data from room_snapshots where session_id = 'r5'`)[0]?.data.state.total;
    // Раз в 10 с, если менялось.
    clock += 11_000;
    rooms().step(clock);
    expect(await settle(async () => (await saved()) === 9)).toBe(true);
    // Контрольная точка — сразу.
    await input("r5", anya.cookie, 2, [{ t: "tap", n: 1 }]);
    await call("POST", "/api/rooms/r5/command", host, { cmd: "checkpoint" });
    rooms().step(clock);
    expect(await settle(async () => (await saved()) === 10)).toBe(true);

    // «Перезапуск»: новое приложение на той же базе.
    let second: RoomManager | null = null;
    const restarted = make((m) => (second = m));
    const view = await call("GET", "/api/rooms/r5/host", host, undefined, restarted);
    expect(view.json()).toMatchObject({ type: "host", paused: true, restored: true, data: { total: 10 } });
    // На паузе касания не считаются; ведущий продолжает.
    await call("POST", "/api/rooms/r5/input", anya.cookie, { stream: "t2", seq: 1, events: [{ t: "tap", n: 3 }] }, restarted);
    expect(((second as RoomManager | null)?.loaded("r5")?.state as CheckState).total).toBe(10);
    expect((await call("POST", "/api/rooms/r5/command", host, { cmd: "resume" }, restarted)).statusCode).toBe(200);
    await call("POST", "/api/rooms/r5/input", anya.cookie, { stream: "t2", seq: 2, events: [{ t: "tap", n: 3 }] }, restarted);
    expect(((second as RoomManager | null)?.loaded("r5")?.state as CheckState).total).toBe(13);
    // Остановка приложения — снимок всех комнат.
    await restarted.close();
    expect(await saved()).toBe(13);
  });

  it("15 минут без пачек и команд — комната выгружается со снимком; следующая пачка поднимает её на паузе", async () => {
    await newSession("r6");
    const anya = await guestIn("r6", "Аня");
    await input("r6", anya.cookie, 1, [{ t: "tap", n: 2 }]);
    rooms().step(clock + 14 * 60_000);
    expect(rooms().loaded("r6")).not.toBeNull();
    rooms().step(clock + 15 * 60_000);
    expect(rooms().loaded("r6")).toBeNull();
    expect(
      await settle(async () => ((await sql<{ data: { state: { total: number } } }[]>`select data from room_snapshots where session_id = 'r6'`)[0]?.data.state.total ?? -1) === 2),
    ).toBe(true);
    expect((await input("r6", anya.cookie, 2)).json()).toMatchObject({ paused: true });
  });

  it("переподключение: новый поток сразу получает свежий снимок; выгрузка закрывает поток событием «closed»", async () => {
    await newSession("r8");
    const anya = await guestIn("r8", "Аня");
    const address = await listening();
    const open = async () => {
      const controller = new AbortController();
      const res = await fetch(`${address}/api/stream/room/r8/me`, { headers: { cookie: anya.cookie }, signal: controller.signal });
      const r = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const next = async (): Promise<RoomStreamEvent | null> => {
        for (;;) {
          const end = buffer.indexOf("\n\n");
          if (end >= 0) {
            const chunk = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (data) return JSON.parse(data.slice(6)) as RoomStreamEvent;
            continue;
          }
          const { value, done } = await r.read();
          if (done) return null;
          buffer += decoder.decode(value, { stream: true });
        }
      };
      return { next, controller };
    };
    const first = await open();
    expect(await first.next()).toMatchObject({ type: "snapshot", data: { taps: 0 } });
    first.controller.abort();
    await input("r8", anya.cookie, 1, [{ t: "tap", n: 6 }]);
    const second = await open();
    expect(await second.next()).toMatchObject({ type: "snapshot", data: { taps: 6, total: 6 } });
    // Выгрузка (15 минут без пачек): «closed», поток закрыт — браузер переподключится к новой комнате.
    rooms().step(clock + 16 * 60_000);
    expect(await second.next()).toMatchObject({ type: "closed", reason: "unloaded" });
    expect(await second.next()).toBeNull();
    const third = await open();
    expect(await third.next()).toMatchObject({ type: "snapshot", paused: true, data: { taps: 6 } });
    third.controller.abort();
  });

  it("пауза и продолжение с пульта по HTTP: касания на паузе не считаются, после — считаются", async () => {
    await newSession("r9");
    const anya = await guestIn("r9", "Аня");
    expect((await call("POST", "/api/rooms/r9/command", host, { cmd: "pause", id: "p1" })).json()).toEqual({ ok: true, result: null });
    expect((await call("GET", "/api/rooms/r9/host", host)).json()).toMatchObject({ paused: true });
    expect((await input("r9", anya.cookie, 1, [{ t: "tap", n: 5 }])).json()).toMatchObject({ paused: true });
    expect((await call("GET", "/api/rooms/r9/screen", anya.cookie)).json()).toMatchObject({ paused: true, data: { total: 0 } });
    expect((await call("POST", "/api/rooms/r9/command", host, { cmd: "resume", id: "p2" })).statusCode).toBe(200);
    expect((await input("r9", anya.cookie, 2, [{ t: "tap", n: 5 }])).json()).toMatchObject({ paused: false });
    expect((await call("GET", "/api/rooms/r9/me", anya.cookie)).json()).toMatchObject({ paused: false, data: { taps: 5 } });
  });

  it("события сессии: смена механики или блока вечера — комната выгружается; участник ушёл — пачки не принимаются", async () => {
    await newSession("r10");
    const anya = await guestIn("r10", "Аня");
    const hub = new Hub();
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as FastifyBaseLogger;
    const own = new RoomManager(sql, hub, log, { now: () => clock, loopMs: 0 });
    const loaded = await own.get("r10");
    expect(typeof loaded).toBe("object");
    const room = own.loaded("r10");
    expect(room?.has(anya.uid)).toBe(true);
    hub.publish("participants:r10", { type: "remove", id: anya.uid });
    expect(room?.has(anya.uid)).toBe(false);
    hub.publish("participants:r10", { type: "upsert", participant: { id: anya.uid, name: "Аня", kind: "player", teamId: null } });
    expect(room?.has(anya.uid)).toBe(true);
    // Тот же блок — комната остаётся.
    hub.publish("session:r10", { type: "snapshot", session: { mechanic: "room-check", program: null, state: { phase: "playing" } } });
    expect(own.loaded("r10")).toBe(room);
    // Другой блок вечера (та же механика подряд — с чистого листа) — выгрузка.
    hub.publish("session:r10", { type: "snapshot", session: { mechanic: "room-check", program: { title: "В", blocks: [{ title: "a", mechanic: "room-check" }, { title: "b", mechanic: "room-check" }], index: 1, at: "block" }, state: { phase: "playing" } } });
    expect(own.loaded("r10")).toBeNull();
    // Снова загружается; завершение (patch) — выгрузка.
    await own.get("r10");
    expect(own.loaded("r10")).not.toBeNull();
    hub.publish("session:r10", { type: "patch", version: 9, state: { phase: "finished" }, leaderboard: {} });
    expect(own.loaded("r10")).toBeNull();
    await own.close();
  });

  it("задержка цикла больше 100 мс — в журнал (не чаще раза в минуту) и в сводку пульта", async () => {
    const warns: object[] = [];
    const log = { info: () => undefined, warn: (o: object) => warns.push(o), error: () => undefined } as unknown as FastifyBaseLogger;
    const own = new RoomManager(sql, new Hub(), log, { now: () => clock, loopMs: 0 });
    own.lag(20);
    own.lag(150);
    own.lag(300);
    expect(warns).toEqual([{ roomLoopLagMs: 150, rooms: 0 }]);
    expect(own.loopStats()).toEqual({ lagMs: 300, maxLagMs: 300 });
    await own.close();
  });

  it("личный поток: снимок сразу, на «движение» — личное событие; экран — сводка", async () => {
    await newSession("r7");
    const anya = await guestIn("r7", "Аня");
    const address = await listening();
    const controller = new AbortController();
    async function reader(path: string) {
      const res = await fetch(`${address}${path}`, { headers: { cookie: anya.cookie }, signal: controller.signal });
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const r = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      return async function next(): Promise<RoomStreamEvent> {
        for (;;) {
          const end = buffer.indexOf("\n\n");
          if (end >= 0) {
            const chunk = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (data) return JSON.parse(data.slice(6)) as RoomStreamEvent;
            continue;
          }
          const { value, done } = await r.read();
          if (done) throw new Error("поток закрыт");
          buffer += decoder.decode(value, { stream: true });
        }
      };
    }
    const me = await reader("/api/stream/room/r7/me");
    expect(await me()).toMatchObject({ type: "snapshot", paused: false, data: { taps: 0 } });
    const screen = await reader("/api/stream/room/r7/screen");
    expect(await screen()).toMatchObject({ type: "screen", data: { total: 0 } });
    await input("r7", anya.cookie, 1, [{ t: "move", id: "m1" }, { t: "tap", n: 3 }]);
    expect(await me()).toMatchObject({ type: "event", data: { t: "pong", id: "m1" } });
    clock += 300;
    rooms().step(clock);
    expect(await screen()).toMatchObject({ type: "screen", data: { total: 3 } });
    controller.abort();
  });
});
