import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { upsertClient } from "./clients";
import { statsRangeOf } from "./events";
import { migrate } from "./migrate";
import { telegramPolling, type Bot } from "./telegram";

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

  it("заявка с сайта по строкам в истории; записанное мероприятие делает клиента «Клиентом» один раз", async () => {
    const id = await upsertClient(sql, { name: "Вера", phone: "+7 903 000 11 22", source: "site", summary: "Корпоратив, 25 гостей\n🧮 Расчёт: Пакет «Квиз»" });
    const first = (await get(`/api/clients/${id}`, owner)).json();
    expect(first.status).toBe("new");
    expect(first.history[0].summary).toBe("Корпоратив, 25 гостей\n🧮 Расчёт: Пакет «Квиз»");
    await upsertClient(sql, { phone: "89030001122", source: "event", summary: "Корпоратив, 20 ноября", ref: "ev-vera", promote: true });
    await upsertClient(sql, { phone: "89030001122", source: "event", summary: "Корпоратив, 20 ноября", ref: "ev-vera", promote: true });
    const after = (await get(`/api/clients/${id}`, owner)).json();
    expect(after.status).toBe("client");
    expect(after.history.filter((h: { source: string }) => h.source === "status")).toHaveLength(1);
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

  it("менеджер по продажам: ведёт клиентов и мероприятия, но без выгрузки, удаления, согласия «да» и итогов", async () => {
    const m = (await post("/api/users", owner, { email: "sales@example.com", name: "Мария" })).json();
    expect((await post(`/api/users/${m.account.uid}/profession`, owner, { profession: "sales" })).statusCode).toBe(200);
    expect((await post(`/api/users/${m.account.uid}/access`, owner, { role: "sales" })).statusCode).toBe(200);
    const maria = await login("sales@example.com", m.temporaryPassword);
    expect((await get("/api/clients", maria)).statusCode).toBe(200);
    expect((await get("/api/clients/export", maria)).statusCode).toBe(403);
    expect((await get("/api/clients/export?all=1", maria)).statusCode).toBe(403);
    expect((await get("/api/privacy?q=89001112233", maria)).statusCode).toBe(403);
    expect((await post("/api/privacy/erase", maria, { q: "89001112233" })).statusCode).toBe(403);
    // Новый клиент: «да» на рассылку менеджер не ставит — остаётся «нет согласия»; «нет» — можно.
    const made = await post("/api/clients", maria, { id: "ksales1", name: "Вера", phone: "+7 905 123-45-67", links: [], status: "new", marketing: "yes", notes: "" });
    expect(made.statusCode).toBe(200);
    expect(made.json()).toMatchObject({ marketing: "unknown" });
    expect(made.json().history[0].summary).toContain("Мария");
    // Смена статуса — в историю с именем.
    const worked = (await post("/api/clients", maria, { id: "ksales1", name: "Вера", phone: "+7 905 123-45-67", links: [], status: "work", marketing: "no", notes: "квиз, 20 гостей" })).json();
    expect(worked).toMatchObject({ status: "work", marketing: "no" });
    expect(worked.history.find((h: { source: string }) => h.source === "status")?.summary).toBe("В работе · Мария");
    expect((await post("/api/clients/ksales1/archive", maria)).statusCode).toBe(200);
    expect((await post("/api/clients/ksales1/restore", maria)).statusCode).toBe(200);
    // Мероприятия: записать, отменить — да; удалить навсегда и итоги — нет; «Кто может» — да.
    const ev = { id: "evsales", hostId: annaId, day: day(20), start: 1080, end: 1200, title: "День рождения", clientName: "Вера", clientPhone: "+7 905 123-45-67", place: "", guests: 20, note: "квиз" };
    expect((await post("/api/events", maria, ev)).statusCode).toBe(200);
    expect((await get(`/api/events?from=${day(19)}&to=${day(21)}`, maria)).json().events.some((e: { id: string }) => e.id === "evsales")).toBe(true);
    expect((await get(`/api/events?stats=1&from=${day(-200)}&to=${day(150)}`, maria)).statusCode).toBe(400);
    expect((await get(`/api/calendar/team?from=${day(19)}&to=${day(21)}`, maria)).statusCode).toBe(200);
    expect((await post("/api/events/evsales/cancel", maria)).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/api/events/evsales", headers: headers(maria) })).statusCode).toBe(403);
    expect((await post("/api/events/evsales/restore", maria)).statusCode).toBe(200);
    // Заявки на подбор площадок — открыты.
    expect((await get("/api/venue-requests", maria)).statusCode).toBe(200);
    // Ведущему без роли — по-прежнему нет.
    expect((await get("/api/clients", boris)).statusCode).toBe(403);
    expect((await post("/api/events", boris, { ...ev, id: "evboris" })).statusCode).toBe(403);
  });

  it("владелец и менеджер одновременно: статус не затирает заметку, чужую правку заметки и формы не затереть", async () => {
    const m = (await post("/api/users", owner, { email: "sales2@example.com", name: "Ника" })).json();
    expect((await post(`/api/users/${m.account.uid}/access`, owner, { role: "sales" })).statusCode).toBe(200);
    const nika = await login("sales2@example.com", m.temporaryPassword);
    const made = (await post("/api/clients", owner, { id: "kshared", name: "Олег", phone: "+7 916 000 11 22", links: [], status: "new", marketing: "unknown", notes: "квиз" })).json();
    // Менеджер открыл карточку (версия made), владелец дописал заметку.
    const owned = await post("/api/clients/kshared/notes", owner, { notes: "квиз\nперезвонить в 18:00", base: "квиз" });
    expect(owned.statusCode).toBe(200);
    // Менеджер ставит «В работе» по старой карточке — заметка владельца на месте, в истории — кто взял.
    const status = (await post("/api/clients/kshared/status", nika, { status: "work" })).json();
    expect(status).toMatchObject({ status: "work", notes: "квиз\nперезвонить в 18:00", statusLine: "В работе · Ника" });
    // Заметка менеджера со старой основой — 409, текст владельца не затёрт.
    expect((await post("/api/clients/kshared/notes", nika, { notes: "квиз, 30 гостей", base: "квиз" })).statusCode).toBe(409);
    // Полная форма по старой версии — 409.
    const stale = await post("/api/clients", nika, { id: "kshared", name: "Олег", phone: "+7 916 000 11 22", links: [], status: "new", marketing: "unknown", notes: "квиз", expect: made.updatedAt });
    expect(stale.statusCode).toBe(409);
    const now = (await get("/api/clients/kshared", owner)).json();
    expect(now).toMatchObject({ status: "work", notes: "квиз\nперезвонить в 18:00" });
    // По свежей версии — сохраняется.
    const fresh = await post("/api/clients", nika, { id: "kshared", name: "Олег Н.", phone: "+7 916 000 11 22", links: [], status: "work", marketing: "unknown", notes: now.notes, expect: now.updatedAt });
    expect(fresh.statusCode).toBe(200);
    // Тот же статус ещё раз — без новой строки истории; архивного клиента статусом не трогаем.
    await post("/api/clients/kshared/status", owner, { status: "work" });
    expect(((await get("/api/clients/kshared", owner)).json().history as Array<{ source: string }>).filter((h) => h.source === "status")).toHaveLength(1);
    await post("/api/clients/kshared/archive", owner);
    const inArchive = await post("/api/clients/kshared/status", nika, { status: "lost" });
    expect(inArchive.statusCode).toBe(409);
    // Причина — архив, а не чужая правка: браузер говорит «верните из архива».
    expect(inArchive.json()).toEqual({ error: "failed-precondition", reason: "archived" });
    const noteInArchive = await post("/api/clients/kshared/notes", nika, { notes: "новое", base: now.notes });
    expect(noteInArchive.statusCode).toBe(409);
    expect(noteInArchive.json()).toMatchObject({ reason: "archived" });
    expect((await post("/api/clients/kshared/status", nika, { status: "мимо" })).statusCode).toBe(400);
    // Мероприятие: владелец и менеджер открыли форму правки одной версии — второй не затрёт первого.
    const ev = { id: "evshared", hostId: annaId, day: day(30), start: 1080, end: 1200, title: "Корпоратив", clientName: "", clientPhone: "", place: "", guests: 20, note: "" };
    const created = (await post("/api/events", owner, ev)).json();
    expect(created.updatedAt).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 5));
    expect((await post("/api/events", nika, { ...ev, note: "Ника: перенос на 19:00", expect: created.updatedAt })).statusCode).toBe(200);
    const staleEvent = await post("/api/events", owner, { ...ev, note: "владелец", expect: created.updatedAt });
    expect(staleEvent.statusCode).toBe(409);
    expect(staleEvent.json().error).toBe("changed");
    const list = (await get(`/api/events?from=${day(29)}&to=${day(31)}`, owner)).json().events as Array<{ id: string; note: string }>;
    expect(list.find((e) => e.id === "evshared")?.note).toBe("Ника: перенос на 19:00");
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

  it("«Данные по номеру»: находит человека везде и удаляет навсегда, остальное не трогает", async () => {
    const PHONE = "+7 926 555-44-33";
    const clientId = await upsertClient(sql, { name: "Ксения", phone: "8 926 555 44 33", links: ["@ksu_party"], source: "site", summary: "Свадьба" });
    const otherId = await upsertClient(sql, { name: "Другой", phone: "+7 926 555-44-34", source: "site", summary: "Квиз" });
    await sql`insert into venue_requests (id, data) values ('rq-ks', ${sql.json({ name: "Ксения", phone: "89265554433", eventType: "Свадьба", guests: 60 })}),
      ('rq-other', ${sql.json({ name: "Другой", phone: "+79265554434" })})`;
    const now = new Date();
    await sql`insert into events (id, host_id, day, start_min, end_min, starts_at, ends_at, title, client_name, client_phone)
      values ('ev-ks', ${annaId}, ${day(30)}, 1080, 1200, ${now}, ${now}, 'Свадьба', 'Ксения', ${PHONE})`;
    await sql`insert into venues (id, data) values ('vn-ks', ${sql.json({ name: "Лофт", person: "Ксения", role: "админ", phone: "", messenger: "Telegram @ksu_party", email: "ks@example.com" })}),
      ('vn-other', ${sql.json({ name: "Бар", person: "Олег", phone: "+79260000000" })})`;

    // Только владелец; непонятный запрос — 400.
    expect((await get(`/api/privacy?q=${encodeURIComponent(PHONE)}`, anna)).statusCode).toBe(403);
    expect((await get("/api/privacy?q=Ксения", owner)).statusCode).toBe(400);
    expect((await post("/api/privacy/erase", owner, { q: "12" })).statusCode).toBe(400);

    const found = (await get(`/api/privacy?q=${encodeURIComponent("9265554433")}`, owner)).json();
    expect(found.label).toBe("+7 926 555-44-33");
    expect(found.clients.map((c: { id: string }) => c.id)).toEqual([clientId]);
    expect(found.requests.map((r: { id: string }) => r.id)).toEqual(["rq-ks"]);
    expect(found.events.map((e: { id: string }) => e.id)).toEqual(["ev-ks"]);
    // У площадки телефона нет, но ник в мессенджере тот же — находится по нику.
    expect(found.venues).toEqual([]);
    expect((await get("/api/privacy?q=@ksu_party", owner)).json().venues.map((v: { id: string }) => v.id)).toEqual(["vn-ks"]);
    expect((await get("/api/privacy?q=KS@example.com", owner)).json().venues.map((v: { id: string }) => v.id)).toEqual(["vn-ks"]);

    // Изменение — только с заголовком X-JoyRest.
    const bare = await app.inject({ method: "POST", url: "/api/privacy/erase", headers: { host: HOST, cookie: owner }, payload: { q: PHONE } });
    expect(bare.statusCode).toBe(403);

    expect((await post("/api/privacy/erase", owner, { q: PHONE })).json()).toEqual({ clients: 1, requests: 1, events: 1, venues: 0 });
    expect((await post("/api/privacy/erase", owner, { q: "@ksu_party" })).json()).toEqual({ clients: 0, requests: 0, events: 0, venues: 1 });

    expect(await sql`select 1 from clients where id = ${clientId}`).toHaveLength(0);
    expect(await sql`select 1 from client_contacts where client_id = ${clientId}`).toHaveLength(0);
    expect(await sql`select 1 from venue_requests where id = 'rq-ks'`).toHaveLength(0);
    const [ev] = await sql<{ client_name: string; client_phone: string; title: string }[]>`select client_name, client_phone, title from events where id = 'ev-ks'`;
    expect(ev).toEqual({ client_name: "", client_phone: "", title: "Свадьба" });
    const [vn] = await sql<{ data: Record<string, unknown> }[]>`select data from venues where id = 'vn-ks'`;
    expect(vn?.data).toMatchObject({ name: "Лофт", person: "", role: "", phone: "", messenger: "", email: "" });
    // Чужое не тронуто.
    expect(await sql`select 1 from clients where id = ${otherId}`).toHaveLength(1);
    expect(await sql`select 1 from venue_requests where id = 'rq-other'`).toHaveLength(1);
    const [bar] = await sql<{ data: Record<string, unknown> }[]>`select data from venues where id = 'vn-other'`;
    expect(bar?.data).toMatchObject({ person: "Олег", phone: "+79260000000" });
    // Повторный поиск — пусто.
    const again = (await get(`/api/privacy?q=${encodeURIComponent(PHONE)}`, owner)).json();
    expect([...again.clients, ...again.requests, ...again.events, ...again.venues]).toHaveLength(0);
  });

  it("«Данные по номеру»: неполный номер (ключа нет) находит записи с той же опечаткой и удаляет их", async () => {
    const now = new Date();
    await sql`insert into venue_requests (id, data) values ('rq-short', ${sql.json({ name: "Лена", phone: "8 916 777 66 5" })}),
      ('rq-short-other', ${sql.json({ name: "Не она", phone: "8 916 777 66 55" })})`;
    await sql`insert into events (id, host_id, day, start_min, end_min, starts_at, ends_at, title, client_name, client_phone)
      values ('ev-short', ${annaId}, ${day(31)}, 1080, 1200, ${now}, ${now}, 'Квиз', 'Лена', '+7 916 777-66-5')`;
    const found = await get(`/api/privacy?q=${encodeURIComponent("8916777665")}`, owner);
    expect(found.statusCode).toBe(200);
    const body = found.json();
    expect(body.label).toBe("916777665 (номер неполный)");
    expect(body.requests.map((r: { id: string }) => r.id)).toEqual(["rq-short"]);
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(["ev-short"]);
    expect((await post("/api/privacy/erase", owner, { q: "8916777665" })).json()).toEqual({ clients: 0, requests: 1, events: 1, venues: 0 });
    expect(await sql`select 1 from venue_requests where id = 'rq-short'`).toHaveLength(0);
    expect(await sql`select 1 from venue_requests where id = 'rq-short-other'`).toHaveLength(1);
    const [ev] = await sql<{ client_phone: string }[]>`select client_phone from events where id = 'ev-short'`;
    expect(ev?.client_phone).toBe("");
  });

  it("таймер ответа: идёт с прихода заявки, встаёт на «В работе» с именем; среднее — по ответам; повтор от «Отказа» — снова «Новый»", async () => {
    const id = await upsertClient(sql, { name: "Тимур", phone: "+7 917 333-22-11", source: "site", summary: "Квиз, 30 гостей" });
    // Заявка «пролежала» 5 минут.
    await sql`update clients set new_since = now() - interval '5 minutes' where id = ${id}`;
    const fresh = (await get(`/api/clients/${id}`, owner)).json();
    expect(fresh).toMatchObject({ status: "new", takenMs: null });
    expect(Date.now() - fresh.newSince).toBeGreaterThanOrEqual(5 * 60_000 - 5_000);
    const taken = (await post(`/api/clients/${id}/status`, owner, { status: "work" })).json();
    expect(taken.status).toBe("work");
    expect(taken.newSince).toBeNull();
    expect(taken.takenMs).toBeGreaterThanOrEqual(5 * 60_000 - 5_000);
    expect(taken.takenMs).toBeLessThan(6 * 60_000);
    expect(taken.takenBy).toBeTruthy();
    // Второй раз в «В работе» не считается, «Клиент» — тоже не ответ на заявку.
    await post(`/api/clients/${id}/status`, owner, { status: "client" });
    const today = day(0);
    const responses = (await get(`/api/clients/responses?from=${today}&to=${today}`, owner)).json().responses as Array<{ waitedMs: number }>;
    expect(responses.filter((r) => r.waitedMs >= 5 * 60_000 - 5_000 && r.waitedMs < 6 * 60_000)).toHaveLength(1);
    expect((await get(`/api/clients/responses?from=${today}&to=${today}`, anna)).statusCode).toBe(403);
    expect((await get(`/api/clients/responses?from=${day(-400)}&to=${today}`, owner)).statusCode).toBe(400);
    // «Клиент» с мероприятием впереди пишет снова — статус не трогаем.
    await upsertClient(sql, { phone: "89173332211", source: "site", summary: "Вопрос про площадку" });
    expect((await get(`/api/clients/${id}`, owner)).json().status).toBe("client");
    // Не договорились — «Отказ»; написал снова — «Новый», таймер с нуля, в истории «повторное обращение».
    await post(`/api/clients/${id}/status`, owner, { status: "lost" });
    await upsertClient(sql, { phone: "89173332211", source: "site", summary: "Снова квиз, весной" });
    const back = (await get(`/api/clients/${id}`, owner)).json();
    expect(back).toMatchObject({ status: "new", takenMs: null, takenBy: "" });
    expect(Date.now() - back.newSince).toBeLessThan(60_000);
    expect(back.history.some((h: { summary: string }) => h.summary === "Новый · повторное обращение")).toBe(true);
    // Через форму «В работе» — таймер тоже встаёт.
    const viaForm = (await post("/api/clients", owner, { id, name: "Тимур", phone: "+7 917 333-22-11", links: [], status: "work", marketing: "unknown", notes: "", expect: back.updatedAt })).json();
    expect(viaForm).toMatchObject({ status: "work" });
    expect(viaForm.takenMs).toBeGreaterThanOrEqual(0);
  });

  it("клиент вручную: «что хочет» — первой записью истории, «Новый» — с таймером, «В работе» — без", async () => {
    const made = (await post("/api/clients", owner, { id: "kreq1", name: "Алла", phone: "+7 918 444-55-66", links: [], status: "new", marketing: "unknown", notes: "", request: "Свадьба, 12 июня, 60 гостей" })).json();
    expect(made.history[0].summary).toContain("Свадьба, 12 июня, 60 гостей");
    expect(made.newSince).toBeGreaterThan(0);
    const talk = (await post("/api/clients", owner, { id: "kreq2", name: "Глеб", phone: "+7 918 444-55-67", links: [], status: "work", marketing: "unknown", notes: "" })).json();
    expect(talk).toMatchObject({ status: "work", newSince: null, takenMs: null });
  });

  it("«Проведено» ставит клиенту «Провели», снятая отметка — обратно «Клиент»", async () => {
    const ev = { id: "evheld", hostId: annaId, day: day(-1), start: 1080, end: 1320, title: "Корпоратив", clientName: "Лев", clientPhone: "+7 919 777-88-99", place: "", guests: 25, note: "" };
    expect((await post("/api/events", owner, ev)).statusCode).toBe(200);
    const find = async () => ((await get("/api/clients", owner)).json().clients as Array<{ name: string; status: string; id: string }>).find((c) => c.name === "Лев");
    await new Promise((r) => setTimeout(r, 200));
    expect((await find())?.status).toBe("client");
    expect((await post("/api/events/evheld/held", anna, { held: true })).statusCode).toBe(200);
    const lev = await find();
    expect(lev?.status).toBe("held");
    const card = (await get(`/api/clients/${lev?.id}`, owner)).json();
    expect(card.history.some((h: { summary: string }) => h.summary.startsWith("Провели · Корпоратив"))).toBe(true);
    expect((await post("/api/events/evheld/held", anna, { held: null })).statusCode).toBe(200);
    expect((await find())?.status).toBe("client");
    // Провели и снова написал — «Новый».
    await post("/api/events/evheld/held", anna, { held: true });
    await upsertClient(sql, { phone: "+79197778899", source: "site", summary: "Новый год" });
    expect((await find())?.status).toBe("new");
  });

  // ───── Исправления по QA 22 октября 2026 ─────
  type ClientRow = { id: string; status: string; archived_at: Date | null; last_contact_at: Date; taken_ms: string | number | null };
  const byKey = async (key: string) =>
    (await sql<ClientRow[]>`select id, status, archived_at, last_contact_at, taken_ms from clients where phone_key = ${key}`)[0];
  const responsesOf = async (id: string) => Number((await sql<{ n: number }[]>`select count(*)::int as n from client_responses where client_id = ${id}`)[0]?.n ?? 0);
  const statusLines = async (id: string) => Number((await sql<{ n: number }[]>`select count(*)::int as n from client_contacts where client_id = ${id} and source = 'status'`)[0]?.n ?? 0);

  it("M1: правка без статуса и согласия (мои правки поверх) не откатывает чужой статус и согласие «да»", async () => {
    const base = { id: "kforce", name: "Рита", phone: "+7 921 100-20-30", links: [], notes: "" };
    expect((await post("/api/clients", owner, { ...base, status: "new", marketing: "unknown" })).statusCode).toBe(200);
    const taken = (await post("/api/clients/kforce/status", owner, { status: "client" })).json();
    const consent = await post("/api/clients", owner, { ...base, status: "client", marketing: "yes", expect: taken.updatedAt });
    expect(consent.json()).toMatchObject({ status: "client", marketing: "yes" });
    const linesBefore = await statusLines("kforce");
    // Форма менеджера, открытая раньше: свои правки поверх — без статуса и согласия.
    const forced = await post("/api/clients", owner, { ...base, name: "Рита Н.", notes: "моя правка" });
    expect(forced.statusCode).toBe(200);
    expect(forced.json()).toMatchObject({ name: "Рита Н.", notes: "моя правка", status: "client", marketing: "yes" });
    expect(await statusLines("kforce")).toBe(linesBefore);
    expect(await responsesOf("kforce")).toBe(1);
  });

  it("ручной «Новый» не стирает «кто взял» и не дублирует скорость ответа", async () => {
    await post("/api/clients", owner, { id: "kback", name: "Зоя", phone: "+7 921 200-30-40", links: [], status: "new", marketing: "unknown", notes: "" });
    const first = (await post("/api/clients/kback/status", owner, { status: "work" })).json();
    expect(first.takenBy).toBeTruthy();
    const back = (await post("/api/clients/kback/status", owner, { status: "new" })).json();
    expect(back).toMatchObject({ status: "new", takenBy: first.takenBy, takenMs: first.takenMs });
    expect(back.newSince).toBeGreaterThan(0);
    await post("/api/clients/kback/status", owner, { status: "work" });
    expect(await responsesOf("kback")).toBe(1);
  });

  it("M2: мероприятие с неполным телефоном или только с именем — сохранено, а ответ говорит, что клиент не записан", async () => {
    const ev = { id: "evhalf", hostId: annaId, day: day(45), start: 1080, end: 1200, title: "Квиз", clientName: "Анна", clientPhone: "8915", place: "", guests: 20, note: "" };
    const half = await post("/api/events", owner, ev);
    expect(half.statusCode).toBe(200);
    expect(half.json()).toMatchObject({ id: "evhalf", clientNotSaved: true, clientIncomplete: true });
    const nameOnly = await post("/api/events", owner, { ...ev, id: "evname", clientPhone: "" });
    expect(nameOnly.json()).toMatchObject({ clientNotSaved: true, clientIncomplete: true });
    // «8 915 123 45 6» — 10 цифр без последней: не «7 891 512-34-56», а неполный номер.
    const short = await post("/api/events", owner, { ...ev, id: "evshort", clientPhone: "8 915 123 45 6" });
    expect(short.json()).toMatchObject({ clientNotSaved: true, clientIncomplete: true });
    expect(await sql`select 1 from clients where phone_key = '78915123456'`).toHaveLength(0);
    // Без клиента вовсе — ничего не говорим.
    const none = (await post("/api/events", owner, { ...ev, id: "evnone", clientName: "", clientPhone: "" })).json();
    expect(none.clientNotSaved).toBeUndefined();
  });

  it("двойное касание «Записать»: оба ответа — успех, запись одна, «назначено» в Telegram — один раз", async () => {
    // Бот понарошку: считаем уведомления ведущему (настоящий Telegram — в telegram.test.ts).
    const notices: string[] = [];
    const bot: Bot = {
      polling: false,
      health: async () => ({ polling: false, username: null, lastPollAt: null, state: "off" }),
      remindNow: async () => undefined,
      username: async () => null,
      sendTo: async () => false,
      eventNotice: async (kind, userId, event) => {
        notices.push(`${kind}:${userId}:${event.id}`);
      },
      salesNotice: async () => 0,
      waitingNow: async () => 0,
      stop: () => undefined,
    };
    const withBot = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, bot, auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } } });
    try {
      const send = (payload: object) => withBot.inject({ method: "POST", url: "/api/events", headers: headers(owner), payload });
      const ev = { id: "evtwice", hostId: annaId, day: day(47), start: 1080, end: 1200, title: "Квиз", clientName: "Дина", clientPhone: "+7 921 800-90-10", place: "", guests: 20, note: "" };
      const twice = await Promise.all([send(ev), send(ev)]);
      expect(twice.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(await sql`select 1 from events where id = 'evtwice'`).toHaveLength(1);
      expect(notices.filter((n) => n === `created:${annaId}:evtwice`)).toHaveLength(1);
      // Клиент тоже один, с одной записью истории мероприятия.
      const dina = await byKey("79218009010");
      expect(dina?.status).toBe("client");
      expect(await sql`select 1 from client_contacts where source = 'event' and ref = 'evtwice'`).toHaveLength(1);
      // Правка без смены времени, вида и гостей — ведущему ничего нового.
      expect((await send({ ...ev, note: "заметка" })).statusCode).toBe(200);
      expect(notices.filter((n) => n.endsWith(":evtwice"))).toHaveLength(1);
      // Перенос — «изменено» один раз.
      expect((await send({ ...ev, start: 1140, end: 1260 })).statusCode).toBe(200);
      expect(notices.filter((n) => n === `changed:${annaId}:evtwice`)).toHaveLength(1);
    } finally {
      await withBot.close();
    }
  });

  it("смена телефона в мероприятии: история переезжает к новому клиенту, правки не возвращают его из «Провели» и архива", async () => {
    const ev = { id: "evswap", hostId: annaId, day: day(-4), start: 1080, end: 1200, title: "Юбилей", clientName: "Яна", clientPhone: "+7 921 600-70-80", place: "", guests: 30, note: "" };
    expect((await post("/api/events", owner, ev)).statusCode).toBe(200);
    const first = await byKey("79216007080");
    expect(first?.status).toBe("client");
    // Ошиблись номером — исправили на телефон B: B — «Клиент», запись истории мероприятия — у него.
    const swapped = { ...ev, clientPhone: "+7 921 600-70-81" };
    expect((await post("/api/events", owner, swapped)).statusCode).toBe(200);
    const second = await byKey("79216007081");
    expect(second?.status).toBe("client");
    const owners = await sql<{ client_id: string }[]>`select client_id from client_contacts where source = 'event' and ref = 'evswap'`;
    expect(owners.map((r) => r.client_id)).toEqual([second?.id]);
    // «Проведено» — B «Провели»; убрали в архив.
    expect((await post("/api/events/evswap/held", owner, { held: true })).statusCode).toBe(200);
    expect((await byKey("79216007081"))?.status).toBe("held");
    expect((await post(`/api/clients/${second?.id}/archive`, owner)).statusCode).toBe(200);
    const archived = await byKey("79216007081");
    await new Promise((r) => setTimeout(r, 20));
    // Правка мероприятия — B остаётся «Провели», в архиве, «последнее обращение» не сдвигается.
    expect((await post("/api/events", owner, { ...swapped, note: "правка" })).statusCode).toBe(200);
    expect((await post("/api/events", owner, { ...swapped, note: "ещё правка" })).statusCode).toBe(200);
    const still = await byKey("79216007081");
    expect(still?.status).toBe("held");
    expect(still?.archived_at).not.toBeNull();
    expect(still?.last_contact_at.getTime()).toBe(archived?.last_contact_at.getTime());
  });

  it("ручной «Новый» без обращения — не в скорости ответа; новое обращение клиента в «Новом» — снова в ней", async () => {
    const card = async () => (await get("/api/clients/kmanualnew", owner)).json();
    // Заведён сразу «В работе» (ответа на обращение не было), вернули в «Новый» и снова «В работе» — строки нет.
    await post("/api/clients", owner, { id: "kmanualnew", name: "Фёдор", phone: "+7 921 700-80-90", links: [], status: "work", marketing: "unknown", notes: "" });
    await post("/api/clients/kmanualnew/status", owner, { status: "new" });
    await post("/api/clients/kmanualnew/status", owner, { status: "work" });
    expect(await responsesOf("kmanualnew")).toBe(0);
    // Вручную «Новый», и клиент написал — это обращение: таймер с нуля, без прежнего «кто взял».
    await post("/api/clients/kmanualnew/status", owner, { status: "new" });
    await sql`update clients set new_since = now() - interval '1 hour' where id = 'kmanualnew'`;
    await upsertClient(sql, { phone: "89217008090", source: "site", summary: "Квиз на 30 гостей" });
    const fresh = await card();
    expect(fresh).toMatchObject({ status: "new", takenMs: null, takenBy: "" });
    expect(Date.now() - fresh.newSince).toBeLessThan(60_000);
    // Пока ждёт ответа, ещё одно сообщение таймер не сбрасывает.
    await sql`update clients set new_since = now() - interval '2 minutes' where id = 'kmanualnew'`;
    await upsertClient(sql, { phone: "89217008090", source: "site", summary: "И про ведущего" });
    expect(Date.now() - (await card()).newSince).toBeGreaterThanOrEqual(2 * 60_000 - 5_000);
    const taken = (await post("/api/clients/kmanualnew/status", owner, { status: "work" })).json();
    expect(taken.takenMs).toBeGreaterThanOrEqual(2 * 60_000 - 5_000);
    expect(await responsesOf("kmanualnew")).toBe(1);
    // Ответили, вернули в «Новый» вручную, клиент написал снова — ещё один ответ в скорость.
    await post("/api/clients/kmanualnew/status", owner, { status: "new" });
    await upsertClient(sql, { phone: "89217008090", source: "question", summary: "Можно на субботу?" });
    expect(await card()).toMatchObject({ status: "new", takenMs: null });
    await post("/api/clients/kmanualnew/status", owner, { status: "work" });
    expect(await responsesOf("kmanualnew")).toBe(2);
  });

  it("клиент, созданный мероприятием, — сразу «Клиент» без «ответили за 0 с»", async () => {
    const ev = { id: "evfresh", hostId: annaId, day: day(46), start: 1080, end: 1200, title: "Свадьба", clientName: "Нина", clientPhone: "+7 921 300-40-50", place: "", guests: 60, note: "" };
    expect((await post("/api/events", owner, ev)).json().clientNotSaved).toBeUndefined();
    const nina = await byKey("79213004050");
    expect(nina?.status).toBe("client");
    expect(nina?.taken_ms).toBeNull();
    expect(await responsesOf(nina?.id ?? "")).toBe(0);
    expect(await statusLines(nina?.id ?? "")).toBe(1);
  });

  it("«Провели» + новое мероприятие — снова «Клиент»; правка прежнего — статус, архив и «последнее обращение» не трогает", async () => {
    const PHONE = "+7 921 400-50-60";
    const past = { id: "evonce", hostId: annaId, day: day(-3), start: 1080, end: 1200, title: "Юбилей", clientName: "Ефим", clientPhone: PHONE, place: "", guests: 30, note: "" };
    expect((await post("/api/events", owner, past)).statusCode).toBe(200);
    expect((await post("/api/events/evonce/held", owner, { held: true })).statusCode).toBe(200);
    const efim = await byKey("79214005060");
    expect(efim?.status).toBe("held");
    // Правка того же мероприятия — «Провели» остаётся.
    expect((await post("/api/events", owner, { ...past, note: "поправили заметку" })).statusCode).toBe(200);
    expect((await byKey("79214005060"))?.status).toBe("held");
    // Клиента убрали в архив; правка прежнего мероприятия его не возвращает и не сдвигает «последнее обращение».
    expect((await post(`/api/clients/${efim?.id}/archive`, owner)).statusCode).toBe(200);
    const archived = await byKey("79214005060");
    await new Promise((r) => setTimeout(r, 20));
    expect((await post("/api/events", owner, { ...past, note: "ещё правка" })).statusCode).toBe(200);
    const still = await byKey("79214005060");
    expect(still?.archived_at).not.toBeNull();
    expect(still?.last_contact_at.getTime()).toBe(archived?.last_contact_at.getTime());
    // Новое мероприятие — снова «Клиент» и из архива.
    expect((await post("/api/events", owner, { ...past, id: "evagain", day: day(50) })).statusCode).toBe(200);
    const again = await byKey("79214005060");
    expect(again).toMatchObject({ status: "client", archived_at: null });
    // Архив несуществующего — 404, а не «успех».
    expect((await post("/api/clients/knothing/archive", owner)).statusCode).toBe(404);
  });

  it("городской без семёрки — тот же клиент, что и с +7, в том числе записанный по-старому", async () => {
    // Карточка из прежней версии: ключ «4951234567» без семёрки.
    await sql`insert into clients (id, name, phone, phone_key, links, new_since) values ('klegacy', 'Город', '495 123-45-67', '4951234567', '[]', now())`;
    const id = await upsertClient(sql, { phone: "+7 (495) 123-45-67", source: "site", summary: "Квиз" });
    expect(id).toBe("klegacy");
    expect((await sql<{ phone_key: string }[]>`select phone_key from clients where id = 'klegacy'`)[0]?.phone_key).toBe("74951234567");
    const dup = await post("/api/clients", owner, { id: "kcity2", name: "Двойник", phone: "8 495 123 45 67", links: [], status: "new", marketing: "unknown", notes: "" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "already-exists", id: "klegacy" });
  });

  it("два одновременных клиента с одним телефоном — один сохранён, второй 409, без 500", async () => {
    const body = (id: string) => ({ id, name: "Одновременно", phone: "+7 921 500-60-70", links: [], status: "new", marketing: "unknown", notes: "" });
    const res = await Promise.all([post("/api/clients", owner, body("krace1")), post("/api/clients", owner, body("krace2"))]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await sql`select 1 from clients where phone_key = '79215006070'`).toHaveLength(1);
  });

  it("Telegram: без бота подключение недоступно, ответ понятный", async () => {
    expect((await get("/api/telegram/me", anna)).json()).toEqual({ available: false, linked: false, username: "" });
    expect((await post("/api/telegram/link", anna)).statusCode).toBe(503);
    expect((await get("/api/telegram/me", "")).statusCode).toBe(401);
  });
});
