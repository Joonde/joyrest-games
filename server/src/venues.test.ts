/**
 * База площадок (CLAUDE.md, «База площадок»): анкеты без входа только при VENUE_FORMS=on,
 * в Telegram — без имён и телефонов, предложение клиенту — без адресов и контактов, кабинет —
 * только владельцу и ведущим с доступом.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyRequest, emptyVenue, type VenueData } from "../../src/core/venues";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";
import { newOfferId, requestNotice, venueFileMime, venueNotice } from "./venues";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const webp = (fill: number) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 0), Buffer.from("WEBP"), Buffer.alloc(500, fill)]);
const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(300, 32)]);

const VENUE = {
  name: "Белая веранда",
  type: "Ресторан",
  address: "ул. Секретная, 12",
  person: "Ольга Иванова",
  phone: "+7 900 123-45-67",
  email: "banket@example.ru",
  seated: 120,
  standing: 180,
  district: "СЗАО",
  metro: "Строгино",
  dance: true,
  layouts: ["Круглые столы", "Фуршет"],
  features: ["Панорамные окна"],
  perGuest: 6000,
};

const REQUEST = {
  name: "Анна Клиентова",
  phone: "+7 999 888-77-66",
  eventType: "Свадьба",
  date: "2027-06-19",
  guests: 80,
  format: "banquet",
  budget: 6500,
  wishes: { dance: 2, round: 1, panorama: 1 } as Record<string, 1 | 2>,
  comment: "Хотим светлый зал",
};

describe("база площадок: без базы", () => {
  it("уведомления — без имён, телефонов и адресов", () => {
    const v: VenueData = { ...emptyVenue(), ...VENUE };
    const venueText = venueNotice(v, "Иван", "https://games.test/venues/v/x", "🧪 ТЕСТ");
    expect(venueText).toContain("«Белая веранда», ресторан, до 180 гостей");
    expect(venueText).toContain("Привёл: Иван");
    const requestText = requestNotice(12, { ...emptyRequest(), ...REQUEST, format: "banquet" }, null, "https://games.test/venues/r/x");
    expect(requestText).toContain("Заявка №12: свадьба, 80 гостей, 19 июня 2027");
    for (const secret of ["Ольга", "123-45-67", "Секретная", "banket@", "Анна", "888-77-66"]) {
      expect(venueText + requestText).not.toContain(secret);
    }
  });

  it("тип файла — по первым байтам", () => {
    expect(venueFileMime(webp(1))).toBe("image/webp");
    expect(venueFileMime(pdf)).toBe("application/pdf");
    expect(venueFileMime(Buffer.from("<html>"))).toBeNull();
  });

  it("ссылка предложения — 22 случайных символа", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newOfferId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("анкеты на основной версии выключены по умолчанию; включает только владелец", () => {
    const compose = read("deploy/compose.yml");
    expect(compose).toContain("VENUE_FORMS: ${VENUE_FORMS:-off}");
    expect(compose).toContain('VENUE_FORMS: "on"');
    expect(compose.match(/^\s+VENUE_FORMS:/gm)?.length).toBe(2);
    expect(read("server/src/main.ts")).toContain("formsOpen: isOn(process.env.VENUE_FORMS)");
    expect(read("deploy/bin/joyrest")).toMatch(/cmd_venues\(\) \{[\s\S]*need_root venues[\s\S]*ensure_no_game/);
    for (const workflow of ["build.yml", "e2e.yml", "load.yml", "scenario.yml"]) {
      expect(read(`.github/workflows/${workflow}`)).not.toContain("VENUE_FORMS");
    }
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("база площадок на PostgreSQL", () => {
  const SCHEMA = "venues_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const sent: string[] = [];
  const mediaDir = mkdtempSync(join(tmpdir(), "joyrest-venues-"));
  const build = (formsOpen: boolean) =>
    buildApp({
      version: "t",
      publicDir: null,
      checkDatabase: async () => true,
      sql,
      mediaDir,
      auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
      lead: { telegram: { token: "t", chatId: "c" }, send: async (_target, text) => void sent.push(text) },
      venues: { formsOpen, freeBytes: async () => 100 * 1024 ** 3, limits: { venuesPerIp: 3, requestsPerIp: 3 } },
    });
  const app = build(true);
  const closed = build(false);
  let owner = "";
  let anna = "";
  let annaId = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie = "") => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, payload: object, cookie = "", target = app) => target.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const patch = (path: string, payload: object, cookie: string) => app.inject({ method: "PATCH", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie = "") => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const putFile = (path: string, body: Buffer, type: string, extra: Record<string, string>) =>
    app.inject({ method: "PUT", url: path, headers: { ...headers(), "content-type": type, ...extra }, payload: body });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", { email, password }));

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    const created = (await post("/api/users", { email: "anna@example.com", name: "Анна" }, owner)).json();
    annaId = created.account.uid;
    anna = await login("anna@example.com", created.temporaryPassword);
  });

  afterAll(async () => {
    await app.close();
    await closed.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("закрытые анкеты: 404, статус «закрыто»; предложения и кабинет работают", async () => {
    expect((await closed.inject({ method: "GET", url: "/api/venue-forms/status", headers: { host: HOST } })).json()).toEqual({ open: false });
    const res = await post("/api/venue-forms/venue", { id: "closed-venue-1", data: VENUE, consent: true, menuFiles: 1 }, "", closed);
    expect(res.statusCode).toBe(404);
    expect((await get("/api/venue-forms/status")).json()).toEqual({ open: true });
  });

  it("анкета площадки: обязательные поля, согласие, файлы по токену, уведомление без контактов", async () => {
    const missing = await post("/api/venue-forms/venue", { id: "venue-form-001", data: { name: "Х" }, consent: true });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().missing).toContain("телефон");
    expect((await post("/api/venue-forms/venue", { id: "venue-form-001", data: VENUE, consent: false, menuFiles: 1 })).statusCode).toBe(400);

    sent.length = 0;
    const ok = await post("/api/venue-forms/venue", { id: "venue-form-001", from: annaId, data: VENUE, consent: true, menuFiles: 1, photoFiles: 2 });
    expect(ok.statusCode).toBe(200);
    const token = ok.json().uploadToken as string;
    expect(sent.join("\n")).toContain("«Белая веранда»");
    expect(sent.join("\n")).toContain("Привёл: Анна");
    expect(sent.join("\n")).not.toContain("123-45-67");

    const path = "/api/venue-forms/venue/venue-form-001/files";
    expect((await putFile(`${path}/photo`, webp(1), "image/webp", { "x-upload-token": "неверный-токен-123456" })).statusCode).toBe(403);
    expect((await putFile(`${path}/photo`, pdf, "application/pdf", { "x-upload-token": token })).statusCode).toBe(400);
    expect((await putFile(`${path}/photo`, webp(1), "image/webp", { "x-upload-token": token })).statusCode).toBe(200);
    expect((await putFile(`${path}/photo`, webp(2), "image/webp", { "x-upload-token": token })).statusCode).toBe(200);
    // Третье фото — сверх заявленного.
    expect((await putFile(`${path}/photo`, webp(3), "image/webp", { "x-upload-token": token })).statusCode).toBe(409);
    expect((await putFile(`${path}/menu`, pdf, "application/pdf", { "x-upload-token": token, "x-file-name": encodeURIComponent("Банкетное меню.pdf") })).statusCode).toBe(200);

    // Повтор после обрыва: та же анкета, новый токен, без второго уведомления.
    sent.length = 0;
    const again = await post("/api/venue-forms/venue", { id: "venue-form-001", data: VENUE, consent: true, menuFiles: 1 });
    expect(again.statusCode).toBe(200);
    expect(sent).toEqual([]);
  });

  it("лимит анкет с одного адреса и ловушка для ботов", async () => {
    const trap = await post("/api/venue-forms/venue", { id: "venue-trap-0001", data: VENUE, consent: true, menuFiles: 1, website: "spam" });
    expect(trap.statusCode).toBe(200);
    expect((await sql`select 1 from venues where id = 'venue-trap-0001'`).length).toBe(0);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await post("/api/venue-forms/venue", { id: `venue-limit-${i}0000`, data: VENUE, consent: true, menuFiles: 1 })).statusCode);
    }
    expect(statuses).toContain(429);
  });

  it("заявка клиента: номер, повтор — тот же номер, уведомление без имени и телефона", async () => {
    expect((await post("/api/venue-forms/request", { id: "request-0001", data: REQUEST, consent: true })).statusCode).toBe(400);
    sent.length = 0;
    const res = await post("/api/venue-forms/request", { id: "request-0001", from: annaId, data: REQUEST, consent: true, ack: true });
    expect(res.statusCode).toBe(200);
    const number = res.json().number as number;
    expect(number).toBeGreaterThan(0);
    expect(sent.join("\n")).toContain(`Заявка №${number}: свадьба, 80 гостей`);
    expect(sent.join("\n")).not.toMatch(/Анна Клиентова|888-77-66/);
    const again = await post("/api/venue-forms/request", { id: "request-0001", data: REQUEST, consent: true, ack: true });
    expect(again.json().number).toBe(number);
  });

  it("кабинет: только владелец и ведущие с доступом", async () => {
    expect((await get("/api/venues")).statusCode).toBe(401);
    expect((await get("/api/venues", anna)).statusCode).toBe(403);
    expect((await get("/api/venue-requests", anna)).statusCode).toBe(403);
    expect((await post(`/api/users/${annaId}/venue-access`, { access: true }, anna)).statusCode).toBe(403);
    expect((await post(`/api/users/${annaId}/venue-access`, { access: true }, owner)).statusCode).toBe(200);
    expect((await get("/api/auth/me", anna)).json().profile.venueAccess).toBe(true);
    expect((await get("/api/venues", anna)).statusCode).toBe(200);
    expect((await post(`/api/users/${annaId}/venue-access`, { access: false }, owner)).statusCode).toBe(200);
    expect((await get("/api/venues", anna)).statusCode).toBe(403);
  });

  it("владелец: список, статус, оценка, заметки, файлы; вручную — только название", async () => {
    const list = (await get("/api/venues", owner)).json() as Array<Record<string, unknown>>;
    const venue = list.find((v) => v.id === "venue-form-001");
    expect(venue).toMatchObject({ status: "new", source: "form", hostName: "Анна" });
    expect((venue?.data as VenueData).phone).toBe("+7 900 123-45-67");
    const files = venue?.files as Array<{ sha: string; kind: string; name: string }>;
    expect(files.filter((f) => f.kind === "photo")).toHaveLength(2);
    expect(files.find((f) => f.kind === "menu")?.name).toBe("Банкетное меню.pdf");

    const edited = await patch("/api/venues/venue-form-001", { status: "worked", rating: 5, notes: "Звукорежиссёр Олег помогает" }, owner);
    expect(edited.json()).toMatchObject({ status: "worked", rating: 5, notes: "Звукорежиссёр Олег помогает" });
    expect((await patch("/api/venues/venue-form-001", { status: "космос" }, owner)).statusCode).toBe(400);
    expect((await patch("/api/venues/venue-form-001", { rating: 9 }, owner)).statusCode).toBe(400);

    const file = await get(`/api/venues/venue-form-001/files/${files[0]?.sha}`, owner);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("image/webp");
    expect((await get(`/api/venues/venue-form-001/files/${files[0]?.sha}`)).statusCode).toBe(401);

    expect((await post("/api/venues", { id: "manual-venue-01", data: {} }, owner)).statusCode).toBe(400);
    const manual = await post("/api/venues", { id: "manual-venue-01", data: { name: "Лофт «Кирпич»", seated: 60, standing: 90 } }, owner);
    expect(manual.json()).toMatchObject({ status: "checked", source: "manual" });
    const upload = await app.inject({
      method: "PUT",
      url: "/api/venues/manual-venue-01/files/photo",
      headers: { ...headers(owner), "content-type": "image/webp" },
      payload: webp(7),
    });
    expect(upload.statusCode).toBe(200);
  });

  it("предложение клиенту: снимок без адресов и контактов, фото по ссылке, заявка — «отправлено»", async () => {
    const [req] = await sql<{ id: string }[]>`select id from venue_requests where id = 'request-0001'`;
    expect(req).toBeDefined();
    const res = await post("/api/venue-offers", { requestId: "request-0001", venueIds: ["venue-form-001", "manual-venue-01"], comment: "Две площадки на ваш день" }, owner);
    expect(res.statusCode).toBe(200);
    const offerId = res.json().id as string;

    const offer = await get(`/api/offers/${offerId}`);
    expect(offer.statusCode).toBe(200);
    const text = offer.body;
    for (const secret of ["Секретная", "123-45-67", "Ольга", "banket@", "Олег", "Анна Клиентова", "888-77-66"]) expect(text).not.toContain(secret);
    const body = offer.json();
    expect(body.title).toBe("Свадьба · 19 июня 2027 · 80 гостей");
    expect(body.items[0]).toMatchObject({ name: "Белая веранда", where: "СЗАО · м. Строгино" });
    expect(body.items[0].ok).toContain("танцпол");
    const photo = body.items[0].photos[0] as string;
    expect((await get(`/api/offers/${offerId}/photos/${photo}`)).statusCode).toBe(200);
    expect((await get(`/api/offers/${offerId}/photos/${"0".repeat(64)}`)).statusCode).toBe(404);
    expect((await get("/api/offers/neverexistingoffer0000")).statusCode).toBe(404);

    const requests = (await get("/api/venue-requests", owner)).json() as Array<Record<string, unknown>>;
    expect(requests.find((r) => r.id === "request-0001")).toMatchObject({ status: "sent", offers: 1 });
    const offers = (await get("/api/venue-offers?request=request-0001", owner)).json();
    expect(offers[0]).toMatchObject({ id: offerId, venues: ["Белая веранда", "Лофт «Кирпич»"] });

    // Площадку удалили из базы — отправленная ссылка открывается как раньше.
    await app.inject({ method: "DELETE", url: "/api/venues/manual-venue-01", headers: headers(owner) });
    expect((await get(`/api/offers/${offerId}`)).json().items).toHaveLength(2);
    expect((await patch("/api/venue-requests/request-0001", { status: "agreed", notes: "Выбрали веранду" }, owner)).json()).toMatchObject({ status: "agreed" });
  });
});
