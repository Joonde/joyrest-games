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
      state: { stage: "question", startedAt: "server", peek: null },
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

    // «Игры сейчас»: лёгкий список без снимка игры; гостю — нет.
    const overview = (await call("GET", "/api/sessions/overview", host)).json() as Array<Record<string, unknown>>;
    expect(overview.find((o) => o.id === "sess2")).toMatchObject({ phase: "playing", players: 1, hostName: expect.any(String) });
    expect(JSON.stringify(overview)).not.toContain("gameSnapshot");
    expect((await call("GET", "/api/sessions/overview", guest.cookie)).statusCode).toBe(403);
    // Идущую игру из списка не убрать; гостю — нельзя.
    expect((await call("POST", "/api/sessions/sess2/hide", host)).statusCode).toBe(409);
    expect((await call("POST", "/api/sessions/sess2/hide", guest.cookie)).statusCode).toBe(403);

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

    // Шаг, где ответ можно менять (ночь «Мафии»): ведущий отмечает `result.changeable`, повтор перезаписывает.
    expect((await call("POST", "/api/sessions/sess2/apply", host, { state: { step: 1, stage: "question", startedAt: "server", timeLimit: null, result: { changeable: true } } })).statusCode).toBe(200);
    const night = (value: string) => call("POST", "/api/sessions/sess2/answers", guest.cookie, { step: 1, pid: guest.uid, value });
    expect((await night("x")).json()).toEqual({ result: "sent" });
    expect((await night("y")).json()).toEqual({ result: "sent" });
    expect((await call("GET", `/api/sessions/sess2/answers/1/${guest.uid}`, guest.cookie)).json().value).toBe("y");
    // Чужой телефон чужой ответ не перепишет.
    expect((await call("POST", "/api/sessions/sess2/answers", stranger.cookie, { step: 1, pid: guest.uid, value: "z" })).json()).toEqual({ result: "rejected" });

    // «Назад» и снова «Показать вопрос», а удаление ответов не дошло: старый ответ не мешает новому.
    const again = (value: string) => call("POST", "/api/sessions/sess2/answers", guest.cookie, { step: 2, pid: guest.uid, value });
    expect((await call("POST", "/api/sessions/sess2/apply", host, { state: { step: 2, stage: "question", startedAt: "server", timeLimit: 20, result: null } })).statusCode).toBe(200);
    expect((await again("old")).json()).toEqual({ result: "sent" });
    expect((await call("POST", "/api/sessions/sess2/apply", host, { state: { stage: "ready", startedAt: null } })).statusCode).toBe(200);
    clock += 5_000;
    expect((await call("POST", "/api/sessions/sess2/apply", host, { state: { stage: "question", startedAt: "server", timeLimit: 20 } })).statusCode).toBe(200);
    expect((await again("new")).json()).toEqual({ result: "sent" });
    expect((await again("again")).json()).toEqual({ result: "rejected" });
    expect((await call("GET", `/api/sessions/sess2/answers/2/${guest.uid}`, guest.cookie)).json()).toMatchObject({ value: "new", submittedAt: clock });
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

  it("фотоотчёт: ведущий снимает до 3 фото, переснимает и удаляет; гость не может ни снять, ни посмотреть", async () => {
    await newSession("ph1");
    const webp = (fill: number) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 0), Buffer.from("WEBP"), Buffer.alloc(3000, fill)]);
    const put = (slot: number, cookie: string, body: Buffer) =>
      app.inject({ method: "PUT", url: `/api/sessions/ph1/photos/${slot}`, headers: { host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie, "content-type": "image/webp", "x-width": "1600", "x-height": "1200" }, payload: body });
    const guest = await device();
    expect((await put(1, guest.cookie, webp(1))).statusCode).toBe(401);
    expect((await put(4, host, webp(1))).statusCode).toBe(404);
    expect((await put(1, host, Buffer.from("<html>"))).statusCode).toBe(400);
    expect((await put(1, host, webp(1))).json()).toMatchObject({ sessionId: "ph1", slot: 1, gameTitle: "Квиз", width: 1600 });
    const first = (await call("GET", "/api/sessions/ph1/photos", host)).json() as Array<{ url: string }>;
    expect((await put(1, host, webp(2))).statusCode).toBe(200);
    expect((await put(2, host, webp(3))).statusCode).toBe(200);
    const list = (await call("GET", "/api/sessions/ph1/photos", host)).json() as Array<{ slot: number; url: string }>;
    expect(list.map((p) => p.slot)).toEqual([1, 2]);
    expect(list[0]?.url).not.toBe(first[0]?.url);
    const file = await call("GET", list[0]?.url ?? "", host);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("image/webp");
    expect((await call("GET", list[0]?.url ?? "", guest.cookie)).statusCode).toBe(401);
    expect((await call("GET", "/api/sessions/ph1/photos", guest.cookie)).statusCode).toBe(401);
    expect((await call("DELETE", "/api/sessions/ph1/photos/2", host)).statusCode).toBe(200);
    expect(((await call("GET", "/api/photos", host)).json() as Array<{ sessionId: string }>).filter((p) => p.sessionId === "ph1")).toHaveLength(1);
  });

  it("конец игры: чаевые ведущего, отзыв гостя после завершения (один на телефон), владелец показывает на сайте", async () => {
    await newSession("fz1");
    expect((await call("POST", "/api/me/tips", host, { url: "javascript:alert(1)" })).statusCode).toBe(400);
    expect((await call("POST", "/api/me/tips", host, { url: "https://pay.example.ru/tips/anna" })).json().url).toBe("https://pay.example.ru/tips/anna");
    const guest = await device();
    const finale = (await call("GET", "/api/finale/fz1", guest.cookie)).json();
    expect(finale).toMatchObject({ gameTitle: "Квиз", tipsUrl: "https://pay.example.ru/tips/anna", myReview: null });
    expect((await call("GET", "/api/finale/fz1", "")).statusCode).toBe(401);
    const review = { sessionId: "fz1", rating: 5, text: "Было здорово!", name: "Аня", consent: true };
    // До конца игры отзыв не принимается; без согласия — тоже.
    expect((await call("POST", "/api/reviews", guest.cookie, review)).statusCode).toBe(409);
    expect((await call("POST", "/api/sessions/fz1/finish", host, { participantsCount: 1 })).statusCode).toBe(200);
    expect((await call("POST", "/api/reviews", guest.cookie, { ...review, consent: false })).statusCode).toBe(400);
    expect((await call("POST", "/api/reviews", guest.cookie, { ...review, rating: 9 })).statusCode).toBe(400);
    expect((await call("POST", "/api/reviews", guest.cookie, review)).statusCode).toBe(200);
    expect((await call("POST", "/api/reviews", guest.cookie, { ...review, rating: 4, text: "Исправила" })).statusCode).toBe(200);
    expect((await call("GET", "/api/finale/fz1", guest.cookie)).json().myReview).toEqual({ rating: 4, text: "Исправила", name: "Аня" });
    const list = (await call("GET", "/api/reviews", host)).json() as Array<{ id: string; sessionId: string; status: string }>;
    const mine = list.filter((r) => r.sessionId === "fz1");
    expect(mine).toHaveLength(1);
    expect((await call("GET", "/api/reviews", guest.cookie)).statusCode).toBe(401);
    expect((await call("POST", `/api/reviews/${mine[0]?.id}/status`, guest.cookie, { status: "published" })).statusCode).toBe(401);
    expect((await call("POST", `/api/reviews/${mine[0]?.id}/status`, host, { status: "published" })).json().status).toBe("published");
    // Удалить отзыв: только владелец, только сам отзыв; повтор — 404.
    expect((await call("DELETE", `/api/reviews/${mine[0]?.id}`, guest.cookie)).statusCode).toBe(401);
    expect((await call("DELETE", `/api/reviews/${mine[0]?.id}`, host)).statusCode).toBe(200);
    expect(((await call("GET", "/api/reviews", host)).json() as Array<{ sessionId: string }>).filter((r) => r.sessionId === "fz1")).toHaveLength(0);
    expect((await call("DELETE", `/api/reviews/${mine[0]?.id}`, host)).statusCode).toBe(404);
    expect((await call("GET", "/api/finale/fz1", guest.cookie)).json().myReview).toBeNull();
    await call("POST", "/api/me/tips", host, { url: "" });
    expect((await call("GET", "/api/finale/fz1", guest.cookie)).json().tipsUrl).toBe("");
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

  it("мероприятие из блоков: один код, блок → перерыв → следующий блок, общий счёт, ответы прошлого блока в архиве", async () => {
    const snap = (title: string, mechanic: string) => ({ title, mechanic, themeId: "joyrest", content: { questions: [] } });
    const program = { title: "Вечер", blocks: [{ title: "Квиз", mechanic: "quiz", snapshot: snap("Квиз", "quiz") }, { title: "Ставка на знания", mechanic: "board", snapshot: snap("Ставка на знания", "board") }] };
    // Больше 5 блоков или блок без снимка — отказ.
    const bad = await call("POST", "/api/sessions", host, { id: "prog-bad", gameTitle: "Вечер", mechanic: "evening", program: { blocks: [{ title: "x", mechanic: "quiz" }] } });
    expect(bad.statusCode).toBe(400);
    const created = await call("POST", "/api/sessions", host, { id: "prog1", gameId: "g1", gameTitle: "Вечер", mechanic: "evening", gameSnapshot: snap("Вечер", "evening"), playMode: "solo", screenMode: "laptop", themeId: "joyrest", program });
    expect(created.statusCode, created.body).toBe(200);
    const code = created.json().code as string;
    const guest = await device();
    const first = (await call("GET", `/api/sessions/by-code/${code}`, guest.cookie)).json();
    // Сессия начинается с первой игры; браузер видит программу без снимков.
    expect(first).toMatchObject({ mechanic: "quiz", gameSnapshot: { mechanic: "quiz" }, program: { title: "Вечер", at: "block", index: 0, blocks: [{ mechanic: "quiz" }, { mechanic: "board" }] } });
    expect(JSON.stringify(first.program)).not.toContain("snapshot");

    await call("POST", `/api/sessions/prog1/participants/${guest.uid}/join`, guest.cookie, { name: "Аня", teamId: null });
    await call("POST", "/api/sessions/prog1/phase", host, { phase: "playing" });
    await call("POST", "/api/sessions/prog1/apply", host, { state: { stage: "question", startedAt: "server", timeLimit: 20 } });
    expect((await call("POST", "/api/sessions/prog1/answers", guest.cookie, { step: 0, pid: guest.uid, value: "a" })).json()).toEqual({ result: "sent" });
    await call("POST", "/api/sessions/prog1/leaderboard", host, { entries: { [guest.uid]: { name: "Аня", kind: "player", score: 0 } } });
    await call("POST", "/api/sessions/prog1/apply", host, { addScore: { [guest.uid]: 120 } });

    // Гость не переключает вечер; неверный номер блока — 409.
    expect((await call("POST", "/api/sessions/prog1/program", guest.cookie, { action: "break", from: 0 })).statusCode).toBe(403);
    expect((await call("POST", "/api/sessions/prog1/program", host, { action: "break", from: 1 })).statusCode).toBe(409);
    expect((await call("POST", "/api/sessions/prog1/program", host, { action: "break", from: 0 })).statusCode).toBe(200);
    const pause = (await call("GET", "/api/sessions/prog1", guest.cookie)).json();
    expect(pause).toMatchObject({ mechanic: "evening", state: { phase: "playing", step: 0, stage: "ready" }, program: { at: "break", totals: { [guest.uid]: 120 } } });
    expect(pause.leaderboard[guest.uid].score).toBe(120);
    // Ответ прошлого блока больше не на шаге 0.
    expect((await call("GET", "/api/sessions/prog1/answers/0", host)).json()).toEqual([]);
    // Повтор того же действия (второй пульт) — 409, вечер не сдвигается дважды.
    expect((await call("POST", "/api/sessions/prog1/program", host, { action: "break", from: 0 })).statusCode).toBe(409);

    expect((await call("POST", "/api/sessions/prog1/program", host, { action: "next", from: 0 })).statusCode).toBe(200);
    const second = (await call("GET", "/api/sessions/prog1", guest.cookie)).json();
    expect(second).toMatchObject({ mechanic: "board", gameSnapshot: { mechanic: "board" }, program: { at: "block", index: 1 } });
    expect(second.leaderboard[guest.uid].score).toBe(0);
    // Тот же код — та же сессия.
    expect((await call("GET", `/api/sessions/by-code/${code}`, guest.cookie)).json().id).toBe("prog1");

    await call("POST", "/api/sessions/prog1/apply", host, { addScore: { [guest.uid]: 30 } });
    // Последний блок — сразу итоги вечера; «Завершить» пишет в историю общий счёт.
    expect((await call("POST", "/api/sessions/prog1/program", host, { action: "break", from: 1 })).statusCode).toBe(200);
    const final = (await call("GET", "/api/sessions/prog1", guest.cookie)).json();
    expect(final).toMatchObject({ mechanic: "evening", program: { at: "final" } });
    expect(final.program.results.map((r: { title: string }) => r.title)).toEqual(["Квиз", "Ставка на знания"]);
    expect((await call("POST", "/api/sessions/prog1/finish", host, { participantsCount: 1 })).statusCode).toBe(200);
    expect((await call("GET", "/api/results/prog1", "")).json().board).toEqual([{ name: "Аня", score: 150 }]);
    // После завершения вечер не переключить.
    expect((await call("POST", "/api/sessions/prog1/program", host, { action: "next", from: 1 })).statusCode).toBe(409);
  });

  it("вечер из блоков, закрытый посреди блока из «Игр сейчас»: в истории — общий счёт вечера; картинки — от игры блока", async () => {
    const snap = (mechanic: string) => ({ title: mechanic, mechanic, themeId: "joyrest", content: {} });
    const program = { title: "Вечер 2", blocks: [{ title: "Квиз", mechanic: "quiz", gameId: "gq", snapshot: snap("quiz") }, { title: "Лото", mechanic: "lotto", gameId: "gl", snapshot: snap("lotto") }] };
    expect((await call("POST", "/api/sessions", host, { id: "prog2", gameId: "ge", gameTitle: "Вечер 2", mechanic: "evening", gameSnapshot: snap("evening"), playMode: "solo", screenMode: "laptop", themeId: "joyrest", program })).statusCode).toBe(200);
    expect((await call("GET", "/api/sessions/prog2", host)).json().gameId).toBe("gq");
    await call("POST", "/api/sessions/prog2/phase", host, { phase: "playing" });
    await call("POST", "/api/sessions/prog2/leaderboard", host, { entries: { m1: { name: "Аня", kind: "player", score: 0 } } });
    await call("POST", "/api/sessions/prog2/apply", host, { addScore: { m1: 70 } });
    await call("POST", "/api/sessions/prog2/program", host, { action: "break", from: 0 });
    // В перерыве — id самого вечера.
    expect((await call("GET", "/api/sessions/prog2", host)).json().gameId).toBe("ge");
    await call("POST", "/api/sessions/prog2/program", host, { action: "next", from: 0 });
    expect((await call("GET", "/api/sessions/prog2", host)).json().gameId).toBe("gl");
    await call("POST", "/api/sessions/prog2/apply", host, { addScore: { m1: 5 } });
    expect((await call("POST", "/api/sessions/prog2/finish", host, { participantsCount: 0 })).statusCode).toBe(200);
    expect((await call("GET", "/api/results/prog2", "")).json()).toMatchObject({ mechanic: "evening", board: [{ name: "Аня", score: 75 }] });
    // Экран и телефоны тоже видят итоги вечера: блок закрыт, в таблице — общий счёт.
    const closed = (await call("GET", "/api/sessions/prog2", host)).json();
    expect(closed).toMatchObject({ mechanic: "evening", state: { phase: "finished" }, program: { at: "final" } });
    expect(closed.leaderboard.m1.score).toBe(75);
  });

  it("время вечера: начало — первый гость, перерывы — слайд «Перерыв», в итогах — их длительность", async () => {
    await newSession("ev1");
    expect((await call("GET", "/api/sessions/ev1", host)).json().eventStartedAt).toBeNull();
    const guest = await device();
    expect((await call("POST", `/api/sessions/ev1/participants/${guest.uid}/join`, guest.cookie, { name: "Аня" })).statusCode).toBe(200);
    const started = (await call("GET", "/api/sessions/ev1", host)).json().eventStartedAt as number;
    expect(started).toBeGreaterThan(0);
    // Повторный вход того же гостя начало не сдвигает.
    await call("POST", `/api/sessions/ev1/participants/${guest.uid}/join`, guest.cookie, { name: "Аня" });
    expect((await call("GET", "/api/sessions/ev1", host)).json().eventStartedAt).toBe(started);

    const slide = { id: "b1", kind: "break", title: "Перерыв", text: "", lines: [], endsAt: clock + 10 * 60_000 };
    expect((await call("POST", "/api/sessions/ev1/apply", host, { state: { slide } })).statusCode).toBe(200);
    expect((await call("POST", "/api/sessions/ev1/apply", host, { state: { slide: null } })).statusCode).toBe(200);
    const [row] = await sql<{ breaks: Array<{ id: string; start: number; end: number }> }[]>`select breaks from sessions where id = 'ev1'`;
    expect(row?.breaks).toHaveLength(1);
    // Убрали раньше конца отсчёта — конец перерыва не позже отсчёта и не раньше начала.
    expect(row?.breaks[0]?.end).toBeGreaterThanOrEqual(row?.breaks[0]?.start ?? Infinity);
    expect(row?.breaks[0]?.end).toBeLessThan(slide.endsAt);
    // Перерыв 15 минут (подменяем время, чтобы не ждать).
    const t = Date.now();
    await sql`update sessions set breaks = ${sql.json([{ id: "b1", start: t - 20 * 60_000, end: t - 5 * 60_000 }] as never)} where id = 'ev1'`;
    await call("POST", "/api/sessions/ev1/leaderboard", host, { entries: { [guest.uid]: { name: "Аня", kind: "player", score: 10 } } });
    expect((await call("POST", "/api/sessions/ev1/finish", host, { participantsCount: 1 })).statusCode).toBe(200);
    const result = (await call("GET", "/api/results/ev1", "")).json();
    expect(result.breaksCount).toBe(1);
    expect(result.breaksMs).toBe(15 * 60_000);
    expect(result.startedAt).toBe(started);
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
    await call("POST", "/api/sessions/exp1/leaderboard", host, { entries: { p1: { name: "Анна", kind: "player", score: 0 } } });
    expect((await call("GET", "/api/sessions/exp1", host)).json().leaderboard.p1).toMatchObject({ name: "Анна", score: 30 });
    // Смена капитана команды доходит до таблицы, очки команды остаются.
    await call("POST", "/api/sessions/exp1/leaderboard", host, { entries: { t1: { name: "Утки", kind: "team", score: 0, colorIndex: 0, captainUid: "u1" } } });
    await call("POST", "/api/sessions/exp1/apply", host, { addScore: { t1: 50 } });
    await call("POST", "/api/sessions/exp1/leaderboard", host, { entries: { t1: { name: "Утки", kind: "team", score: 0, colorIndex: 0, captainUid: "u2" } } });
    expect((await call("GET", "/api/sessions/exp1", host)).json().leaderboard.t1).toMatchObject({ captainUid: "u2", score: 50, colorIndex: 0 });
    expect((await call("POST", "/api/sessions/exp1/apply", host, { addScore: { p1: 1e9 } })).statusCode).toBe(400);
    await call("POST", "/api/sessions/exp1/finish", host, { participantsCount: 1 });
    expect((await call("POST", "/api/sessions/exp1/apply", host, { state: { step: 3 } })).statusCode).toBe(409);
    expect((await call("POST", "/api/sessions/exp1/apply", host, { state: { cue: { id: "c1", sound: "gong" } } })).statusCode).toBe(200);
  });

  it("конец перерыва с двух пультов: убирает только тот же слайд (`expect.slide`), чужой слайд остаётся", async () => {
    await newSession("tech1");
    const tech = { id: "tb1", kind: "tech", title: "Пауза", text: "", lines: [], endsAt: clock + 60_000 };
    expect((await call("POST", "/api/sessions/tech1/apply", host, { state: { slide: tech } })).statusCode).toBe(200);
    // Второй пульт за это время показал QR для опоздавших.
    const join = { id: "jq1", kind: "join", title: "Вход", text: "", lines: [], endsAt: null };
    expect((await call("POST", "/api/sessions/tech1/apply", host, { state: { slide: join } })).statusCode).toBe(200);
    // Первый пульт по таймеру убирает «свой» перерыв — отказ, QR на месте.
    const late = await call("POST", "/api/sessions/tech1/apply", host, { state: { slide: null }, expect: { slide: "tb1" } });
    expect(late.statusCode).toBe(409);
    expect(late.json()).toEqual({ error: "failed-precondition" });
    expect((await call("GET", "/api/sessions/tech1", host)).json().state.slide).toMatchObject({ id: "jq1" });
    // Тот же слайд — убирается; «слайда нет» тоже проверяется.
    expect((await call("POST", "/api/sessions/tech1/apply", host, { state: { slide: null }, expect: { slide: "jq1" } })).statusCode).toBe(200);
    expect((await call("GET", "/api/sessions/tech1", host)).json().state.slide ?? null).toBeNull();
    expect((await call("POST", "/api/sessions/tech1/apply", host, { state: { slide: join }, expect: { slide: null } })).statusCode).toBe(200);
    expect((await call("POST", "/api/sessions/tech1/apply", host, { state: { slide: tech }, expect: { slide: null } })).statusCode).toBe(409);
    // Непонятный id — 400.
    expect((await call("POST", "/api/sessions/tech1/apply", host, { state: { slide: null }, expect: { slide: "не id" } })).statusCode).toBe(400);
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

  it("помощь зала по QR: голос без участия в игре, один на устройство, только пока ведущий открыл голосование", async () => {
    await newSession("aud1");
    const a = await device();
    const b = await device();
    const vote = (who: { cookie: string }, step: number, v: number) => call("POST", "/api/sessions/aud1/audience", who.cookie, { step, vote: v });
    expect((await call("POST", "/api/sessions/aud1/phase", host, { phase: "playing" })).statusCode).toBe(200);
    expect((await call("POST", "/api/sessions/aud1/apply", host, { state: { step: 3, stage: "question", startedAt: "server", timeLimit: 20, result: { mode: "question" } } })).statusCode).toBe(200);
    expect((await vote(a, 3, 1)).json()).toEqual({ result: "rejected" });
    expect((await call("POST", "/api/sessions/aud1/apply", host, { state: { result: { mode: "audience", audienceVote: true } } })).statusCode).toBe(200);
    expect((await vote(a, 3, 1)).json()).toEqual({ result: "ok" });
    expect((await vote(a, 3, 2)).json()).toEqual({ result: "ok" });
    expect((await vote(b, 3, 2)).json()).toEqual({ result: "ok" });
    expect((await vote(b, 2, 0)).json()).toEqual({ result: "rejected" });
    expect((await vote(b, 3, -1)).statusCode).toBe(400);
    expect((await call("POST", "/api/sessions/aud1/audience", "", { step: 3, vote: 1 })).statusCode).toBe(401);
    expect((await call("GET", "/api/sessions/aud1/audience", host)).json()).toEqual({ step: 3, counts: [0, 0, 2, 0] });
    expect((await call("GET", "/api/sessions/aud1/audience", a.cookie)).statusCode).toBe(403);
    clock += 24_000;
    expect((await vote(a, 3, 0)).json()).toEqual({ result: "rejected" });
  });

  it("вернуться за своего игрока: только за того, кто не на связи; прежний телефон теряет доступ", async () => {
    await newSession("rej1");
    const anna = await device();
    expect((await call("POST", `/api/sessions/rej1/participants/${anna.uid}/join`, anna.cookie, { name: "🦊 Аня", teamId: null })).statusCode).toBe(200);
    expect((await call("POST", `/api/sessions/rej1/participants/${anna.uid}/touch`, anna.cookie)).statusCode).toBe(200);
    const phone = await device();
    // Аня на связи — за неё войти нельзя, в списке её нет.
    expect((await call("GET", "/api/sessions/rej1/offline", phone.cookie)).json()).toEqual([]);
    expect((await call("POST", `/api/sessions/rej1/participants/${anna.uid}/claim`, phone.cookie)).statusCode).toBe(409);
    clock += 80_000;
    expect((await call("GET", "/api/sessions/rej1/offline", phone.cookie)).json()).toEqual([{ pid: anna.uid, name: "🦊 Аня", team: null }]);
    expect((await call("POST", `/api/sessions/rej1/participants/${anna.uid}/claim`, host)).statusCode).toBe(403);
    const claimed = await call("POST", `/api/sessions/rej1/participants/${anna.uid}/claim`, phone.cookie);
    expect(claimed.statusCode, claimed.body).toBe(200);
    const newCookie = cookieOf(claimed);
    expect((await call("POST", "/api/auth/device", newCookie)).json()).toMatchObject({ uid: anna.uid, anonymous: true });
    // Старый телефон Ани больше не она.
    expect((await call("POST", "/api/auth/device", anna.cookie)).json().uid).not.toBe(anna.uid);
    // Телефон, у которого уже есть свой игрок, за другого не входит.
    const boris = await device();
    await call("POST", `/api/sessions/rej1/participants/${boris.uid}/join`, boris.cookie, { name: "Боря", teamId: null });
    clock += 80_000;
    expect((await call("POST", `/api/sessions/rej1/participants/${anna.uid}/claim`, boris.cookie)).statusCode).toBe(409);
  });

  it("вернуться за игрока нельзя, если его телефон играет в другой идущей игре", async () => {
    await newSession("rej2");
    await newSession("rej3");
    const vera = await device();
    expect((await call("POST", `/api/sessions/rej2/participants/${vera.uid}/join`, vera.cookie, { name: "Вера", teamId: null })).statusCode).toBe(200);
    expect((await call("POST", `/api/sessions/rej3/participants/${vera.uid}/join`, vera.cookie, { name: "Вера", teamId: null })).statusCode).toBe(200);
    clock += 80_000;
    const thief = await device();
    expect((await call("POST", `/api/sessions/rej2/participants/${vera.uid}/claim`, thief.cookie)).statusCode).toBe(409);
    expect((await call("POST", "/api/auth/device", vera.cookie)).json().uid).toBe(vera.uid);
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
