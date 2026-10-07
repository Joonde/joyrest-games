import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_UID } from "../../src/data/config";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { imageMime, parseGameInput } from "./games";
import { migrate } from "./migrate";

/** Похожие на настоящие файлы: тип проверяется по первым байтам. */
function webp(size: number, fill = 1): Buffer {
  const body = Buffer.alloc(Math.max(0, size - 12), fill);
  return Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), body]);
}
const jpeg = (size: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(Math.max(0, size - 3), 7)]);

describe("картинки: тип по первым байтам", () => {
  it("WebP и JPEG — да, остальное — нет", () => {
    expect(imageMime(webp(100))).toBe("image/webp");
    expect(imageMime(jpeg(100))).toBe("image/jpeg");
    expect(imageMime(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(imageMime(Buffer.from("GIF89a"))).toBeNull();
  });
});

describe("игра из запроса", () => {
  it("лишние поля отбрасываются, неизвестные значения — по умолчанию", () => {
    expect(
      parseGameInput({ scope: "personal", ownerId: "u1", title: "Квиз", mechanic: "quiz", themeId: "joyrest", ageRating: "21+", playMode: "x", content: { q: 1 }, id: "x", createdAt: 1 }),
    ).toEqual({ scope: "personal", ownerId: "u1", title: "Квиз", mechanic: "quiz", themeId: "joyrest", ageRating: "0+", playMode: "solo", content: { q: 1 } });
    expect(parseGameInput({ scope: "global", ownerId: "u1", title: "", mechanic: "quiz", themeId: "j" })).toBeNull();
  });
});

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("игры и картинки на PostgreSQL", () => {
  const SCHEMA = "games_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const mediaDir = mkdtempSync(join(tmpdir(), "joyrest-media-"));
  const siteDir = mkdtempSync(join(tmpdir(), "joyrest-site-"));
  writeFileSync(join(siteDir, "index.html"), "<html></html>");
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    mediaDir,
    auth: { limits: { perAccount: 1000, perIp: 1000 } },
    games: { freeBytes: async () => 100 * 1024 ** 3 },
    site: { dir: siteDir, enabled: false, stubDir: null, hosts: ["site.test"], indexing: false },
  });
  const OWNER = { email: "owner@example.com", password: "пароль-владельца-12" };
  let owner = "";
  let anna = "";
  let annaId = "";
  let boris = "";

  function cookieOf(res: { headers: Record<string, unknown> }): string {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  }

  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, cookie: string, payload?: object) =>
    app.inject({ method, url: path, headers: method === "GET" ? { host: HOST, cookie } : headers(cookie), payload });
  const put = (path: string, cookie: string, bytes: Buffer, type = "image/webp", size = { w: "1280", h: "720" }) =>
    app.inject({ method: "PUT", url: path, headers: { ...headers(cookie), "content-type": type, "x-width": size.w, "x-height": size.h }, payload: bytes });

  async function login(email: string, password: string): Promise<string> {
    const res = await call("POST", "/api/auth/login", "", { email, password });
    expect(res.statusCode, res.body).toBe(200);
    return cookieOf(res);
  }

  async function addHost(email: string, name: string): Promise<{ cookie: string; uid: string }> {
    const created = (await call("POST", "/api/users", owner, { email, name })).json();
    const cookie = await login(email, created.temporaryPassword);
    return { cookie, uid: created.account.uid };
  }

  const draft = (ownerId: string, scope: "agency" | "personal" = "personal") => ({
    scope,
    ownerId,
    title: "Квиз",
    mechanic: "quiz",
    themeId: "joyrest",
    ageRating: "0+",
    playMode: "solo",
    content: { questions: [{ id: "q1", text: "Столица?", imageId: "img1" }] },
  });

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, OWNER.email, OWNER.password);
    owner = await login(OWNER.email, OWNER.password);
    ({ cookie: anna, uid: annaId } = await addHost("anna@example.com", "Аня"));
    ({ cookie: boris } = await addHost("boris@example.com", "Борис"));
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("без входа — 401, на адресе сайта — 404", async () => {
    expect((await call("GET", "/api/games?scope=agency", "")).statusCode).toBe(401);
    const site = await app.inject({ method: "GET", url: "/api/games?scope=agency", headers: { host: "site.test", cookie: owner } });
    expect(site.statusCode).toBe(404);
  });

  it("ведущий создаёт личную игру; повтор того же запроса — та же игра; чужой id — ошибка", async () => {
    const res = await call("POST", "/api/games", anna, { ...draft(annaId), id: "annaGame1" });
    expect(res.statusCode, res.body).toBe(200);
    expect((await call("POST", "/api/games", anna, { ...draft(annaId), id: "annaGame1" })).statusCode).toBe(200);
    expect((await call("POST", "/api/games", owner, { ...draft(ADMIN_UID), id: "annaGame1" })).statusCode).toBe(409);
    const [{ count }] = await sql<{ count: string }[]>`select count(*)::text as count from games where id = 'annaGame1'`;
    expect(count).toBe("1");
  });

  it("общую библиотеку пополняет только admin; личную игру — только себе", async () => {
    expect((await call("POST", "/api/games", anna, { ...draft(ADMIN_UID, "agency"), id: "agencyByAnna" })).statusCode).toBe(403);
    expect((await call("POST", "/api/games", anna, { ...draft(ADMIN_UID), id: "forOwner" })).statusCode).toBe(403);
    expect((await call("POST", "/api/games", owner, { ...draft(ADMIN_UID, "agency"), id: "agency1" })).statusCode).toBe(200);
  });

  it("общую библиотеку видят все ведущие, личные игры — владелец и admin", async () => {
    const agency = (await call("GET", "/api/games?scope=agency", boris)).json();
    expect(agency.map((g: { id: string }) => g.id)).toContain("agency1");
    expect((await call("GET", `/api/games?scope=personal&owner=${annaId}`, boris)).statusCode).toBe(403);
    expect((await call("GET", "/api/games/annaGame1", boris)).statusCode).toBe(403);
    const mine = (await call("GET", `/api/games?scope=personal&owner=${annaId}`, anna)).json();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: "annaGame1", scope: "personal", ownerId: annaId, title: "Квиз", content: draft(annaId).content });
    expect((await call("GET", `/api/games?scope=personal&owner=${annaId}`, owner)).statusCode).toBe(200);
    expect((await call("GET", "/api/games/nope", anna)).statusCode).toBe(404);
  });

  it("правка: содержимое целиком, название и тема; чужую игру не изменить", async () => {
    const before = (await call("GET", "/api/games/annaGame1", anna)).json();
    await new Promise((r) => setTimeout(r, 5));
    const content = { questions: [{ id: "q1", text: "Новый вопрос", options: ["а", "б"], imageId: null }], rounds: [{ n: 1 }] };
    const res = await call("PATCH", "/api/games/annaGame1", anna, { title: "Квиз 2", themeId: "joyrest-day", content });
    expect(res.statusCode, res.body).toBe(200);
    const after = (await call("GET", "/api/games/annaGame1", anna)).json();
    expect(after).toMatchObject({ title: "Квиз 2", themeId: "joyrest-day", content, scope: "personal", ownerId: annaId });
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect((await call("PATCH", "/api/games/annaGame1", boris, { title: "взлом" })).statusCode).toBe(403);
    expect((await call("PATCH", "/api/games/agency1", anna, { title: "взлом" })).statusCode).toBe(403);
  });

  it("картинка: загрузка, выдача с кэшем на год и ETag, повтор — успех, другая под тем же id — нет", async () => {
    const image = webp(5000, 3);
    expect((await put("/api/media/annaGame1/img1/full", anna, image)).statusCode).toBe(200);
    expect((await put("/api/media/annaGame1/img1/full", anna, image)).statusCode).toBe(200);
    expect((await put("/api/media/annaGame1/img1/full", anna, webp(5000, 4))).statusCode).toBe(409);

    const res = await call("GET", "/api/media/annaGame1/img1/full", anna);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(image)).toBe(true);
    expect(res.headers["content-type"]).toBe("image/webp");
    expect(res.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    const etag = String(res.headers.etag);
    const again = await app.inject({ method: "GET", url: "/api/media/annaGame1/img1/full", headers: { host: HOST, cookie: anna, "if-none-match": etag } });
    expect(again.statusCode).toBe(304);
    expect((await call("GET", "/api/media/annaGame1/img1/small", anna)).statusCode).toBe(404);
  });

  it("картинка: только WebP/JPEG, с размерами, в пределах веса варианта и только в свою игру", async () => {
    expect((await put("/api/media/annaGame1/img2/full", anna, Buffer.from("<svg/>"), "image/webp")).statusCode).toBe(400);
    expect((await put("/api/media/annaGame1/img2/full", anna, jpeg(2000), "image/jpeg", { w: "0", h: "10" })).statusCode).toBe(400);
    expect((await put("/api/media/annaGame1/img2/small", anna, webp(200 * 1024))).statusCode).toBe(413);
    expect((await put("/api/media/annaGame1/img2/full", boris, webp(1000))).statusCode).toBe(403);
    expect((await put("/api/media/annaGame1/img2/full", anna, jpeg(2000), "image/jpeg")).statusCode).toBe(200);
    expect((await call("GET", "/api/media/annaGame1/img2/full", anna)).headers["content-type"]).toBe("image/jpeg");
    expect((await call("GET", "/api/media/annaGame1/img2/full", boris)).statusCode).toBe(403);
  });

  it("лимит места на ведущего и запас свободного места на диске", async () => {
    const tight = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, mediaDir, games: { limits: { perHostBytes: 10_000 }, freeBytes: async () => 100 * 1024 ** 3 } });
    const full = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, mediaDir, games: { freeBytes: async () => 1024 ** 3 } });
    const send = (target: typeof app) =>
      target.inject({ method: "PUT", url: "/api/media/annaGame1/img3/full", headers: { ...headers(anna), "content-type": "image/webp", "x-width": "10", "x-height": "10" }, payload: webp(8000, 9) });
    const quota = await send(tight);
    expect(quota.statusCode).toBe(413);
    expect(quota.json()).toEqual({ error: "resource-exhausted" });
    expect((await send(full)).statusCode).toBe(507);
    await tight.close();
    await full.close();
  });

  it("копия игры ссылается на те же файлы картинок; удаление картинки и игры", async () => {
    const files = readdirSync(mediaDir).length;
    const res = await call("POST", "/api/games/annaCopy1/copy", anna, { sourceId: "annaGame1", mediaIds: ["img1", "img1"], game: { ...draft(annaId), title: "Копия" } });
    expect(res.statusCode, res.body).toBe(200);
    expect((await call("GET", "/api/media/annaCopy1/img1/full", anna)).statusCode).toBe(200);
    expect((await call("GET", "/api/media/annaCopy1/img2/full", anna)).statusCode).toBe(404);
    expect(readdirSync(mediaDir).length).toBe(files);
    // Чужую личную игру скопировать нельзя.
    expect((await call("POST", "/api/games/borisCopy/copy", boris, { sourceId: "annaGame1", mediaIds: [], game: draft("x") })).statusCode).toBe(403);

    expect((await call("DELETE", "/api/media/annaCopy1/img1", anna)).statusCode).toBe(200);
    expect((await call("GET", "/api/media/annaCopy1/img1/full", anna)).statusCode).toBe(404);
    // У оригинала картинка осталась.
    expect((await call("GET", "/api/media/annaGame1/img1/full", anna)).statusCode).toBe(200);

    expect((await call("DELETE", "/api/games/annaGame1", boris)).statusCode).toBe(403);
    expect((await call("DELETE", "/api/games/annaGame1", anna)).statusCode).toBe(200);
    expect((await call("GET", "/api/games/annaGame1", anna)).statusCode).toBe(404);
    const [{ count }] = await sql<{ count: string }[]>`select count(*)::text as count from media where game_id = 'annaGame1'`;
    expect(count).toBe("0");
  });
});
