// Стенд телефона «Игр Матрёшки» (Блок 3b): настоящий телефон гостя (`MatryoshkaPhone`) без сервера.
// • Сцена (`?s=<сценарий>&style=sunny|night`): комната в памяти — правила `src/mechanics/matryoshka/rules/` и мир тестов
//   (`world.test-kit.ts`), 50 ботов играют по своему личному виду; сценарий доводит игру до нужного состояния (макеты ph-*,
//   fan-*), телефон «№ 027» получает снимок личного потока и дальше рассылку. `matryoshka-phone.mjs` снимает экран на 360, 390 и
//   412 px и проверяет раскладку, контраст и сбои зоны «Замри!».
// • Живая игра (`?live=1&pid=<pid>`): комната — настоящий движок (`server/src/rooms/engine.ts`) в процессе Node с 47 ботами,
//   телефон связан с ней через функции страницы (`liveInput`, `__liveDeliver`) — Playwright играет им по-настоящему.
import "../../src/fonts.css";
import "../../src/styles.css";
import { createRoot } from "react-dom/client";
import type { RoomClosedReason, RoomInputEvent, RoomInputReply, RoomStreamEvent } from "../../src/data/types";
import { MatryoshkaPhone } from "../../src/mechanics/matryoshka/phone/Phone";
import type { PhoneLink } from "../../src/mechanics/matryoshka/phone/link";
import type { ChairsState, FreezeState, GingerState, HopState, TrialKind } from "../../src/mechanics/matryoshka/rules/types";
import { shapeOf } from "../../src/mechanics/matryoshka/rules/shapes";
import { personalSnapshot } from "../../src/mechanics/matryoshka/rules/views";
import { World } from "../../src/mechanics/matryoshka/rules/world.test-kit";
import { newBot } from "../../src/mechanics/matryoshka/sim/bots";
import { applyTheme, getTheme } from "../../src/themes/registry";

const NAMES = ["Аня", "Константин Александрович", "Оля", "Дима", "Маша", "Серёжа", "Катя", "Вова", "Лена", "Миша", "Света", "Паша", "Юля", "Игорь", "Таня", "Рома", "Настя", "Женя", "Даша", "Артём"];
const EMOJI = ["🦊", "🐻", "🐼", "🐯", "🦁", "🐸", "🐙", "🦄", "🐝", "🦋", "🐧", "🐢", "🌟", "🔥", "🚀", "🎉", "🎈", "🎯", "🎸", "🍕"];

const params = new URLSearchParams(location.search);
const win = window as unknown as Record<string, unknown>;
const pushes: Array<{ event: RoomInputEvent; now: boolean }> = [];
win.pushes = pushes;
/** Точки контура фигуры на поле «Пряника» (из правил) — по ним стенд ведёт палец. */
win.shapePoints = () => {
  const id = document.querySelector(".mtp-field")?.getAttribute("data-points");
  return id ? shapeOf(id as Parameters<typeof shapeOf>[0]).points : null;
};

function nameOf(i: number): string {
  return `${EMOJI[i % EMOJI.length]} ${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""}`;
}

/** Комната в памяти: один телефон подписан, события ему доходят после каждого шага. */
class SceneLink implements PhoneLink {
  private listeners = new Set<(e: RoomStreamEvent) => void>();
  private reply: ((r: RoomInputReply) => void) | null = null;
  closed: RoomClosedReason | null = null;
  /** Касания телефона доходят до комнаты (выключено — только журнал `pushes`). */
  apply = true;
  mute = false;
  key = `stand.${Math.random().toString(36).slice(2, 8)}`;
  clock = { offset: () => 0, sync: () => undefined };
  constructor(
    readonly w: World,
    public pid: string,
  ) {}
  subscribe(onEvent: (e: RoomStreamEvent) => void): () => void {
    this.listeners.add(onEvent);
    queueMicrotask(() => {
      if (this.mute) return;
      if (this.closed) onEvent({ type: "closed", at: this.w.now, reason: this.closed });
      else onEvent({ type: "snapshot", at: this.w.now, paused: this.w.paused, every: 1000, offlineMs: 3000, data: personalSnapshot(this.w.s, this.pid, this.w) });
    });
    return () => this.listeners.delete(onEvent);
  }
  sender(onReply: (r: RoomInputReply) => void) {
    this.reply = onReply;
    return {
      push: (event: RoomInputEvent, now?: boolean) => {
        pushes.push({ event, now: now === true });
        if (this.mute || !this.apply) return;
        this.w.in(this.pid, [event]);
        this.pump();
        onReply({ at: this.w.now, every: 1000, paused: this.w.paused, dropped: 0, dup: false, stale: false });
      },
      stop: () => undefined,
    };
  }
  pump(): void {
    if (this.mute) return;
    const mine = this.w.sent.filter((x) => x.pid === this.pid);
    this.w.sent = [];
    for (const x of mine) for (const l of this.listeners) l({ type: "event", at: this.w.now, data: x.data });
  }
  room(paused: boolean): void {
    for (const l of this.listeners) l({ type: "room", at: this.w.now, paused });
  }
  beat(): void {
    this.reply?.({ at: this.w.now, every: 1000, paused: this.w.paused, dropped: 0, dup: false, stale: false });
  }
}

// ------------------------------------------------------------------ сцены

const ME = "p26";

function world(content: Record<string, unknown> = {}, seed = "stand"): World {
  const w = new World(0, { style: params.get("style") === "night" ? "night" : "sunny", ...content }, seed);
  for (let i = 0; i < 50; i += 1) w.addPlayer(`p${i}`, nameOf(i));
  // «№ 027» — сам игрок стенда: боты за него не играют (прогнозы и ставки — тоже он сам).
  w.bots.set(ME, newBot(ME, seed, { lazy: true }));
  return w;
}

const S = (w: World) => w.s;
const trialKind = (w: World): TrialKind | null => w.s.trial?.kind ?? null;
const srvNow = (w: World) => w.now;
const gameToSrv = (w: World, t: number) => t + w.s.offset;

/** До этапа `open` нужного испытания (остальные — «Пропустить испытание»), без игры ботов. */
function toTrial(w: World, kind: TrialKind): void {
  if (w.s.phase === "lobby") w.cmd("start");
  for (let i = 0; i < 2000; i += 1) {
    const tr = w.s.trial;
    if (w.s.phase === "trial" && tr && tr.kind === kind && (tr.stage === "open" || tr.stage === "rules")) return;
    if (w.s.phase === "trial" && tr && (tr.stage === "open" || tr.stage === "rules")) w.cmd("skip-trial");
    else if (w.host().can.next) w.cmd("next");
    w.step(100, true);
  }
}

function toStage(w: World, stage: string, bots = true, limit = 300_000): void {
  w.until(() => w.s.trial?.stage === stage, limit, bots);
}

/** «№ 027» держит зону `ms` (как телефон: «держу» раз в секунду с отметкой). */
function holdFor(w: World, ms: number, pid = ME): void {
  w.in(pid, [{ t: "h", on: true, st: srvNow(w) }]);
  for (let x = 0; x < ms; x += 100) {
    w.step(100, true);
    if (x % 1000 === 900) w.in(pid, [{ t: "h", on: true, st: srvNow(w) }]);
  }
}

/** Провести всё ботами (пульт жмёт главную кнопку) до условия. */
function drive(w: World, cond: () => boolean, opts: { chance?: boolean } = {}, limit = 40 * 60 * 10): boolean {
  if (w.s.phase === "lobby") w.cmd("start");
  for (let i = 0; i < limit; i += 1) {
    if (cond()) return true;
    w.step(100, true);
    const c = w.host().can;
    if (cond()) return true;
    if (c.chance && opts.chance !== false) w.cmd("chance");
    else if (c.next) w.cmd("next");
    else if (c.duel) w.cmd("duel");
    else if (c.podium) w.cmd("podium");
  }
  return cond();
}

function firstMember(w: World, test: (pid: string) => boolean, fallback = ME): string {
  return Object.keys(w.s.members).find(test) ?? fallback;
}

type Scene = () => { w: World; pid: string; closed?: RoomClosedReason; muted?: boolean };

const SCENES: Record<string, Scene> = {
  lobby: () => ({ w: world(), pid: ME }),
  "late-fan": () => {
    const w = world();
    w.cmd("start");
    w.addPlayer("late", "🎈 Лёва");
    w.bots.set("late", newBot("late", "x", { lazy: true }));
    return { w, pid: "late" };
  },
  intro: () => {
    const w = world();
    w.cmd("start");
    toStage(w, "rules");
    return { w, pid: ME };
  },
  guess: () => {
    const w = world();
    w.cmd("start");
    w.addPlayer("late", "🎈 Лёва");
    w.bots.set("late", newBot("late", "x", { lazy: true }));
    toTrial(w, "chairs");
    return { w, pid: "late" };
  },
  countdown: () => {
    const w = world();
    w.cmd("start");
    toStage(w, "countdown");
    w.step(400, true);
    return { w, pid: ME };
  },
  "freeze-run": () => {
    const w = world();
    w.cmd("start");
    toStage(w, "play");
    holdFor(w, 5000);
    return { w, pid: ME };
  },
  "freeze-gaze": () => {
    const w = world({}, "gaze");
    w.cmd("start");
    toStage(w, "play");
    const st = w.s.trial?.play as FreezeState;
    const g = st.gazes[0];
    if (g) w.until(() => w.now >= gameToSrv(w, g.a) + 150, 60_000, true);
    return { w, pid: ME };
  },
  "freeze-caught": () => {
    const w = world({}, "caught");
    w.cmd("start");
    toStage(w, "play");
    const st = w.s.trial?.play as FreezeState;
    const g = st.gazes[0];
    if (g) holdFor(w, gameToSrv(w, g.e) - w.now + 1600);
    w.in(ME, [{ t: "h", on: false, st: srvNow(w) }]);
    return { w, pid: ME };
  },
  "freeze-finished": () => {
    const w = world();
    w.cmd("start");
    toStage(w, "play");
    const st = w.s.trial?.play as FreezeState;
    const r = st.runners[ME];
    if (r) {
      r.path = 1000;
      r.finishedAt = w.now - w.s.offset;
    }
    w.step(600, true);
    return { w, pid: ME };
  },
  "ginger-pick": () => {
    const w = world();
    toTrial(w, "ginger");
    toStage(w, "play");
    w.in(ME, [{ t: "box", n: 1 }]);
    return { w, pid: ME };
  },
  "ginger-unbox": () => {
    const w = world();
    toTrial(w, "ginger");
    toStage(w, "play");
    w.in(ME, [{ t: "box", n: 1 }]);
    const g = w.s.trial?.play as GingerState;
    w.until(() => w.s.lastTick !== null && w.s.lastTick >= g.pickEnds + 1500, 30_000, true);
    return { w, pid: ME };
  },
  "ginger-trace": () => {
    const w = world();
    toTrial(w, "ginger");
    toStage(w, "play");
    w.in(ME, [{ t: "box", n: 1 }]);
    const g = w.s.trial?.play as GingerState;
    w.until(() => w.s.lastTick !== null && w.s.lastTick >= g.unboxEnds + 300, 30_000, true);
    return { w, pid: ME };
  },
  "ginger-crack": () => {
    const w = world();
    toTrial(w, "ginger");
    toStage(w, "play");
    w.in(ME, [{ t: "box", n: 3 }]);
    const g = w.s.trial?.play as GingerState;
    w.until(() => w.s.lastTick !== null && w.s.lastTick >= g.unboxEnds + 8000, 40_000, true);
    w.in(ME, [{ t: "g", c: 142, crack: true, st: srvNow(w) }]);
    w.step(600, true);
    return { w, pid: ME };
  },
  "ginger-done": () => {
    const w = world();
    toTrial(w, "ginger");
    toStage(w, "play");
    w.in(ME, [{ t: "box", n: 0 }]);
    const g = w.s.trial?.play as GingerState;
    w.until(() => w.s.lastTick !== null && w.s.lastTick >= g.unboxEnds + 8000, 40_000, true);
    w.in(ME, [{ t: "g", c: 200, st: srvNow(w) }]);
    w.step(600, true);
    return { w, pid: ME };
  },
  "chairs-music": () => {
    const w = world();
    toTrial(w, "chairs");
    toStage(w, "play");
    w.step(1000, true);
    return { w, pid: ME };
  },
  "chairs-stop": () => {
    const w = world({}, "stop");
    toTrial(w, "chairs");
    toStage(w, "play");
    const c = w.s.trial?.play as ChairsState;
    const r = c.rounds[0];
    if (r) w.until(() => (w.s.lastTick ?? 0) >= r.stopAt + 100, 60_000, true);
    return { w, pid: ME };
  },
  "chairs-tap": () => {
    const w = world({}, "tap");
    toTrial(w, "chairs");
    toStage(w, "play");
    const c = w.s.trial?.play as ChairsState;
    const r = c.rounds[0];
    if (r) w.until(() => (w.s.lastTick ?? 0) >= r.appearAt + 100, 60_000, true);
    return { w, pid: ME };
  },
  "chairs-seated": () => {
    const w = world({}, "seat");
    toTrial(w, "chairs");
    toStage(w, "play");
    const c = w.s.trial?.play as ChairsState;
    const r = c.rounds[0];
    if (r) {
      w.until(() => (w.s.lastTick ?? 0) >= r.appearAt + 250, 60_000, true);
      w.in(ME, [{ t: "sit", rt: 240, st: srvNow(w) }]);
      w.until(() => r.seated !== null, 10_000, true);
    }
    return { w, pid: ME };
  },
  "chairs-missed": () => {
    const w = world({}, "miss");
    toTrial(w, "chairs");
    toStage(w, "play");
    const c = w.s.trial?.play as ChairsState;
    const r = c.rounds[0];
    if (r) w.until(() => r.seated !== null, 60_000, true);
    return { w, pid: ME };
  },
  rope: () => {
    const w = world();
    toTrial(w, "rope");
    toStage(w, "play");
    w.until(() => w.me(ME)?.trial !== undefined && JSON.stringify(w.me(ME)).includes('"sub":"pull"'), 30_000, true);
    w.step(4000, true);
    return { w, pid: ME };
  },
  "rope-fan": () => {
    const w = world({ lives: 1 });
    w.cmd("start");
    w.addPlayer("late", "🎈 Лёва");
    w.bots.set("late", newBot("late", "x", { lazy: true }));
    toTrial(w, "rope");
    toStage(w, "play");
    w.until(() => JSON.stringify(w.me("late")).includes('"sub":"pull"'), 30_000, true);
    w.step(3000, true);
    return { w, pid: "late" };
  },
  "hop-brave": () => {
    const w = world();
    toTrial(w, "hopscotch");
    toStage(w, "play");
    w.step(500, true);
    return { w, pid: ME };
  },
  "hop-jump": () => {
    const w = world({}, "jump");
    toTrial(w, "hopscotch");
    toStage(w, "play");
    const h = w.s.trial?.play as HopState;
    const r = h.rows[0];
    if (r) {
      w.step(200, false);
      w.in(ME, [{ t: "brave", rt: 200, st: gameToSrv(w, r.braveAt) + 200 }]);
      w.until(() => r.braves !== null, 10_000, true);
      w.step(300, true);
    }
    return { w, pid: ME };
  },
  "hop-choose": () => {
    const w = world({}, "choose");
    toTrial(w, "hopscotch");
    toStage(w, "play");
    const h = w.s.trial?.play as HopState;
    const r = h.rows[0];
    if (r) w.until(() => r.chooseAt !== null && (w.s.lastTick ?? 0) >= r.chooseAt + 500, 30_000, true);
    w.in(ME, [{ t: "cell", side: "L" }]);
    return { w, pid: ME };
  },
  "hop-crack": () => {
    const w = world({}, "crackhop");
    toTrial(w, "hopscotch");
    toStage(w, "play");
    const h = w.s.trial?.play as HopState;
    const r = h.rows[0];
    if (r) {
      w.until(() => r.chooseAt !== null && (w.s.lastTick ?? 0) >= r.chooseAt + 200, 30_000, true);
      w.in(ME, [{ t: "cell", side: r.solid }]);
      w.until(() => r.fell !== null, 30_000, true);
      w.step(300, true);
    }
    return { w, pid: ME };
  },
  "hop-fell": () => {
    const w = world({}, "fell");
    toTrial(w, "hopscotch");
    toStage(w, "play");
    const h = w.s.trial?.play as HopState;
    const r = h.rows[0];
    if (r) {
      w.until(() => r.chooseAt !== null && (w.s.lastTick ?? 0) >= r.chooseAt + 200, 30_000, true);
      w.in(ME, [{ t: "cell", side: r.solid === "L" ? "R" : "L" }]);
      w.until(() => h.row >= 1 || w.s.trial?.stage !== "play", 40_000, true);
      w.step(500, true);
    }
    return { w, pid: ME };
  },
  judging: () => {
    const w = world();
    w.cmd("start");
    toStage(w, "judging", true, 200_000);
    return { w, pid: ME };
  },
  "result-pass": () => {
    const w = world({}, "rp");
    w.cmd("start");
    toStage(w, "results", true, 200_000);
    const o = w.s.trial?.outcome;
    return { w, pid: firstMember(w, (p) => (o?.order.includes(p) ?? false) && !o?.lost.includes(p) && !o?.out.includes(p)) };
  },
  "result-heart": () => {
    const w = world({}, "rh");
    w.cmd("start");
    toStage(w, "results", true, 200_000);
    const o = w.s.trial?.outcome;
    return { w, pid: firstMember(w, (p) => (o?.lost.includes(p) ?? false) && !o?.out.includes(p)) };
  },
  "result-out": () => {
    const w = world({ lives: 1 }, "ro");
    w.cmd("start");
    toStage(w, "results", true, 200_000);
    const o = w.s.trial?.outcome;
    return { w, pid: firstMember(w, (p) => o?.out.includes(p) ?? false) };
  },
  "result-fan": () => {
    const w = world({}, "rf");
    w.cmd("start");
    w.addPlayer("late", "🎈 Лёва");
    w.bots.set("late", newBot("late", "x"));
    toStage(w, "results", true, 200_000);
    return { w, pid: "late" };
  },
  "chance-question": () => {
    const w = world({ lives: 1 }, "cq");
    drive(w, () => w.s.phase === "chance" && w.s.chance?.stage === "question");
    return { w, pid: firstMember(w, (p) => w.s.chance?.eligible.includes(p) ?? false) };
  },
  "chance-offer": () => {
    const w = world({}, "co");
    drive(w, () => w.s.phase === "chance" && w.s.chance?.stage === "offer");
    return { w, pid: firstMember(w, (p) => w.s.chance?.eligible.includes(p) ?? false) };
  },
  "chance-back": () => {
    const w = world({}, "cb");
    drive(w, () => w.s.phase === "chance" && (w.s.chance?.stage === "back" || w.s.chance?.stage === "done"));
    return { w, pid: firstMember(w, (p) => w.s.chance?.returned.includes(p) ?? false) };
  },
  "chance-wait": () => {
    const w = world({}, "cw");
    drive(w, () => w.s.phase === "chance" && w.s.chance?.stage === "question");
    return { w, pid: firstMember(w, (p) => w.s.members[p]?.role === "player") };
  },
  "dob-choose": () => {
    const w = world({ trials: [{ kind: "freeze", on: true }], lives: 2 }, "dob");
    drive(w, () => w.s.phase === "dobivka" && w.s.dobivka?.stage === "rows");
    return { w, pid: firstMember(w, (p) => w.s.members[p]?.role === "player") };
  },
  "dob-intro": () => {
    const w = world({ trials: [{ kind: "freeze", on: true }], lives: 2 }, "dob");
    drive(w, () => w.s.phase === "dobivka" && w.s.dobivka?.stage === "intro");
    return { w, pid: firstMember(w, (p) => w.s.members[p]?.role === "player") };
  },
  "dob-results": () => {
    const w = world({ trials: [{ kind: "freeze", on: true }], lives: 2 }, "dob");
    drive(w, () => w.s.phase === "dobivka" && w.s.dobivka?.stage === "results");
    return { w, pid: firstMember(w, (p) => w.s.dobivka?.out.includes(p) ?? false) };
  },
  bracket: () => {
    const w = world({}, "fin");
    drive(w, () => w.s.phase === "final");
    return { w, pid: w.s.final?.seeds[0] ?? ME };
  },
  duel: () => {
    const w = world({ lives: 1 }, "duel");
    drive(w, () => w.s.phase === "final" && w.s.final?.duel?.stage === "pick");
    return { w, pid: w.s.final?.duel?.a ?? ME };
  },
  "duel-show": () => {
    const w = world({ lives: 1 }, "duel");
    drive(w, () => w.s.phase === "final" && w.s.final?.duel?.stage === "show");
    return { w, pid: w.s.final?.duel?.a ?? ME };
  },
  bet: () => {
    const w = world({ lives: 1 }, "bet");
    drive(w, () => w.s.phase === "final" && w.s.final?.duel?.stage === "bets");
    return { w, pid: firstMember(w, (p) => w.s.members[p]?.role === "fan") };
  },
  "duel-watch": () => {
    const w = world({}, "watch");
    drive(w, () => w.s.phase === "final" && w.s.final?.duel?.stage === "show");
    return { w, pid: firstMember(w, (p) => w.s.members[p]?.role === "fan") };
  },
  champion: () => {
    const w = world({}, "champ");
    drive(w, () => w.s.final?.stage === "champion");
    return { w, pid: w.s.final?.champion ?? ME };
  },
  podium: () => {
    const w = world({}, "pod");
    drive(w, () => w.s.phase === "podium");
    return { w, pid: ME };
  },
  pause: () => {
    const w = world();
    w.cmd("start");
    toStage(w, "play");
    w.pause();
    return { w, pid: ME };
  },
  connecting: () => ({ w: world(), pid: ME, muted: true }),
  tab: () => ({ w: world(), pid: ME, closed: "busy" }),
  removed: () => ({ w: world(), pid: ME, closed: "removed" }),
};

// ------------------------------------------------------------------ живая игра (комната — в Node)

/** Связь с комнатой в процессе Node (настоящий движок): пачки — `liveInput`, поток — `__liveDeliver`. */
class LiveLink implements PhoneLink {
  private listeners = new Set<(e: RoomStreamEvent) => void>();
  key: string;
  clock = { offset: () => 0, sync: () => undefined };
  private seq = 0;
  private pending: RoomInputEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(readonly pid: string) {
    this.key = `live.${pid}`;
    win.__liveDeliver = (events: RoomStreamEvent[]) => {
      for (const e of events) for (const l of this.listeners) l(e);
    };
  }
  subscribe(onEvent: (e: RoomStreamEvent) => void): () => void {
    this.listeners.add(onEvent);
    void (win.liveSubscribe as (pid: string) => Promise<void>)(this.pid);
    return () => this.listeners.delete(onEvent);
  }
  private post(events: RoomInputEvent[], onReply: (r: RoomInputReply) => void): void {
    const body = { stream: `s-${this.pid}`, seq: events.length > 0 ? this.seq++ : undefined, events: events.map((e) => ({ ...e, ago: 0 })) };
    void (win.liveInput as (pid: string, body: unknown) => Promise<RoomInputReply | null>)(this.pid, body).then((r) => r && onReply(r));
  }
  sender(onReply: (r: RoomInputReply) => void) {
    this.timer = setInterval(() => {
      const batch = this.pending;
      this.pending = [];
      this.post(batch, onReply);
    }, 1000);
    return {
      push: (event: RoomInputEvent, now?: boolean) => {
        pushes.push({ event, now: now === true });
        if (now) this.post([event], onReply);
        else this.pending.push(event);
      },
      stop: () => {
        if (this.timer) clearInterval(this.timer);
      },
    };
  }
}

applyTheme(getTheme("joyrest"));
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("нет #root");

if (params.get("live") === "1") {
  const pid = params.get("pid") ?? "b0";
  const link = new LiveLink(pid);
  /** Часы комнаты: страница знает их по последней доставке (`__liveClock`). */
  const clock = { base: Date.now(), real: Date.now(), speed: 1 };
  win.__liveClock = (base: number, speed: number) => {
    clock.base = base;
    clock.real = Date.now();
    clock.speed = speed;
  };
  const now = () => clock.base + (Date.now() - clock.real) * clock.speed;
  createRoot(rootEl).render(<MatryoshkaPhone link={link} name={params.get("name") ?? pid} code="515 042" now={now} />);
  win.stand = { pid, screen: () => document.querySelector<HTMLElement>(".mtp")?.dataset.screen ?? null };
  win.standReady = true;
} else {
  const scenario = params.get("s") ?? "lobby";
  const make = SCENES[scenario] ?? SCENES.lobby;
  if (!make) throw new Error("нет сцены");
  const { w, pid, closed, muted } = make();
  w.sent = [];
  const link = new SceneLink(w, pid);
  if (closed) link.closed = closed;
  if (muted) link.mute = true;
  const member = w.s.members[pid];
  createRoot(rootEl).render(<MatryoshkaPhone link={link} name={member?.name ?? pid} code="515 042" now={() => w.now} />);
  setTimeout(() => {
    link.pump();
    win.standReady = true;
  }, 150);
  setInterval(() => {
    if (!link.mute) link.beat();
  }, 500);
  win.stand = {
    scenes: Object.keys(SCENES),
    pid,
    screen: () => document.querySelector<HTMLElement>(".mtp")?.dataset.screen ?? null,
    /** Шаг комнаты (мс) — для проверок, где нужно время. */
    step: (ms: number) => {
      w.step(ms, true);
      link.pump();
    },
    pause: () => {
      w.pause();
      link.room(true);
    },
    apply: (on: boolean) => {
      link.apply = on;
    },
    /** Что знает комната про этот телефон. */
    server: () => {
      const p = w.s.trial?.play;
      if (p?.kind === "freeze") {
        const r = p.runners[pid];
        return { holding: r?.holding ?? null, seen: r?.seen ?? null, caught: r?.caught ?? null, path: r?.path ?? null };
      }
      if (p?.kind === "ginger") return { c: p.runners[pid]?.c ?? null, cracked: p.runners[pid]?.cracked ?? null };
      if (p?.kind === "rope") return { taps: p.taps[pid]?.total ?? null };
      return { phase: S(w).phase, kind: trialKind(w) };
    },
  };
}
