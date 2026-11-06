// Стенд телефона «Бубликатора» (Блок 2b): настоящий телефон гостя (`BublikatorPhone`) против комнаты в памяти — правила
// и личное из `src/mechanics/bublikator/rules/` (как на сервере: снимок `personalSnapshot`, дальше куски рассылки). 50 гостей
// в командах (решение владельца 6 ноября 2026 — проверки на 50). Сценарий — из адреса `?s=<имя>`; страница доводит игру до
// нужного состояния (макеты ph-*), а `bublikator-phone.mjs` снимает экран на 360 и 412 px и проверяет раскладку.
import { createRoot } from "react-dom/client";
import type { RoomClosedReason, RoomInputEvent, RoomInputReply, RoomStreamEvent } from "../../src/data/types";
import { BublikatorPhone } from "../../src/mechanics/bublikator/phone/Phone";
import type { PhoneLink } from "../../src/mechanics/bublikator/phone/link";
import { DOCK_MS, LAUNCH_MS, WARN_MS } from "../../src/mechanics/bublikator/rules/constants";
import { crewPlayers } from "../../src/mechanics/bublikator/rules/crews";
import { personalSnapshot } from "../../src/mechanics/bublikator/rules/views";
import { World } from "../../src/mechanics/bublikator/rules/world.test-kit";
import { applyTheme, getTheme } from "../../src/themes/registry";
import "../../src/fonts.css";
import "../../src/styles.css";

const TEAMS = ["🦊 Лисы", "🚀 Ракеты", "🐻 Медведи из соседнего подъезда", "🌟 Звёзды", "🎩 Джентльмены"];
const NAMES = [
  "Аня",
  "Константин Александрович",
  "Оля",
  "Дима",
  "Маша",
  "Серёжа",
  "Катя",
  "Вова",
  "Лена",
  "Миша",
  "Света",
  "Паша",
  "Юля",
  "Игорь",
  "Таня",
  "Рома",
  "Настя",
  "Женя",
  "Даша",
  "Артём",
];

const params = new URLSearchParams(location.search);
const scenario = params.get("s") ?? "lobby";

/** Комната в памяти: один телефон подписан, события ему доходят после каждого шага. */
class StandLink implements PhoneLink {
  private listeners = new Set<(e: RoomStreamEvent) => void>();
  private reply: ((r: RoomInputReply) => void) | null = null;
  closed: RoomClosedReason | null = null;
  mute = false;
  constructor(
    readonly w: World,
    public pid: string,
  ) {}
  subscribe(onEvent: (e: RoomStreamEvent) => void): () => void {
    this.listeners.add(onEvent);
    queueMicrotask(() => {
      if (this.closed) onEvent({ type: "closed", at: this.w.env.now, reason: this.closed });
      else onEvent({ type: "snapshot", at: this.w.env.now, paused: this.w.env.paused, every: 2000, offlineMs: 4000, data: personalSnapshot(this.w.s, this.pid, this.w.env) });
    });
    return () => this.listeners.delete(onEvent);
  }
  sender(onReply: (r: RoomInputReply) => void) {
    this.reply = onReply;
    return {
      push: (event: RoomInputEvent) => {
        if (this.mute) return;
        this.w.send(this.pid, [event]);
        this.pump();
        onReply({ at: this.w.env.now, every: 2000, paused: this.w.env.paused, dropped: 0, dup: false, stale: false });
      },
      stop: () => undefined,
    };
  }
  /** Всё, что комната отправила этому телефону, — в поток. */
  pump(): void {
    if (this.mute) return;
    const mine = this.w.env.sent.filter((x) => x.pid === this.pid);
    this.w.env.sent = [];
    for (const x of mine) for (const l of this.listeners) l({ type: "event", at: this.w.env.now, data: x.data });
  }
  room(paused: boolean): void {
    for (const l of this.listeners) l({ type: "room", at: this.w.env.now, paused });
  }
  beat(): void {
    this.reply?.({ at: this.w.env.now, every: 2000, paused: this.w.env.paused, dropped: 0, dup: false, stale: false });
  }
}

function world(opts: { teams?: number; content?: Record<string, unknown>; players?: number } = {}): World {
  const teams = opts.teams ?? 5;
  return new World({
    players: opts.players ?? 50,
    teams,
    teamNames: (i) => TEAMS[i % TEAMS.length] ?? `Команда ${i + 1}`,
    names: (i) => `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""}`,
    content: { theme: "newyear", legMinutes: 3, saboteur: true, ...opts.content },
  });
}

function seeRoles(w: World): void {
  for (const pid of Object.keys(w.s.members)) w.send(pid, [{ t: "role-ok" }]);
}

function endFlight(w: World): void {
  if (w.s.leg?.stage === "launch") w.advance(LAUNCH_MS);
  const leg = w.s.leg;
  if (!leg) return;
  leg.event = null;
  leg.schedule = [];
  leg.flight = leg.duration;
  w.step();
}

function noSchedule(w: World): void {
  if (w.s.leg) w.s.leg.schedule = [];
}

function toLeg(w: World, index: number): void {
  w.toFlight();
  noSchedule(w);
  for (let i = 0; i < index; i += 1) {
    endFlight(w);
    seeRoles(w);
    if (w.s.leg?.saboteurs) {
      w.ok("vote");
      w.ok("vote-end");
    }
    w.ok("next");
    w.advance(LAUNCH_MS + 100);
    noSchedule(w);
  }
  seeRoles(w);
  w.advance(2500);
}

function event(w: World, kind: string): void {
  w.ok("event", { kind });
  w.advance(WARN_MS + 300);
}

/** Сценарии: доводят игру до состояния макета; `pid` — чей телефон показываем. */
const SCENARIOS: Record<string, () => { w: World; pid: string; after?: (l: StandLink) => void }> = {
  lobby: () => ({ w: world(), pid: "p0" }),
  crews: () => {
    const w = world();
    w.ok("gather");
    return { w, pid: "p0" };
  },
  drill: () => {
    const w = world();
    w.ok("gather");
    w.ok("drill");
    w.advance(2500);
    return { w, pid: "p0" };
  },
  launch: () => {
    const w = world();
    w.ok("gather");
    w.ok("start");
    seeRoles(w);
    w.advance(1200);
    return { w, pid: "p0" };
  },
  panel: () => {
    const w = world();
    toLeg(w, 0);
    return { w, pid: "p0" };
  },
  "panel-leg3": () => {
    const w = world();
    toLeg(w, 2);
    return { w, pid: "p0" };
  },
  "feedback-done": () => {
    const w = world();
    toLeg(w, 0);
    return {
      w,
      pid: "p0",
      after: (l) => {
        if (!w.member("p0").order) w.advance(1500);
        w.fulfil("p0");
        w.advance(800);
        l.pump();
      },
    };
  },
  "feedback-fail": () => {
    const w = world();
    toLeg(w, 0);
    return {
      w,
      pid: "p0",
      after: (l) => {
        const o = w.member("p0").order;
        if (o) o.due = -1;
        w.step();
        l.pump();
      },
    };
  },
  double: () => {
    const w = world();
    toLeg(w, 0);
    w.addPlayer("late", "Опоздавший Валентин", "t0");
    w.send("late", [{ t: "role-ok" }]);
    w.step();
    return { w, pid: "late" };
  },
  glitch: () => {
    const w = world();
    toLeg(w, 1);
    const g = w.s.leg?.glitch;
    if (g) g.at = (w.s.leg?.flight ?? 0) + 100;
    w.advance(400);
    return { w, pid: "p0" };
  },
  flip: () => {
    const w = world();
    toLeg(w, 2);
    const f = w.s.leg?.flip;
    if (f) f.at = (w.s.leg?.flight ?? 0) + 100;
    w.advance(1500);
    return { w, pid: "p0" };
  },
  "event-warn": () => {
    const w = world();
    toLeg(w, 0);
    w.ok("event", { kind: "meteor" });
    w.advance(800);
    return { w, pid: "p0" };
  },
  meteor: () => {
    const w = world();
    toLeg(w, 0);
    event(w, "meteor");
    for (const pid of ["p0", "p5", "p10"]) w.send(pid, [{ t: "tap", n: 4 }]);
    w.advance(1500);
    return { w, pid: "p0" };
  },
  pull: () => {
    const w = world();
    toLeg(w, 0);
    event(w, "pull");
    for (const pid of ["p5", "p10", "p15"]) w.send(pid, [{ t: "hold", on: true }]);
    w.advance(600);
    return { w, pid: "p0" };
  },
  sos: () => {
    const w = world();
    toLeg(w, 0);
    event(w, "sos");
    const crew = w.member("p0").crew ?? 0;
    const cap = crewPlayers(w.s, crew)[0]?.pid ?? "p0";
    const seq = w.s.leg?.event?.seq ?? [];
    w.send(cap, [{ t: "sos", color: seq[0] ?? 0 }]);
    w.step();
    return { w, pid: cap };
  },
  "sos-crew": () => {
    const w = world();
    toLeg(w, 0);
    event(w, "sos");
    const crew = w.member("p0").crew ?? 0;
    const players = crewPlayers(w.s, crew);
    const seq = w.s.leg?.event?.seq ?? [];
    w.send(players[0]?.pid ?? "p0", [{ t: "sos", color: seq[0] ?? 0 }]);
    w.step();
    return { w, pid: players[1]?.pid ?? "p5" };
  },
  deck: () => {
    const w = world();
    toLeg(w, 0);
    event(w, "captain");
    return { w, pid: "p0" };
  },
  repair: () => {
    const w = world();
    toLeg(w, 0);
    const crew = w.s.crews.find((c) => c.id === w.member("p0").crew);
    if (crew) {
      crew.hull = 0.1;
      for (const m of crewPlayers(w.s, crew.id)) if (m.order) m.order.due = -1;
    }
    w.step();
    w.send("p0", [{ t: "tap", n: 9 }]);
    w.send("p5", [{ t: "tap", n: 20 }]);
    w.advance(2000);
    return { w, pid: "p0" };
  },
  finish: () => {
    const w = world();
    toLeg(w, 0);
    const crew = w.s.crews.find((c) => c.id === w.member("p0").crew);
    if (crew) crew.dist = 999.9;
    for (let i = 0; i < 20 && crew?.finishedAt === null; i += 1) {
      const m = crewPlayers(w.s, crew.id).find((x) => x.order);
      if (m) w.fulfil(m.pid);
      w.advance(800);
    }
    return { w, pid: "p0" };
  },
  pause: () => {
    const w = world();
    toLeg(w, 0);
    if (!w.member("p0").order) w.advance(1500);
    w.pause();
    return { w, pid: "p0", after: (l) => l.room(true) };
  },
  role: () => {
    const w = world();
    w.ok("gather");
    w.ok("start");
    w.advance(LAUNCH_MS + 300);
    const crew = w.s.crews.find((c) => c.id === w.member("p0").crew);
    return { w, pid: crew?.saboteur ?? "p0" };
  },
  "role-honest": () => {
    const w = world();
    w.ok("gather");
    w.ok("start");
    w.advance(LAUNCH_MS + 300);
    const crew = w.s.crews.find((c) => c.id === w.member("p0").crew);
    const honest = crewPlayers(w.s, crew?.id ?? 0).find((m) => m.pid !== crew?.saboteur);
    return { w, pid: honest?.pid ?? "p0" };
  },
  dock: () => {
    const w = world();
    toLeg(w, 0);
    w.advance(30_000, 100, () => {
      const m = Object.values(w.s.members).find((x) => x.order && w.env.now % 300 === 0);
      if (m) w.fulfil(m.pid);
    });
    endFlight(w);
    return { w, pid: "p0" };
  },
  vote: () => {
    const w = world();
    toLeg(w, 0);
    endFlight(w);
    w.advance(DOCK_MS + 200);
    const cand = Object.keys(w.s.members).find((pid) => pid !== "p0" && w.member(pid).crew === w.member("p0").crew);
    w.send("p0", [{ t: "vote", pid: cand ?? null }]);
    w.step();
    return { w, pid: "p0" };
  },
  voted: () => {
    const w = world();
    toLeg(w, 0);
    endFlight(w);
    w.ok("vote");
    const crew = w.s.crews.find((c) => c.id === w.member("p0").crew);
    for (const m of crewPlayers(w.s, crew?.id ?? 0)) if (m.pid !== crew?.saboteur) w.send(m.pid, [{ t: "vote", pid: crew?.saboteur ?? null }]);
    w.ok("vote-end");
    return { w, pid: "p0" };
  },
  nosab: () => {
    // 12 команд: в двух по 5 человек (там диверсант), в остальных по 4 — диверсанта нет.
    const w = world({ teams: 12 });
    toLeg(w, 0);
    endFlight(w);
    w.ok("vote");
    return { w, pid: "p11" };
  },
  card: () => {
    const w = world({ content: { legs: 2 } });
    toLeg(w, 0);
    w.advance(20_000, 100, () => {
      const m = Object.values(w.s.members).find((x) => x.order && w.env.now % 300 === 0);
      if (m) w.fulfil(m.pid);
    });
    endFlight(w);
    w.ok("vote");
    w.ok("vote-end");
    w.ok("podium");
    return { w, pid: "p0" };
  },
  kids: () => {
    const w = world({ content: { difficulty: "kids", theme: "space" } });
    toLeg(w, 0);
    return { w, pid: "p0" };
  },
  "kids-leg3": () => {
    const w = world({ content: { difficulty: "kids", theme: "pirates" } });
    toLeg(w, 2);
    return { w, pid: "p3" };
  },
  "theme-space": () => {
    const w = world({ content: { theme: "space" } });
    toLeg(w, 0);
    return { w, pid: "p1" };
  },
  "theme-wedding": () => {
    const w = world({ content: { theme: "wedding" } });
    toLeg(w, 1);
    return { w, pid: "p2" };
  },
  tab: () => {
    const w = world();
    toLeg(w, 0);
    return { w, pid: "p0" };
  },
  abandoned: () => ({ w: world(), pid: "p0" }),
  removed: () => ({ w: world(), pid: "p0" }),
  offline: () => {
    const w = world();
    toLeg(w, 0);
    return {
      w,
      pid: "p0",
      after: (l) => {
        l.mute = true;
        w.env.now += 7000;
      },
    };
  },
};

const make = SCENARIOS[scenario] ?? SCENARIOS.lobby;
if (!make) throw new Error("нет сценария");
const { w, pid, after } = make();
w.env.sent = [];
const link = new StandLink(w, pid);
if (scenario === "tab") link.closed = "busy";
if (scenario === "abandoned") link.closed = "abandoned";
if (scenario === "removed") link.closed = "removed";
const member = w.member(pid);
const now = () => w.env.now;

applyTheme(getTheme("joyrest"));
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("нет #root");
createRoot(rootEl).render(<BublikatorPhone link={link} name={member.name} code="515 042" now={now} />);

// Дальше — по сценарию (после снимка телефона), и раз в полсекунды «я на связи».
setTimeout(() => {
  after?.(link);
  link.pump();
  (window as unknown as { standReady: boolean }).standReady = true;
}, 150);
setInterval(() => {
  if (!link.mute) link.beat();
}, 500);
(window as unknown as { stand: unknown }).stand = {
  scenarios: Object.keys(SCENARIOS),
  pid,
  screen: () => document.querySelector<HTMLElement>(".bkp-root")?.dataset.screen ?? null,
  /** Что знает комната (для проверки касаний): положения приборов этого телефона, «Тяга», голос, роль прочитана. */
  server: () => {
    const m = w.member(pid);
    const ev = w.s.leg?.event;
    return { panel: (m.doubleOf ? w.member(m.doubleOf).panel : m.panel).map((id) => w.s.controls[id]?.state ?? null), holding: ev?.holds?.[pid]?.on === true, vote: m.vote, roleSeen: m.roleSeen, sos: w.s.crews.find((c) => c.id === m.crew)?.sos?.progress ?? null };
  },
};
