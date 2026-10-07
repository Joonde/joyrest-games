/**
 * Сценарная проверка живой игры (CLAUDE.md, раздел 9): обычный вечер на 35 гостей на
 * test.games.joy-rest.ru, каждый механизм платформы — по три раза и в разном порядке. Пульт ведёт
 * игру той же логикой, что настоящий (flow.ts, `expect`), экран зала и телефоны слушают сессию
 * потоками событий, как браузеры.
 *
 *   LOAD_HOST_EMAIL=… LOAD_HOST_PASSWORD=… npx tsx scripts/scenario.ts
 *
 * После каждого действия сверяется: очки на сервере = очки модели (ответы с сервера × правила
 * квиза + ручные правки); экран зала и телефоны видят ту же версию и ту же таблицу; лишних
 * срабатываний нет (устаревший пульт и двойное касание получают отказ и ничего не меняют); гостю
 * не уходят чужие данные, пароли, токены и почты; ни одного ответа 5xx.
 * Только тестовый адрес. Код выхода 1 — если хоть одна проверка не прошла.
 */
import { leaderboardAdditions, rankedLeaderboard } from "../src/core/leaderboard";
import { podiumBack, podiumNext, podiumShown, startPodium } from "../src/core/podium";
import type { Answer, Leaderboard, LeaderboardEntry, Participant, PlayMode, Session, SessionChange } from "../src/data/types";
import { DEFAULTS, type QuestionKind, type QuizContent, type QuizQuestion } from "../src/mechanics/quiz/content";
import { back, boardView, nextQuestion, reveal, showBoard, showQuestion, showTotal } from "../src/mechanics/quiz/flow";
import { score, steps } from "../src/mechanics/quiz/logic";

const BASE = (process.env.LOAD_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const GUESTS = Math.max(6, Math.min(60, Number(process.env.GUESTS ?? 35) || 35));
const TEAM_SIZE = 5;

// ---------------------------------------------------------------- отчёт

const report: string[] = [];
let passed = 0;
const failures: string[] = [];
function say(line: string): void {
  report.push(line);
  console.log(line);
}
function check(ok: boolean, what: string, detail = ""): boolean {
  if (ok) passed += 1;
  else {
    failures.push(detail ? `${what}: ${detail}` : what);
    say(`  ❌ ${what}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}
function finish(code: number): never {
  if (process.env.GITHUB_ACTIONS === "true") {
    const text = report.join("\n").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    console.log(`::${code === 0 ? "notice" : "error"} title=Сценарий 35 гостей::${text.slice(0, 60000)}`);
  }
  process.exit(code);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(test: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > end) return false;
    await wait(40);
  }
  return true;
}

// ---------------------------------------------------------------- устройство

const statuses = { s5xx: 0, total: 0 };
const timings: number[] = [];

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class Device {
  cookies = new Map<string, string>();
  /** Всё, что устройство получило (для проверки утечек), — до 3 МБ. */
  seen = "";

  constructor(readonly label: string) {}

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

  private keep(text: string) {
    if (this.seen.length < 3_000_000) this.seen += text;
  }

  async raw(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<Response> {
    const write = method !== "GET";
    const res = await fetch(BASE + path, {
      method,
      headers: { ...this.headers(write), ...extra },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    statuses.total += 1;
    if (res.status >= 500) statuses.s5xx += 1;
    this.remember(res);
    return res;
  }

  async call<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE" | "PATCH", path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, method === "GET" ? undefined : (body ?? {}));
    const text = await res.text();
    this.keep(text);
    const data = (text ? JSON.parse(text) : null) as T & { error?: string };
    if (!res.ok) throw new HttpError(res.status, data?.error ?? "", `${this.label} ${method} ${path}: ${res.status} ${data?.error ?? ""}`);
    return data;
  }

  /** Код ответа без исключения (для проверок отказов). */
  async status(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<number> {
    const res = await this.raw(method, path, method === "GET" ? undefined : (body ?? {}));
    this.keep(await res.text());
    return res.status;
  }

  stream(path: string, onEvent: (event: Record<string, unknown>) => void): { stop: () => void } {
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
                if (!line.startsWith("data: ")) continue;
                this.keep(line);
                onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
              }
            }
          }
        } catch {
          if (stopped) return;
        }
        if (stopped) return;
        await wait(1000);
      }
    };
    void run();
    return {
      stop: () => {
        stopped = true;
        controller.abort();
      },
    };
  }
}

type Versioned = Session & { version: number };

/** Сессия глазами устройства — как src/data/server/sessions.ts. */
class View {
  current: Versioned | null = null;
  cues: string[] = [];
  private sub: { stop: () => void } | null = null;

  constructor(
    readonly device: Device,
    readonly sessionId: string,
  ) {}

  private onChange?: (s: Versioned) => void;

  /** Подписка; повторный start() без аргумента — переподключение с тем же обработчиком. */
  start(onChange?: (s: Versioned) => void) {
    if (onChange) this.onChange = onChange;
    this.sub = this.device.stream(`/api/stream/session/${this.sessionId}`, (event) => {
      if (event.type === "snapshot" && event.session) {
        const next = event.session as Versioned;
        if (this.current && next.version < this.current.version) return;
        this.current = next;
      } else if (event.type === "patch" && this.current) {
        const version = Number(event.version);
        if (version <= this.current.version) return;
        const leaderboard: Leaderboard = { ...this.current.leaderboard };
        for (const [pid, entry] of Object.entries((event.leaderboard ?? {}) as Record<string, LeaderboardEntry | null>)) {
          if (entry === null) delete leaderboard[pid];
          else leaderboard[pid] = entry;
        }
        this.current = { ...this.current, version, state: event.state as Session["state"], leaderboard };
      } else return;
      const cue = this.current.state.cue;
      if (cue && this.cues[this.cues.length - 1] !== cue.id) this.cues.push(cue.id);
      this.onChange?.(this.current);
    });
  }

  stop() {
    this.sub?.stop();
    this.sub = null;
  }
}

// ---------------------------------------------------------------- игра

function q(id: string, kind: QuestionKind, round: string | null, rest: Partial<QuizQuestion>): QuizQuestion {
  return { id, kind, text: `Вопрос ${id}`, options: [], correct: -1, answers: [], ...DEFAULTS[kind], timeLimit: 15, points: 100, imageId: null, round, ...rest };
}
const OPTS = ["А", "Б", "В", "Г"];
const CONTENT: QuizContent = {
  questions: [
    q("s1", "choice", "Разминка", { options: OPTS, correct: 0 }),
    q("s2", "open", null, { answers: ["Снегурочка", "Снегурка"] }),
    q("s3", "speed", null, { options: OPTS, correct: 2 }),
    q("s4", "choice", "Кино", { options: OPTS, correct: 1 }),
    q("s5", "speed", null, { options: OPTS, correct: 3 }),
    q("s6", "open", null, { answers: ["ёлка", "ель"] }),
    q("s7", "choice", "Финал", { options: OPTS, correct: 2 }),
    q("s8", "choice", null, { options: OPTS, correct: 0 }),
    q("s9", "speed", null, { options: OPTS, correct: 1 }),
  ],
};
const STEPS = steps(CONTENT);

/** Ответ гостя: примерно каждый четвёртый ошибается, остальные верно (разными словами). */
function answerFor(index: number, step: number): unknown {
  const question = CONTENT.questions[step] as QuizQuestion;
  const right = (index + step) % 4 !== 0;
  if (question.kind === "open") {
    if (!right) return "не знаю";
    // Верно, но разными словами: регистр, ё/е, пробелы.
    return step === 1 ? (index % 2 ? "снегурочка " : "Снегурка") : index % 2 ? "Ёлка" : "ель";
  }
  return right ? question.correct : (question.correct + 1) % question.options.length;
}

const deliveries: number[] = [];

class Guest {
  device: Device;
  view: View;
  uid = "";
  pid = "";
  captain = true;
  answerDelay: number;
  /** Попытки ответа (шаг.время показа), как в Play.tsx, и что ответил сервер. */
  sent = new Map<string, string>();
  muted = false;

  constructor(
    readonly index: number,
    readonly sessionId: string,
    readonly game: { lastShow: number },
  ) {
    this.device = new Device(`гость ${index + 1}`);
    this.view = new View(this.device, sessionId);
    this.answerDelay = 150 + ((index * 97) % 2200);
  }

  async enter(name: string, teamId: string | null): Promise<void> {
    const me = await this.device.call<{ uid: string }>("POST", "/api/auth/device");
    this.uid = me.uid;
    this.pid = teamId ?? this.uid;
    await this.device.call("POST", `/api/sessions/${this.sessionId}/participants/${this.uid}/join`, { name, teamId });
    this.view.start((s) => this.onSession(s));
  }

  onSession(s: Versioned) {
    const { phase, stage, step, startedAt } = s.state;
    if (phase !== "playing" || stage !== "question" || this.muted) return;
    const slot = `${step}.${startedAt ?? 0}`;
    if (this.sent.has(slot)) return;
    if (this.game.lastShow > 0) deliveries.push(Date.now() - this.game.lastShow);
    // Капитана телефоны узнают из таблицы (как Play.tsx).
    const entry = s.leaderboard[this.pid];
    const captain = s.playMode === "teams" ? entry?.captainUid === this.uid : true;
    if (!captain) return;
    this.sent.set(slot, "pending");
    setTimeout(() => {
      void this.device
        .call<{ result: string }>("POST", `/api/sessions/${this.sessionId}/answers`, { step, pid: this.pid, value: answerFor(this.index, step) })
        .then((r) => this.sent.set(slot, r.result))
        .catch(() => this.sent.set(slot, "error"));
    }, this.answerDelay);
  }
}

class Pult {
  device = new Device("пульт");
  view: View;
  participants: Participant[] = [];
  /** Модель очков: сумма показанных ответов (по ответам с сервера) и ручных правок. */
  model = new Map<string, number>();
  lastDelta = new Map<string, number>();
  /** Когда пульт последний раз нажал «Показать вопрос» (для замера доставки). */
  lastShow = 0;
  private subs: Array<{ stop: () => void }> = [];

  constructor(readonly sessionId: string) {
    this.view = new View(this.device, sessionId);
  }

  get s(): Versioned {
    return this.view.current as Versioned;
  }

  listen() {
    this.view.start();
    this.subs.push(
      this.device.stream(`/api/stream/participants/${this.sessionId}`, (event) => {
        if (event.type === "snapshot") this.participants = (event.participants ?? []) as Participant[];
        else if (event.type === "upsert") {
          const p = event.participant as Participant;
          this.participants = [...this.participants.filter((x) => x.id !== p.id), p];
        } else if (event.type === "remove") this.participants = this.participants.filter((x) => x.id !== event.id);
      }),
    );
  }

  stop() {
    this.view.stop();
    this.subs.forEach((s) => s.stop());
  }

  /** Действие пульта как HostControls: с ожиданием «где игра», дальше ждём своё изменение. */
  async act(change: SessionChange, expect = true): Promise<number> {
    const before = this.s.version;
    const { phase, step, stage } = this.s.state;
    const t = Date.now();
    const res = await this.device.raw("POST", `/api/sessions/${this.sessionId}/apply`, expect ? { ...change, expect: { phase, step, stage } } : change);
    const text = await res.text();
    if (res.ok) {
      timings.push(Date.now() - t);
      check(await until(() => this.s.version > before, 5000), "изменение пульта дошло до пульта по потоку");
    } else if (res.status !== 409) check(false, "пульт: изменение отклонено", `${res.status} ${text.slice(0, 80)}`);
    return res.status;
  }

  async addPeople() {
    for (let i = 0; i < 6; i++) {
      const additions = leaderboardAdditions(this.s.leaderboard, this.participants, this.s.playMode);
      if (Object.keys(additions).length === 0) return;
      await this.device.call("POST", `/api/sessions/${this.sessionId}/leaderboard`, { entries: additions });
      await wait(400);
    }
  }

  async freshAnswers(step: number): Promise<Answer[]> {
    return this.device.call<Answer[]>("GET", `/api/sessions/${this.sessionId}/answers/${step}`);
  }

  async show(): Promise<void> {
    this.lastShow = Date.now();
    await this.act(showQuestion(this.s, CONTENT));
  }

  /** «Показать ответ» по свежим ответам с сервера; модель — те же правила квиза. */
  async reveal(): Promise<Answer[]> {
    const step = this.s.state.step;
    const answers = (await this.freshAnswers(step)).filter((a) => a.step === step);
    const deltas = score(STEPS[step] as never, answers, { state: this.s.state });
    const status = await this.act(reveal(this.s, CONTENT, answers, this.participants));
    if (status === 200) {
      this.lastDelta.clear();
      for (const pid of Object.keys(this.s.leaderboard)) this.lastDelta.set(pid, 0);
      for (const d of deltas) {
        this.model.set(d.pid, (this.model.get(d.pid) ?? 0) + d.delta);
        this.lastDelta.set(d.pid, d.delta);
      }
    }
    return answers;
  }

  async backFromReveal(): Promise<void> {
    const plan = back(this.s);
    if (!plan) return;
    const status = await this.act(plan.change);
    if (status === 200) for (const [pid, d] of this.lastDelta) this.model.set(pid, (this.model.get(pid) ?? 0) - d);
  }

  async backFromQuestion(): Promise<void> {
    const plan = back(this.s);
    if (!plan) return;
    const step = this.s.state.step;
    await this.act(plan.change);
    if (plan.clearAnswers !== undefined) await this.device.call("DELETE", `/api/sessions/${this.sessionId}/answers/${step}`);
  }

  async addScore(pid: string, delta: number): Promise<void> {
    const res = await this.device.raw("POST", `/api/sessions/${this.sessionId}/apply`, { addScore: { [pid]: delta } });
    await res.text();
    if (check(res.ok, "ручные очки приняты", String(res.status))) this.model.set(pid, (this.model.get(pid) ?? 0) + delta);
  }

  /** Очки на сервере совпадают с моделью у всех. */
  checkScores(where: string): void {
    const bad: string[] = [];
    for (const [pid, entry] of Object.entries(this.s.leaderboard)) {
      const want = this.model.get(pid) ?? 0;
      if (Math.abs(entry.score - want) > 1e-9) bad.push(`${entry.name}: ${entry.score} ≠ ${want}`);
    }
    check(bad.length === 0, `очки верны (${where})`, bad.slice(0, 4).join("; "));
  }
}

/** Экран и телефоны видят то же, что пульт (версия, этап, таблица). */
async function checkSync(pult: Pult, views: View[], where: string): Promise<void> {
  const version = pult.s.version;
  const ok = await until(() => views.every((v) => (v.current?.version ?? 0) >= version), 4000);
  const differs = views.filter((v) => {
    const c = v.current;
    if (!c || c.version !== pult.s.version) return false;
    return JSON.stringify(c.state) !== JSON.stringify(pult.s.state) || JSON.stringify(rankedLeaderboard(c.leaderboard)) !== JSON.stringify(rankedLeaderboard(pult.s.leaderboard));
  });
  check(ok && differs.length === 0, `экран и телефоны видят то же, что пульт (${where})`, ok ? `расходятся: ${differs.length}` : "не дошло за 4 с");
}

async function waitAnswers(pult: Pult, guests: Guest[], timeoutMs = 9000): Promise<void> {
  const { step, startedAt } = pult.s.state;
  const slot = `${step}.${startedAt ?? 0}`;
  const answering = guests.filter((g) => !g.muted && (pult.s.playMode === "solo" || pult.s.leaderboard[g.pid]?.captainUid === g.uid));
  await until(() => answering.every((g) => (g.sent.get(slot) ?? "pending") !== "pending"), timeoutMs);
  const lost = answering.filter((g) => g.sent.get(slot) !== "sent");
  check(lost.length === 0, `все ответы шага ${step + 1} приняты`, lost.map((g) => `${g.index + 1}:${g.sent.get(slot) ?? "нет"}`).slice(0, 6).join(", "));
}

// ---------------------------------------------------------------- проверки безопасности

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/password/i, "пароль"],
  [/scrypt\$/, "хэш пароля"],
  [/token_hash|tokenHash/i, "токен сеанса"],
  [/__Host-jr_s/, "cookie ведущего"],
  [/POSTGRES|DATABASE_URL|DB_PASSWORD/i, "доступ к базе"],
  [/[A-Za-z0-9._%+-]+@(?:joy-rest\.ru|example\.com|gmail\.com|mail\.ru|yandex\.ru)/i, "почта"],
  [/\d{8,10}:AA[\w-]{30,}/, "токен Telegram"],
];

function scanLeaks(devices: Device[], who: string): void {
  const found = new Set<string>();
  for (const d of devices) for (const [re, label] of SECRET_PATTERNS) if (re.test(d.seen)) found.add(label);
  check(found.size === 0, `${who}: нет паролей, токенов, почт и доступов к базе`, [...found].join(", "));
}

// ---------------------------------------------------------------- сценарий

async function createSession(host: Device, playMode: PlayMode, title: string): Promise<{ id: string; code: string }> {
  const id = `sc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const created = await host.call<{ id: string; code: string }>("POST", "/api/sessions", {
    id,
    gameTitle: title,
    mechanic: "quiz",
    gameSnapshot: { title, mechanic: "quiz", themeId: "joyrest", content: CONTENT },
    themeId: "joyrest",
    playMode,
    screenMode: "laptop",
  });
  return { id: created.id, code: created.code };
}

const NAMES = ["🦊 Аня", "Боря", "🐯 Аня", "Вика", "Аня", "Гоша", "Даша", "Егор", "🐼 Женя", "Зоя"];

async function soloEvening(host: Device): Promise<void> {
  say(`\n— Вечер «каждый сам за себя», ${GUESTS} гостей —`);
  const { id, code } = await createSession(host, "solo", "Сценарий: 35 гостей");
  const pult = new Pult(id);
  pult.device = host;
  pult.view = new View(host, id);
  pult.listen();
  await until(() => pult.view.current !== null, 8000);

  // Экран зала: отдельное устройство по коду, сообщает о себе пульту.
  const screenDevice = new Device("экран зала");
  await screenDevice.call("POST", "/api/auth/device");
  check((await screenDevice.status("GET", "/api/sessions/by-code/000000")) === 404, "неверный код — «не найдено»");
  const found = await screenDevice.call<Session>("GET", `/api/sessions/by-code/${code}`);
  check(found.id === id, "экран зала находит игру по коду");
  const screen = new View(screenDevice, id);
  screen.start();
  await screenDevice.call("POST", `/api/sessions/${id}/screen`, { soundReady: true, muted: false, musicBlocked: false });
  const status = await host.call<{ screen: { soundReady: boolean } | null }>("GET", `/api/sessions/${id}/screen`);
  check(status.screen?.soundReady === true, "пульт видит: экран на связи, звук разрешён");

  // Гости входят пачками по 7 — как на мероприятии.
  const guests: Guest[] = [];
  const t0 = Date.now();
  for (let i = 0; i < GUESTS; i += 7) {
    const batch = Array.from({ length: Math.min(7, GUESTS - i) }, (_, k) => new Guest(i + k, id, pult));
    const results = await Promise.allSettled(batch.map((g) => g.enter(NAMES[g.index % NAMES.length] as string, null)));
    results.forEach((r, k) => {
      if (r.status === "fulfilled") guests.push(batch[k] as Guest);
      else check(false, `гость ${i + k + 1} вошёл`, String(r.reason).slice(0, 100));
    });
  }
  await until(() => pult.participants.filter((p) => p.kind === "player").length >= guests.length, 10_000);
  await pult.addPeople();
  await until(() => Object.keys(pult.s.leaderboard).length >= guests.length, 5000);
  const names = Object.values(pult.s.leaderboard).map((e) => e.name);
  check(names.length === guests.length, `в таблице все ${guests.length} гостей`, String(names.length));
  check(new Set(names).size === names.length, "одинаковые имена различаются («Аня 2»)");
  say(`  вошли за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  for (const pid of Object.keys(pult.s.leaderboard)) pult.model.set(pid, 0);
  const sample = [screen, ...guests.filter((_, i) => i % 9 === 0).map((g) => g.view)];

  // Старт: второй «Начать игру» с отставшего пульта — отказ, игра не возвращается к началу.
  const start = { state: { phase: "playing" as const, step: 0, stage: "ready" as const, startedAt: null, revealed: false, timeLimit: null, answered: 0, result: null } };
  check((await pult.act(start)) === 200, "«Начать игру»");
  const stale = await host.raw("POST", `/api/sessions/${id}/apply`, { ...start, expect: { phase: "lobby" } });
  await stale.text();
  check(stale.status === 409, "второй «Начать игру» (отставший пульт) — отказ", String(stale.status));

  // Трек для проверки музыки: свой трек ведущего, крошечный mp3.
  const trackId = `sct${Date.now().toString(36)}`;
  let trackReady = false;
  try {
    await host.call("POST", "/api/tracks", { id: trackId, title: "Проверка", category: "lobby", license: "own" });
    const mp3 = new Uint8Array(4096);
    mp3.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
    const put = await host.raw("PUT", `/api/tracks/${trackId}/file`, mp3, { "Content-Type": "audio/mpeg", "X-Duration": "5000" });
    trackReady = put.ok;
    await put.text();
  } catch {
    trackReady = false;
  }
  check(trackReady, "трек для музыки загружен");

  let rev = 0;
  for (let step = 0; step < CONTENT.questions.length; step++) {
    const variant = step % 3;
    say(`  вопрос ${step + 1} (вариант ${variant + 1})`);
    check(pult.s.state.step === step && pult.s.state.stage === "ready", `шаг ${step + 1} готов к показу`, `${pult.s.state.step}/${pult.s.state.stage}`);

    // Двойное касание «Показать вопрос»: второе — отказ, таймер не перезапускается.
    const showChange = showQuestion(pult.s, CONTENT);
    const expect = { phase: pult.s.state.phase, step: pult.s.state.step, stage: pult.s.state.stage };
    pult.lastShow = Date.now();
    const [a, b] = await Promise.all([
      host.raw("POST", `/api/sessions/${id}/apply`, { ...showChange, expect }),
      host.raw("POST", `/api/sessions/${id}/apply`, { ...showChange, expect }),
    ]);
    await Promise.all([a.text(), b.text()]);
    check([a.status, b.status].sort().join() === "200,409", "двойное касание «Показать вопрос»: одно принято, второе — отказ", `${a.status},${b.status}`);
    await until(() => pult.s.state.stage === "question", 4000);
    const startedAt = pult.s.state.startedAt;

    // Мешающие механизмы во время вопроса — в разном порядке.
    const cueId = () => `c${step}${Math.random().toString(36).slice(2, 8)}`;
    if (variant === 0) {
      await pult.act({ state: { slide: { id: `sl${step}`, kind: "rules", title: "Правила", text: "", lines: ["Один", "Два"], endsAt: null } } }, false);
      await pult.act({ state: { cue: { id: cueId(), sound: "gong" } } }, false);
      await pult.act({ state: { slide: null } }, false);
    } else if (variant === 1) {
      if (trackReady) await pult.act({ state: { music: { trackId, playing: true, rev: `r${++rev}` } } }, false);
      await pult.act({ state: { mix: { music: 40 + step, effects: 90, muted: false } } }, false);
      await pult.act({ state: { cue: { id: cueId(), sound: "drumroll" } } }, false);
    } else {
      await pult.act({ state: { cue: { id: cueId(), sound: "applause" } } }, false);
      await pult.act({ state: { cue: { id: cueId(), sound: "stop" } } }, false);
      if (trackReady) await pult.act({ state: { music: { trackId, playing: false, rev: `r${rev}` } } }, false);
    }
    check(pult.s.state.startedAt === startedAt && pult.s.state.stage === "question", "звуки, музыка и слайды не сбили вопрос и таймер");

    await waitAnswers(pult, guests);
    await checkSync(pult, sample, `вопрос ${step + 1}`);

    if (variant === 1) {
      // «Назад» с вопроса: ответы убраны, гости отвечают заново (новая попытка на телефоне).
      await pult.backFromQuestion();
      check(pult.s.state.stage === "ready", "«Назад» с вопроса — к «готовы?»");
      check((await pult.freshAnswers(step)).length === 0, "«Назад» с вопроса убрал ответы шага");
      await pult.show();
      await waitAnswers(pult, guests);
    }

    // Гости переподключаются посреди вопроса (погас экран, пропал Wi‑Fi).
    if (step === 3 || step === 6) {
      const flaky = guests.slice(0, 5);
      flaky.forEach((g) => g.view.stop());
      await wait(500);
      flaky.forEach((g) => g.view.start());
      check(await until(() => flaky.every((g) => g.view.current?.version === pult.s.version), 6000), "гости вернулись в игру после обрыва и видят текущий шаг");
      const own = await guests[0]?.device.call<Answer>("GET", `/api/sessions/${id}/answers/${step}/${guests[0]?.pid}`).catch(() => null);
      check(own !== null && own !== undefined, "после перезагрузки гость видит свой ответ");
    }

    await pult.reveal();
    pult.checkScores(`ответ ${step + 1}`);

    if (variant === 1) {
      // «Назад» с ответа снимает очки шага, повторный показ начисляет их снова.
      await pult.backFromReveal();
      pult.checkScores(`«Назад» с ответа ${step + 1}`);
      await pult.reveal();
      pult.checkScores(`повторный ответ ${step + 1}`);
    }

    await pult.act(showBoard(pult.s, CONTENT));
    await checkSync(pult, sample, `таблица ${step + 1}`);

    if (variant === 2) {
      // Ручные очки на таблице: три быстрых «+10» одновременно, «−10», переименование.
      const ids = Object.keys(pult.s.leaderboard);
      const x = ids[step % ids.length] as string;
      const y = ids[(step + 5) % ids.length] as string;
      await Promise.all([pult.addScore(x, 10), pult.addScore(x, 10), pult.addScore(x, 10)]);
      await pult.addScore(y, -10);
      await wait(600);
      pult.checkScores(`ручные очки ${step + 1}`);
      const newName = `Переименован ${step}`;
      await host.call("POST", `/api/sessions/${id}/apply`, { rename: { [y]: newName } });
      await until(() => pult.s.leaderboard[y]?.name === newName, 3000);
      check(pult.s.leaderboard[y]?.name === newName, "переименование в таблице");
      pult.checkScores(`после переименования ${step + 1}`);
      // Отставший второй пульт жмёт «Показать ответ» на таблице — отказ, ничего не меняется.
      const version = pult.s.version;
      const res = await host.raw("POST", `/api/sessions/${id}/apply`, { state: { stage: "reveal" }, expect: { phase: "playing", step, stage: "question" } });
      await res.text();
      check(res.status === 409 && pult.s.version === version, "устаревший второй пульт — отказ, игра не изменилась");
    }

    // Конец раунда: итоги раунда ↔ общий счёт; на втором раунде — «Назад» через начало раунда.
    if (boardView(pult.s) === "round") {
      await pult.act(showTotal(pult.s));
      check(boardView(pult.s) === "total", "«Общий счёт» после итогов раунда");
      const backPlan = back(pult.s);
      if (backPlan) await pult.act(backPlan.change);
      check(boardView(pult.s) === "round", "«Назад» с общего счёта — к итогам раунда");
      await pult.act(showTotal(pult.s));
    }
    if (step < CONTENT.questions.length - 1) {
      const before = Object.fromEntries(Object.entries(pult.s.leaderboard).map(([pid, e]) => [pid, e.roundBase ?? 0]));
      await pult.act(nextQuestion(pult.s, CONTENT));
      if (step === 5) {
        // Начало 3-го раунда: «Назад» возвращает общий счёт и старт прошлого раунда, вперёд — снова.
        const plan = back(pult.s);
        if (plan) await pult.act(plan.change);
        const restored = Object.entries(pult.s.leaderboard).every(([pid, e]) => (e.roundBase ?? 0) === (before[pid] ?? 0));
        check(pult.s.state.step === step && boardView(pult.s) === "total" && restored, "«Назад» с заставки раунда вернул общий счёт и счёт раунда");
        await pult.act(nextQuestion(pult.s, CONTENT));
      }
    }
  }

  // Награждение: вперёд, назад и снова вперёд — по три места.
  await pult.act(startPodium(pult.s));
  for (let i = 0; i < 3; i++) await pult.act(podiumNext(pult.s));
  const shownAll = podiumShown(pult.s.state);
  for (let i = 0; i < 3; i++) await pult.act(podiumBack(pult.s));
  check(podiumShown(pult.s.state) === 0, "«Назад» на награждении закрывает места", String(podiumShown(pult.s.state)));
  for (let i = 0; i < 3; i++) await pult.act(podiumNext(pult.s));
  check(podiumShown(pult.s.state) === shownAll && shownAll > 0, "награждение заново открывает те же места");
  pult.checkScores("награждение");
  await checkSync(pult, sample, "награждение");

  // Безопасность во время игры: гость не может управлять и подглядывать.
  const guest = guests[1] as Guest;
  check((await guest.device.status("POST", `/api/sessions/${id}/apply`, { state: { step: 0 } })) === 403, "гость не может управлять игрой");
  check((await guest.device.status("GET", `/api/sessions/${id}/answers/0`)) === 403, "гость не видит чужие ответы списком");
  check((await guest.device.status("GET", `/api/sessions/${id}/answers/0/${guests[2]?.pid}`)) !== 200, "гость не читает ответ другого гостя");
  check((await guest.device.status("GET", `/api/sessions/${id}/screen`)) === 403, "гость не видит служебные данные экрана");
  check((await guest.device.status("POST", `/api/sessions/${id}/participants/${guests[2]?.uid}/rename`, { name: "Взлом" })) === 403, "гость не переименовывает других");
  check((await new Device("без входа").status("GET", `/api/sessions/${id}`)) === 401, "без входа сессию не открыть");
  const trackStatus = await guest.device.status("POST", "/api/tracks", { id: "x", title: "x", license: "own" });
  check(trackStatus === 401 || trackStatus === 403, "гость не загружает музыку", String(trackStatus));
  const bigBody = await guest.device.raw("PUT", `/api/tracks/${trackId}/file`, new Uint8Array(200 * 1024), { "Content-Type": "audio/mpeg" });
  await bigBody.text();
  check(bigBody.status === 401 || bigBody.status === 403, "большой файл без прав отклонён до чтения", String(bigBody.status));

  // Завершение и что можно после него.
  const board = rankedLeaderboard(pult.s.leaderboard);
  await host.call("POST", `/api/sessions/${id}/finish`, { participantsCount: guests.length });
  await until(() => pult.s.state.phase === "finished", 4000);
  const afterStep = await host.raw("POST", `/api/sessions/${id}/apply`, { state: { step: 1 } });
  await afterStep.text();
  check(afterStep.status === 409, "после «Завершить» ход игры не меняется", String(afterStep.status));
  check((await pult.act({ state: { cue: { id: "fin1", sound: "fanfare" } } }, false)) === 200, "после «Завершить» звуки работают");
  if (trackReady) check((await pult.act({ state: { music: { trackId, playing: true, rev: "fin" } } }, false)) === 200, "после «Завершить» музыка работает");
  check((await pult.act({ state: { slide: { id: "bye", kind: "thanks", title: "Спасибо", text: "", lines: [], endsAt: null } } }, false)) === 200, "после «Завершить» слайд «Спасибо» работает");
  const late = await guests[0]?.device.call<{ result: string }>("POST", `/api/sessions/${id}/answers`, { step: 8, pid: guests[0]?.pid, value: 1 });
  check(late?.result === "rejected", "ответ после завершения не принимается");
  const results = await new Device("по ссылке").call<{ board: Array<{ name: string; score: number }> }>("GET", `/api/results/${id}`);
  check(
    JSON.stringify(results.board.map((r) => [r.name, r.score])) === JSON.stringify(board.map((e) => [e.name, e.score])),
    "итоги по ссылке совпадают с финальной таблицей",
  );
  check((await screenDevice.status("GET", `/api/sessions/by-code/${code}`)) === 404, "после завершения игру по коду не найти");
  const cuesSeen = screen.cues.length;
  check(cuesSeen >= 7, "экран зала получил все звуки ведущего", String(cuesSeen));

  // Музыку экран зала скачивает сам.
  if (trackReady) {
    const file = await screenDevice.raw("GET", `/api/tracks/${trackId}/file`);
    await file.arrayBuffer();
    check(file.ok, "экран зала скачивает трек", String(file.status));
    await host.call("DELETE", `/api/tracks/${trackId}`).catch(() => undefined);
  }

  scanLeaks([screenDevice, ...guests.map((g) => g.device)], "гости и экран зала");
  pult.stop();
  screen.stop();
  guests.forEach((g) => g.view.stop());
}

async function teamsEvening(host: Device): Promise<void> {
  const teams = Math.ceil(GUESTS / TEAM_SIZE);
  say(`\n— Вечер командами: ${teams} команд по ${TEAM_SIZE} телефонов —`);
  const { id } = await createSession(host, "teams", "Сценарий: команды");
  const pult = new Pult(id);
  pult.device = host;
  pult.view = new View(host, id);
  pult.listen();
  await until(() => pult.view.current !== null, 8000);

  const guests: Guest[] = [];
  const teamIds: string[] = [];
  for (let t = 0; t < teams; t++) {
    const captain = new Guest(t * TEAM_SIZE, id, pult);
    await captain.device.call("POST", "/api/auth/device").then((me) => (captain.uid = String((me as { uid: string }).uid)));
    const teamId = `tm${t}${captain.uid.slice(0, 10)}`;
    await captain.device.call("POST", `/api/sessions/${id}/teams`, { id: teamId, name: `Команда ${t + 1}` });
    // Повтор создания после обрыва — та же команда; вторую команду тот же телефон не создаёт.
    const again = await captain.device.call<{ id: string }>("POST", `/api/sessions/${id}/teams`, { id: teamId, name: `Команда ${t + 1}` });
    check(again.id === teamId, "повтор «Создать команду» — та же команда");
    if (t === 0) check((await captain.device.status("POST", `/api/sessions/${id}/teams`, { id: `${teamId}x`, name: "Вторая" })) === 409, "второй команды с одного телефона нет");
    teamIds.push(teamId);
    captain.pid = teamId;
    await captain.device.call("POST", `/api/sessions/${id}/participants/${captain.uid}/join`, { name: `Капитан ${t + 1}`, teamId });
    captain.view.start((s) => captain.onSession(s));
    guests.push(captain);
    for (let m = 1; m < TEAM_SIZE && guests.length < GUESTS; m++) {
      const member = new Guest(t * TEAM_SIZE + m, id, pult);
      await member.enter(`Игрок ${t + 1}.${m}`, teamId);
      guests.push(member);
    }
  }
  await until(() => pult.participants.filter((p) => p.kind === "team").length >= teams, 10_000);
  await pult.addPeople();
  await until(() => Object.keys(pult.s.leaderboard).length >= teams, 5000);
  check(Object.keys(pult.s.leaderboard).length === teams, `в таблице ${teams} команд`);
  for (const pid of Object.keys(pult.s.leaderboard)) pult.model.set(pid, 0);
  await pult.act({ state: { phase: "playing", step: 0, stage: "ready", startedAt: null, revealed: false, timeLimit: null, answered: 0, result: null } });

  for (let step = 0; step < 3; step++) {
    if (step === 1) {
      // Смена капитана (как «Сделать капитаном» или капитан выпал): отвечает новый капитан.
      const teamId = teamIds[0] as string;
      const newCaptain = guests.find((g) => g.pid === teamId && g.index % TEAM_SIZE === 1) as Guest;
      await host.call("POST", `/api/sessions/${id}/participants/${teamId}/captain`, { uid: newCaptain.uid });
      await wait(500);
      await pult.addPeople();
      check(await until(() => pult.s.leaderboard[teamId]?.captainUid === newCaptain.uid, 4000), "новый капитан записан в таблицу");
      check(pult.model.get(teamId) === pult.s.leaderboard[teamId]?.score, "смена капитана не тронула очки команды");
    }
    await pult.show();
    await waitAnswers(pult, guests);
    if (step === 1) {
      const old = guests.find((g) => g.pid === teamIds[0] && g.index % TEAM_SIZE === 0) as Guest;
      const r = await old.device.call<{ result: string }>("POST", `/api/sessions/${id}/answers`, { step, pid: teamIds[0], value: 0 });
      check(r.result === "rejected", "бывший капитан ответить не может");
    }
    await pult.reveal();
    pult.checkScores(`команды, ответ ${step + 1}`);
    await pult.act(showBoard(pult.s, CONTENT));
    if (boardView(pult.s) === "round") await pult.act(showTotal(pult.s));
    if (step < 2) await pult.act(nextQuestion(pult.s, CONTENT));
  }
  await host.call("POST", `/api/sessions/${id}/finish`, { participantsCount: guests.length });
  scanLeaks(guests.map((g) => g.device), "телефоны команд");
  pult.stop();
  guests.forEach((g) => g.view.stop());
}

async function main() {
  if (!/^https:\/\/test\./.test(BASE)) {
    say(`Отказ: сценарий только на тестовом адресе (сейчас ${BASE}).`);
    finish(2);
  }
  if (!EMAIL || !PASSWORD) {
    say("Нужны LOAD_HOST_EMAIL и LOAD_HOST_PASSWORD — ведущий на тестовом адресе.");
    finish(2);
  }
  const health = await fetch(`${BASE}/health`).then((r) => r.json() as Promise<{ version?: string }>);
  say(`Сценарий на ${BASE}, версия ${String(health.version ?? "?").slice(0, 7)}: ${GUESTS} гостей, каждый механизм ×3`);
  const host = new Device("пульт");
  await host.call("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  const started = Date.now();

  for (const [title, run] of [
    ["каждый сам за себя", soloEvening],
    ["команды", teamsEvening],
  ] as const) {
    try {
      await run(host);
    } catch (error) {
      check(false, `сценарий «${title}» остановился`, error instanceof Error ? error.message.slice(0, 200) : String(error));
    }
  }

  deliveries.sort((a, b) => a - b);
  const p95 = deliveries[Math.floor(deliveries.length * 0.95)] ?? 0;
  timings.sort((a, b) => a - b);
  const act95 = timings[Math.floor(timings.length * 0.95)] ?? 0;
  check(p95 <= 2000, "вопрос доходит до 95% телефонов быстрее 2 с", `${p95} мс`);
  check(statuses.s5xx === 0, "ни одного сбоя сервера (5xx)", String(statuses.s5xx));
  say(`\nИтог за ${Math.round((Date.now() - started) / 1000)} с: проверок пройдено ${passed}, не пройдено ${failures.length}.`);
  say(`Доставка вопроса на телефоны: 95% за ${p95} мс. Действие пульта: 95% за ${act95} мс. Запросов: ${statuses.total}.`);
  say("Известно и не проверяется здесь: правильные ответы есть в данных игры на телефоне (аудит M1).");
  if (failures.length > 0) {
    say("\nНе прошло:");
    for (const f of failures.slice(0, 40)) say(`  • ${f}`);
  }
  say(failures.length === 0 ? "\n✅ Всё работает" : "\n❌ Есть проблемы");
  finish(failures.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  say(`Остановлено с ошибкой: ${error instanceof Error ? error.message : String(error)}`);
  finish(1);
});
