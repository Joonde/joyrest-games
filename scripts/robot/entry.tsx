// Робот-ведущий: настоящая игра целиком в памяти страницы — тот же пульт механики, тот же экран зала и
// настоящие телефоны гостей (PlayerView), только вместо сервера — сессия в памяти с правилами сервера
// (expect → отказ, ответ только на открытый шаг, капитан за команду, после финиша — только музыка и слайды).
// Робот жмёт кнопки пульта и телефонов как человек: вперёд, «Назад», двойные касания, таблица и QR поверх
// игры, перерывы, «+10 секунд», «Наградить сейчас», опоздавшие, ушедшие, перезагрузка телефона, пульта и
// экрана. Каждая ошибка экрана, зависание и нарушение правил попадают в отчёт (window.robotReport).
import { Component, Suspense, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BoardView } from "../../src/components/live/BoardView";
import { Podium, PodiumPhone } from "../../src/components/live/Podium";
import { SlideView } from "../../src/components/live/SlideView";
import { drawSlide } from "../../src/core/draw";
import { leaderboardAdditions } from "../../src/core/leaderboard";
import { awardNow, canAwardNow, podiumBack } from "../../src/core/podium";
import { roundLeaderboard } from "../../src/core/rounds";
import { addTimeChange, applyChange, meetsExpect, resultKey, startState } from "../../src/core/session";
import { joinSlide, techSlide } from "../../src/core/slides";
import { canSubmitAnswer } from "../../src/data/permissions";
import type { Answer, Participant, PlayMode, Session, SessionChange } from "../../src/data/types";
import { allDemoGames as demoGames, getMechanic, newContent, validateGame } from "../../src/mechanics/registry";
import type { PhoneRole, SessionControl } from "../../src/mechanics/types";
import { applyTheme, getTheme } from "../../src/themes/registry";
import { Screen as RealHall } from "../../src/screens/HallScreen";
import { findingKey, inspectArea, type Area, type Finding } from "./inspect";
import "../../src/fonts.css";
import "../../src/styles.css";

// ------------------------------------------------------------------ параметры

const q = new URLSearchParams(location.search);
const MECHANIC = q.get("m") ?? "quiz";
const MODE: PlayMode = q.get("mode") === "teams" ? "teams" : "solo";
const PLAYERS = Math.max(1, Number(q.get("n") ?? "4"));
const SEED = Number(q.get("seed") ?? "1");
const DEMO = Number(q.get("demo") ?? "0");
const BUDGET = Number(q.get("budget") ?? "500");
// Снимки экранов (scripts/robot/shots.mjs): только вперёд, без вмешательств, пауза перед каждым снимком.
const SHOTS = q.get("shots") === "1";
// Ревизор (scripts/robot/inspect.mjs): настоящий экран зала на размере `hall` (окно браузера — того же размера,
// поэтому vw/vh как на телевизоре), пульт и телефоны — в обёртке настоящих страниц (`page--pult`, `page--play`),
// на каждом новом виде — проверка того, что видят люди (inspect.ts).
const INSPECT = q.get("inspect") === "1";
const [HALL_W = 960, HALL_H = 540] = (q.get("hall") ?? "960x540").split("x").map(Number);
const HOST_W = Number(q.get("host") ?? (INSPECT ? "390" : "720"));
const PHONE_W = Number(q.get("phone") ?? "360");
const GALLERY = q.get("gallery") === "1";
// Что смотрит эта страница: `hall` — экран зала (окно = экран), `phones` — пульт и телефоны (окно = ширина телефона,
// чтобы vw телефона были как на телефоне). Ход игры один и тот же (тот же seed), страниц две.
const AREAS = q.get("areas") ?? "all";
// Длинные имена, как у настоящих гостей (до 30 символов со смайликом): проверка, что ничего не разъезжается.
const LONG_NAMES = q.get("names") === "long";
const LONG_TEAMS = ["🦄 Единороги из бухгалтерии", "🐺 Северные волки отдела IT", "🦉 Совы-полуночники ресепшн", "🐻 Медведи складской логистики", "🐯 Тигры клиентского сервиса", "🐬 Дельфины маркетинга и PR"];
const LONG_PLAYERS = ["🦊 Александра Константинова", "🐺 Владимир Преображенский", "🦉 Екатерина Воскресенская", "🐻 Максимилиан Рождественский", "🐯 Анастасия Великорецкая", "🐬 Святослав Новосельцев"];

let rnd = SEED * 2654435761;
function random(): number {
  rnd ^= rnd << 13;
  rnd ^= rnd >>> 17;
  rnd ^= rnd << 5;
  return ((rnd >>> 0) % 100000) / 100000;
}
const chance = (p: number) => random() < p;
const pick = <T,>(list: T[]): T | undefined => list[Math.floor(random() * list.length)];

// ------------------------------------------------------------------ отчёт

interface Report {
  mechanic: string;
  mode: PlayMode;
  players: number;
  seed: number;
  demo: string;
  ticks: number;
  finished: boolean;
  errors: Array<{ where: string; message: string; at: string }>;
  stuck: string | null;
  edges: Record<string, number>;
  actions: Record<string, number>;
  log: string[];
  findings: Finding[];
  views: number;
}

const mechanic = getMechanic(MECHANIC);
// Шаблоны из кода — для стресс-теста пульта (scripts/e2e/pult.mjs), когда игры нет в библиотеке test.
(window as unknown as { robotDemos: unknown }).robotDemos = demoGames;
const demos = demoGames.filter((d) => d.mechanic === MECHANIC);
const demo = demos[DEMO] ?? null;
const report: Report = {
  mechanic: MECHANIC,
  mode: MODE,
  players: PLAYERS,
  seed: SEED,
  demo: demo?.title ?? "новая игра",
  ticks: 0,
  finished: false,
  errors: [],
  stuck: null,
  edges: {},
  actions: {},
  log: [],
  findings: [],
  views: 0,
};
(window as unknown as { robotReport: Report }).robotReport = report;

function where(): string {
  const s = store.session;
  return `${s.state.phase}/${s.state.step}/${s.state.stage}/${modeOf(s)}`;
}
function fail(area: string, message: string) {
  if (report.errors.length < 40) report.errors.push({ where: area, message: message.slice(0, 400), at: where() });
}
window.addEventListener("error", (e) => fail("страница", String(e.message)));
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason as { code?: string; message?: string } | undefined;
  // Отказ «игра ушла вперёд» — нормальное поведение сервера, пульт его ждёт.
  if (reason?.code === "failed-precondition") return;
  fail("обещание", String(reason?.message ?? reason));
});

// ------------------------------------------------------------------ сессия в памяти (как сервер)

const content = mechanic ? mechanic.parse(demo ? demo.content : newContent(MECHANIC)) : null;
const participants: Participant[] = [];
let joinCounter = 0;
function addGuest(late = false): void {
  const n = ++joinCounter;
  const at = Date.now() + n;
  if (MODE === "teams") {
    const teamName = LONG_NAMES ? `${LONG_TEAMS[(n - 1) % LONG_TEAMS.length] ?? "Команда"}${n > LONG_TEAMS.length ? ` ${n}` : ""}`.slice(0, 30) : `${late ? "Опоздавшие" : "Команда"} ${n}`;
    const team: Participant = { id: `team${n}`, name: teamName, kind: "team", teamId: null, captainUid: `cap${n}`, joinedAt: at };
    participants.push(team);
    participants.push({ id: `cap${n}`, name: `Капитан ${n}`, kind: "player", teamId: team.id, captainUid: `cap${n}`, joinedAt: at });
    participants.push({ id: `mem${n}`, name: `Игрок ${n}`, kind: "player", teamId: team.id, captainUid: `mem${n}`, joinedAt: at + 1 });
  } else {
    const playerName = LONG_NAMES ? `${LONG_PLAYERS[(n - 1) % LONG_PLAYERS.length] ?? "Гость"}${n > LONG_PLAYERS.length ? ` ${n}` : ""}`.slice(0, 30) : `${late ? "Опоздал" : "Гость"} ${n}`;
    participants.push({ id: `p${n}`, name: playerName, kind: "player", teamId: null, captainUid: `p${n}`, joinedAt: at });
  }
}
for (let i = 0; i < PLAYERS; i++) addGuest();

const store = {
  session: {
    id: "robot",
    code: "123456",
    hostId: "host",
    gameId: "robot-game",
    gameTitle: demo?.title ?? "Робот",
    mechanic: MECHANIC,
    gameSnapshot: { content: demo ? demo.content : newContent(MECHANIC) },
    themeId: demo?.themeId ?? "joyrest",
    playMode: MODE,
    screenMode: "laptop",
    state: { ...startState(), phase: "lobby" },
    leaderboard: {},
    createdAt: Date.now(),
  } as Session,
  answers: [] as Answer[],
  version: 0,
  keys: { hall: 0, host: 0 } as Record<string, number>,
};
const listeners = new Set<() => void>();
function bump() {
  store.version++;
  listeners.forEach((l) => l());
}
function useStore() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => store.version,
  );
}

const AFTER_FINISH = new Set(["cue", "music", "mix", "slide", "peek"]);
function serverApply(change: SessionChange): void {
  const s = store.session;
  if (change.expect && !meetsExpect(s.state, change.expect)) throw Object.assign(new Error("ушла вперёд"), { code: "failed-precondition" });
  if (s.state.phase === "finished") {
    const keys = Object.keys(change.state ?? {});
    const ok = keys.every((k) => AFTER_FINISH.has(k)) && !change.leaderboard && !change.addScore && !change.rename;
    if (!ok) throw Object.assign(new Error("после финиша"), { code: "failed-precondition" });
  }
  const before = s.state;
  store.session = applyChange(s, change, Date.now());
  const next = store.session.state;
  // Проверки состояния, как у сервера.
  for (const [pid, e] of Object.entries(store.session.leaderboard)) {
    if (!Number.isFinite(e.score)) fail("таблица", `счёт ${pid} = ${e.score}`);
  }
  if (!Number.isInteger(next.step) || next.step < 0) fail("состояние", `шаг ${next.step}`);
  if (next.step !== before.step || next.stage !== before.stage) {
    const edge = `${label(before)} → ${label(next)}`;
    report.edges[edge] = (report.edges[edge] ?? 0) + 1;
  }
  bump();
}

function modeOf(s: Session): string {
  const r = s.state.result;
  if (r && typeof r === "object" && typeof (r as { mode?: unknown }).mode === "string") return (r as { mode: string }).mode;
  return "";
}
function label(state: Session["state"]): string {
  const m = modeOf({ ...store.session, state });
  return `${state.phase === "playing" ? "" : `${state.phase}:`}${state.stage}${m ? `/${m}` : ""}`;
}

function submit(pid: string, uid: string, value: unknown, personal = false): Promise<"sent" | "rejected"> {
  const s = store.session;
  const step = s.state.step;
  const now = Date.now();
  if (!canSubmitAnswer(s.state, step, now)) return Promise.resolve("rejected");
  const owner = participants.find((p) => p.id === pid);
  // Отвечает сам игрок или капитан своей команды (свой ответ телефона — от себя).
  const captain = personal ? uid === pid : (s.leaderboard[pid]?.captainUid ?? owner?.captainUid) === uid;
  if (!owner || !captain) return Promise.resolve("rejected");
  const id = `${step}_${pid}`;
  const at = store.answers.findIndex((a) => a.id === id);
  const changeable = !!(s.state.result && typeof s.state.result === "object" && (s.state.result as { changeable?: unknown }).changeable === true);
  const stale = at >= 0 && (store.answers[at]?.submittedAt ?? 0) < (s.state.startedAt ?? 0);
  if (at >= 0 && !changeable && !stale) return Promise.resolve("rejected");
  const answer: Answer = { id, step, pid, uid, value: JSON.parse(JSON.stringify(value ?? null)), submittedAt: now };
  if (at >= 0) store.answers.splice(at, 1, answer);
  else store.answers.push(answer);
  bump();
  return Promise.resolve("sent");
}

const control: SessionControl = {
  apply: async (change) => serverApply(change),
  clearAnswers: async (step) => {
    store.answers = store.answers.filter((a) => a.step !== step);
    bump();
  },
  freshAnswers: async (step) => store.answers.filter((a) => a.step === step),
  requestFinish: () => {
    finishWanted = true;
  },
};
let finishWanted = false;

function syncBoard(): void {
  const additions = leaderboardAdditions(store.session.leaderboard, participants, MODE);
  if (Object.keys(additions).length > 0) serverApply({ leaderboard: additions });
}

// ------------------------------------------------------------------ экраны

class Guard extends Component<{ area: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: String((error as Error)?.message ?? error) };
  }
  componentDidCatch(error: unknown) {
    fail(this.props.area, String((error as Error)?.stack ?? error));
  }
  render() {
    return this.state.error ? <p className="error">Ошибка: {this.state.error}</p> : this.props.children;
  }
}

function Hall() {
  useStore();
  const s = store.session;
  if (!mechanic || content === null) return null;
  if (INSPECT) return <RealHall session={s} isHost={false} />;
  const { ScreenView } = mechanic;
  const slide = s.state.slide ?? null;
  let body: ReactNode;
  if (mechanic.standalone) body = <ScreenView session={s} content={content} />;
  else if (slide) body = <SlideView slide={slide} code={s.code} />;
  else if (s.state.phase === "finished") body = <Podium session={s} final />;
  else if (s.state.phase === "lobby") body = <p>Лобби</p>;
  else if (s.state.peek)
    body = <BoardView leaderboard={s.state.peek === "round" ? roundLeaderboard(s.leaderboard) : s.leaderboard} title="Таблица" showLast={false} />;
  else if (s.state.stage === "podium") body = <Podium session={s} />;
  else {
    // Как в HallScreen: нарисованный фон игры под вопросом (Mechanic.art).
    const art = mechanic.art?.(content) ?? null;
    body = art ? (
      <main className="quiz-stage show-stage show-stage--evening hall-art" style={{ width: "100%", height: "100%", ["--hall-art" as string]: `url("/covers/art/web/${art}-1280.webp")`, ["--hall-art-hd" as string]: `url("/covers/art/web/${art}.webp")` } as CSSProperties}>
        <ScreenView session={s} content={content} />
      </main>
    ) : (
      <ScreenView session={s} content={content} />
    );
  }
  return (
    <div className="preview-screen" style={{ width: 960, height: 540 }}>
      {body}
    </div>
  );
}

function Host() {
  useStore();
  const s = store.session;
  if (!mechanic || content === null) return null;
  const { HostControls } = mechanic;
  if (s.state.phase !== "playing") return <p>Пульт: {s.state.phase}</p>;
  return (
    <Suspense fallback={null}>
      <HostControls session={s} content={content} answers={store.answers.filter((a) => a.step === s.state.step)} participants={participants} control={control} rehearsal={false} />
    </Suspense>
  );
}

function Phone({ me }: { me: Participant }) {
  useStore();
  const s = store.session;
  if (!mechanic || content === null) return null;
  const teams = MODE === "teams";
  const pid = teams ? (me.teamId ?? me.id) : me.id;
  const captainUid = teams ? (s.leaderboard[pid]?.captainUid ?? participants.find((p) => p.id === pid)?.captainUid ?? "") : me.id;
  const role: PhoneRole = !teams ? "player" : captainUid === me.id ? "captain" : "member";
  const { PlayerView } = mechanic;
  const own = store.answers.find((a) => a.step === s.state.step && a.pid === pid && (a.submittedAt ?? 0) >= (s.state.startedAt ?? 0));
  const mine = store.answers.find((a) => a.step === s.state.step && a.pid === me.id && (a.submittedAt ?? 0) >= (s.state.startedAt ?? 0));
  if (s.state.phase === "lobby") return <p>Ждём начала</p>;
  if (!mechanic.standalone && s.state.phase === "playing" && s.state.stage === "podium") return <PodiumPhone session={s} pid={pid} />;
  if (!mechanic.standalone && s.state.phase === "finished") return <p>Игра завершена</p>;
  return (
    <PlayerView
      session={s}
      content={content}
      participant={me}
      pid={pid}
      role={role}
      myAnswer={own ? { value: own.value } : null}
      sending={false}
      onAnswer={(value) => void submit(pid, me.id, value)}
      personal={teams ? { value: mine ? { value: mine.value } : null, sending: false, send: (value) => void submit(me.id, me.id, value, true) } : undefined}
    />
  );
}

function Phones() {
  useStore();
  const phones = participants.filter((p) => p.kind === "player");
  return (
    <div className="robot-phones">
      {phones.map((p) => (
        <section key={`${p.id}-${store.keys[p.id] ?? 0}`} className="robot-phone" data-phone={p.id} style={{ width: 360 }}>
          <Guard area={`телефон ${p.id}`}>
            <Phone me={p} />
          </Guard>
        </section>
      ))}
    </div>
  );
}

function App() {
  useStore();
  if (INSPECT) {
    const phones = participants.filter((p) => p.kind === "player");
    return (
      <>
        {/* Экран зала — в левом верхнем углу во всё окно: transform делает его рамкой для position: fixed. */}
        {AREAS !== "phones" && (
          <section data-hall key={`hall-${store.keys.hall}`} style={{ position: "relative", width: HALL_W, height: HALL_H, overflow: "hidden", transform: "translateZ(0)" }}>
            <Guard area="экран зала">
              <Hall />
            </Guard>
          </section>
        )}
        <section data-host key={`host-${store.keys.host}`} style={{ width: HOST_W, background: "var(--color-bg)" }}>
          <main className="page page--pult">
            <section className="card">
              <Guard area="пульт">
                <Host />
              </Guard>
            </section>
          </main>
        </section>
        {phones.map((p) => (
          <section key={`${p.id}-${store.keys[p.id] ?? 0}`} data-phone={p.id} style={{ width: PHONE_W, background: "var(--color-bg)" }}>
            <main className="page page--play">
              <div className="card">
                <Guard area={`телефон ${p.id}`}>
                  <Phone me={p} />
                </Guard>
              </div>
            </main>
          </section>
        ))}
      </>
    );
  }
  return (
    <div className="page page--wide" style={{ maxWidth: "none" }}>
      <section data-hall key={`hall-${store.keys.hall}`}>
        <Guard area="экран зала">
          <Hall />
        </Guard>
      </section>
      <section data-host className="card" key={`host-${store.keys.host}`} style={{ width: 720 }}>
        <Guard area="пульт">
          <Host />
        </Guard>
      </section>
      <Phones />
    </div>
  );
}

// ------------------------------------------------------------------ робот

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const visible = (el: Element) => (el as HTMLElement).offsetParent !== null || (el as HTMLElement).getClientRects().length > 0;
function buttons(root: Element | null): HTMLButtonElement[] {
  if (!root) return [];
  return [...root.querySelectorAll("button")].filter((b) => !b.disabled && visible(b)) as HTMLButtonElement[];
}
const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function count(name: string) {
  report.actions[name] = (report.actions[name] ?? 0) + 1;
}
function note(line: string) {
  if (report.log.length < 400) report.log.push(`${report.ticks}: ${line} [${where()}]`);
}

// ------------------------------------------------------------------ Ревизор

const seenViews = new Set<string>();
const findings = new Map<string, Finding>();
const MAX_VIEWS = Number(q.get("views") ?? "60");
const MAX_SHOTS = Number(q.get("snaps") ?? "25");
let snaps = 0;

/** Вид игры: этап, режим механики, слайд, таблица поверх, награждение, есть ли ответы. */
function viewKey(): string {
  const s = store.session;
  const st = s.state;
  const r = st.result && typeof st.result === "object" ? (st.result as Record<string, unknown>) : {};
  const answered = store.answers.some((a) => a.step === st.step && (a.submittedAt ?? 0) >= (st.startedAt ?? 0));
  return [st.phase, st.stage, modeOf(s), st.slide?.kind ?? "", st.peek ?? "", typeof r.podium === "number" ? r.podium : "", answered ? "ответы" : "", st.revealed ? "открыт" : ""].join("|");
}

async function settle(): Promise<void> {
  await sleep(300);
  const running = document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().endTime !== Infinity);
  await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => undefined))), sleep(1500)]);
  // Картинки и шрифты — дождаться (битая картинка видна только после загрузки).
  await Promise.race([document.fonts.ready, sleep(1000)]);
  const imgs = [...document.images].filter((i) => !i.complete);
  const loaded = (i: HTMLImageElement) =>
    new Promise((r) => {
      i.addEventListener("load", r, { once: true });
      i.addEventListener("error", r, { once: true });
    });
  await Promise.race([Promise.all(imgs.map(loaded)), sleep(2000)]);
}

async function snap(root: HTMLElement, el: Element | null, id: string, key: string): Promise<string | undefined> {
  const w = window as unknown as { robotSnap?: (id: string, key: string) => Promise<string | null> };
  if (!w.robotSnap || (el && snaps >= MAX_SHOTS)) return undefined;
  const target = (el ?? root) as HTMLElement;
  const prev = [target.style.outline, target.style.outlineOffset];
  if (el) {
    target.style.outline = "4px solid #ff2d55";
    target.style.outlineOffset = "2px";
  }
  root.setAttribute("data-snap", "1");
  try {
    const file = await w.robotSnap(id, key);
    if (file && el) snaps++;
    return file ?? undefined;
  } finally {
    root.removeAttribute("data-snap");
    target.style.outline = prev[0] ?? "";
    target.style.outlineOffset = prev[1] ?? "";
  }
}

async function inspectView(): Promise<void> {
  const key = viewKey();
  if (seenViews.has(key) || seenViews.size >= MAX_VIEWS) return;
  seenViews.add(key);
  await settle();
  report.views++;
  const at = where();
  const playing = store.session.state.phase === "playing";
  const areas: { area: Area; root: HTMLElement }[] = [];
  const hall = document.querySelector<HTMLElement>("[data-hall]");
  if (hall) areas.push({ area: "экран зала", root: hall });
  const host = document.querySelector<HTMLElement>("[data-host]");
  if (host && playing && AREAS !== "hall") areas.push({ area: "пульт", root: host });
  // Телефоны: первые три и участник команды (у него свой вид).
  const phones = AREAS === "hall" ? [] : [...document.querySelectorAll<HTMLElement>("[data-phone]")];
  const member = phones.find((p) => p.dataset.phone?.startsWith("mem"));
  for (const p of [...phones.slice(0, 3), ...(member && !phones.slice(0, 3).includes(member) ? [member] : [])]) areas.push({ area: "телефон", root: p });
  for (const { area, root } of areas) {
    window.scrollTo(0, area === "экран зала" ? 0 : root.offsetTop);
    await sleep(30);
    let raws;
    try {
      raws = inspectArea({ area, root, at, playing, hallHeight: area === "экран зала" ? HALL_H : undefined });
    } catch (e) {
      fail("ревизор", String((e as Error)?.stack ?? e));
      continue;
    }
    for (const raw of raws) {
      const k = findingKey(area, raw);
      const old = findings.get(k);
      if (old) {
        old.count++;
        continue;
      }
      const f: Finding = { key: k, area, kind: raw.kind, message: raw.message, path: raw.path, text: raw.text, at, count: 1 };
      findings.set(k, f);
      report.findings.push(f);
      f.shot = await snap(root, raw.el, `${findings.size}`, k);
    }
  }
  window.scrollTo(0, 0);
  // Галерея (GALLERY=1 у inspect.mjs): снимок экрана зала на каждом новом виде — посмотреть все экраны глазами.
  if (GALLERY && hall) await snap(hall, null, `вид-${seenViews.size}`, `галерея|${MECHANIC}|${DEMO}|${MODE}|${key}`);
}

/** Окно подтверждения на экране — соглашаемся (иногда сначала отказываемся). */
async function confirmDialogs(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const dialog = document.querySelector("dialog[open], [role=dialog], [role=alertdialog]");
    if (!dialog) return;
    const all = buttons(dialog);
    const yes = all.find((b) => b.classList.contains("btn") && !b.classList.contains("btn--secondary") && !b.classList.contains("btn--quiet")) ?? all[0];
    if (!yes) return;
    yes.click();
    await sleep(30);
  }
}

/** Телефоны: заполнить поля и нажать что-то из доступного. */
async function phonesAct(): Promise<void> {
  for (const root of document.querySelectorAll("[data-phone]")) {
    if (!chance(0.7)) continue;
    for (const field of root.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea")) {
      const f = field as HTMLInputElement;
      if (f.disabled || f.value) continue;
      setValue(f, f.type === "number" ? String(1 + Math.floor(random() * 5)) : `Робот пишет ответ ${Math.floor(random() * 90) + 10}`);
    }
    for (const sel of root.querySelectorAll("select")) {
      const options = [...(sel as HTMLSelectElement).options].filter((o) => !o.disabled && o.value);
      const o = pick(options);
      if (o) {
        (sel as HTMLSelectElement).value = o.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    const list = buttons(root);
    const b = pick(list);
    if (b) {
      count("телефон: кнопка");
      b.click();
      await sleep(10);
    }
  }
}

const RISKY = /досрочно|Закончить|Без голосования|Завершить партию|Завершить сессию|Убрать|Отклонить|Не брать/i;

async function hostAct(): Promise<void> {
  const root = document.querySelector("[data-host]");
  const list = buttons(root);
  if (list.length === 0) return;
  const primary = list.find((b) => b.classList.contains("host-quiz__primary")) ?? list.find((b) => b.classList.contains("btn") && !b.classList.contains("btn--secondary") && !b.classList.contains("btn--quiet"));
  const back = list.find((b) => /^(←\s*)?Назад/.test(text(b)));
  const late = report.ticks > BUDGET * 0.7;
  const others = list.filter((b) => b !== primary && b !== back && (late || !RISKY.test(text(b))));
  let chosen: HTMLButtonElement | undefined;
  const r = random();
  if (SHOTS) chosen = primary ?? others.find((b) => !RISKY.test(text(b)));
  else if (back && r < 0.12) chosen = back;
  else if (r < 0.3) chosen = pick(others) ?? primary;
  else chosen = primary ?? pick(others);
  if (!chosen) return;
  const name = text(chosen).slice(0, 40);
  count(`пульт: ${chosen === back ? "Назад" : chosen === primary ? "главная" : "другая"}`);
  note(`пульт «${name}»`);
  chosen.click();
  // Двойное касание иногда: второй раз — пока пульт ещё не получил своё изменение.
  if (!SHOTS && chance(0.05)) chosen.click();
  await sleep(20);
  await confirmDialogs();
}

/** Вмешательства ведущего поверх любой игры (общие кнопки пульта) и жизнь зала. */
async function overlay(): Promise<void> {
  const s = store.session;
  const st = s.state;
  const r = random();
  const safe = (name: string, change: SessionChange | null) => {
    if (!change) return;
    try {
      count(name);
      note(name);
      serverApply(change);
    } catch (e) {
      if ((e as { code?: string }).code !== "failed-precondition") fail(name, String(e));
    }
  };
  if (st.phase !== "playing" || mechanic?.standalone || SHOTS) return;
  if (r < 0.04) safe("таблица на экран", { state: { peek: chance(0.5) ? "total" : "round" } });
  else if (r < 0.08 && st.peek) safe("убрать таблицу", { state: { peek: null } });
  else if (r < 0.11) safe("QR для опоздавших", { state: { slide: joinSlide(`j${report.ticks}`) } });
  else if (r < 0.15 && st.slide) safe("убрать слайд", { state: { slide: null } });
  else if (r < 0.17) safe("технический перерыв", { state: { slide: techSlide(`t${report.ticks}`) } });
  else if (r < 0.19) {
    const names = Object.values(s.leaderboard).map((e) => e.name);
    if (names.length >= 2) safe("жеребьёвка", { state: { slide: drawSlide(`d${report.ticks}`, names, names[0] ?? "", Date.now()) } });
  } else if (r < 0.21) safe("+10 секунд", addTimeChange(st, Date.now()));
  else if (r < 0.23 && !mechanic?.ownAward && canAwardNow(st) && Object.values(s.leaderboard).some((e) => e.score > 0)) {
    // «Наградить сейчас» и сразу «Назад» — игра должна вернуться туда же.
    const before = { step: st.step, stage: st.stage, key: resultKey(st.result) };
    safe("наградить сейчас", { ...awardNow(s), expect: { phase: "playing", step: st.step, stage: st.stage } });
    safe("назад с награждения", podiumBack(store.session));
    const after = store.session.state;
    if (after.step !== before.step || after.stage !== before.stage) fail("наградить сейчас", `«Назад» вернул не туда: ${before.stage} → ${after.stage}`);
  } else if (r < 0.25 && joinCounter < PLAYERS + 3) {
    count("опоздавший гость");
    note("опоздавший гость");
    addGuest(true);
    syncBoard();
  } else if (r < 0.27) {
    // Телефон уснул и вернулся / перезагрузили страницу.
    const phone = pick(participants.filter((p) => p.kind === "player"));
    if (phone) {
      count("телефон переподключился");
      store.keys[phone.id] = (store.keys[phone.id] ?? 0) + 1;
      bump();
    }
  } else if (r < 0.285) {
    count("пульт открыли заново");
    note("пульт открыли заново");
    store.keys.host = (store.keys.host ?? 0) + 1;
    bump();
  } else if (r < 0.3) {
    count("экран зала перезагрузили");
    store.keys.hall = (store.keys.hall ?? 0) + 1;
    bump();
  }
}

async function run(): Promise<void> {
  if (!mechanic || content === null) {
    fail("подготовка", `нет механики ${MECHANIC}`);
    (window as unknown as { robotDone: boolean }).robotDone = true;
    return;
  }
  const errors = validateGame(MECHANIC, demo ? demo.content : newContent(MECHANIC));
  if (errors.length > 0) note(`игра с замечаниями: ${errors[0]?.message}`);
  applyTheme(getTheme(store.session.themeId));
  // Лобби → пульт добавляет гостей в таблицу → «Начать игру».
  syncBoard();
  serverApply({ state: { ...startState(), startedAt: null }, expect: { phase: "lobby" } });
  let lastSig = "";
  let still = 0;
  for (report.ticks = 0; report.ticks < BUDGET; report.ticks++) {
    await sleep(15);
    await phonesAct();
    await sleep(15);
    await overlay();
    await sleep(15);
    await hostAct();
    if (INSPECT) await inspectView();
    if (SHOTS) {
      const w = window as unknown as { robotShot?: (tick: number) => Promise<void> };
      await sleep(1300);
      if (w.robotShot) await w.robotShot(report.ticks);
    }
    if (finishWanted) {
      finishWanted = false;
      count("завершить игру");
      note("завершить игру");
      serverApply({ state: { phase: "finished", peek: null } });
    }
    if (store.session.state.phase === "finished") {
      report.finished = true;
      await sleep(50);
      if (INSPECT) await inspectView();
      break;
    }
    const st = store.session.state;
    const sig = `${st.step}|${st.stage}|${resultKey(st.result)}|${store.answers.length}|${JSON.stringify(store.session.leaderboard)}`;
    if (sig === lastSig) still++;
    else {
      still = 0;
      lastSig = sig;
    }
    if (still > 40) {
      const host = document.querySelector("[data-host]");
      report.stuck = `пульт: ${text(host ?? document.body).slice(0, 300)} | кнопки: ${buttons(host).map(text).join(" / ").slice(0, 200)}`;
      break;
    }
  }
  (window as unknown as { robotDone: boolean }).robotDone = true;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
void sleep(200).then(run);
