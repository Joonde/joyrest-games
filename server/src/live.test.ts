import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { applyChange, checkChange, Hub, normalizeState, sseFrame } from "./live";
import { migrate } from "./migrate";

describe("изменение пульта", () => {
  it("лишние поля состояния отбрасываются, неверные — отказ", () => {
    expect(checkChange({ state: { stage: "question", startedAt: "server", hack: 1 }, leaderboard: { p1: { name: "Аня", kind: "player", score: 10 }, p2: null } })).toEqual({
      state: { stage: "question", startedAt: "server" },
      leaderboard: { p1: { name: "Аня", kind: "player", score: 10 }, p2: null },
    });
    expect(checkChange({ state: { phase: "deleted" } })).toBeNull();
    expect(checkChange({ state: { startedAt: 12345 } })).toBeNull();
    expect(checkChange({ leaderboard: { "../x": null } })).toBeNull();
  });

  it("звук по кнопке ведущего: только известные звуки и короткий id", () => {
    expect(checkChange({ state: { cue: { id: "abc123", sound: "gong" } } })?.state.cue).toEqual({ id: "abc123", sound: "gong" });
    expect(checkChange({ state: { cue: null } })?.state.cue).toBeNull();
    expect(checkChange({ state: { cue: { id: "abc", sound: "siren" } } })).toBeNull();
    expect(checkChange({ state: { cue: { id: "../x", sound: "gong" } } })).toBeNull();
    expect(normalizeState({ cue: { id: "a", sound: "stop" }, phase: "playing" }).cue).toEqual({ id: "a", sound: "stop" });
    expect(normalizeState({ cue: "gong" }).cue).toBeNull();
  });

  it("музыка и микшер: трек по id, громкость 0–100", () => {
    expect(checkChange({ state: { music: { trackId: "t1", playing: true, rev: "r1" } } })?.state.music).toEqual({ trackId: "t1", playing: true, rev: "r1" });
    expect(checkChange({ state: { music: null } })?.state.music).toBeNull();
    expect(checkChange({ state: { music: { trackId: "../x", playing: true, rev: "r" } } })).toBeNull();
    expect(checkChange({ state: { mix: { music: 250, effects: -5, muted: true } } })?.state.mix).toEqual({ music: 100, effects: 0, muted: true });
    expect(checkChange({ state: { mix: "loud" } })).toBeNull();
  });

  it("слайд: известный вид, текст обрезается, пункты без пустых", () => {
    const slide = checkChange({ state: { slide: { id: "s1", kind: "rules", title: "Правила\nигры", text: "x".repeat(500), lines: ["Один", " ", "Два"], endsAt: null } } })?.state.slide;
    expect(slide).toMatchObject({ id: "s1", kind: "rules", title: "Правила игры", lines: ["Один", "Два"], endsAt: null });
    expect(slide?.text.length).toBe(400);
    expect(checkChange({ state: { slide: null } })?.state.slide).toBeNull();
    expect(checkChange({ state: { slide: { id: "s1", kind: "video", title: "" } } })).toBeNull();
  });

  it("время старта шага ставит сервер, null убирает запись таблицы", () => {
    const state = normalizeState({ phase: "playing", step: 2, stage: "ready" });
    const change = checkChange({ state: { stage: "question", startedAt: "server", timeLimit: 20 }, leaderboard: { gone: null, p1: { name: "Аня", kind: "player", score: 5 } } });
    expect(change).not.toBeNull();
    const next = applyChange(state, { gone: { name: "Боря", kind: "player", score: 1 } }, change!, 1_000_000);
    expect(next.state).toMatchObject({ phase: "playing", step: 2, stage: "question", startedAt: 1_000_000, timeLimit: 20 });
    expect(next.leaderboard).toEqual({ p1: { name: "Аня", kind: "player", score: 5 } });
  });

  it("событие для потока сериализуется один раз", () => {
    const event = { type: "patch", version: 2 };
    expect(sseFrame(event)).toBe('data: {"type":"patch","version":2}\n\n');
    expect(sseFrame(event)).toBe(sseFrame(event));
  });

  it("рассылка только подписчикам своего канала, отписка работает", () => {
    const hub = new Hub();
    const got: object[] = [];
    const stop = hub.subscribe("session:a", (e) => got.push(e));
    hub.publish("session:b", { x: 1 });
    hub.publish("session:a", { x: 2 });
    stop();
    hub.publish("session:a", { x: 3 });
    expect(got).toEqual([{ x: 2 }]);
    expect(hub.count("session:a")).toBe(0);
  });
});

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("игра в реальном времени на PostgreSQL", () => {
  const SCHEMA = "live_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 4, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  let clock = 1_800_000_000_000;
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    mediaDir: mkdtempSync(join(tmpdir(), "joyrest-media-")),
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
    live: { now: () => clock, keepAliveMs: 60_000 },
  });
  let host = "";
  let hostUid = "";

  function cookieOf(res: { headers: Record<string, unknown> }): string {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  }

  const call = (method: "GET" | "POST" | "DELETE", path: string, cookie: string, payload?: object) =>
    app.inject({
      method,
      url: path,
      headers: method === "GET" ? { host: HOST, cookie } : { host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie },
      payload,
    });

  async function device(): Promise<{ cookie: string; uid: string }> {
    const res = await call("POST", "/api/auth/device", "");
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: cookieOf(res), uid: res.json().uid };
  }

  async function newSession(id: string, playMode: "solo" | "teams" = "solo"): Promise<string> {
    const res = await call("POST", "/api/sessions", host, {
      id,
      gameId: null,
      gameTitle: "Квиз",
      playMode,
      screenMode: "laptop",
      themeId: "joyrest",
      mechanic: "quiz",
      gameSnapshot: { title: "Квиз", content: { questions: [] } },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().code;
  }

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    const res = await call("POST", "/api/auth/login", "", { email: "owner@example.com", password: "пароль-владельца-12" });
    host = cookieOf(res);
    hostUid = res.json().user.uid;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("гость входит по устройству: cookie __Host-jr_d на 180 дней, повторный вход — тот же гость", async () => {
    const res = await call("POST", "/api/auth/device", "");
    expect(String(res.headers["set-cookie"])).toMatch(/^__Host-jr_d=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax$/);
    const { uid } = res.json();
    expect(res.json().anonymous).toBe(true);
    const again = await call("POST", "/api/auth/device", cookieOf(res));
    expect(again.json().uid).toBe(uid);
    expect(again.headers["set-cookie"]).toBeUndefined();
    // Вошедший ведущий остаётся собой.
    expect((await call("POST", "/api/auth/device", host)).json()).toMatchObject({ uid: hostUid, anonymous: false });
  });

  it("сессию создаёт только ведущий; повтор того же запроса — та же сессия; код из 6 цифр", async () => {
    const guest = await device();
    expect((await call("POST", "/api/sessions", guest.cookie, { id: "nope" })).statusCode).toBe(403);
    const code = await newSession("sess1");
    expect(code).toMatch(/^\d{6}$/);
    expect(await newSession("sess1")).toBe(code);
    const found = await call("GET", `/api/sessions/by-code/${code}`, guest.cookie);
    expect(found.json()).toMatchObject({ id: "sess1", hostId: hostUid, state: { phase: "lobby", step: 0 }, leaderboard: {} });
    expect((await call("GET", `/api/sessions/by-code/${code}`, "")).statusCode).toBe(401);
  });

  it("игра: старт шага по часам сервера, ответ принимается один раз и только вовремя", async () => {
    await newSession("sess2");
    const guest = await device();
    expect((await call("POST", `/api/sessions/sess2/participants/${guest.uid}/join`, guest.cookie, { name: "Аня", teamId: null })).statusCode).toBe(200);
    // Чужой id участника — нельзя.
    expect((await call("POST", "/api/sessions/sess2/participants/other/join", guest.cookie, { name: "X", teamId: null })).statusCode).toBe(403);

    const answer = (value: string) => call("POST", "/api/sessions/sess2/answers", guest.cookie, { step: 0, pid: guest.uid, value });
    expect((await answer("a")).json()).toEqual({ result: "rejected" });

    expect((await call("POST", "/api/sessions/sess2/phase", guest.cookie, { phase: "playing" })).statusCode).toBe(403);
    expect((await call("POST", "/api/sessions/sess2/phase", host, { phase: "playing" })).statusCode).toBe(200);
    const apply = await call("POST", "/api/sessions/sess2/apply", host, { state: { stage: "question", startedAt: "server", timeLimit: 20 } });
    expect(apply.statusCode, apply.body).toBe(200);
    const session = (await call("GET", "/api/sessions/sess2", guest.cookie)).json();
    expect(session.state).toMatchObject({ phase: "playing", step: 0, stage: "question", startedAt: clock, timeLimit: 20 });

    expect((await answer("b")).json()).toEqual({ result: "sent" });
    expect((await answer("c")).json()).toEqual({ result: "rejected" });
    const list = (await call("GET", "/api/sessions/sess2/answers/0", host)).json();
    expect(list).toEqual([{ id: `0_${guest.uid}`, step: 0, pid: guest.uid, uid: guest.uid, value: "b", submittedAt: clock }]);
    expect((await call("GET", "/api/sessions/sess2/answers/0", guest.cookie)).statusCode).toBe(403);

    // Своё видно, чужое — нет.
    expect((await call("GET", `/api/sessions/sess2/answers/0/${guest.uid}`, guest.cookie)).json().value).toBe("b");
    const stranger = await device();
    expect((await call("GET", `/api/sessions/sess2/answers/0/${guest.uid}`, stranger.cookie)).statusCode).toBe(404);

    // Опоздал больше чем на 3 секунды запаса — не принимается.
    await call("POST", `/api/sessions/sess2/participants/${stranger.uid}/join`, stranger.cookie, { name: "Боря", teamId: null });
    clock += 24_000;
    expect((await call("POST", "/api/sessions/sess2/answers", stranger.cookie, { step: 0, pid: stranger.uid, value: "x" })).json()).toEqual({ result: "rejected" });

    expect((await call("DELETE", "/api/sessions/sess2/answers/0", host)).statusCode).toBe(200);
    expect((await call("GET", "/api/sessions/sess2/answers/0", host)).json()).toEqual([]);
  });

  it("команды: создать можно только в режиме команд; ответ отправляет капитан, участник видит ответ команды", async () => {
    await newSession("solo1");
    const guest = await device();
    expect((await call("POST", "/api/sessions/solo1/teams", guest.cookie, { id: "t1", name: "Команда" })).statusCode).toBe(403);

    await newSession("teams1", "teams");
    const captain = await device();
    const member = await device();
    expect((await call("POST", "/api/sessions/teams1/teams", captain.cookie, { id: "teamA", name: "Звёзды" })).json()).toEqual({ id: "teamA" });
    await call("POST", `/api/sessions/teams1/participants/${captain.uid}/join`, captain.cookie, { name: "Капитан", teamId: "teamA" });
    await call("POST", `/api/sessions/teams1/participants/${member.uid}/join`, member.cookie, { name: "Участник", teamId: "teamA" });
    expect((await call("GET", "/api/sessions/teams1/teams", member.cookie)).json().map((t: { id: string }) => t.id)).toEqual(["teamA"]);

    await call("POST", "/api/sessions/teams1/phase", host, { phase: "playing" });
    await call("POST", "/api/sessions/teams1/apply", host, { state: { stage: "question", startedAt: "server", timeLimit: null } });
    expect((await call("POST", "/api/sessions/teams1/answers", member.cookie, { step: 0, pid: "teamA", value: 1 })).json()).toEqual({ result: "rejected" });
    expect((await call("POST", "/api/sessions/teams1/answers", captain.cookie, { step: 0, pid: "teamA", value: 1 })).json()).toEqual({ result: "sent" });
    expect((await call("GET", "/api/sessions/teams1/answers/0/teamA", member.cookie)).json().value).toBe(1);

    // Ведущий назначает другого капитана.
    expect((await call("POST", "/api/sessions/teams1/participants/teamA/captain", host, { uid: member.uid })).statusCode).toBe(200);
    expect((await call("GET", "/api/sessions/teams1/participants/teamA", member.cookie)).json().captainUid).toBe(member.uid);
  });

  it("завершение: по коду сессию больше не найти, пульт находит свою; итоги по ссылке без входа", async () => {
    const code = await newSession("fin1");
    await call("POST", "/api/sessions/fin1/leaderboard", host, { entries: { p1: { name: "Аня", kind: "player", score: 30 }, p2: { name: "Боря", kind: "player", score: 50 } } });
    expect((await call("POST", "/api/sessions/fin1/finish", host, { participantsCount: 2 })).statusCode).toBe(200);
    const guest = await device();
    expect((await call("GET", `/api/sessions/by-code/${code}`, guest.cookie)).statusCode).toBe(404);
    expect((await call("GET", `/api/sessions/by-code/${code}?host=${hostUid}`, host)).json()).toMatchObject({ id: "fin1", state: { phase: "finished" } });
    expect((await call("GET", `/api/sessions/by-code/${code}?host=${hostUid}`, guest.cookie)).statusCode).toBe(403);

    const result = (await call("GET", "/api/results/fin1", "")).json();
    expect(result).toMatchObject({ id: "fin1", hostId: hostUid, participantsCount: 2, board: [{ name: "Боря", score: 50 }, { name: "Аня", score: 30 }] });
    expect((await call("GET", `/api/results?host=${hostUid}`, host)).json().map((r: { id: string }) => r.id)).toContain("fin1");
    expect((await call("GET", `/api/results?host=${hostUid}`, guest.cookie)).statusCode).toBe(403);
    expect((await call("GET", `/api/sessions?host=${hostUid}`, host)).json().length).toBeGreaterThan(0);
  });

  it("пульт: устаревшее изменение — 409; прибавка очков складывается; после финиша — только музыка и слайды", async () => {
    await newSession("exp1");
    expect((await call("POST", "/api/sessions/exp1/apply", host, { state: { phase: "playing", step: 0, stage: "ready" }, expect: { phase: "lobby" } })).statusCode).toBe(200);
    // Второй «Начать игру» с отставшего пульта не возвращает игру к началу.
    expect((await call("POST", "/api/sessions/exp1/apply", host, { state: { step: 0 }, expect: { phase: "lobby" } })).statusCode).toBe(409);
    await call("POST", "/api/sessions/exp1/leaderboard", host, { entries: { p1: { name: "Аня", kind: "player", score: 0 } } });
    for (let i = 0; i < 3; i++) expect((await call("POST", "/api/sessions/exp1/apply", host, { addScore: { p1: 10 } })).statusCode).toBe(200);
    expect((await call("POST", "/api/sessions/exp1/apply", host, { rename: { p1: "Анна" } })).statusCode).toBe(200);
    // Запоздавшее «добавить участника» не обнуляет очки.
    await call("POST", "/api/sessions/exp1/leaderboard", host, { entries: { p1: { name: "Аня", kind: "player", score: 0 } } });
    expect((await call("GET", "/api/sessions/exp1", host)).json().leaderboard.p1).toMatchObject({ name: "Анна", score: 30 });
    expect((await call("POST", "/api/sessions/exp1/apply", host, { addScore: { p1: 1e9 } })).statusCode).toBe(400);
    await call("POST", "/api/sessions/exp1/finish", host, { participantsCount: 1 });
    expect((await call("POST", "/api/sessions/exp1/apply", host, { state: { step: 3 } })).statusCode).toBe(409);
    expect((await call("POST", "/api/sessions/exp1/apply", host, { state: { cue: { id: "c1", sound: "gong" } } })).statusCode).toBe(200);
  });

  it("экран зала сообщает пульту о себе; видит только ведущий; молчит минуту — нет экрана", async () => {
    await newSession("scr1");
    const screen = await device();
    expect((await call("GET", "/api/sessions/scr1/screen", host)).json()).toEqual({ screen: null });
    expect((await call("POST", "/api/sessions/scr1/screen", screen.cookie, { soundReady: "yes" })).statusCode).toBe(400);
    expect((await call("POST", "/api/sessions/scr1/screen", "", { soundReady: true, muted: false, musicBlocked: false })).statusCode).toBe(401);
    expect((await call("POST", "/api/sessions/scr1/screen", screen.cookie, { soundReady: true, muted: false, musicBlocked: false })).statusCode).toBe(200);
    expect((await call("GET", "/api/sessions/scr1/screen", host)).json()).toEqual({ screen: { soundReady: true, muted: false, musicBlocked: false, seenAt: clock } });
    expect((await call("GET", "/api/sessions/scr1/screen", screen.cookie)).statusCode).toBe(403);
    clock += 61_000;
    expect((await call("GET", "/api/sessions/scr1/screen", host)).json()).toEqual({ screen: null });
  });

  it("часы сервера", async () => {
    expect((await call("GET", "/api/time", "")).json()).toEqual({ now: clock });
  });

  it("поток событий: снимок сразу, затем изменения пульта", async () => {
    await newSession("live1");
    const guest = await device();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const res = await fetch(`${address}/api/stream/session/live1`, { headers: { cookie: guest.cookie }, signal: controller.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    async function nextEvent(): Promise<{ type: string; [key: string]: unknown }> {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (data) return JSON.parse(data.slice(6));
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("поток закрыт");
        buffer += decoder.decode(value, { stream: true });
      }
    }
    const snapshot = await nextEvent();
    expect(snapshot).toMatchObject({ type: "snapshot", session: { id: "live1", state: { phase: "lobby" } } });
    await call("POST", "/api/sessions/live1/apply", host, { state: { phase: "playing", step: 1 }, leaderboard: { p1: { name: "Аня", kind: "player", score: 0 } } });
    const patch = await nextEvent();
    expect(patch).toMatchObject({ type: "patch", state: { phase: "playing", step: 1 }, leaderboard: { p1: { name: "Аня", kind: "player", score: 0 } } });
    expect(patch.version).toBeGreaterThan((snapshot.session as { version: number }).version);
    controller.abort();
  });
});
