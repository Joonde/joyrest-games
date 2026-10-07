import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";
import { cleanText } from "./staff";

describe("комментарий к баллам", () => {
  it("одной строкой, без управляющих символов, до 200", () => {
    expect(cleanText("  Отличный\nотзыв\u0007 ")).toBe("Отличный отзыв");
    expect(cleanText(5)).toBe("");
    expect(cleanText("а".repeat(300)).length).toBe(200);
  });
});

const MINUTE = 60_000;

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("квалификация, стаж и баллы на PostgreSQL", () => {
  const SCHEMA = "staff_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  let clock = Date.parse("2026-10-07T12:00:00Z");
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
    live: { now: () => clock, keepAliveMs: 60_000 },
  });
  let owner = "";
  let anna = "";
  let annaId = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));

  /** Игра ведущей Анны: phones телефонов, minutes минут от «Начать игру» до «Завершить». */
  async function playGame(id: string, phones: number, minutes: number) {
    expect((await post("/api/sessions", anna, { id, gameTitle: "Квиз", mechanic: "quiz", playMode: "solo" })).statusCode).toBe(200);
    for (let i = 0; i < phones; i++) {
      const device = await post("/api/auth/device", "", {});
      const cookie = cookieOf(device);
      const uid = device.json().uid as string;
      expect((await post(`/api/sessions/${id}/participants/${uid}/join`, cookie, { name: `Гость ${i}` })).statusCode).toBe(200);
    }
    expect((await post(`/api/sessions/${id}/phase`, anna, { phase: "playing" })).statusCode).toBe(200);
    clock += minutes * MINUTE;
    expect((await post(`/api/sessions/${id}/finish`, anna, { participantsCount: 999 })).statusCode).toBe(200);
  }

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    const created = (await post("/api/users", owner, { email: "anna@example.com", name: "Анна" })).json();
    annaId = created.account.uid;
    anna = await login("anna@example.com", created.temporaryPassword);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("квалификацию и «опыт с» ставит только владелец; ведущий видит их в профиле", async () => {
    expect((await post(`/api/users/${annaId}/level`, anna, { level: "top", experienceSince: null })).statusCode).toBe(403);
    expect((await post(`/api/users/${annaId}/level`, owner, { level: "boss", experienceSince: null })).statusCode).toBe(400);
    expect((await post(`/api/users/${annaId}/level`, owner, { level: "novice", experienceSince: "2099-01-01" })).statusCode).toBe(400);
    expect((await post(`/api/users/${annaId}/level`, owner, { level: "novice", experienceSince: "2025-03-01" })).statusCode).toBe(200);
    const me = (await get("/api/auth/me", anna)).json();
    expect(me.profile.level).toBe("novice");
    expect(new Date(me.profile.experienceSince).toISOString().slice(0, 10)).toBe("2025-03-01");
    // Снять уровень, стаж — с даты добавления.
    await post(`/api/users/${annaId}/level`, owner, { level: null, experienceSince: null });
    const again = (await get("/api/auth/me", anna)).json();
    expect(again.profile.level).toBeNull();
    expect(typeof again.profile.experienceSince).toBe("number");
  });

  it("баллы за игру: больше 10 телефонов и не меньше 40 минут; одна запись на сессию", async () => {
    await playGame("short", 12, 30);
    await playGame("small", 10, 60);
    await playGame("ok", 11, 45);
    // Повторное «Завершить» ничего не добавляет.
    await post("/api/sessions/ok/finish", anna, {});
    const rows = await sql<{ session_id: string; points: string }[]>`select session_id, points::text as points from host_points where host_id = ${annaId}`;
    expect(rows).toEqual([{ session_id: "ok", points: "1.0" }]);
  });

  it("баллы видит только владелец; ручные — шаг 0,5 и комментарий", async () => {
    expect((await get(`/api/users/${annaId}/points`, anna)).statusCode).toBe(403);
    expect((await post(`/api/users/${annaId}/points`, owner, { id: "m1", points: 0.3, reason: "x" })).statusCode).toBe(400);
    expect((await post(`/api/users/${annaId}/points`, owner, { id: "m1", points: 2, reason: "  " })).statusCode).toBe(400);
    expect((await post(`/api/users/${annaId}/points`, owner, { id: "m1", points: 2.5, reason: "Отзыв клиента" })).statusCode).toBe(200);
    // Повтор того же запроса — не дважды.
    await post(`/api/users/${annaId}/points`, owner, { id: "m1", points: 2.5, reason: "Отзыв клиента" });
    await post(`/api/users/${annaId}/points`, owner, { id: "m2", points: -0.5, reason: "Опоздание" });
    const history = (await get(`/api/users/${annaId}/points`, owner)).json();
    expect(history.total).toBe(3);
    expect(history.items.map((i: { points: number; kind: string }) => [i.points, i.kind]).sort()).toEqual([
      [-0.5, "manual"],
      [1, "game"],
      [2.5, "manual"],
    ]);
    const hosts = (await get("/api/users", owner)).json() as Array<{ uid: string; points: number }>;
    expect(hosts.find((h) => h.uid === annaId)?.points).toBe(3);
    // Ведущему сумма баллов не приходит.
    expect((await get("/api/auth/me", anna)).json().profile.points).toBeUndefined();
  });
});
