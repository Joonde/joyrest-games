import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { availabilityOf } from "../../src/core/calendar";
import type { AvailabilityEntry } from "../../src/data/types";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { rangeOf } from "./calendar";
import { migrate } from "./migrate";

describe("календарь: без базы", () => {
  it("окно запроса — до 62 дней, с прошлым днём (вечер за полночь)", () => {
    expect(rangeOf({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ from: "2026-09-30", to: "2026-10-31" });
    expect(rangeOf({ from: "2026-10-31", to: "2026-10-01" })).toBeNull();
    expect(rangeOf({ from: "2026-01-01", to: "2026-12-31" })).toBeNull();
    expect(rangeOf({ from: "вчера", to: "2026-10-01" })).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("календарь на PostgreSQL", () => {
  const SCHEMA = "calendar_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
  });
  let owner = "";
  let anna = "";
  let annaId = "";
  let boris = "";
  let borisId = "";
  // Даты — относительно сегодняшнего дня, чтобы тест не устарел.
  const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const next = new Date(Date.now() + 11 * 86_400_000).toISOString().slice(0, 10);

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const del = (path: string, cookie: string) => app.inject({ method: "DELETE", url: path, headers: headers(cookie) });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));
  const team = async () => (await get(`/api/calendar/team?from=${day}&to=${next}`, owner)).json() as { members: Array<{ uid: string; name: string }>; entries: AvailabilityEntry[] };

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    const a = (await post("/api/users", owner, { email: "anna@example.com", name: "Анна" })).json();
    annaId = a.account.uid;
    anna = await login("anna@example.com", a.temporaryPassword);
    const b = (await post("/api/users", owner, { email: "boris@example.com", name: "Борис" })).json();
    borisId = b.account.uid;
    boris = await login("boris@example.com", b.temporaryPassword);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("ведущий отмечает свободное и занятое время; повтор с тем же id — правка, не дубль", async () => {
    expect((await post("/api/calendar", anna, { id: "a1", day, start: 0, end: 1440, kind: "free" })).statusCode).toBe(200);
    expect((await post("/api/calendar", anna, { id: "a2", day, start: 600, end: 720, kind: "busy", note: "своё" })).statusCode).toBe(200);
    expect((await post("/api/calendar", anna, { id: "a2", day, start: 600, end: 780, kind: "busy", note: "своё" })).statusCode).toBe(200);
    const mine = (await get(`/api/calendar?from=${day}&to=${day}`, anna)).json().entries as AvailabilityEntry[];
    expect(mine).toHaveLength(2);
    expect(mine.find((e) => e.id === "a2")).toMatchObject({ day, start: 600, end: 780, kind: "busy", note: "своё" });
    // Борис отметил вечер до 02:00.
    expect((await post("/api/calendar", boris, { id: "b1", day, start: 1200, end: 1560, kind: "free" })).statusCode).toBe(200);
  });

  it("неверное время, вид и чужие записи — отказ", async () => {
    expect((await post("/api/calendar", anna, { id: "x1", day, start: 1200, end: 1100, kind: "free" })).statusCode).toBe(400);
    expect((await post("/api/calendar", anna, { id: "x2", day, start: 1210, end: 1300, kind: "free" })).statusCode).toBe(400);
    expect((await post("/api/calendar", anna, { id: "x3", day, start: 600, end: 700 + 1200, kind: "free" })).statusCode).toBe(400);
    expect((await post("/api/calendar", anna, { id: "x4", day, start: 600, end: 720, kind: "booked" })).statusCode).toBe(400);
    expect((await post("/api/calendar", anna, { id: "x5", day: "2020-01-01", start: 600, end: 720, kind: "free" })).statusCode).toBe(400);
    // Чужую запись не переписать и не удалить.
    expect((await post("/api/calendar", anna, { id: "b1", day, start: 600, end: 720, kind: "busy" })).statusCode).toBe(403);
    expect((await del("/api/calendar/b1", anna)).statusCode).toBe(403);
    // Календарь команды — только владелец; гость без входа — 401.
    expect((await get(`/api/calendar/team?from=${day}&to=${day}`, anna)).statusCode).toBe(403);
    expect((await get(`/api/calendar?from=${day}&to=${day}`, "")).statusCode).toBe(401);
    expect((await post("/api/calendar/book", anna, { id: "bk0", uid: borisId, day, start: 1140, end: 1380 })).statusCode).toBe(403);
  });

  it("владелец видит, кто может; закреплённое мероприятие занимает время и снимается только владельцем", async () => {
    let data = await team();
    expect(data.members.map((m) => m.name)).toEqual(expect.arrayContaining(["Анна", "Борис"]));
    const of = (uid: string) => data.entries.filter((e) => e.uid === uid);
    expect(availabilityOf(of(annaId), day, 1140, 1380).status).toBe("free");
    expect(availabilityOf(of(annaId), day, 660, 720).status).toBe("busy");
    expect(availabilityOf(of(borisId), day, 1140, 1380).status).toBe("partial");
    // Ночью следующего дня Борис ещё свободен (до 02:00).
    expect(availabilityOf(of(borisId), next, 0, 120).status).toBe("free");

    expect((await post("/api/calendar/book", owner, { id: "bk1", uid: annaId, day, start: 1140, end: 1380, note: "Корпоратив, 40 гостей" })).statusCode).toBe(200);
    data = await team();
    expect(availabilityOf(of(annaId), day, 1140, 1380).status).toBe("busy");
    // Ведущий видит мероприятие у себя, но снять и переписать его не может.
    const mine = (await get(`/api/calendar?from=${day}&to=${day}`, anna)).json().entries as AvailabilityEntry[];
    expect(mine.find((e) => e.id === "bk1")).toMatchObject({ kind: "booked", note: "Корпоратив, 40 гостей" });
    expect((await del("/api/calendar/bk1", anna)).statusCode).toBe(403);
    expect((await post("/api/calendar", anna, { id: "bk1", day, start: 1140, end: 1380, kind: "free" })).statusCode).toBe(403);
    // Тот же id за другим человеком — отказ.
    expect((await post("/api/calendar/book", owner, { id: "bk1", uid: borisId, day, start: 1140, end: 1380 })).statusCode).toBe(409);
    expect((await del("/api/calendar/bk1", owner)).statusCode).toBe(200);
    // Повтор удаления — успех.
    expect((await del("/api/calendar/bk1", owner)).statusCode).toBe(200);
    expect((await del("/api/calendar/a2", anna)).statusCode).toBe(200);
  });

  it("планировщик: мероприятие занимает время ведущего, ведущий видит только свои, отмена и возврат", async () => {
    const event = { id: "ev1", hostId: annaId, day, start: 1140, end: 1380, title: "Свадьба", clientName: "Ольга", clientPhone: "+7 999 000-00-00", place: "Лофт", guests: 60, note: "" };
    expect((await post("/api/events", anna, event)).statusCode).toBe(403);
    expect((await post("/api/events", owner, { ...event, title: "", clientName: "" })).statusCode).toBe(400);
    const saved = await post("/api/events", owner, event);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ id: "ev1", hostName: "Анна", clientName: "Ольга", cancelled: false });
    // Повтор с тем же id — правка, не дубль.
    expect((await post("/api/events", owner, { ...event, guests: 70 })).json()).toMatchObject({ guests: 70 });
    let data = await team();
    const of = (uid: string) => data.entries.filter((e) => e.uid === uid);
    expect(availabilityOf(of(annaId), day, 1140, 1380).status).toBe("busy");
    // В календаре ведущего — без имени и телефона клиента.
    const booked = data.entries.find((e) => e.id === "ev-ev1");
    expect(booked).toMatchObject({ kind: "booked", note: "Свадьба, 70 гостей" });
    // Ведущий видит своё мероприятие (за период и в «Предстоящих»), Борис — нет.
    const annaRange = (await get(`/api/events?from=${day}&to=${day}`, anna)).json().events as Array<{ id: string }>;
    expect(annaRange.map((e) => e.id)).toEqual(["ev1"]);
    expect(((await get("/api/events?scope=upcoming", anna)).json().events as Array<{ id: string }>).map((e) => e.id)).toEqual(["ev1"]);
    expect((await get(`/api/events?from=${day}&to=${day}`, boris)).json().events).toEqual([]);
    expect((await post("/api/events/ev1/cancel", anna)).statusCode).toBe(403);
    // Отмена: время освобождается, мероприятие — в «Отменённых».
    expect((await post("/api/events/ev1/cancel", owner)).json()).toMatchObject({ cancelled: true });
    expect((await post("/api/events/ev1/cancel", owner)).statusCode).toBe(200);
    data = await team();
    expect(data.entries.some((e) => e.id === "ev-ev1")).toBe(false);
    expect(((await get("/api/events?scope=cancelled", owner)).json().events as Array<{ id: string }>).map((e) => e.id)).toContain("ev1");
    expect(((await get("/api/events?scope=upcoming", owner)).json().events as Array<{ id: string }>).map((e) => e.id)).not.toContain("ev1");
    // Отменённое не правится, только возвращается.
    expect((await post("/api/events", owner, event)).statusCode).toBe(409);
    expect((await post("/api/events/ev1/restore", owner)).json()).toMatchObject({ cancelled: false });
    data = await team();
    expect(data.entries.some((e) => e.id === "ev-ev1")).toBe(true);
    // «Снять мероприятие» в «Кто может» — отменяет его.
    expect((await del("/api/calendar/ev-ev1", owner)).statusCode).toBe(200);
    expect((await get(`/api/events?from=${day}&to=${day}`, owner)).json().events[0]).toMatchObject({ id: "ev1", cancelled: true });
    // Перенос на другого ведущего: запись календаря переезжает.
    await post("/api/events/ev1/restore", owner);
    await post("/api/events", owner, { ...event, hostId: borisId });
    data = await team();
    expect(data.entries.find((e) => e.id === "ev-ev1")?.uid).toBe(borisId);
    // Удалить навсегда — только отменённое.
    expect((await del("/api/events/ev1", owner)).statusCode).toBe(409);
    await post("/api/events/ev1/cancel", owner);
    expect((await del("/api/events/ev1", anna)).statusCode).toBe(403);
    expect((await del("/api/events/ev1", owner)).statusCode).toBe(200);
    expect((await get("/api/events?scope=cancelled", owner)).json().events).toEqual([]);
  });

  it("«Добавить в мой календарь»: файл .ics и подписка без клиента; чужое — нет; новая ссылка отключает старую", async () => {
    const event = { id: "ics1", hostId: annaId, day, start: 1080, end: 1380, clientName: "Иван Секретов", clientPhone: "+79005554433", title: "Свадьба", place: "ул. Тайная 7", guests: 60, note: "" };
    expect((await post("/api/events", owner, event)).statusCode).toBe(200);
    const file = await get("/api/events/ics1/ics", anna);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("text/calendar");
    expect(file.headers["content-disposition"]).toContain(`joyrest-${day}.ics`);
    const text = file.body.replace(/\r\n /g, "");
    expect(text).toContain("SUMMARY:JoyRest: Свадьба · 60 гостей");
    expect(text).toContain("TRIGGER:-PT2H");
    expect(text).not.toMatch(/Иван|5554433|Тайная/);
    expect((await get("/api/events/ics1/ics", boris)).statusCode).toBe(404);
    expect((await get("/api/events/ics1/ics", "")).statusCode).toBe(401);

    const feed = (await get("/api/calendar/feed", anna)).json().url as string;
    expect(feed).toMatch(/^https:\/\/games\.test\/api\/calendar\/feed\/[A-Za-z0-9_-]{20,}\.ics$/);
    expect((await get("/api/calendar/feed", anna)).json().url).toBe(feed);
    const path = feed.replace("https://games.test", "");
    const sub = await get(path, "");
    const body = (r: { body: string }) => r.body.replace(/\r\n /g, "");
    expect(sub.statusCode).toBe(200);
    expect(body(sub)).toContain("X-WR-CALNAME:JoyRest — мои мероприятия");
    expect(body(sub)).toContain("UID:ics1@joy-rest.ru");
    expect(body(sub)).not.toMatch(/Иван|5554433|Тайная/);
    // У Бориса в подписке чужого мероприятия нет; у владельца — все, с ведущим.
    const borisFeed = (await get("/api/calendar/feed", boris)).json().url as string;
    expect(body(await get(borisFeed.replace("https://games.test", ""), ""))).not.toContain("UID:ics1@");
    const ownerFeed = (await get("/api/calendar/feed", owner)).json().url as string;
    expect(body(await get(ownerFeed.replace("https://games.test", ""), ""))).toContain("ведёт Анна");
    // Отменили — из подписки пропало.
    await post("/api/events/ics1/cancel", owner);
    expect(body(await get(path, ""))).not.toContain("UID:ics1@");
    await post("/api/events/ics1/restore", owner);
    // «Сменить ссылку»: старая — 404, новая работает.
    const fresh = (await post("/api/calendar/feed/reset", anna)).json().url as string;
    expect(fresh).not.toBe(feed);
    expect((await get(path, "")).statusCode).toBe(404);
    expect(body(await get(fresh.replace("https://games.test", ""), ""))).toContain("UID:ics1@");
    expect((await get("/api/calendar/feed/short.ics", "")).statusCode).toBe(404);
    await post("/api/events/ics1/cancel", owner);
    await del("/api/events/ics1", owner);
  });

  it("отключённого человека нет в календаре команды, и за ним не закрепить время", async () => {
    await post(`/api/users/${borisId}/active`, owner, { active: false });
    const data = await team();
    expect(data.members.some((m) => m.uid === borisId)).toBe(false);
    expect(data.entries.some((e) => e.uid === borisId)).toBe(false);
    expect((await post("/api/calendar/book", owner, { id: "bk2", uid: borisId, day, start: 1140, end: 1380 })).statusCode).toBe(404);
  });

  it("в один день — не больше 12 записей", async () => {
    for (let i = 0; i < 11; i++) {
      expect((await post("/api/calendar", anna, { id: `m${i}`, day: next, start: i * 60, end: i * 60 + 30, kind: "free" })).statusCode).toBe(200);
    }
    expect((await post("/api/calendar", anna, { id: "m11", day: next, start: 1320, end: 1350, kind: "free" })).statusCode).toBe(200);
    expect((await post("/api/calendar", anna, { id: "m12", day: next, start: 1380, end: 1410, kind: "free" })).statusCode).toBe(429);
  });
});
