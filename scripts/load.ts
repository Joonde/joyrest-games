/**
 * Нагрузочная проверка своего сервера (этап 7, CLAUDE.md, раздел 9): N виртуальных гостей
 * проходят демо-квиз на тестовом адресе через настоящие REST и потоки событий (SSE), как
 * браузеры. Пульт ведёт игру той же логикой, что настоящий (src/mechanics/quiz/flow.ts),
 * экран зала слушает сессию.
 *
 *   LOAD_HOST_EMAIL=… LOAD_HOST_PASSWORD=… GUESTS=500 npx tsx scripts/load.ts
 *   TEAMS=1 — режим команд (по 10 телефонов в команде)
 *   MODE=room — быстрый канал (CLAUDE.md, «Быстрый канал (комнаты)»): игра «room-check», каждый бот раз в
 *   секунду шлёт пачку касаний и раз в ~2 с — «движение» отдельным запросом; экран и пульт подписаны на свои
 *   потоки. ROOM_SECONDS — сколько длится (по умолчанию 60).
 *
 * Только test.games.joy-rest.ru: основной адрес — отказ (там могут идти игры).
 * Итог: время входа, доставка вопроса на телефоны, время ответа, ошибки. Код выхода 1 —
 * если есть ошибки, потерянные ответы или доставка дольше порога.
 */
import { leaderboardAdditions } from "../src/core/leaderboard";
import type { Answer, Leaderboard, LeaderboardEntry, Participant, PlayMode, Session, SessionChange } from "../src/data/types";
import { DEMO_QUIZ } from "../src/mechanics/quiz/demo";
import { nextQuestion, reveal, showBoard, showQuestion } from "../src/mechanics/quiz/flow";

const BASE = (process.env.LOAD_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const GUESTS = Math.max(1, Math.min(1000, Number(process.env.GUESTS ?? 500) || 500));
const TEAMS = process.env.TEAMS === "1" || process.env.TEAMS === "true";
/** Сколько мероприятий идёт одновременно (разные ведущие, свои гости у каждого). */
const EVENTS = Math.max(1, Math.min(12, Number(process.env.EVENTS ?? 1) || 1));
const TEAM_SIZE = 10;
const EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
/** Вопрос должен дойти до 95% телефонов быстрее — иначе проверка не пройдена. */
const DELIVERY_P95_LIMIT_MS = 2000;
const ANSWERED_THROTTLE_MS = 2000;
const QUESTIONS = DEMO_QUIZ.content.questions;
/** quiz — демо-квиз (медленный путь), room — быстрый канал (игровая комната). */
const MODE = process.env.MODE === "room" ? "room" : "quiz";
const ROOM_SECONDS = Math.max(10, Math.min(600, Number(process.env.ROOM_SECONDS ?? 60) || 60));
/** Быстрый канал: личное событие и сводка экрана должны доходить у 95% быстрее — иначе не пройдено. */
const ROOM_P95_LIMIT_MS = 1000;
/** Быстрый канал: задержка общего цикла комнат больше этого — не пройдено (ТЗ: сначала оптимизировать расчёт). */
const ROOM_LOOP_LIMIT_MS = 100;
/** Быстрый канал: память процесса app больше этого — не пройдено (80% от mem_limit app-test 256 МБ). */
const ROOM_MEMORY_LIMIT_MB = Math.max(64, Number(process.env.ROOM_MEMORY_LIMIT_MB ?? 205) || 205);

// ---------- Отчёт ----------

/** Все строки отчёта: в лог и, в GitHub Actions, отдельной аннотацией (её видно без логов). */
const report: string[] = [];
function say(line: string): void {
  report.push(line);
  console.log(line);
}
function finish(code: number): never {
  if (process.env.GITHUB_ACTIONS === "true") {
    const escape = (lines: string[]) => lines.join("\n").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    // Аннотация обрезается (~4 КБ): итог — отдельной, чтобы его было видно всегда.
    const at = report.findIndex((l) => l.startsWith("\nИтог"));
    const summary = at >= 0 ? report.slice(at) : report.slice(-25);
    console.log(`::${code === 0 ? "notice" : "error"} title=Нагрузка — итог::${escape([report[0] ?? "", ...summary])}`);
    console.log(`::notice title=Нагрузка — ход::${escape(report.slice(0, at >= 0 ? at : undefined))}`);
  }
  process.exit(code);
}

// ---------- Замеры ----------

const timings: Record<string, number[]> = {};
const errors: Record<string, number> = {};
const measure = (what: string, ms: number) => (timings[what] ??= []).push(ms);
const fail = (what: string) => (errors[what] = (errors[what] ?? 0) + 1);
let reconnects = 0;

function pct(list: number[], p: number): number {
  if (list.length === 0) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) return false;
    await wait(50);
  }
  return true;
}

// ---------- Клиент: своя cookie на устройство ----------

class Device {
  cookies = new Map<string, string>();

  private headers(write: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    if (write) {
      h["Content-Type"] = "application/json";
      h["X-JoyRest"] = "1";
      h.Origin = BASE;
    }
    return h;
  }

  private remember(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair?.indexOf("=") ?? -1;
      if (pair && i > 0) this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }

  async call<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const write = method !== "GET";
    const res = await fetch(BASE + path, {
      method,
      headers: this.headers(write),
      body: write ? JSON.stringify(body ?? {}) : undefined,
    });
    this.remember(res);
    const data = (await res.json().catch(() => null)) as T & { error?: string };
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error ?? ""}`);
    return data;
  }

  /** Поток событий как EventSource: при обрыве — переподключение через 1 с и новый снимок. */
  stream(path: string, onEvent: (event: Record<string, unknown>) => void): () => void {
    const controller = new AbortController();
    let stopped = false;
    const run = async () => {
      while (!stopped) {
        try {
          const res = await fetch(BASE + path, { headers: { ...this.headers(false), Accept: "text/event-stream" }, signal: controller.signal });
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let end: number;
            while ((end = buffer.indexOf("\n\n")) >= 0) {
              const chunk = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              for (const line of chunk.split("\n")) {
                if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
              }
            }
          }
        } catch (error) {
          if (stopped) return;
          fail(`поток оборвался (${error instanceof Error ? error.message.slice(0, 40) : "?"})`);
        }
        if (stopped) return;
        reconnects += 1;
        await wait(1000);
      }
    };
    void run();
    return () => {
      stopped = true;
      controller.abort();
    };
  }
}

// ---------- Сессия глазами устройства ----------

type Versioned = Session & { version: number };

function follow(device: Device, sessionId: string, onChange: (s: Versioned) => void): () => void {
  let current: Versioned | null = null;
  return device.stream(`/api/stream/session/${sessionId}`, (event) => {
    if (event.type === "snapshot" && event.session) {
      current = event.session as Versioned;
      onChange(current);
    } else if (event.type === "patch" && current) {
      const version = Number(event.version);
      if (version <= current.version) return;
      const leaderboard: Leaderboard = { ...current.leaderboard };
      for (const [pid, entry] of Object.entries((event.leaderboard ?? {}) as Record<string, LeaderboardEntry | null>)) {
        if (entry === null) delete leaderboard[pid];
        else leaderboard[pid] = entry;
      }
      current = { ...current, version, state: event.state as Session["state"], leaderboard };
      onChange(current);
    }
  });
}

// ---------- Гость ----------

const OPEN_ANSWERS = ["Снегурочка", "снегурка", "Снегурочк", "ёлка", "Ель", "не знаю"];
/** Когда пульт открыл шаг (по часам этой машины) — для замера доставки. */
const questionShownAt = new Map<string, number[]>();
const answeredBy = new Map<string, Set<string>>();
const shownList = (sessionId: string) => questionShownAt.get(sessionId) ?? questionShownAt.set(sessionId, []).get(sessionId) ?? [];

/** Гость входит в сессию (свой телефон, в режиме команд — своя или новая команда). */
async function joinGuest(sessionId: string, index: number, teamIds: string[]): Promise<{ device: Device; uid: string; pid: string; captain: boolean }> {
  const device = new Device();
  // Сначала открыть соединение (TLS с машины проверки — сотни мс на бота): «выдача устройства» меряет сервер, а не рукопожатие.
  let t = Date.now();
  await device.call("GET", "/api/time");
  measure("первое соединение (TLS, /api/time)", Date.now() - t);
  t = Date.now();
  const me = await device.call<{ uid: string }>("POST", "/api/auth/device");
  measure("выдача устройства", Date.now() - t);
  const uid = me.uid;
  let pid = uid;
  let captain = true;
  if (TEAMS) {
    const team = Math.floor(index / TEAM_SIZE);
    if (index % TEAM_SIZE === 0) {
      const created = await device.call<{ id: string }>("POST", `/api/sessions/${sessionId}/teams`, {
        id: `t${team}${uid.slice(0, 12)}`,
        name: `Команда ${team + 1}`,
      });
      teamIds[team] = created.id;
    }
    await until(() => Boolean(teamIds[team]), 30_000);
    pid = teamIds[team] ?? uid;
    captain = index % TEAM_SIZE === 0;
  }
  t = Date.now();
  await device.call("POST", `/api/sessions/${sessionId}/participants/${uid}/join`, {
    name: `Гость ${(index % 40) + 1}`, // повторяющиеся имена — проверка номеров
    teamId: TEAMS ? pid : null,
  });
  measure("вход в игру", Date.now() - t);
  return { device, uid, pid, captain };
}

async function startGuest(sessionId: string, index: number, teamIds: string[]): Promise<() => void> {
  const { device, pid, captain } = await joinGuest(sessionId, index, teamIds);
  const seenSteps = new Set<number>();
  return follow(device, sessionId, (session) => {
    const { phase, stage, step } = session.state;
    if (phase !== "playing" || stage !== "question" || seenSteps.has(step)) return;
    seenSteps.add(step);
    const shown = shownList(sessionId)[step];
    if (shown) measure("вопрос дошёл до телефона", Date.now() - shown);
    if (!captain) return;
    const q = QUESTIONS[step];
    if (!q) return;
    const value = q.kind === "open" ? OPEN_ANSWERS[index % OPEN_ANSWERS.length] : Math.floor(Math.random() * q.options.length);
    // Гости отвечают за 0,5–5 секунд.
    setTimeout(() => {
      const sent = Date.now();
      device
        .call<{ result: string }>("POST", `/api/sessions/${sessionId}/answers`, { step, pid, value })
        .then((r) => {
          measure("ответ принят сервером", Date.now() - sent);
          const key = `${sessionId}:${step}`;
          if (r.result === "sent") (answeredBy.get(key) ?? answeredBy.set(key, new Set()).get(key))?.add(pid);
          else fail("ответ отклонён");
        })
        .catch(() => fail("ответ не отправился"));
    }, 500 + Math.random() * 4500);
  });
}

// ---------- Пульт ----------

async function main() {
  if (!/^https:\/\/test\./.test(BASE) && process.env.LOAD_ALLOW_ANY !== "1") {
    say(`Отказ: нагрузка только на тестовый адрес (сейчас ${BASE}).`);
    finish(2);
  }
  if (!EMAIL || !PASSWORD) {
    say("Нужны LOAD_HOST_EMAIL и LOAD_HOST_PASSWORD — ведущий на тестовом адресе (RUNBOOK, «Нагрузка»).");
    finish(2);
  }
  const started = Date.now();
  say(
    MODE === "room"
      ? `Нагрузка быстрого канала на ${BASE}: ${EVENTS} × ${GUESTS} гостей, ${ROOM_SECONDS} с, пачка раз в секунду и «движение» раз в ~2 с с каждого телефона`
      : EVENTS > 1
      ? `Нагрузка на ${BASE}: ${EVENTS} мероприятий одновременно по ${GUESTS} гостей (всего ${EVENTS * GUESTS}), ${TEAMS ? "команды по 10" : "каждый сам за себя"}, ${QUESTIONS.length} вопросов; параллельно — сайт, «Игры сейчас», анкеты площадок`
      : `Нагрузка на ${BASE}: ${GUESTS} гостей, ${TEAMS ? "команды по 10" : "каждый сам за себя"}, ${QUESTIONS.length} вопросов`,
  );

  const health = await fetch(`${BASE}/health`).then((r) => r.json() as Promise<{ version?: string }>);
  say(`Версия на сервере: ${String(health.version ?? "?").slice(0, 7)}`);

  const host = new Device();
  await host.call("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });

  // Фон, как в обычный вечер: студия («Игры сейчас»), команда, проверка сервера, анкеты площадок (QR).
  let background = true;
  const side = (async () => {
    const visitor = new Device();
    while (background) {
      for (const [what, run] of [
        ["сервер /health", () => fetch(`${BASE}/health`).then((r) => { if (!r.ok) throw new Error(String(r.status)); })],
        ["студия: игры сейчас", () => host.call("GET", "/api/sessions/overview")],
        ["команда JoyRest", () => host.call("GET", "/api/team")],
        ["анкета площадки (QR)", () => fetch(`${BASE}/v?from=load`).then((r) => { if (!r.ok) throw new Error(String(r.status)); })],
        ["анкеты: открыты ли", () => visitor.call("GET", "/api/venue-forms/status")],
      ] as const) {
        const t = Date.now();
        try {
          await run();
          measure(what, Date.now() - t);
        } catch {
          fail(`${what}: ошибка`);
        }
      }
      await wait(1500);
    }
  })();

  const results = await Promise.allSettled(Array.from({ length: EVENTS }, (_, i) => (MODE === "room" ? runRoomEvent(host, i) : runEvent(host, i))));
  background = false;
  await side;
  for (const r of results) if (r.status === "rejected") fail(`мероприятие сорвалось: ${String(r.reason).slice(0, 80)}`);
  report_(started);
}

async function runEvent(host: Device, index: number): Promise<void> {
  const playMode: PlayMode = TEAMS ? "teams" : "solo";
  const sessionId = `load${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const created = await host.call<{ id: string; code: string }>("POST", "/api/sessions", {
    id: sessionId,
    gameTitle: EVENTS > 1 ? `Нагрузка ${index + 1}/${EVENTS}` : `Нагрузка ${GUESTS}`,
    mechanic: "quiz",
    gameSnapshot: { title: DEMO_QUIZ.title, mechanic: "quiz", themeId: "joyrest", content: DEMO_QUIZ.content },
    themeId: "joyrest",
    playMode,
    screenMode: "laptop",
  });
  const tag = EVENTS > 1 ? `[${index + 1}] ` : "";
  say(`${tag}Сессия ${created.code}`);

  let session: Versioned | null = null;
  const stopSession = follow(host, sessionId, (s) => (session = s));
  let participants: Participant[] = [];
  const stopParticipants = host.stream(`/api/stream/participants/${sessionId}`, (event) => {
    if (event.type === "snapshot") participants = (event.participants ?? []) as Participant[];
    else if (event.type === "upsert") {
      const p = event.participant as Participant;
      participants = [...participants.filter((x) => x.id !== p.id), p];
    } else if (event.type === "remove") participants = participants.filter((x) => x.id !== event.id);
  });
  // Экран зала — отдельное устройство, слушает только сессию.
  const screen = new Device();
  await screen.call("POST", "/api/auth/device");
  const stopScreen = follow(screen, sessionId, () => undefined);
  await until(() => session !== null, 10_000);

  const apply = async (change: SessionChange) => {
    const t = Date.now();
    await host.call("POST", `/api/sessions/${sessionId}/apply`, change);
    measure("действие пульта", Date.now() - t);
  };
  const current = () => session as unknown as Versioned;

  // Гости входят пачками по 25 — как на мероприятии.
  say(`${tag}Гости входят…`);
  const joinStart = Date.now();
  const teamIds: string[] = [];
  const stops: Array<() => void> = [];
  for (let i = 0; i < GUESTS; i += 25) {
    const batch = await Promise.allSettled(Array.from({ length: Math.min(25, GUESTS - i) }, (_, k) => startGuest(sessionId, i + k, teamIds)));
    for (const r of batch) {
      if (r.status === "fulfilled") stops.push(r.value);
      else {
        fail("гость не вошёл");
        if ((errors["гость не вошёл"] ?? 0) <= 3) say(`  ${String(r.reason).slice(0, 120)}`);
      }
    }
  }
  const joinSeconds = (Date.now() - joinStart) / 1000;
  const scoringKind = TEAMS ? "team" : "player";
  const expected = TEAMS ? Math.ceil(GUESTS / TEAM_SIZE) : GUESTS;
  await until(() => participants.filter((p) => p.kind === scoringKind).length >= expected, 30_000);

  // Пульт вносит участников в таблицу (как в лобби).
  for (let i = 0; i < 5; i++) {
    const additions = leaderboardAdditions(current().leaderboard, participants, playMode);
    if (Object.keys(additions).length > 0) {
      await host.call("POST", `/api/sessions/${sessionId}/leaderboard`, { entries: additions });
      await until(() => Object.keys(current().leaderboard).length >= Object.keys(additions).length, 5000);
    }
    await wait(300);
  }
  const names = Object.values(current().leaderboard).map((e) => e.name);
  say(`${tag}Вошли за ${joinSeconds.toFixed(1)} с. В таблице ${names.length}, уникальных имён ${new Set(names).size}`);

  await host.call("POST", `/api/sessions/${sessionId}/phase`, { phase: "playing" });
  await until(() => current().state.phase === "playing", 5000);

  for (let step = 0; step < QUESTIONS.length; step++) {
    await until(() => current().state.step === step && current().state.stage === "ready", 10_000);
    let answers: Answer[] = [];
    const stopAnswers = host.stream(`/api/stream/answers/${sessionId}/${step}`, (event) => {
      if (event.type === "snapshot") answers = (event.answers ?? []) as Answer[];
      else if (event.type === "answer") answers = [...answers.filter((a) => a.id !== (event.answer as Answer).id), event.answer as Answer];
      else if (event.type === "clear") answers = [];
    });
    const t0 = Date.now();
    shownList(sessionId)[step] = t0;
    await apply(showQuestion(current(), DEMO_QUIZ.content));
    let lastCount = 0;
    while (answers.length < expected && Date.now() - t0 < 15_000) {
      await wait(ANSWERED_THROTTLE_MS);
      if (answers.length !== lastCount) {
        lastCount = answers.length;
        await apply({ state: { answered: lastCount } });
      }
    }
    await until(() => current().state.stage === "question", 5000);
    await apply(reveal(current(), DEMO_QUIZ.content, answers, participants));
    await apply(showBoard(current(), DEMO_QUIZ.content));
    stopAnswers();
    if (step < QUESTIONS.length - 1) await apply(nextQuestion(current(), DEMO_QUIZ.content));
    const got = answeredBy.get(`${sessionId}:${step}`)?.size ?? 0;
    say(`  ${tag}вопрос ${step + 1}: пульт видит ${answers.length}, сервер принял ${got} из ${expected} за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
    if (answers.length < got) fail("пульт не увидел ответ");
  }

  await host.call("POST", `/api/sessions/${sessionId}/finish`, { participantsCount: GUESTS });
  await wait(2000);
  stops.forEach((stop) => stop());
  stopSession();
  stopParticipants();
  stopScreen();
  expectedTotal += expected * QUESTIONS.length;
}

let expectedTotal = 0;

// ---------- Быстрый канал (MODE=room) ----------

const roomStats = { movesSent: 0, pongsGot: 0, tapsAccepted: 0, tapsUnknown: 0, tapsOnServer: 0, loopMaxLagMs: 0, memoryMb: 0, tapsWaiting: 0 };
/**
 * «Касание → экран»: каждая пачка касаний — отметка «сумма касаний после неё, когда ушла». Сводка экрана с общим
 * счётом не меньше этой суммы — касание дошло до экрана (замер от отправки до прихода сводки).
 */
const tapMarks = new Map<string, Array<{ cum: number; sentAt: number }>>();
const tapCum = new Map<string, number>();

/** Смещение часов сервера относительно этой машины: три замера, лучший по задержке. */
async function serverOffset(device: Device): Promise<number> {
  let best = { rtt: Infinity, offset: 0 };
  for (let i = 0; i < 3; i++) {
    const sent = Date.now();
    const { now } = await device.call<{ now: number }>("GET", "/api/time");
    const received = Date.now();
    if (received - sent < best.rtt) best = { rtt: received - sent, offset: now - (sent + received) / 2 };
  }
  return best.offset;
}

/** Бот-телефон: пачка касаний раз в секунду, «движение» отдельным запросом раз в ~2 с, личный поток. */
async function roomBot(sessionId: string, index: number, teamIds: string[], endAt: number): Promise<void> {
  const { device } = await joinGuest(sessionId, index, teamIds);
  const stream = `b${index}${Math.random().toString(36).slice(2, 8)}`;
  let seq = 0;
  const waiting = new Map<string, number>();
  let snapshot = false;
  const stop = device.stream(`/api/stream/room/${sessionId}/me`, (event) => {
    if (event.type === "snapshot") snapshot = true;
    if (event.type !== "event") return;
    const data = (event.data ?? {}) as { t?: string; id?: string };
    const sentAt = data.t === "pong" && data.id ? waiting.get(data.id) : undefined;
    if (sentAt === undefined || !data.id) return;
    waiting.delete(data.id);
    roomStats.pongsGot += 1;
    measure("личное событие дошло", Date.now() - sentAt);
  });
  if (!(await until(() => snapshot, 15_000))) fail("личный поток не открылся");
  let every = 1000;
  const send = async (events: Array<Record<string, unknown>>) => {
    const number = ++seq;
    const t = Date.now();
    const taps = events.reduce((n, e) => n + (e.t === "tap" ? Number(e.n) || 0 : 0), 0);
    if (taps > 0) {
      const cum = (tapCum.get(sessionId) ?? 0) + taps;
      tapCum.set(sessionId, cum);
      (tapMarks.get(sessionId) ?? tapMarks.set(sessionId, []).get(sessionId) ?? []).push({ cum, sentAt: t });
    }
    try {
      const reply = await device.call<{ dup?: boolean; dropped?: number; every?: number; stale?: boolean }>("POST", `/api/rooms/${sessionId}/input`, { stream, seq: number, events });
      measure("пачка принята сервером", Date.now() - t);
      if (typeof reply.every === "number" && reply.every >= 250) every = reply.every;
      if (reply.dropped) fail("лимит срезал события");
      if (reply.stale) fail("пачка устарела (stale)");
      if (!reply.dup && !reply.stale) roomStats.tapsAccepted += taps;
    } catch (error) {
      // Ответ потерялся — сервер мог её и принять: такие касания «неизвестны», не потеряны.
      roomStats.tapsUnknown += taps;
      fail(`пачка не принята (${error instanceof Error ? error.message.replace(/^POST \S+: /, "").slice(0, 30) : "?"})`);
    }
  };
  await wait(Math.random() * 300);
  let moves = 0;
  let nextMove = Date.now() + 500 + Math.random() * 1500;
  const pending: Promise<void>[] = [];
  while (Date.now() < endAt) {
    pending.push(send([{ t: "tap", n: 1 + Math.floor(Math.random() * 9) }]));
    if (Date.now() >= nextMove) {
      const id = `${index}-${moves++}`;
      waiting.set(id, Date.now());
      roomStats.movesSent += 1;
      pending.push(send([{ t: "move", id }]));
      nextMove = Date.now() + 1500 + Math.random() * 1000;
    }
    // Как настоящий телефон: пачка раз в `every`, который назначает сервер.
    await wait(every);
  }
  await Promise.all(pending);
  await until(() => waiting.size === 0, 5000);
  for (let i = 0; i < waiting.size; i++) fail("личное событие потерялось");
  stop();
}


async function runRoomEvent(host: Device, index: number): Promise<void> {
  const playMode: PlayMode = TEAMS ? "teams" : "solo";
  const sessionId = `loadr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const created = await host.call<{ id: string; code: string }>("POST", "/api/sessions", {
    id: sessionId,
    gameTitle: `Нагрузка: быстрый канал ${GUESTS}`,
    mechanic: "room-check",
    gameSnapshot: { title: "room-check", mechanic: "room-check", content: {} },
    themeId: "joyrest",
    playMode,
    screenMode: "laptop",
  });
  const tag = EVENTS > 1 ? `[${index + 1}] ` : "";
  say(`${tag}Сессия ${created.code} (комната room-check)`);

  // Экран зала — отдельное устройство: сводка до 5 раз в секунду. Пульт — сводка раз в секунду.
  const screen = new Device();
  await screen.call("POST", "/api/auth/device");
  const offset = await serverOffset(screen);
  let screens = 0;
  const stopScreen = screen.stream(`/api/stream/room/${sessionId}/screen`, (event) => {
    if (event.type !== "screen" || typeof event.at !== "number") return;
    screens += 1;
    if (screens > 1) measure("сводка экрана дошла", Math.max(0, Date.now() + offset - event.at));
    const shown = Number((event.data as { total?: number } | undefined)?.total) || 0;
    const marks = tapMarks.get(sessionId) ?? [];
    while (marks.length > 0 && (marks[0]?.cum ?? Infinity) <= shown) {
      const mark = marks.shift();
      if (mark) measure("касание → экран", Date.now() - mark.sentAt);
    }
  });
  let online = 0;
  const stopHost = host.stream(`/api/stream/room/${sessionId}/host`, (event) => {
    if (event.type !== "host") return;
    online = Math.max(online, Number(event.online) || 0);
    const loop = (event.loop ?? {}) as { maxLagMs?: number };
    roomStats.loopMaxLagMs = Math.max(roomStats.loopMaxLagMs, Number(loop.maxLagMs) || 0);
    roomStats.memoryMb = Math.max(roomStats.memoryMb, Number((loop as { memoryMb?: number }).memoryMb) || 0);
  });
  await host.call("POST", `/api/rooms/${sessionId}/command`, { cmd: "reset", id: `reset${index}` });
  await host.call("POST", `/api/sessions/${sessionId}/phase`, { phase: "playing" });

  say(`${tag}Гости входят и играют ${ROOM_SECONDS} с…`);
  const endAt = Date.now() + ROOM_SECONDS * 1000 + 20_000;
  const teamIds: string[] = [];
  const bots: Promise<void>[] = [];
  const joinStart = Date.now();
  for (let i = 0; i < GUESTS; i += 25) {
    for (let k = 0; k < Math.min(25, GUESTS - i); k++) {
      bots.push(roomBot(sessionId, i + k, teamIds, endAt).catch((error: unknown) => {
        fail("гость не вошёл");
        if ((errors["гость не вошёл"] ?? 0) <= 3) say(`  ${String(error).slice(0, 120)}`);
      }));
    }
    await wait(400);
  }
  say(`${tag}Все боты запущены за ${((Date.now() - joinStart) / 1000).toFixed(1)} с`);
  // Посреди игры — контрольная точка (снимок в базу), как на смене шага.
  await wait(Math.max(0, (endAt - Date.now()) / 2));
  await host.call("POST", `/api/rooms/${sessionId}/command`, { cmd: "checkpoint" });
  await Promise.all(bots);
  await wait(1500);
  const final = await host.call<{ data?: { total?: number }; online?: number; loop?: { maxLagMs?: number } }>("GET", `/api/rooms/${sessionId}/host`);
  roomStats.tapsOnServer += Number(final.data?.total) || 0;
  roomStats.tapsWaiting += (tapMarks.get(sessionId) ?? []).length;
  roomStats.loopMaxLagMs = Math.max(roomStats.loopMaxLagMs, Number(final.loop?.maxLagMs) || 0);
  say(`  ${tag}на связи было до ${online} из ${GUESTS}, сводок экрана ${screens}`);
  await host.call("POST", `/api/sessions/${sessionId}/finish`, { participantsCount: GUESTS });
  stopScreen();
  stopHost();
}

function report_(started: number): void {
  // ---------- Итог ----------
  const answersExpected = expectedTotal;
  const answersGot = [...answeredBy.values()].reduce((n, s) => n + s.size, 0);
  say(`\nИтог (${Math.round((Date.now() - started) / 1000)} с):`);
  for (const [what, list] of Object.entries(timings)) {
    say(`  ${what.padEnd(28)} медиана ${String(pct(list, 50)).padStart(5)} мс, 95% ${String(pct(list, 95)).padStart(5)} мс, макс ${String(Math.max(...list)).padStart(5)} мс (${list.length})`);
  }
  if (MODE === "quiz") say(`  ответов принято               ${answersGot} из ${answersExpected}`);
  say(`  переподключений потоков       ${reconnects}`);
  const errorTotal = Object.values(errors).reduce((a, b) => a + b, 0);
  say(`  ошибок                        ${errorTotal}`);
  for (const [what, n] of Object.entries(errors)) say(`    ${what}: ${n}`);

  if (MODE === "room") {
    say(`  личных событий дошло          ${roomStats.pongsGot} из ${roomStats.movesSent}`);
    say(`  касаний принято / на сервере  ${roomStats.tapsAccepted} / ${roomStats.tapsOnServer} (без ответа сервера: ${roomStats.tapsUnknown})`);
    say(`  пачек касаний не дошло до экрана ${roomStats.tapsWaiting}`);
    say(`  задержка цикла комнат (худшая) ${roomStats.loopMaxLagMs} мс (порог ${ROOM_LOOP_LIMIT_MS})`);
    say(`  память app (наибольшая)       ${roomStats.memoryMb} МБ (порог ${ROOM_MEMORY_LIMIT_MB})`);
    const me95 = pct(timings["личное событие дошло"] ?? [], 95);
    const screen95 = pct(timings["сводка экрана дошла"] ?? [], 95);
    const tap95 = pct(timings["касание → экран"] ?? [], 95);
    // Касания: сервер насчитал меньше принятого — потеря; больше принятого с «неизвестными» — двойной счёт.
    const tapsLost = Math.max(0, roomStats.tapsAccepted - roomStats.tapsOnServer) + Math.max(0, roomStats.tapsOnServer - roomStats.tapsAccepted - roomStats.tapsUnknown);
    const lost = roomStats.movesSent - roomStats.pongsGot + tapsLost;
    const ok =
      errorTotal === 0 &&
      lost === 0 &&
      roomStats.movesSent > 0 &&
      me95 <= ROOM_P95_LIMIT_MS &&
      screen95 <= ROOM_P95_LIMIT_MS &&
      tap95 <= ROOM_P95_LIMIT_MS + 1000 &&
      roomStats.loopMaxLagMs <= ROOM_LOOP_LIMIT_MS &&
      roomStats.memoryMb <= ROOM_MEMORY_LIMIT_MB;
    say(
      ok
        ? "\n✅ Проверка пройдена"
        : `\n❌ Проверка не пройдена (доставка 95% — ${ROOM_P95_LIMIT_MS} мс, «касание → экран» — ${ROOM_P95_LIMIT_MS + 1000} мс, цикл — ${ROOM_LOOP_LIMIT_MS} мс, память — ${ROOM_MEMORY_LIMIT_MB} МБ, потерь — 0)`,
    );
    finish(ok ? 0 : 1);
  }
  const delivery95 = pct(timings["вопрос дошёл до телефона"] ?? [], 95);
  const ok = errorTotal === 0 && answersGot === answersExpected && delivery95 <= DELIVERY_P95_LIMIT_MS;
  say(ok ? "\n✅ Проверка пройдена" : `\n❌ Проверка не пройдена (порог доставки 95% — ${DELIVERY_P95_LIMIT_MS} мс)`);
  finish(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  say(`Остановлено с ошибкой: ${error instanceof Error ? error.message : String(error)}`);
  finish(1);
});
