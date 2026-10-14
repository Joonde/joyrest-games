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
