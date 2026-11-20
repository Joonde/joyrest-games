import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("записи «Танцуй как звезда» на PostgreSQL", () => {
  const SCHEMA = "dance_attempts_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const app = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } } });
  let owner = "";
  let guest = "";
  let guestId = "";
  const cookieOf = (res: { headers: Record<string, unknown> }) => (Array.isArray(res.headers["set-cookie"]) ? String(res.headers["set-cookie"][0]) : String(res.headers["set-cookie"] ?? "")).split(";")[0] ?? "";
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const payload = (id = "attempt0001") => ({
    id,
    sessionId: "session1",
    tileId: "dance1",
    songKey: "bailar",
    dancer: 1,
    recording: { v: 2, song: "bailar", dancer: 1, calib_events: [{ t: 0, accg: [0, 0, 9.8] }], events: [{ t: 0, accg: [0, 0, 9.8] }, { t: 1, accg: [0.1, 0, 9.8] }] },
    result: { ok: true, percent: 87, points: 870, max: 1000, cards: [{ grade: "PERFECT", score: 91 }], lag: 0.12 },
  });

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = cookieOf(await post("/api/auth/login", "", { email: "owner@example.com", password: "пароль-владельца-12" }));
    const users = await sql<{ id: string }[]>`select id from users where email = 'owner@example.com'`;
    const hostId = users[0]?.id ?? "owner";
    guest = cookieOf(await post("/api/auth/device", ""));
    const devices = await sql<{ id: string }[]>`select id from devices order by created_at desc limit 1`;
    guestId = devices[0]?.id ?? "guest";
    const content = { variant: "dance", categories: [{ id: "c1", title: "Танцы" }], tiles: [{ id: "dance1", cat: "c1", points: 300, kind: "perform", who: "m1", motionSong: "bailar" }], gift: 0, voteTime: 20, battleLock: false };
    await sql`insert into sessions (id, code, host_id, game_id, game_title, mechanic, game_snapshot, play_mode, state, leaderboard) values ('session1', '123456', ${hostId}, 'game1', 'Танцы', 'stage', ${sql.json({ content })}, 'teams', ${sql.json({ phase: "playing", step: 1, stage: "question" })}, '{}')`;
    await sql`insert into participants (session_id, id, name, kind, team_id, captain_uid) values ('session1', ${guestId}, 'Аня', 'player', 'A', ${guestId})`;
  });
  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("гость сохраняет запись и анализ; повтор не создаёт дубль; ведущий читает результат", async () => {
    expect((await post("/api/dance-attempts", "", payload())).statusCode).toBe(401);
    const saved = await post("/api/dance-attempts", guest, payload());
    expect(saved.statusCode).toBe(200);
    expect(saved.json().attempt).toMatchObject({ id: "attempt0001", sessionId: "session1", tileId: "dance1", percent: 87, teamId: "A", playerName: "Аня" });
    expect((await post("/api/dance-attempts", guest, payload())).statusCode).toBe(200);
    expect((await sql`select count(*)::int as n from dance_attempts`)[0]?.n).toBe(1);
    const list = await get("/api/dance-attempts?sessionId=session1&tileId=dance1", owner);
    expect(list.statusCode).toBe(200);
    expect(list.json().attempts).toHaveLength(1);
    const full = await get("/api/dance-attempts/attempt0001?sessionId=session1", owner);
    expect(full.statusCode).toBe(200);
    expect(full.json().recording.events).toHaveLength(2);
    expect(full.json().analysis.percent).toBe(87);
  });

  it("чужой танец и чужое устройство отклоняются", async () => {
    expect((await post("/api/dance-attempts", guest, { ...payload("attempt0002"), songKey: "animals" })).statusCode).toBe(409);
    const other = cookieOf(await post("/api/auth/device", ""));
    expect((await post("/api/dance-attempts", other, payload("attempt0003"))).statusCode).toBe(403);
  });

  it("удаление старой сессии не стирает запись для калибровки", async () => {
    await sql`delete from sessions where id = 'session1'`;
    expect((await sql`select count(*)::int as n from dance_attempts where id = 'attempt0001'`)[0]?.n).toBe(1);
  });
});
