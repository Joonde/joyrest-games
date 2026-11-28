import { mkdtempSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { teamNameKey } from "../../src/core/teamFormation";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";

// Командное лобби на настоящей PostgreSQL (docs/TEAM_LOBBY_AND_COLLABORATION_TZ_2026-11-22.md, 14.2 и 20.2).
// Локально: TEST_DATABASE_URL=postgres://localhost:5432/team_lobby_test. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("командное лобби на PostgreSQL", () => {
  const SCHEMA = "team_lobby_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 8, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    mediaDir: mkdtempSync(join(tmpdir(), "joyrest-lobby-")),
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
    // Часы сервера — настоящие: «на связи» сравнивает их с временем входа, которое ставит база.
    live: { keepAliveMs: 60_000 },
  });
  let host = "";
  let seq = 0;
  const actionId = () => `a${++seq}`;

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
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

  async function newSession(id: string, teamFormation?: object, playMode = "teams") {
    return call("POST", "/api/sessions", host, {
      id,
      gameId: null,
      gameTitle: "Квиз",
      playMode,
      screenMode: "laptop",
      themeId: "joyrest",
      mechanic: "quiz",
      gameSnapshot: { title: "Квиз", content: { questions: [] } },
      ...(teamFormation ? { teamFormation } : {}),
    });
  }

  async function guests(session: string, n: number, prefix = "Гость") {
    const out: Array<{ cookie: string; uid: string }> = [];
    for (let i = 0; i < n; i++) {
      const g = await device();
      const res = await call("POST", `/api/sessions/${session}/participants/${g.uid}/join`, g.cookie, { name: `${prefix} ${i + 1}` });
      expect(res.statusCode, res.body).toBe(200);
      out.push(g);
    }
    return out;
  }

  const revision = async (session: string) => (await sql<{ r: number }[]>`select (team_formation->>'revision')::int as r from sessions where id = ${session}`)[0]?.r ?? 0;
  const rows = (session: string) => sql<{ id: string; kind: string; team_id: string | null; captain_uid: string; no_captain: boolean; name: string }[]>`
    select id, kind, team_id, captain_uid, no_captain, name from participants where session_id = ${session}`;
  const offline = (session: string, uids: string[]) =>
    sql`update participants set joined_at = now() - interval '10 minutes', seen_at = now() - interval '10 minutes' where session_id = ${session} and id = any(${uids}::text[])`;
  const hostAct = async (session: string, path: string, body: object = {}) =>
    call("POST", `/api/sessions/${session}/${path}`, host, { actionId: actionId(), expectedRevision: await revision(session), ...body });

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    host = cookieOf(await call("POST", "/api/auth/login", "", { email: "owner@example.com", password: "пароль-владельца-12" }));
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("настройки при запуске: только режим команд, 1–20 команд, 2–10 мест, не больше 100 мест; «Случайные капитаны» — позже", async () => {
    expect((await newSession("bad1", { mode: "self", teamCount: 20, maxMembers: 10 })).statusCode).toBe(400);
    expect((await newSession("bad2", { mode: "randomCaptains" })).statusCode).toBe(400);
    expect((await newSession("bad3", { mode: "self" }, "solo")).statusCode).toBe(400);
    expect((await newSession("ok1", { mode: "randomTeams", teamCount: 10, maxMembers: 10 })).statusCode).toBe(200);
    const g = await device();
    const session = (await call("GET", "/api/sessions/ok1", g.cookie)).json();
    expect(session.teamFormation).toEqual({ mode: "randomTeams", teamCount: 10, maxMembers: 10, revision: 1, distributed: false });
    // Прежняя сессия — без настроек.
    await newSession("legacy1");
    expect((await call("GET", "/api/sessions/legacy1", g.cookie)).json().teamFormation).toBeNull();
    expect((await call("GET", "/api/sessions/legacy1/team-lobby", g.cookie)).statusCode).toBe(404);
    expect((await call("POST", `/api/sessions/legacy1/participants/${g.uid}/captain-pref`, g.cookie, { noCaptain: true })).statusCode).toBe(404);
  });

  it("«Сами»: создать команду — капитан и первый член; дубль названия, лимит команд, полная команда, выход капитана", async () => {
    await newSession("self1", { mode: "self", teamCount: 2, maxMembers: 3 });
    const [a, b, c, d, e] = await guests("self1", 5);
    // До входа команду не создать.
    const stranger = await device();
    expect((await call("POST", "/api/sessions/self1/teams", stranger.cookie, { id: "tx", name: "Чужие" })).json()).toEqual({ error: "failed-precondition" });
    await call("POST", `/api/sessions/self1/participants/${a!.uid}/captain-pref`, a!.cookie, { noCaptain: true });
    expect((await call("POST", "/api/sessions/self1/teams", a!.cookie, { id: "tA", name: "🦊 Лисы" })).json()).toEqual({ id: "tA" });
    // Повтор после обрыва — тот же ответ.
    expect((await call("POST", "/api/sessions/self1/teams", a!.cookie, { id: "tA", name: "🦊 Лисы" })).json()).toEqual({ id: "tA" });
    let all = await rows("self1");
    expect(all.find((r) => r.id === "tA")).toMatchObject({ kind: "team", captain_uid: a!.uid });
    // Создал команду — вызвался капитаном: галочка снята.
    expect(all.find((r) => r.id === a!.uid)).toMatchObject({ team_id: "tA", no_captain: false });
    expect((await call("POST", "/api/sessions/self1/teams", b!.cookie, { id: "tB", name: "ЛИСЫ" })).json()).toEqual({ error: "team-name-taken" });
    expect((await call("POST", "/api/sessions/self1/teams", a!.cookie, { id: "tZ", name: "Ещё" })).json()).toEqual({ error: "already-assigned" });
    expect((await call("POST", "/api/sessions/self1/teams", b!.cookie, { id: "tB", name: "Совы" })).statusCode).toBe(200);
    expect((await call("POST", "/api/sessions/self1/teams", c!.cookie, { id: "tC", name: "Ежи" })).json()).toEqual({ error: "team-limit" });
    // Вступить: c и d в «Лисы», e — уже нет места (3 телефона).
    await call("POST", `/api/sessions/self1/participants/${c!.uid}/captain-pref`, c!.cookie, { noCaptain: true });
    expect((await call("POST", `/api/sessions/self1/participants/${c!.uid}/join`, c!.cookie, { name: "Гость 3", teamId: "tA" })).statusCode).toBe(200);
    expect((await call("POST", `/api/sessions/self1/participants/${d!.uid}/join`, d!.cookie, { name: "Гость 4", teamId: "tA" })).statusCode).toBe(200);
    expect((await call("POST", `/api/sessions/self1/participants/${e!.uid}/join`, e!.cookie, { name: "Гость 5", teamId: "tA" })).json()).toEqual({ error: "team-full" });
    // Вход без команды не стирает свою команду (в прежнем лобби стирал).
    await call("POST", `/api/sessions/self1/participants/${d!.uid}/join`, d!.cookie, { name: "Гость 4" });
    expect((await rows("self1")).find((r) => r.id === d!.uid)?.team_id).toBe("tA");
    // Сменить команду — только через выход.
    expect((await call("POST", `/api/sessions/self1/participants/${d!.uid}/join`, d!.cookie, { name: "Гость 4", teamId: "tB" })).json()).toEqual({ error: "already-assigned" });
    // Капитан выходит: c отметил «Не хочу» — капитаном становится d, хотя c вошёл раньше.
    expect((await call("POST", `/api/sessions/self1/participants/${a!.uid}/leave`, a!.cookie)).statusCode).toBe(200);
    all = await rows("self1");
    expect(all.find((r) => r.id === "tA")?.captain_uid).toBe(d!.uid);
    expect(all.find((r) => r.id === a!.uid)?.team_id).toBeNull();
    // Чужой выход — нельзя; последний вышел — пустая команда удаляется.
    expect((await call("POST", `/api/sessions/self1/participants/${b!.uid}/leave`, a!.cookie)).statusCode).toBe(403);
    await call("POST", `/api/sessions/self1/participants/${b!.uid}/leave`, b!.cookie);
    expect((await rows("self1")).some((r) => r.id === "tB")).toBe(false);
    // Название: капитан — да (без дублей), участник — нет.
    expect((await call("POST", "/api/sessions/self1/teams/tA/profile", d!.cookie, { name: "Совы" })).statusCode).toBe(200);
    expect((await call("POST", "/api/sessions/self1/teams/tA/profile", c!.cookie, { name: "Орлы" })).json()).toEqual({ error: "not-captain" });
  });

  it("одновременно: 8 телефонов на одно последнее место — вошёл ровно один; два создания последней команды — одно", async () => {
    await newSession("race1", { mode: "self", teamCount: 2, maxMembers: 2 });
    const [cap, ...rest] = await guests("race1", 9);
    await call("POST", "/api/sessions/race1/teams", cap!.cookie, { id: "tA", name: "Лисы" });
    const joins = await Promise.all(rest.map((g, i) => call("POST", `/api/sessions/race1/participants/${g.uid}/join`, g.cookie, { name: `Гость ${i + 2}`, teamId: "tA" })));
    expect(joins.filter((r) => r.statusCode === 200).length).toBe(1);
    expect(joins.filter((r) => r.json().error === "team-full").length).toBe(7);
    expect((await rows("race1")).filter((r) => r.team_id === "tA").length).toBe(2);
    const free = [];
    for (const g of rest) if ((await rows("race1")).find((r) => r.id === g.uid)?.team_id === null) free.push(g);
    const creates = await Promise.all(free.slice(0, 2).map((g, i) => call("POST", "/api/sessions/race1/teams", g.cookie, { id: `tN${i}`, name: `Новые ${i}` })));
    expect(creates.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(creates.some((r) => r.json().error === "team-limit")).toBe(true);
  });

  it("приватность: чужой участник, команды, отключившиеся и лобби — без чужих составов и галочек", async () => {
    await newSession("priv1", { mode: "self", teamCount: 4, maxMembers: 5 });
    const [a, b, c] = await guests("priv1", 3);
    await call("POST", "/api/sessions/priv1/teams", a!.cookie, { id: "tA", name: "Лисы" });
    await call("POST", `/api/sessions/priv1/participants/${b!.uid}/join`, b!.cookie, { name: "Гость 2", teamId: "tA" });
    await call("POST", `/api/sessions/priv1/participants/${b!.uid}/captain-pref`, b!.cookie, { noCaptain: true });
    expect((await call("GET", `/api/sessions/priv1/participants/${b!.uid}`, c!.cookie)).statusCode).toBe(403);
    expect((await call("GET", `/api/sessions/priv1/participants/${b!.uid}`, b!.cookie)).json()).toMatchObject({ id: b!.uid, noCaptain: true });
    expect((await call("GET", `/api/sessions/priv1/participants/${b!.uid}`, host)).json()).toMatchObject({ noCaptain: true });
    const teams = (await call("GET", "/api/sessions/priv1/teams", c!.cookie)).json();
    expect(teams).toEqual([{ id: "tA", name: "Лисы", kind: "team", teamId: null, captainUid: "", joinedAt: null, seenAt: null, memberCount: 2 }]);
    await offline("priv1", [b!.uid]);
    const off = (await call("GET", "/api/sessions/priv1/offline", c!.cookie)).json();
    expect(off).toEqual([{ pid: b!.uid, name: "Гость 2", team: null }]);
    // Лобби телефона: свой состав — только своей команде; чужому — только карточки.
    const mine = (await call("GET", "/api/sessions/priv1/team-lobby", a!.cookie)).json();
    expect(mine.me).toEqual({ teamId: "tA", isCaptain: true, noCaptain: false });
    expect(mine.ownTeamMembers.map((m: { name: string }) => m.name).sort()).toEqual(["Гость 1", "Гость 2"]);
    expect(mine.ownTeamMembers.find((m: { name: string }) => m.name === "Гость 2")).toEqual({ name: "Гость 2", isCaptain: false, online: false });
    expect(mine.formation).not.toHaveProperty("excluded");
    const theirs = (await call("GET", "/api/sessions/priv1/team-lobby", c!.cookie)).json();
    expect(theirs.me).toEqual({ teamId: null, isCaptain: false, noCaptain: false });
    expect(theirs.ownTeamMembers).toBeUndefined();
    expect(theirs.teams).toEqual([{ id: "tA", name: "Лисы", memberCount: 2, captainName: "Гость 1" }]);
    expect(JSON.stringify(theirs)).not.toContain(b!.uid);
    // «Не хочу быть капитаном» — только свой.
    expect((await call("POST", `/api/sessions/priv1/participants/${b!.uid}/captain-pref`, c!.cookie, { noCaptain: false })).statusCode).toBe(403);
  });

  it("«Случайно»: на связи и не исключённые, плюс добавленные ведущим; размеры ±1; повтор по actionId; revision", async () => {
    await newSession("rnd1", { mode: "randomTeams", teamCount: 3, maxMembers: 4 });
    const people = await guests("rnd1", 12);
    const [skip, sleepy, forced] = people;
    await offline("rnd1", [sleepy!.uid, forced!.uid]);
    const r0 = await revision("rnd1");
    // Исключение: значение, а не переключение; revision не меняется.
    expect((await call("POST", "/api/sessions/rnd1/team-formation/exclude", host, { pid: skip!.uid, excluded: true })).json()).toEqual({ ok: true, excluded: [skip!.uid] });
    await call("POST", "/api/sessions/rnd1/team-formation/exclude", host, { pid: skip!.uid, excluded: true });
    expect(await revision("rnd1")).toBe(r0);
    // Гостю исключения не видны.
    expect(JSON.stringify((await call("GET", "/api/sessions/rnd1/team-lobby", people[5]!.cookie)).json())).not.toContain(skip!.uid);
    expect((await call("POST", "/api/sessions/rnd1/team-formation/exclude", people[4]!.cookie, { pid: skip!.uid, excluded: false })).statusCode).toBe(403);
    const body = { actionId: "dist-1", expectedRevision: r0, includeOffline: [forced!.uid, "nobody"] };
    const res = await call("POST", "/api/sessions/rnd1/team-formation/distribute", host, body);
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json();
    expect(out.skippedExcluded).toEqual([skip!.uid]);
    expect(out.skippedOffline).toEqual([sleepy!.uid]);
    expect(out.ignored).toEqual(["nobody"]);
    expect(Object.keys(out.assigned).length).toBe(10);
    expect(out.assigned[forced!.uid]).toBeDefined();
    expect(out.revision).toBe(r0 + 1);
    // revision в снимке сессии та же, что в настройках (поток сессии получил новую версию).
    expect((await call("GET", "/api/sessions/rnd1", host)).json().teamFormation.revision).toBe(r0 + 1);
    const all = await rows("rnd1");
    const teams = all.filter((r) => r.kind === "team");
    expect(teams.length).toBe(3);
    const sizes = teams.map((t) => all.filter((p) => p.team_id === t.id).length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    for (const t of teams) expect(all.find((p) => p.id === t.captain_uid)?.team_id).toBe(t.id);
    // Готовые названия, разные, не «Команда N».
    expect(new Set(teams.map((t) => teamNameKey(t.name))).size).toBe(3);
    expect(teams.every((t) => !t.name.startsWith("Команда"))).toBe(true);
    // Повтор того же запроса — тот же результат; тот же actionId с другими галочками — отказ.
    expect((await call("POST", "/api/sessions/rnd1/team-formation/distribute", host, body)).json()).toEqual(out);
    expect((await call("POST", "/api/sessions/rnd1/team-formation/distribute", host, { ...body, includeOffline: [] })).json()).toEqual({ error: "formation-changed" });
    // Старый revision — отказ; свежий — уже распределено.
    expect((await call("POST", "/api/sessions/rnd1/team-formation/distribute", host, { actionId: actionId(), expectedRevision: r0 })).json()).toEqual({ error: "formation-changed" });
    expect((await hostAct("rnd1", "team-formation/distribute")).json()).toEqual({ error: "already-distributed" });
    // Гость в случайном режиме сам команду не выбирает и не выходит.
    const someTeam = teams[0]!.id;
    expect((await call("POST", `/api/sessions/rnd1/participants/${skip!.uid}/join`, skip!.cookie, { name: "Гость 1", teamId: someTeam })).statusCode).toBe(403);
    expect((await call("POST", `/api/sessions/rnd1/participants/${people[4]!.uid}/leave`, people[4]!.cookie)).statusCode).toBe(403);

    // Пришли ещё двое, исключённого вернули — «Распределить оставшихся»: в свободные места, остаток — списком.
    await guests("rnd1", 2, "Поздний");
    await call("POST", "/api/sessions/rnd1/team-formation/exclude", host, { pid: skip!.uid, excluded: false });
    const auto = (await hostAct("rnd1", "team-formation/auto-assign")).json();
    expect(Object.keys(auto.assigned).length + auto.rest.length).toBe(3);
    expect(auto.skippedOffline).toEqual([sleepy!.uid]);
    const after = await rows("rnd1");
    for (const t of teams) expect(after.filter((p) => p.team_id === t.id).length).toBeLessThanOrEqual(4);
  });

  it("«Случайно»: игроков меньше, чем команд, или больше мест — отказ; у всех «Не хочу» — капитан всё равно есть", async () => {
    await newSession("rnd2", { mode: "randomTeams", teamCount: 3, maxMembers: 2 });
    await guests("rnd2", 2);
    expect((await hostAct("rnd2", "team-formation/distribute")).json()).toEqual({ error: "not-enough-players" });
    await guests("rnd2", 5, "Ещё");
    expect((await hostAct("rnd2", "team-formation/distribute")).json()).toEqual({ error: "capacity-exceeded" });

    await newSession("rnd3", { mode: "randomTeams", teamCount: 1, maxMembers: 3 });
    const shy = await guests("rnd3", 3);
    for (const g of shy) await call("POST", `/api/sessions/rnd3/participants/${g.uid}/captain-pref`, g.cookie, { noCaptain: true });
    const out = (await hostAct("rnd3", "team-formation/distribute")).json();
    expect(out.teams).toHaveLength(1);
    expect(out.teams[0].unwilling).toBe(true);
  });

  it("два пульта распределяют одновременно — один результат, второй получает formation-changed", async () => {
    await newSession("rnd4", { mode: "randomTeams", teamCount: 2, maxMembers: 5 });
    await guests("rnd4", 6);
    const rev = await revision("rnd4");
    const both = await Promise.all([
      call("POST", "/api/sessions/rnd4/team-formation/distribute", host, { actionId: "p1", expectedRevision: rev }),
      call("POST", "/api/sessions/rnd4/team-formation/distribute", host, { actionId: "p2", expectedRevision: rev }),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await rows("rnd4")).filter((r) => r.kind === "team").length).toBe(2);
  });

  it("сброс, перемещение, команда от ведущего; во время вопроса перемещать нельзя; поздний игрок — в меньшую команду", async () => {
    await newSession("mv1", { mode: "randomTeams", teamCount: 2, maxMembers: 3 });
    const people = await guests("mv1", 4);
    await call("POST", "/api/sessions/mv1/team-formation/exclude", host, { pid: people[3]!.uid, excluded: true });
    await hostAct("mv1", "team-formation/distribute");
    // Сброс — команды удалены, игроки без команды, исключения очищены.
    const reset = (await hostAct("mv1", "team-formation/reset")).json();
    expect(reset.removedTeams).toHaveLength(2);
    let all = await rows("mv1");
    expect(all.filter((r) => r.kind === "team")).toHaveLength(0);
    expect(all.every((r) => r.team_id === null)).toBe(true);
    expect((await call("GET", "/api/sessions/mv1/team-lobby", host)).json().formation.excluded).toEqual([]);
    // Снова распределяем всех четверых.
    await hostAct("mv1", "team-formation/distribute");
    all = await rows("mv1");
    const [t1, t2] = all.filter((r) => r.kind === "team");
    const inT1 = all.filter((p) => p.team_id === t1!.id);
    const inT2 = all.filter((p) => p.team_id === t2!.id);
    // Капитан t1 переходит в t2: в t1 новый капитан, в t2 капитан прежний.
    const captain1 = t1!.captain_uid;
    const moved = await hostAct("mv1", `participants/${captain1}/move`, { teamId: t2!.id });
    expect(moved.statusCode, moved.body).toBe(200);
    all = await rows("mv1");
    expect(all.find((p) => p.id === captain1)?.team_id).toBe(t2!.id);
    const newCaptain = all.find((r) => r.id === t1!.id)?.captain_uid;
    expect(inT1.map((p) => p.id)).toContain(newCaptain);
    expect(newCaptain).not.toBe(captain1);
    expect(all.find((r) => r.id === t2!.id)?.captain_uid).toBe(t2!.captain_uid);
    // t2 полна (3) — ещё одного не взять.
    const left = inT1.find((p) => p.id !== captain1)!;
    expect(inT2.length + 1).toBe(3);
    expect((await hostAct("mv1", `participants/${left.id}/move`, { teamId: t2!.id })).json()).toEqual({ error: "team-full" });
    // Ведущий не может создать третью команду сверх двух.
    expect((await hostAct("mv1", "team-formation/team", { captainPid: left.id })).json()).toEqual({ error: "team-limit" });

    // Игра: открытый вопрос — перемещать нельзя; поздний игрок попадает в меньшую команду.
    await call("POST", "/api/sessions/mv1/phase", host, { phase: "playing" });
    await call("POST", "/api/sessions/mv1/apply", host, { state: { stage: "question", startedAt: "server", timeLimit: null } });
    expect((await hostAct("mv1", `participants/${left.id}/move`, { teamId: null })).json()).toEqual({ error: "failed-precondition" });
    const [late] = await guests("mv1", 1, "Поздний");
    all = await rows("mv1");
    expect(all.find((p) => p.id === late!.uid)?.team_id).toBe(t1!.id);
    await call("POST", "/api/sessions/mv1/apply", host, { state: { stage: "reveal" } });
    expect((await hostAct("mv1", `participants/${left.id}/move`, { teamId: null })).statusCode).toBe(200);
    // Сбросить во время игры нельзя.
    expect((await hostAct("mv1", "team-formation/reset")).json()).toEqual({ error: "failed-precondition" });
  });

  it("капитан: только член команды; автосмена не берёт вернувшегося и отметившего «Не хочу»; удаление команды очищает членов", async () => {
    await newSession("cap1", { mode: "self", teamCount: 3, maxMembers: 5 });
    const [a, b, c, outsider] = await guests("cap1", 4);
    await call("POST", "/api/sessions/cap1/teams", a!.cookie, { id: "tA", name: "Лисы" });
    for (const g of [b!, c!]) await call("POST", `/api/sessions/cap1/participants/${g.uid}/join`, g.cookie, { name: "Член", teamId: "tA" });
    expect((await call("POST", "/api/sessions/cap1/participants/tA/captain", host, { uid: outsider!.uid })).statusCode).toBe(400);
    // Капитан на связи — автосмена отклоняется; ручная — можно.
    expect((await call("POST", "/api/sessions/cap1/participants/tA/captain", host, { uid: b!.uid, auto: true })).json()).toEqual({ error: "formation-changed" });
    await offline("cap1", [a!.uid]);
    // b успел отметить «Не хочу», c согласен и на связи — автосмена на b отклоняется, на c — проходит.
    await call("POST", `/api/sessions/cap1/participants/${b!.uid}/captain-pref`, b!.cookie, { noCaptain: true });
    expect((await call("POST", "/api/sessions/cap1/participants/tA/captain", host, { uid: b!.uid, auto: true })).json()).toEqual({ error: "formation-changed" });
    expect((await call("POST", "/api/sessions/cap1/participants/tA/captain", host, { uid: c!.uid, auto: true })).statusCode).toBe(200);
    // Ручное назначение галочку не проверяет.
    expect((await call("POST", "/api/sessions/cap1/participants/tA/captain", host, { uid: b!.uid })).statusCode).toBe(200);
    // Ведущий убирает команду — у членов нет висящей ссылки.
    expect((await call("DELETE", "/api/sessions/cap1/participants/tA", host)).statusCode).toBe(200);
    const all = await rows("cap1");
    expect(all.some((r) => r.id === "tA")).toBe(false);
    expect(all.filter((r) => r.kind === "player").every((r) => r.team_id === null)).toBe(true);
  });

  it("во время игры: исключения не действуют, настройки — не при открытом вопросе, последнюю команду с людьми не убрать; поздний — капитан команды без капитана", async () => {
    await newSession("play1", { mode: "self", teamCount: 3, maxMembers: 4 });
    const [a, b, c] = await guests("play1", 3);
    await call("POST", "/api/sessions/play1/teams", a!.cookie, { id: "tA", name: "Лисы" });
    await call("POST", "/api/sessions/play1/teams", b!.cookie, { id: "tB", name: "Совы" });
    await call("POST", "/api/sessions/play1/team-formation/exclude", host, { pid: c!.uid, excluded: true });
    await call("POST", "/api/sessions/play1/phase", host, { phase: "playing" });
    // c исключён в лобби, но во время игры «Распределить оставшихся» его берёт.
    const auto = (await hostAct("play1", "team-formation/auto-assign")).json();
    expect(Object.keys(auto.assigned)).toEqual([c!.uid]);
    await call("POST", "/api/sessions/play1/apply", host, { state: { stage: "question", startedAt: "server", timeLimit: null } });
    expect((await hostAct("play1", "team-formation", { mode: "self", maxMembers: 5 })).json()).toEqual({ error: "failed-precondition" });
    await call("POST", "/api/sessions/play1/apply", host, { state: { stage: "reveal" } });
    expect((await hostAct("play1", "team-formation", { mode: "self", maxMembers: 5 })).statusCode).toBe(200);
    // Ведущий убрал единственного члена «Сов» (он и капитан): команда осталась без капитана в составе.
    const all = await rows("play1");
    const inB = all.filter((p) => p.team_id === "tB").map((p) => p.id);
    for (const pid of inB) await call("DELETE", `/api/sessions/play1/participants/${pid}`, host);
    const [late] = await guests("play1", 1, "Поздний");
    const after = await rows("play1");
    expect(after.find((p) => p.id === late!.uid)?.team_id).toBe("tB");
    expect(after.find((p) => p.id === "tB")?.captain_uid).toBe(late!.uid);
    // Последнюю команду с людьми во время игры не расформировать.
    for (const p of after.filter((x) => x.team_id === "tA")) await call("DELETE", `/api/sessions/play1/participants/${p.id}`, host);
    await call("DELETE", "/api/sessions/play1/participants/tA", host);
    expect((await call("DELETE", "/api/sessions/play1/participants/tB", host)).json()).toEqual({ error: "failed-precondition" });
  });

  it("удаление сессии убирает и журнал действий формирования", async () => {
    await newSession("del1", { mode: "randomTeams", teamCount: 1, maxMembers: 5 });
    await guests("del1", 2);
    await hostAct("del1", "team-formation/distribute");
    expect((await sql`select count(*)::int as n from team_formation_actions where session_id = 'del1'`)[0]?.n).toBe(1);
    await sql.begin(async (tx) => {
      await tx`delete from participants where session_id = 'del1'`;
      await tx`delete from sessions where id = 'del1'`;
    });
    expect((await sql`select count(*)::int as n from team_formation_actions where session_id = 'del1'`)[0]?.n).toBe(0);
  });

  it("поток лобби по HTTP: снимок при подписке и после входа; «я на связи» и галочка его не трогают; гостю — без исключённых", async () => {
    await newSession("str1", { mode: "randomTeams", teamCount: 2, maxMembers: 5 });
    const [a, b] = await guests("str1", 2);
    await call("POST", "/api/sessions/str1/team-formation/exclude", host, { pid: a!.uid, excluded: true });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const open = (cookie: string) => {
      const events: Array<{ type: string; lobby: { joinedCount: number; formation: { excluded?: string[] } } }> = [];
      let buffer = "";
      const request = get({ host: "127.0.0.1", port, path: "/api/stream/team-lobby/str1", headers: { host: HOST, cookie } }, (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let at: number;
          while ((at = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)));
          }
        });
      });
      request.on("error", () => undefined);
      return { events, close: () => request.destroy() };
    };
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 60 && !check(); i++) await new Promise((r) => setTimeout(r, 50));
      expect(check()).toBe(true);
    };
    const guest = open(b!.cookie);
    const pult = open(host);
    try {
      await until(() => guest.events.length === 1 && pult.events.length === 1);
      expect(guest.events[0]!.lobby.formation).not.toHaveProperty("excluded");
      expect(pult.events[0]!.lobby.formation.excluded).toEqual([a!.uid]);
      await call("POST", `/api/sessions/str1/participants/${b!.uid}/touch`, b!.cookie);
      await call("POST", `/api/sessions/str1/participants/${b!.uid}/captain-pref`, b!.cookie, { noCaptain: true });
      await new Promise((r) => setTimeout(r, 500));
      expect(guest.events.length).toBe(1);
      await guests("str1", 3, "Новый");
      await until(() => guest.events.some((e) => e.lobby.joinedCount === 5));
      // Входы подряд сливаются паузой перед снимком; сколько именно — зависит от скорости машины.
      expect(guest.events.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(guest.events)).not.toContain(a!.uid);
    } finally {
      guest.close();
      pult.close();
    }
  });

  it("настройки: смена режима — только без команд; меньше команд или мест, чем есть, — отказ; в прежнее лобби — галочки сброшены", async () => {
    await newSession("set1", { mode: "self", teamCount: 3, maxMembers: 4 });
    const [a, b] = await guests("set1", 2);
    await call("POST", `/api/sessions/set1/participants/${b!.uid}/captain-pref`, b!.cookie, { noCaptain: true });
    expect((await hostAct("set1", "team-formation", { mode: "self", teamCount: 20, maxMembers: 10 })).json()).toEqual({ error: "capacity-limit" });
    expect((await hostAct("set1", "team-formation", { mode: "self", teamCount: 2, maxMembers: 4 })).json()).toMatchObject({ teamCount: 2 });
    await call("POST", "/api/sessions/set1/teams", a!.cookie, { id: "tA", name: "Лисы" });
    await call("POST", `/api/sessions/set1/participants/${b!.uid}/join`, b!.cookie, { name: "Б", teamId: "tA" });
    expect((await hostAct("set1", "team-formation", { mode: "randomTeams" })).json()).toEqual({ error: "failed-precondition" });
    expect((await hostAct("set1", "team-formation", { mode: "self", maxMembers: 2 })).statusCode).toBe(200);
    expect((await hostAct("set1", "team-formation", { mode: "legacy" })).json()).toEqual({ error: "failed-precondition" });
    await call("DELETE", "/api/sessions/set1/participants/tA", host);
    const before = (await call("GET", "/api/sessions/set1", host)).json().version;
    const oldRevision = await revision("set1");
    expect((await hostAct("set1", "team-formation", { mode: "legacy" })).json()).toEqual({ mode: "legacy", revision: oldRevision + 1 });
    expect((await rows("set1")).every((r) => !r.no_captain)).toBe(true);
    const legacy = (await call("GET", "/api/sessions/set1", host)).json();
    expect(legacy.teamFormation).toBeNull();
    // Телефоны узнают о возврате прежнего лобби из потока сессии: версия выросла.
    expect(legacy.version).toBeGreaterThan(before);
    // Снова управляемое: revision продолжается, запоздалый запрос старого лобби не проходит (ABA).
    expect((await call("POST", "/api/sessions/set1/team-formation", host, { actionId: actionId(), expectedRevision: 1, mode: "self" })).json()).toEqual({ error: "formation-changed" });
    expect((await hostAct("set1", "team-formation", { mode: "self", teamCount: 3, maxMembers: 4 })).json()).toMatchObject({ revision: oldRevision + 2 });
    // При запуске «legacy» — просто прежнее лобби.
    expect((await newSession("set2", { mode: "legacy" })).statusCode).toBe(200);
    expect((await call("GET", "/api/sessions/set2", host)).json().teamFormation).toBeNull();
    // Чужой ведущий — нельзя.
    const g = await device();
    expect((await call("POST", "/api/sessions/set1/team-formation", g.cookie, { actionId: actionId(), expectedRevision: 0, mode: "self" })).statusCode).toBe(403);
  });
});
