import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";
import { cleanupVideos, videoMime } from "./videos";

/** «Видео»: заголовок MP4 (ftyp) и содержимое. */
const mp4 = (length: number, fill = 7) => {
  const body = Buffer.alloc(length, fill);
  Buffer.from([0, 0, 0, 0x20]).copy(body, 0);
  Buffer.from("ftypisom").copy(body, 4);
  return body;
};

describe("видео: проверки без базы", () => {
  it("тип видео по первым байтам", () => {
    expect(videoMime(mp4(64))).toBe("video/mp4");
    expect(videoMime(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  ")]))).toBe("video/quicktime");
    expect(videoMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]))).toBe("video/webm");
    expect(videoMime(Buffer.from("<html>not a video"))).toBeNull();
    expect(videoMime(Buffer.from("ID3....."))).toBeNull();
  });
});

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("видео JoyRest на PostgreSQL", () => {
  const SCHEMA = "videos_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const mediaDir = mkdtempSync(join(tmpdir(), "joyrest-video-"));
  const CHUNK = 64 * 1024;
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    mediaDir,
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
  });
  let owner = "";
  let deputy = "";
  let host = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string, extra: Record<string, string> = {}) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie, ...extra } });
  const chunk = (id: string, cookie: string, offset: number, body: Buffer) =>
    app.inject({ method: "PUT", url: `/api/videos/${id}/chunk?offset=${offset}`, headers: { ...headers(cookie), "content-type": "application/octet-stream" }, payload: body });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));

  /** Загрузить файл частями, как браузер: каждая следующая часть — с `received` из ответа. */
  async function uploadAll(id: string, cookie: string, file: Buffer) {
    let state = { received: 0, ready: false };
    for (let guard = 0; guard < 100 && !state.ready; guard++) {
      const res = await chunk(id, cookie, state.received, file.subarray(state.received, state.received + CHUNK));
      expect(res.statusCode).toBe(200);
      state = res.json();
    }
    return state;
  }

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    for (const [email, name] of [["deputy@example.com", "Зам"], ["host@example.com", "Ведущий"]] as const) {
      const created = (await post("/api/users", owner, { email, name })).json();
      const cookie = await login(email, created.temporaryPassword);
      if (name === "Зам") {
        deputy = cookie;
        expect((await post(`/api/users/${created.account.uid}/access`, owner, { role: "deputy" })).statusCode).toBe(200);
      } else host = cookie;
    }
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("загружают владелец и заместитель, ведущий — нет", async () => {
    expect((await post("/api/videos", host, { id: "v0", title: "Танец", size: 1000 })).statusCode).toBe(403);
    expect((await post("/api/videos", deputy, { id: "v1", title: "Танец 1", folder: "Just Dance", size: 150_000, durationMs: 120_000 })).statusCode).toBe(200);
    expect((await post("/api/videos", owner, { id: "big", title: "Огромное", size: 5 * 1024 * 1024 * 1024 })).statusCode).toBe(413);
    // Повтор с тем же размером — то же видео (дозагрузка), другой размер — id занят.
    expect((await post("/api/videos", deputy, { id: "v1", title: "Танец 1", size: 150_000 })).json()).toMatchObject({ id: "v1", received: 0, ready: false });
    expect((await post("/api/videos", deputy, { id: "v1", title: "Танец 1", size: 99 })).statusCode).toBe(409);
  });

  it("файл частями: не на своём месте не пишется, повтор безопасен, готовое видео видят все", async () => {
    const file = mp4(150_000);
    expect((await chunk("v1", host, 0, file.subarray(0, CHUNK))).statusCode).toBe(403);
    // Не видео — отказ, загрузку можно начать заново.
    expect((await chunk("v1", deputy, 0, Buffer.alloc(CHUNK, 1))).statusCode).toBe(400);
    expect((await chunk("v1", deputy, 0, file.subarray(0, CHUNK))).json()).toMatchObject({ received: CHUNK, ready: false });
    // Повтор той же части (ответ потерялся) и часть «из будущего» — ничего не меняют.
    expect((await chunk("v1", deputy, 0, file.subarray(0, CHUNK))).json()).toMatchObject({ received: CHUNK });
    expect((await chunk("v1", deputy, CHUNK * 2, file.subarray(CHUNK * 2, CHUNK * 3))).json()).toMatchObject({ received: CHUNK });
    // Недогруженное видит загружающий, ведущий — нет.
    expect((await get("/api/videos", host)).json().videos).toEqual([]);
    expect((await get("/api/videos", deputy)).json().videos.map((v: { id: string }) => v.id)).toEqual(["v1"]);
    const done = await uploadAll("v1", deputy, file);
    expect(done).toMatchObject({ ready: true, received: 150_000 });
    const list = (await get("/api/videos", host)).json();
    expect(list.videos).toHaveLength(1);
    expect(list.videos[0]).toMatchObject({ id: "v1", title: "Танец 1", folder: "Just Dance", ready: true, mime: "video/mp4", durationMs: 120_000, ownerName: "Зам" });
    expect(list.usedBytes).toBe(150_000);
    expect(readdirSync(join(mediaDir, "video")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("файл открывает экран зала, частями по Range; без входа — нет", async () => {
    const device = cookieOf(await post("/api/auth/device", "", {}));
    const whole = await get("/api/videos/v1/file", device);
    expect(whole.statusCode).toBe(200);
    expect(whole.headers["content-type"]).toContain("video/mp4");
    expect(whole.rawPayload.length).toBe(150_000);
    const part = await get("/api/videos/v1/file", device, { range: "bytes=100-199" });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe("bytes 100-199/150000");
    expect(part.rawPayload.length).toBe(100);
    expect((await get("/api/videos/v1/file", device, { range: "bytes=200000-" })).statusCode).toBe(416);
    expect((await get("/api/videos/v1/file", "")).statusCode).toBe(401);
  });

  it("название и папку правят владелец и заместитель; убрать — тоже они", async () => {
    const patch = (cookie: string, payload: object) => app.inject({ method: "PATCH", url: "/api/videos/v1", headers: headers(cookie), payload });
    expect((await patch(host, { title: "Чужое" })).statusCode).toBe(403);
    expect((await patch(owner, { title: "Танец под диско", folder: "Диско" })).json()).toMatchObject({ title: "Танец под диско", folder: "Диско" });
    expect((await patch(deputy, { title: "  " })).statusCode).toBe(400);
    const del = (cookie: string, id = "v1") => app.inject({ method: "DELETE", url: `/api/videos/${id}`, headers: headers(cookie) });
    expect((await del(host)).statusCode).toBe(403);
    // Видео владельца заместитель не убирает и не дописывает.
    expect((await post("/api/videos", owner, { id: "own1", title: "Видео владельца", size: 100_000 })).statusCode).toBe(200);
    expect((await chunk("own1", deputy, 0, mp4(CHUNK))).statusCode).toBe(403);
    expect((await del(deputy, "own1")).statusCode).toBe(403);
    expect((await del(owner, "own1")).statusCode).toBe(200);
    expect((await del(deputy)).statusCode).toBe(200);
    expect((await get("/api/videos/v1/file", owner)).statusCode).toBe(404);
  });

  it("ночная уборка: файл без ссылок и брошенная загрузка", async () => {
    const dir = join(mediaDir, "video");
    await post("/api/videos", owner, { id: "half", title: "Брошено", size: 200_000 });
    await chunk("half", owner, 0, mp4(CHUNK));
    const old = Date.now() / 1000 - 10 * 86_400;
    for (const name of readdirSync(dir)) utimesSync(join(dir, name), old, old);
    writeFileSync(join(dir, "stray.tmp"), "x");
    utimesSync(join(dir, "stray.tmp"), old, old);
    await sql`update videos set updated_at = now() - interval '10 days' where id = 'half'`;
    const removed = await cleanupVideos(sql, mediaDir);
    expect(removed).toBe(3);
    expect(readdirSync(dir)).toEqual([]);
    expect(await sql`select id from videos`).toEqual([]);
  });
});
