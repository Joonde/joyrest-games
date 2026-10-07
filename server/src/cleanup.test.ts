import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { cleanupDevices, cleanupMedia } from "./cleanup";
import { migrate } from "./migrate";

const DAY = 24 * 60 * 60_000;
const sha = (c: string) => c.repeat(64);

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("уборка на PostgreSQL", () => {
  const SCHEMA = "cleanup_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const mediaDir = mkdtempSync(join(tmpdir(), "joyrest-media-"));
  const app = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, mediaDir, auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } } });
  let owner = "";
  let ownerUid = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const post = (path: string, cookie: string, payload: object) =>
    app.inject({ method: "POST", url: path, headers: { host: HOST, "x-joyrest": "1", cookie }, payload });

  async function session(id: string, daysAgo: number, board: object) {
    await sql`
      insert into sessions (id, code, host_id, game_title, state, leaderboard, created_at)
      values (${id}, ${String(100000 + Math.floor(Math.random() * 899999))}, ${ownerUid}, 'Квиз',
              ${sql.json({ phase: "playing" })}, ${sql.json(board as never)}, ${new Date(Date.now() - daysAgo * DAY)})`;
  }

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    const res = await post("/api/auth/login", "", { email: "owner@example.com", password: "пароль-владельца-12" });
    owner = cookieOf(res);
    ownerUid = res.json().user.uid;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("сессии старше 30 дней удаляются вместе с участниками и ответами; итоги незавершённой игры сохраняются", async () => {
    await session("old1", 40, { p1: { name: "Аня", kind: "player", score: 7 } });
    await session("old2", 35, {});
    await session("fresh", 5, { p1: { name: "Боря", kind: "player", score: 3 } });
    await sql`insert into participants (session_id, id, name, kind, captain_uid) values ('old1', 'p1', 'Аня', 'player', 'p1')`;
    await sql`insert into answers (session_id, step, pid, uid, value) values ('old1', 0, 'p1', 'p1', ${sql.json(1)})`;

    // Ведущий и гость чистить не могут.
    const guest = cookieOf(await post("/api/auth/device", "", {}));
    expect((await post("/api/sessions/cleanup", guest, { cutoff: Date.now() })).statusCode).toBe(403);

    // Даже «удали всё до сейчас» не трогает сессии свежее 30 дней.
    const res = await post("/api/sessions/cleanup", owner, { cutoff: Date.now() });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ deleted: 2, more: false });
    const left = (await sql<{ id: string }[]>`select id from sessions order by id`).map((r) => r.id);
    expect(left).toEqual(["fresh"]);
    expect((await sql`select 1 from participants where session_id = 'old1'`).length).toBe(0);
    expect((await sql`select 1 from answers where session_id = 'old1'`).length).toBe(0);

    const [result] = await sql<{ participants_count: number; board: unknown }[]>`select participants_count, board from results where id = 'old1'`;
    expect(result).toEqual({ participants_count: 1, board: [{ name: "Аня", score: 7 }] });
    // Пустую игру в историю не пишем.
    expect((await sql`select 1 from results where id = 'old2'`).length).toBe(0);
  });

  it("картинки без ссылок старше 7 дней удаляются, со ссылками и свежие — остаются", async () => {
    const old = Date.now() - 8 * DAY;
    const write = (name: string, at: number) => {
      const path = join(mediaDir, name);
      writeFileSync(path, "x");
      utimesSync(path, at / 1000, at / 1000);
      return path;
    };
    const orphan = write(sha("a"), old);
    const used = write(sha("b"), old);
    const fresh = write(sha("c"), Date.now() - DAY);
    const temp = write(`${sha("d")}.abc123.tmp`, Date.now() - 2 * DAY);
    const other = write("README", old);
    await sql`insert into games (id, scope, owner_id) values ('g1', 'personal', ${ownerUid})`;
    await sql`insert into media (game_id, media_id, variant, sha256, mime, width, height, size) values ('g1', 'm1', 'full', ${sha("b")}, 'image/webp', 1, 1, 1)`;

    expect(await cleanupMedia(sql, mediaDir)).toBe(2);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(temp)).toBe(false);
    expect(existsSync(used)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it("устройства гостей старше 180 дней удаляются", async () => {
    await sql`insert into devices (id, token_hash, created_at) values ('oldDevice', 'h-old', ${new Date(Date.now() - 181 * DAY)})`;
    await sql`insert into devices (id, token_hash) values ('newDevice', 'h-new')`;
    expect(await cleanupDevices(sql)).toBe(1);
    expect((await sql`select id from devices where id in ('oldDevice', 'newDevice')`).map((r) => r.id)).toEqual(["newDevice"]);
  });
});
