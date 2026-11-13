/**
 * «Активные заказы» — `GET /api/orders` на PostgreSQL (логика — docs/active-orders.md, раздел 2): какие мероприятия и клиенты
 * попадают на страницу, клиент из истории, права (владелец и менеджер — да, ведущий — нет).
 */
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { upsertClient } from "./clients";
import { migrate } from "./migrate";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("«Активные заказы»: GET /api/orders на PostgreSQL", () => {
  const SCHEMA = "orders_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const app = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } } });
  let owner = "";
  let manager = "";
  let host = "";
  let hostId = "";
  let ownerId = "";
  let managerId = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));

  /** Мероприятие прямо в базе: `hours` — через сколько часов начало (минус — в прошлом). */
  async function event(id: string, hours: number, more: Record<string, unknown> = {}) {
    const starts = new Date(Date.now() + hours * 3_600_000);
    const ends = new Date(starts.getTime() + 3 * 3_600_000);
    const msk = new Date(starts.getTime() + 3 * 3_600_000);
    const day = msk.toISOString().slice(0, 10);
    const start = msk.getUTCHours() * 60 + msk.getUTCMinutes();
    await sql`insert into events (id, host_id, day, start_min, end_min, starts_at, ends_at, title, client_name, client_phone, place, guests, created_by, price, prepaid_at, accept_rev)
      values (${id}, ${hostId}, ${day}, ${start}, ${start + 180}, ${starts}, ${ends}, 'Корпоратив', ${`Клиент ${id}`}, '', 'Москва', 30, ${ownerId}, 29900, now(), 1)`;
    for (const [k, v] of Object.entries(more)) await sql`update events set ${sql({ [k]: v } as Record<string, string>)} where id = ${id}`;
  }

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    const [o] = await sql<{ id: string }[]>`select id from users where role = 'admin' limit 1`;
    ownerId = o?.id ?? "";
    const m = (await post("/api/users", owner, { email: "maria@example.com", name: "Мария" })).json() as { account: { uid: string }; temporaryPassword: string };
    expect((await post(`/api/users/${m.account.uid}/access`, owner, { role: "sales" })).statusCode).toBe(200);
    manager = await login("maria@example.com", m.temporaryPassword);
    managerId = m.account.uid;
    const h = (await post("/api/users", owner, { email: "anna@example.com", name: "Анна" })).json() as { account: { uid: string }; temporaryPassword: string };
    hostId = h.account.uid;
    host = await login("anna@example.com", h.temporaryPassword);

    await event("ahead", 48);
    await event("past-open", -30);
    await event("past-held-rest", -50, { held: true, rest_paid: "no" });
    await event("past-closed", -50, { held: true, rest_paid: "yes", review: "asked" });
    await event("past-failed", -50, { held: false });
    await event("past-old", -24 * 40);
    await event("off-fresh", 72, { cancelled_at: new Date() });
    await event("off-old", 72, { cancelled_at: new Date(Date.now() - 20 * 86_400_000) });
    await sql`update events set updated_at = now() - interval '20 days' where id = 'off-old'`;
    await event("off-refund", 72, { cancelled_at: new Date(Date.now() - 20 * 86_400_000), refund_at: new Date(Date.now() - 20 * 86_400_000) });
    await sql`update events set updated_at = now() - interval '20 days' where id = 'off-refund'`;

    // Клиенты: один связан с мероприятием впереди (не в переговорах), один в работе с расчётом, один новый, один «Клиент».
    const booked = await upsertClient(sql, { name: "Ольга", phone: "+79990000001", source: "event", summary: "Корпоратив", ref: "ahead", promote: true });
    await sql`update clients set status = 'work', next_step = 'Прислать договор', next_at = current_date, owner_id = ${managerId} where id = ${booked}`;
    const talk = await upsertClient(sql, { name: "Ирина", phone: "+79990000002", source: "site", summary: "🧮 Расчёт JoyRest\n✅ Опытный: 25 900 ₽ — выбран" });
    await sql`update clients set status = 'work', notes = 'Дата: 11.12.2026' where id = ${talk}`;
    await upsertClient(sql, { name: "Пётр", phone: "+79990000003", source: "site", summary: "Вопрос" });
    const done = await upsertClient(sql, { name: "Павел", phone: "+79990000004", source: "site", summary: "Квиз" });
    await sql`update clients set status = 'client' where id = ${done}`;
    const gone = await upsertClient(sql, { name: "Архив", phone: "+79990000005", source: "site", summary: "Квиз" });
    await sql`update clients set archived_at = now() where id = ${gone}`;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("права: владелец и менеджер — да, ведущий и без входа — нет; ответ не кэшируется", async () => {
    expect((await get("/api/orders", host)).statusCode).toBe(403);
    expect((await get("/api/orders", "")).statusCode).toBe(401);
    const res = await get("/api/orders", manager);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((await get("/api/orders", owner)).statusCode).toBe(200);
  });

  it("мероприятия: впереди, прошедшие незакрытые за 30 дней, отмены за 7 дней и ждущие возврата", async () => {
    const board = (await get("/api/orders", owner)).json() as { now: number; events: Array<{ id: string }> };
    const ids = board.events.map((e) => e.id).sort();
    expect(ids).toEqual(["ahead", "off-fresh", "off-refund", "past-held-rest", "past-open"]);
    expect(Math.abs(board.now - Date.now())).toBeLessThan(10_000);
  });

  it("клиент мероприятия — из истории: статус, кто ведёт, следующий шаг", async () => {
    const board = (await get("/api/orders", owner)).json() as { events: Array<Record<string, unknown>> };
    const ahead = board.events.find((e) => e.id === "ahead");
    expect(ahead).toMatchObject({ clientStatus: "work", clientOwnerName: "Мария", nextStep: "Прислать договор", price: 29900 });
    expect(typeof ahead?.nextAt).toBe("string");
    const open = board.events.find((e) => e.id === "past-open");
    expect(open?.clientId).toBeUndefined();
  });

  it("переговоры: «Новый» и «В работе» без мероприятия впереди, без архива; расчёт — последний с ценой", async () => {
    const board = (await get("/api/orders", manager)).json() as { talks: Array<Record<string, unknown>> };
    const names = board.talks.map((t) => t.name).sort();
    expect(names).toEqual(["Ирина", "Пётр"]);
    const irina = board.talks.find((t) => t.name === "Ирина");
    expect(irina).toMatchObject({ status: "work", notes: "Дата: 11.12.2026" });
    expect(String(irina?.calc)).toContain("25 900 ₽");
    expect(board.talks.find((t) => t.name === "Пётр")).toMatchObject({ status: "new", calc: "" });
  });
});
