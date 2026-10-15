import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { logoMime } from "./branding";
import { cleanupBrandLogos } from "./cleanup";
import { migrate } from "./migrate";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 3)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 0), Buffer.from("WEBP"), Buffer.alloc(200, 5)]);

describe("логотип заказчика: тип по первым байтам", () => {
  it("PNG, WebP, JPEG — да; SVG и HTML — нет", () => {
    expect(logoMime(PNG)).toBe("image/png");
    expect(logoMime(WEBP)).toBe("image/webp");
    expect(logoMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(logoMime(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(logoMime(Buffer.from("<html>"))).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("оформление под заказчика на PostgreSQL", () => {
  const SCHEMA = "branding_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const mediaDir = mkdtempSync(join(tmpdir(), "joyrest-brand-"));
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    mediaDir,
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
  });
  let owner = "";
  let anna = "";
  let boris = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const put = (cookie: string, body: Buffer, type: string) => app.inject({ method: "PUT", url: "/api/brandings/logo", headers: { ...headers(cookie), "content-type": type }, payload: body });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    const a = (await post("/api/users", owner, { email: "anna@example.com", name: "Анна" })).json();
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

  let logo = "";

  it("логотип: ведущий загружает PNG; не картинка и без входа — отказ; открывает и экран зала", async () => {
    expect((await put("", PNG, "image/png")).statusCode).toBe(401);
    expect((await put(anna, Buffer.from("<svg></svg>xxxxxxxxxxxx"), "image/png")).statusCode).toBe(400);
    const res = await put(anna, PNG, "image/png");
    expect(res.statusCode).toBe(200);
    logo = res.json().logo;
    expect(logo).toMatch(/^[0-9a-f]{64}$/);
    // Тот же файл ещё раз — тот же отпечаток.
    expect((await put(anna, PNG, "image/png")).json().logo).toBe(logo);
    const device = cookieOf(await post("/api/auth/device", "", {}));
    const file = await get(`/api/brandings/logo/${logo}`, device);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("image/png");
    expect((await get(`/api/brandings/logo/${logo}`, "")).statusCode).toBe(401);
    expect((await get("/api/brandings/logo/../../etc", device)).statusCode).toBe(404);
  });

  it("сохранённые оформления: свои, правка тем же id, чужое не тронуть, удалить", async () => {
    expect((await post("/api/brandings", anna, { id: "b1", name: "Пусто", colors: [] })).statusCode).toBe(400);
    const saved = await post("/api/brandings", anna, { id: "b1", name: "ООО «Ромашка»", colors: ["#ff0000", "nope", "#00ff00", "#0000ff"], logo });
    expect(saved.json()).toMatchObject({ id: "b1", name: "ООО «Ромашка»", colors: ["#FF0000", "#00FF00"], logo });
    expect((await post("/api/brandings", anna, { id: "b1", name: "Ромашка", colors: ["#123456"], logo })).json()).toMatchObject({ name: "Ромашка", colors: ["#123456"] });
    expect((await get("/api/brandings", anna)).json().brandings).toHaveLength(1);
    // Борис не видит и не правит оформление Анны.
    expect((await get("/api/brandings", boris)).json().brandings).toEqual([]);
    expect((await post("/api/brandings", boris, { id: "b1", name: "Чужое", colors: ["#000000"] })).statusCode).toBe(404);
    await app.inject({ method: "DELETE", url: "/api/brandings/b1", headers: headers(boris) });
    expect((await get("/api/brandings", anna)).json().brandings).toHaveLength(1);
    expect((await post("/api/brandings", anna, { id: "b2", name: "Свадьба", colors: ["#F7D9E3"] })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/api/brandings/b2", headers: headers(anna) })).statusCode).toBe(200);
    expect((await get("/api/brandings", anna)).json().brandings.map((b: { id: string }) => b.id)).toEqual(["b1"]);
  });

  it("сессия хранит копию оформления: экран и телефоны её видят; правка сохранённого игру не меняет", async () => {
    const created = await post("/api/sessions", anna, {
      id: "s1",
      gameTitle: "Квиз",
      mechanic: "quiz",
      gameSnapshot: { content: {} },
      themeId: "joyrest",
      playMode: "solo",
      screenMode: "laptop",
      branding: { name: "Ромашка", colors: ["#123456", "#abcdef", "#000000"], logo, junk: "<script>" },
    });
    expect(created.statusCode).toBe(200);
    const device = cookieOf(await post("/api/auth/device", "", {}));
    const session = (await get("/api/sessions/s1", device)).json();
    expect(session.branding).toEqual({ name: "Ромашка", colors: ["#123456", "#ABCDEF"], logo });
    await post("/api/brandings", anna, { id: "b1", name: "Ромашка 2", colors: ["#FF00FF"], logo: null });
    expect((await get("/api/sessions/s1", device)).json().branding.name).toBe("Ромашка");
    // Без оформления — null.
    await post("/api/sessions", anna, { id: "s2", gameTitle: "Квиз", mechanic: "quiz", gameSnapshot: {}, themeId: "joyrest", playMode: "solo", screenMode: "laptop" });
    expect((await get("/api/sessions/s2", device)).json().branding).toBeNull();
  });

  it("ночная уборка: логотип без ссылок через 7 дней — удаляется, логотип сессии — остаётся", async () => {
    const orphan = (await put(anna, WEBP, "image/webp")).json().logo as string;
    const dir = join(mediaDir, "brand");
    const old = Date.now() / 1000 - 10 * 86_400;
    for (const name of readdirSync(dir)) utimesSync(join(dir, name), old, old);
    const temp = `${"a".repeat(64)}.abc123.tmp`;
    writeFileSync(join(dir, temp), "x");
    utimesSync(join(dir, temp), old, old);
    await cleanupBrandLogos(sql, mediaDir);
    const left = readdirSync(dir);
    expect(left).toContain(logo);
    expect(left).not.toContain(orphan);
    expect(left).not.toContain(temp);
  });
});
