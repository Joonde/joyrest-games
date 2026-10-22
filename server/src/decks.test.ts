import { mkdtempSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imageSlide } from "../../src/core/slides";
import { parseSlide } from "../../src/data/cues";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { cleanupDeckPages } from "./cleanup";
import { deckBytes } from "./decks";
import { migrate } from "./migrate";

const webp = (fill: number) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 0), Buffer.from("WEBP"), Buffer.alloc(300, fill)]);
const SHA = "a".repeat(64);

describe("место под показы", () => {
  it("одинаковые файлы считаются один раз", () => {
    expect(deckBytes(new Map([["a", 100], ["b", 50]]))).toBe(150);
    expect(deckBytes(new Map())).toBe(0);
  });
});

describe("слайд «фото и PDF»", () => {
  it("страница показа проходит проверку сервера; без файла или с чужим номером — нет", () => {
    const deck = { id: "d1", title: "Меню", pages: [{ sha: SHA, w: 1920, h: 1080, size: 1000 }, { sha: "b".repeat(64), w: 1080, h: 1920, size: 900 }] };
    const slide = imageSlide("s1", deck, 0);
    expect(slide).not.toBeNull();
    expect(parseSlide(slide)).toEqual(slide);
    expect(slide?.media).toMatchObject({ page: 0, count: 2, next: "b".repeat(64) });
    expect(imageSlide("s2", deck, 1)?.media?.next).toBeNull();
    expect(imageSlide("s3", deck, 2)).toBeNull();
    expect(parseSlide({ ...slide, media: null })).toBeNull();
    expect(parseSlide({ ...slide, media: { ...slide?.media, page: 5 } })).toBeNull();
    expect(parseSlide({ ...slide, media: { ...slide?.media, sha: "../etc" } })).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("показы на PostgreSQL", () => {
  const SCHEMA = "decks_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const mediaDir = mkdtempSync(join(tmpdir(), "joyrest-decks-"));
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
  const page = (cookie: string, body: Buffer, w = 1920, h = 1080) =>
    app.inject({ method: "PUT", url: "/api/decks/page", headers: { ...headers(cookie), "content-type": "image/webp", "x-width": String(w), "x-height": String(h) }, payload: body });
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

  let p1 = { sha: "", w: 0, h: 0, size: 0 };
  let p2 = { sha: "", w: 0, h: 0, size: 0 };

  it("страницы: картинка с размерами — да; без размеров, не картинка, без входа — нет", async () => {
    expect((await page("", webp(1))).statusCode).toBe(401);
    expect((await page(anna, Buffer.from("%PDF-1.7 not an image"))).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/decks/page", headers: { ...headers(anna), "content-type": "image/webp" }, payload: webp(1) })).statusCode).toBe(400);
    p1 = (await page(anna, webp(1))).json();
    p2 = (await page(anna, webp(2), 1080, 1920)).json();
    expect(p1).toMatchObject({ w: 1920, h: 1080 });
    expect(p2).toMatchObject({ w: 1080, h: 1920 });
    const device = cookieOf(await post("/api/auth/device", "", {}));
    expect((await get(`/api/decks/page/${p1.sha}`, device)).statusCode).toBe(200);
    expect((await get(`/api/decks/page/${p1.sha}`, "")).statusCode).toBe(401);
  });

  it("показ: свой, порядок страниц, правка тем же id, чужой — не тронуть, удалить", async () => {
    expect((await post("/api/decks", anna, { id: "d1", title: "Меню", pages: [{ ...p1 }, { sha: "f".repeat(64), w: 10, h: 10, size: 10 }] })).statusCode).toBe(400);
    const saved = (await post("/api/decks", anna, { id: "d1", title: "  Меню\nбанкета ", pages: [p1, p2] })).json();
    expect(saved).toMatchObject({ id: "d1", title: "Меню банкета", pages: [p1, p2] });
    expect((await post("/api/decks", anna, { id: "d1", title: "Меню", pages: [p2, p1] })).json().pages).toEqual([p2, p1]);
    expect((await get("/api/decks", boris)).json().decks).toEqual([]);
    expect((await post("/api/decks", boris, { id: "d1", title: "Чужой", pages: [] })).statusCode).toBe(404);
    await app.inject({ method: "DELETE", url: "/api/decks/d1", headers: headers(boris) });
    expect((await get("/api/decks", anna)).json().decks.map((d: { id: string }) => d.id)).toEqual(["d1"]);
    expect((await post("/api/decks", anna, { id: "d2", title: "Лишний", pages: [p1] })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/api/decks/d2", headers: headers(anna) })).statusCode).toBe(200);
    expect((await get("/api/decks", anna)).json().decks).toHaveLength(1);
  });

  it("размер страницы — с диска, а не из запроса (лимит места не обмануть)", async () => {
    const saved = (await post("/api/decks", anna, { id: "d3", title: "Маленький", pages: [{ ...p1, size: 1 }] })).json();
    expect(saved.pages[0].size).toBe(p1.size);
    expect(p1.size).toBe(webp(1).length);
    expect((await app.inject({ method: "DELETE", url: "/api/decks/d3", headers: headers(anna) })).statusCode).toBe(200);
  });

  it("страница на экране зала: пульт показывает, после «Завершить игру» тоже можно", async () => {
    await post("/api/sessions", anna, { id: "s1", gameTitle: "Квиз", mechanic: "quiz", gameSnapshot: {}, themeId: "joyrest", playMode: "solo", screenMode: "laptop" });
    const slide = imageSlide("x1", { id: "d1", title: "Меню", pages: [p2, p1] }, 1);
    expect((await post("/api/sessions/s1/apply", anna, { state: { slide } })).statusCode).toBe(200);
    const device = cookieOf(await post("/api/auth/device", "", {}));
    expect((await get("/api/sessions/s1", device)).json().state.slide.media).toMatchObject({ page: 1, count: 2, sha: p1.sha, next: null });
    expect((await post("/api/sessions/s1/apply", boris, { state: { slide } })).statusCode).toBe(403);
  });

  it("ночная уборка: страница без показа уходит, страница показа и слайда — остаётся", async () => {
    const orphan = (await page(anna, webp(9))).json().sha as string;
    await post("/api/decks", anna, { id: "d1", title: "Меню", pages: [p2] });
    const dir = join(mediaDir, "slides");
    const old = Date.now() / 1000 - 10 * 86_400;
    for (const name of readdirSync(dir)) utimesSync(join(dir, name), old, old);
    await cleanupDeckPages(sql, mediaDir);
    const left = readdirSync(dir);
    expect(left).toContain(p2.sha);
    // p1 — на слайде сессии s1.
    expect(left).toContain(p1.sha);
    expect(left).not.toContain(orphan);
  });
});
