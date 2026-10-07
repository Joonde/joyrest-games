/**
 * Нагрузочная проверка своего сервера (этап 7, CLAUDE.md, раздел 9): N виртуальных гостей
 * проходят демо-квиз на тестовом адресе через настоящие REST и потоки событий (SSE), как
 * браузеры. Пульт ведёт игру той же логикой, что настоящий (src/mechanics/quiz/flow.ts),
 * экран зала слушает сессию.
 *
 *   LOAD_HOST_EMAIL=… LOAD_HOST_PASSWORD=… GUESTS=500 npx tsx scripts/load.ts
 *   TEAMS=1 — режим команд (по 10 телефонов в команде)
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
const TEAM_SIZE = 10;
const EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
/** Вопрос должен дойти до 95% телефонов быстрее — иначе проверка не пройдена. */
const DELIVERY_P95_LIMIT_MS = 2000;
const ANSWERED_THROTTLE_MS = 2000;
const QUESTIONS = DEMO_QUIZ.content.questions;

if (!/^https:\/\/test\./.test(BASE) && process.env.LOAD_ALLOW_ANY !== "1") {
  console.error(`Отказ: нагрузка только на тестовый адрес (сейчас ${BASE}).`);
  process.exit(2);
}
if (!EMAIL || !PASSWORD) {
  console.error("Нужны LOAD_HOST_EMAIL и LOAD_HOST_PASSWORD — ведущий на тестовом адресе (RUNBOOK, «Нагрузка»).");
  process.exit(2);
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
const questionShownAt: number[] = [];
const answeredBy = new Map<number, Set<string>>();

async function startGuest(sessionId: string, index: number, teamIds: string[]): Promise<() => void> {
  const device = new Device();
  let t = Date.now();
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

  const seenSteps = new Set<number>();
  return follow(device, sessionId, (session) => {
    const { phase, stage, step } = session.state;
    if (phase !== "playing" || stage !== "question" || seenSteps.has(step)) return;
    seenSteps.add(step);
    const shown = questionShownAt[step];
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
          if (r.result === "sent") (answeredBy.get(step) ?? answeredBy.set(step, new Set()).get(step))?.add(pid);
          else fail("ответ отклонён");
        })
        .catch(() => fail("ответ не отправился"));
    }, 500 + Math.random() * 4500);
  });
}

// ---------- Пульт ----------

async function main() {
  const started = Date.now();
  const playMode: PlayMode = TEAMS ? "teams" : "solo";
  console.log(`Нагрузка на ${BASE}: ${GUESTS} гостей, ${TEAMS ? "команды по 10" : "каждый сам за себя"}, ${QUESTIONS.length} вопросов`);

  const health = await fetch(`${BASE}/health`).then((r) => r.json() as Promise<{ version?: string }>);
  console.log(`Версия на сервере: ${String(health.version ?? "?").slice(0, 7)}`);

  const host = new Device();
  await host.call("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  const sessionId = `load${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const created = await host.call<{ id: string; code: string }>("POST", "/api/sessions", {
    id: sessionId,
    gameTitle: `Нагрузка ${GUESTS}`,
    mechanic: "quiz",
    gameSnapshot: { title: DEMO_QUIZ.title, mechanic: "quiz", themeId: "joyrest", content: DEMO_QUIZ.content },
    themeId: "joyrest",
    playMode,
    screenMode: "laptop",
  });
  console.log(`Сессия ${created.code}`);

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
  console.log("Гости входят…");
  const joinStart = Date.now();
  const teamIds: string[] = [];
  const stops: Array<() => void> = [];
  for (let i = 0; i < GUESTS; i += 25) {
    const batch = await Promise.allSettled(Array.from({ length: Math.min(25, GUESTS - i) }, (_, k) => startGuest(sessionId, i + k, teamIds)));
    for (const r of batch) {
      if (r.status === "fulfilled") stops.push(r.value);
      else {
        fail("гость не вошёл");
        if ((errors["гость не вошёл"] ?? 0) <= 3) console.log(`  ${String(r.reason).slice(0, 120)}`);
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
  console.log(`Вошли за ${joinSeconds.toFixed(1)} с. В таблице ${names.length}, уникальных имён ${new Set(names).size}`);

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
    questionShownAt[step] = t0;
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
    await apply(showBoard());
    stopAnswers();
    if (step < QUESTIONS.length - 1) await apply(nextQuestion(current()));
    const got = answeredBy.get(step)?.size ?? 0;
    console.log(`  вопрос ${step + 1}: пульт видит ${answers.length}, сервер принял ${got} из ${expected} за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
    if (answers.length < got) fail("пульт не увидел ответ");
  }

  await host.call("POST", `/api/sessions/${sessionId}/finish`, { participantsCount: GUESTS });
  await wait(2000);
  stops.forEach((stop) => stop());
  stopSession();
  stopParticipants();
  stopScreen();

  // ---------- Итог ----------
  const answersExpected = expected * QUESTIONS.length;
  const answersGot = [...answeredBy.values()].reduce((n, s) => n + s.size, 0);
  console.log(`\nИтог (${Math.round((Date.now() - started) / 1000)} с):`);
  for (const [what, list] of Object.entries(timings)) {
    console.log(`  ${what.padEnd(28)} медиана ${String(pct(list, 50)).padStart(5)} мс, 95% ${String(pct(list, 95)).padStart(5)} мс, макс ${String(Math.max(...list)).padStart(5)} мс (${list.length})`);
  }
  console.log(`  ответов принято               ${answersGot} из ${answersExpected}`);
  console.log(`  переподключений потоков       ${reconnects}`);
  const errorTotal = Object.values(errors).reduce((a, b) => a + b, 0);
  console.log(`  ошибок                        ${errorTotal}`);
  for (const [what, n] of Object.entries(errors)) console.log(`    ${what}: ${n}`);

  const delivery95 = pct(timings["вопрос дошёл до телефона"] ?? [], 95);
  const ok = errorTotal === 0 && answersGot === answersExpected && delivery95 <= DELIVERY_P95_LIMIT_MS;
  console.log(ok ? "\n✅ Проверка пройдена" : `\n❌ Проверка не пройдена (порог доставки 95% — ${DELIVERY_P95_LIMIT_MS} мс)`);
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
