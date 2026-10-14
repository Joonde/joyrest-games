import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { upsertClient } from "./clients";
import { statsRangeOf } from "./events";
import { migrate } from "./migrate";
import { telegramPolling } from "./telegram";

describe("Telegram и итоги: без базы", () => {
  it("сообщения бота читает одно окружение: основное по compose, без переменной — только test.*", () => {
    expect(telegramPolling("on", ["joy-rest.ru"])).toBe(true);
    expect(telegramPolling(" OFF\r\n", ["test.joy-rest.ru"])).toBe(false);
    expect(telegramPolling(undefined, ["test.joy-rest.ru"])).toBe(true);
    expect(telegramPolling(undefined, ["joy-rest.ru"])).toBe(false);
    const compose = readFileSync(resolve(import.meta.dirname, "../../deploy/compose.yml"), "utf8");
    expect(compose.match(/TELEGRAM_UPDATES: "on"/g)?.length).toBe(1);
    expect(compose.match(/TELEGRAM_UPDATES: "off"/g)?.length).toBe(1);
    expect(compose.indexOf('TELEGRAM_UPDATES: "on"')).toBeLessThan(compose.indexOf("app-test:"));
  });
  it("итоги — окно до 370 дней", () => {
    expect(statsRangeOf({ from: "2026-01-01", to: "2026-12-31" })).toEqual({ from: "2025-12-31", to: "2026-12-31" });
    expect(statsRangeOf({ from: "2026-01-01", to: "2027-03-01" })).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("база клиентов, «Проведено» и Telegram на PostgreSQL", () => {
  const SCHEMA = "clients_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const app = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } } });
  let owner = "";
  let anna = "";
  let annaId = "";
  let boris = "";
  const day = (n: number) => new Date(Date.now() + 3 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));

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
    boris = await login("boris@example.com", b.temporaryPassword);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("один человек — одна карточка: телефон в разном виде, ссылки дополняются, история без дублей", async () => {
    const id1 = await upsertClient(sql, { name: "Софья", phone: "8 (915) 241-59-99", source: "site", summary: "Корпоратив, 25 гостей" });
    const id2 = await upsertClient(sql, { name: "Соня", phone: "+7 915 241 59 99", links: ["@sofia_joy"], source: "venue", summary: "Запрос №1", ref: "r1" });
    const id3 = await upsertClient(sql, { phone: "", links: ["https://t.me/sofia_joy"], source: "telegram", summary: "Свадьба", ref: "tg-1" });
    await upsertClient(sql, { phone: "+7 915 241 59 99", source: "venue", summary: "Запрос №1", ref: "r1" });
    expect(id1).toBeTruthy();
    expect(id2).toBe(id1);
    expect(id3).toBe(id1);
    expect(await upsertClient(sql, { name: "Без контактов", source: "manual", summary: "" })).toBeNull();
    const c = (await get(`/api/clients/${id1}`, owner)).json();
    expect(c).toMatchObject({ name: "Софья", links: ["https://t.me/sofia_joy"], marketing: "unknown", contacts: 3 });
    expect(c.history).toHaveLength(3);
  });

  it("согласие на рассылку: «да» только с сайта или вручную; выгрузка — только согласившиеся", async () => {
    await upsertClient(sql, { name: "Ольга", phone: "89001112233", marketing: true, source: "site", summary: "Свадьба" });
    const csv = (await get("/api/clients/export", owner)).body;
    expect(csv).toContain("Ольга;+7 900 111-22-33");
    expect(csv).not.toContain("Софья");
    expect((await get("/api/clients/export?all=1", owner)).body).toContain("Софья");
  });

  it("клиентов видит и правит только владелец; тот же телефон вручную — 409", async () => {
    expect((await get("/api/clients", anna)).statusCode).toBe(403);
    expect((await get("/api/clients/export", anna)).statusCode).toBe(403);
    const dup = await post("/api/clients", owner, { id: "kmanual1", name: "Двойник", phone: "+79152415999", links: [], status: "new", marketing: "unknown", notes: "" });
    expect(dup.statusCode).toBe(409);
    const made = await post("/api/clients", owner, { id: "kmanual2", name: "Игорь", phone: "", links: ["vk.com/igor"], status: "work", marketing: "yes", notes: "звонить после 18" });
    expect(made.json()).toMatchObject({ name: "Игорь", links: ["https://vk.com/igor"], status: "work", marketing: "yes", marketingSource: "вручную владельцем" });
    await post("/api/clients/kmanual2/archive", owner);
    expect(((await get("/api/clients", owner)).json().clients as Array<{ id: string }>).some((c) => c.id === "kmanual2")).toBe(false);
    expect(((await get("/api/clients?archived=1", owner)).json().clients as Array<{ id: string }>).some((c) => c.id === "kmanual2")).toBe(true);
  });

  it("мероприятие с клиентом — клиент в базе; «Проведено» — после начала, владелец или ведущий; итоги за год", async () => {
    const past = { id: "evpast", hostId: annaId, day: day(-2), start: 1080, end: 1380, title: "Юбилей", clientName: "Пётр", clientPhone: "+7 999 555-44-33", place: "", guests: 37, note: "" };
    const future = { ...past, id: "evfuture", day: day(5) };
    expect((await post("/api/events", owner, past)).statusCode).toBe(200);
    expect((await post("/api/events", owner, future)).statusCode).toBe(200);
    const clients = (await get("/api/clients", owner)).json().clients as Array<{ name: string; lastSource: string }>;
    expect(clients.find((c) => c.name === "Пётр")?.lastSource).toBe("event");
    expect((await post("/api/events/evfuture/held", owner, { held: true })).statusCode).toBe(409);
    expect((await post("/api/events/evpast/held", boris, { held: true })).statusCode).toBe(403);
    expect((await post("/api/events/evpast/held", anna, { held: "да" })).statusCode).toBe(400);
    expect((await post("/api/events/evpast/held", anna, { held: true })).json()).toMatchObject({ held: true });
    const year = (await get(`/api/events?stats=1&from=${day(-200)}&to=${day(150)}`, owner)).json().events as Array<{ id: string; held: boolean | null }>;
    expect(year.find((e) => e.id === "evpast")?.held).toBe(true);
    // Ведущему длинное окно не положено.
    expect((await get(`/api/events?stats=1&from=${day(-200)}&to=${day(150)}`, anna)).statusCode).toBe(400);
  });

  it("Telegram: без бота подключение недоступно, ответ понятный", async () => {
    expect((await get("/api/telegram/me", anna)).json()).toEqual({ available: false, linked: false, username: "" });
    expect((await post("/api/telegram/link", anna)).statusCode).toBe(503);
    expect((await get("/api/telegram/me", "")).statusCode).toBe(401);
  });
});
