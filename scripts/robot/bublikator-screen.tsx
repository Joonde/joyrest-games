// Стенд экрана зала «Бубликатора» (Блок 2c): настоящий экран (`BublikatorScreen`) против комнаты в памяти — правила и
// сводка экрана из `src/mechanics/bublikator/rules/` (как на сервере: `screenView`). Адрес: `?s=<сценарий>&crews=5&theme=newyear
// &long=1&guests=50&reduce=1`. Страница доводит игру до нужного состояния (макеты scr-*), а `bublikator-screen.mjs` снимает
// экран на 1920×1080, 1280×800 и 1024×768 и проверяет раскладку.
import "../../src/fonts.css";
import "../../src/styles.css";
import { createRoot } from "react-dom/client";
import type { RoomClosedReason, RoomStreamEvent } from "../../src/data/types";
import { BublikatorScreen } from "../../src/mechanics/bublikator/screen/Screen";
import type { ScreenLink } from "../../src/mechanics/bublikator/screen/link";
import { DOCK_MS, LAUNCH_MS, WARN_MS } from "../../src/mechanics/bublikator/rules/constants";
import { crewPlayers } from "../../src/mechanics/bublikator/rules/crews";
import { screenView } from "../../src/mechanics/bublikator/rules/views";
import { hashRandom, World } from "../../src/mechanics/bublikator/rules/world.test-kit";
import { applyTheme, getTheme } from "../../src/themes/registry";

const TEAMS = ["🦊 Лисы", "🚀 Ракеты", "🐻 Медведи", "🌟 Звёзды", "🎩 Джентльмены", "🍀 Клевер", "🐙 Осьминоги", "⚡ Молнии", "🎈 Шарики", "🍕 Пицца"];
const LONG_TEAMS = ["🐻 Медведи из соседнего подъезда", "🚀 Ракетные войска бухгалтерии", "🦊 Хитрые лисы отдела продаж", "🌟 Звёзды корпоративного вечера"];
const NAMES = ["Аня", "Костя", "Оля", "Дима", "Маша", "Серёжа", "Катя", "Вова", "Лена", "Миша", "Света", "Паша", "Юля", "Игорь", "Таня", "Рома", "Настя", "Женя", "Даша", "Артём"];
const LONG_NAMES = ["Константинопольская Александра", "Анна-Мария Петровна", "Владимир Владимирович", "Екатерина Великолепная"];

const params = new URLSearchParams(location.search);
const scenario = params.get("s") ?? "lobby";
const crewsN = Number(params.get("crews") ?? 5);
const guests = Number(params.get("guests") ?? 50);
const theme = params.get("theme") ?? "newyear";
const long = params.get("long") === "1";
const reduce = params.get("reduce") === "1";

function world(content: Record<string, unknown> = {}): World {
  return new World({
    players: guests,
    teams: crewsN,
    teamNames: (i) => (long ? `${LONG_TEAMS[i % LONG_TEAMS.length]}${i >= LONG_TEAMS.length ? ` ${i + 1}` : ""}` : `${TEAMS[i % TEAMS.length]}${i >= TEAMS.length ? ` ${i + 1}` : ""}`),
    names: (i) => (long ? `${LONG_NAMES[i % LONG_NAMES.length]} ${i}` : `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""}`),
    content: { theme, legMinutes: 3, saboteur: true, ...content },
  });
}

function seeRoles(w: World): void {
  for (const pid of Object.keys(w.s.members)) w.send(pid, [{ t: "role-ok" }]);
}

function noSchedule(w: World): void {
  if (w.s.leg) w.s.leg.schedule = [];
  const leg = w.s.leg;
  if (leg?.glitch) leg.glitch.at = Number.MAX_SAFE_INTEGER;
  if (leg?.flip) leg.flip.at = Number.MAX_SAFE_INTEGER;
}

/** Экипажи летят с разной слаженностью: у каждого своя доля выполненных приказов. */
function fly(w: World, ms: number): void {
  w.advance(ms, 100, () => {
    for (const m of Object.values(w.s.members)) {
      if (!m.order || m.crew === null) continue;
      const rate = 0.05 + 0.25 * hashRandom(`crew${m.crew}`);
      if (hashRandom(`${m.pid}:${w.env.now}`) < rate) w.fulfil(m.pid);
    }
  });
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

function toLeg(w: World, index: number): void {
  w.toFlight();
  noSchedule(w);
  for (let i = 0; i < index; i += 1) {
    fly(w, 8000);
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
  fly(w, 25_000);
}

function event(w: World, kind: string): void {
  w.ok("event", { kind });
  w.advance(WARN_MS + 300);
}

function finishCrew(w: World, crewId: number): void {
  const crew = w.s.crews.find((c) => c.id === crewId);
  if (!crew) return;
  crew.dist = 999.9;
  for (let i = 0; i < 30 && crew.finishedAt === null; i += 1) {
    const m = crewPlayers(w.s, crew.id).find((x) => x.order);
    if (m) w.fulfil(m.pid);
    w.advance(400);
  }
}

function repairCrew(w: World, crewId: number): void {
  const crew = w.s.crews.find((c) => c.id === crewId);
  if (!crew) return;
  crew.hull = 0.1;
  for (const m of crewPlayers(w.s, crew.id)) if (m.order) m.order.due = -1;
  w.step();
}

interface Scene {
  w: World;
  /** Что сделать после первого показа (моменты при открытом экране). */
  after?: (link: StandLink) => void;
}

const SCENARIOS: Record<string, () => Scene> = {
  lobby: () => ({ w: world() }),
  "lobby-wait": () => {
    const w = world();
    for (const [i, n] of ["Вера", "Стас", "Нина", "Тимофей Аркадьевич", "Зоя"].entries()) w.addPlayer(`x${i}`, n, null);
    return { w };
  },
  crews: () => {
    const w = world();
    w.ok("gather");
    w.offline("p3");
    return { w };
  },
  drill: () => {
    const w = world();
    w.ok("gather");
    w.ok("drill");
    w.advance(2500);
    return { w };
  },
  "drill-over": () => {
    const w = world();
    w.ok("gather");
    w.ok("drill");
    w.advance(31_000);
    return { w };
  },
  launch: () => {
    const w = world();
    w.ok("gather");
    w.ok("start");
    seeRoles(w);
    w.advance(1200);
    return {
      w,
      after: (l) => {
        // Взлёт наступил при открытом экране — звук взлёта.
        l.push();
      },
    };
  },
  flight: () => {
    const w = world();
    toLeg(w, 0);
    repairCrew(w, crewsN > 1 ? 1 : 0);
    w.advance(1500);
    return { w };
  },
  "flight-leg2": () => {
    const w = world();
    toLeg(w, 1);
    return { w };
  },
  finish: () => {
    const w = world();
    toLeg(w, 0);
    finishCrew(w, 0);
    return {
      w,
      after: (l) => {
        // Салют с телефонов долетевшего экипажа — при открытом экране.
        for (const m of crewPlayers(w.s, 0)) w.send(m.pid, [{ t: "salute", n: 3 }]);
        w.step();
        l.push();
      },
    };
  },
  warn: () => {
    const w = world();
    toLeg(w, 0);
    w.ok("event", { kind: "meteor" });
    w.advance(800);
    return { w };
  },
  meteor: () => {
    const w = world();
    toLeg(w, 0);
    event(w, "meteor");
    w.advance(3000, 200, () => {
      for (const m of Object.values(w.s.members)) {
        if (m.crew === null) continue;
        const p = Math.round(100 * hashRandom(`shake${m.crew}`));
        w.send(m.pid, [{ t: "shake", p }]);
      }
    });
    return { w };
  },
  glitch: () => {
    const w = world();
    toLeg(w, 1);
    const g = w.s.leg?.glitch;
    if (g) g.at = (w.s.leg?.flight ?? 0) + 100;
    w.advance(400);
    return { w };
  },
  pull: () => {
    const w = world();
    toLeg(w, 0);
    event(w, "pull");
    for (const c of w.s.crews) {
      const players = crewPlayers(w.s, c.id);
      const all = c.id % 3 === 0;
      for (const [i, m] of players.entries()) if (all || i % 2 === 0) w.send(m.pid, [{ t: "hold", on: true }]);
    }
    w.advance(1200);
    return { w };
  },
  sos: () => {
    const w = world();
    toLeg(w, 0);
    event(w, "sos");
    const seq = w.s.leg?.event?.seq ?? [];
    for (const c of w.s.crews) {
      const cap = crewPlayers(w.s, c.id)[0]?.pid;
      if (!cap) continue;
      // Один экипаж набрал всё (событие кончилось бы, будь он единственным) — у остальных по-разному.
      const k = c.id === 0 && w.s.crews.length > 1 ? seq.length : (c.id % 3) + (w.s.crews.length > 1 ? 0 : 1);
      for (let i = 0; i < k; i += 1) w.send(cap, [{ t: "sos", color: seq[i] ?? 0 }]);
    }
    w.step();
    return { w };
  },
  captain: () => {
    const w = world();
    toLeg(w, 0);
    event(w, "captain");
    w.advance(5000);
    return { w };
  },
  dock: () => {
    const w = world();
    toLeg(w, 0);
    finishCrew(w, 0);
    endFlight(w);
    return { w };
  },
  vote: () => {
    const w = world();
    toLeg(w, 0);
    endFlight(w);
    // Голосование открывается само через 10 с «Привала» (если есть диверсанты; в экипажах меньше 5 — нет).
    w.advance(DOCK_MS + 200);
    for (const [i, pid] of Object.keys(w.s.members).entries()) {
      if (i % 3 === 0) continue;
      const m = w.member(pid);
      const mate = Object.values(w.s.members).find((x) => x.crew === m.crew && x.pid !== pid);
      w.send(pid, [{ t: "vote", pid: mate?.pid ?? null }]);
    }
    w.step();
    return { w };
  },
  reveal: () => {
    const w = world();
    toLeg(w, 0);
    endFlight(w);
    if (!w.s.leg?.saboteurs) return { w };
    w.ok("vote");
    for (const c of w.s.crews) {
      for (const m of crewPlayers(w.s, c.id)) if (m.pid !== c.saboteur && c.id % 2 === 0) w.send(m.pid, [{ t: "vote", pid: c.saboteur }]);
    }
    w.ok("vote-end");
    return { w };
  },
  // Раскрытие при открытом экране: по одному, шаг 1,6 с.
  "reveal-seq": () => {
    const w = world();
    toLeg(w, 0);
    endFlight(w);
    if (!w.s.leg?.saboteurs) return { w };
    w.ok("vote");
    return {
      w,
      after: (l) => {
        for (const c of w.s.crews) for (const m of crewPlayers(w.s, c.id)) if (m.pid !== c.saboteur) w.send(m.pid, [{ t: "vote", pid: c.saboteur }]);
        w.ok("vote-end");
        l.push();
        setTimeout(() => {
          w.env.now += 900;
        }, 200);
      },
    };
  },
  podium: () => {
    const w = world({ legs: 2 });
    toLeg(w, 0);
    endFlight(w);
    if (w.s.leg?.saboteurs) {
      w.ok("vote");
      w.ok("vote-end");
    }
    w.ok("podium");
    return { w };
  },
  over: () => ({ w: world() }),
  tab: () => ({ w: world() }),
  abandoned: () => ({ w: world() }),
  connecting: () => ({ w: world() }),
  pause: () => {
    const w = world();
    toLeg(w, 0);
    w.pause();
    return { w };
  },
};

/** Комната в памяти: экран подписан, сводка приходит после каждого шага. */
class StandLink implements ScreenLink {
  private listeners = new Set<(e: RoomStreamEvent) => void>();
  closed: RoomClosedReason | null = null;
  subError: string | null = null;
  silent = false;
  /** Экран получил первую сводку (дальше — моменты «при открытом экране»). */
  onFirst: (() => void) | null = null;
  constructor(readonly w: World) {}
  subscribe(onEvent: (e: RoomStreamEvent) => void, onError: (e: Error) => void, take: boolean): () => void {
    this.listeners.add(onEvent);
    if (take) this.closed = null;
    const fail = this.subError;
    queueMicrotask(() => {
      if (fail) return onError(Object.assign(new Error(fail), { reason: fail }));
      if (this.silent) return;
      if (this.closed) onEvent({ type: "closed", at: this.w.env.now, reason: this.closed });
      else onEvent(this.event());
      const first = this.onFirst;
      this.onFirst = null;
      first?.();
    });
    return () => this.listeners.delete(onEvent);
  }
  event(): RoomStreamEvent {
    const online = Object.values(this.w.s.members).filter((m) => this.w.env.online(m.pid)).length;
    return { type: "screen", at: this.w.env.now, version: this.w.env.changes, paused: this.w.env.paused, players: Object.keys(this.w.s.members).length, online, data: screenView(this.w.s, this.w.env) };
  }
  push(): void {
    for (const l of this.listeners) l(this.event());
  }
}

const make = SCENARIOS[scenario] ?? SCENARIOS.lobby;
if (!make) throw new Error("нет сценария");
const { w, after } = make();
const link = new StandLink(w);
if (scenario === "tab") link.closed = "busy";
if (scenario === "abandoned") link.closed = "abandoned";
if (scenario === "over") link.subError = "finished";
if (scenario === "connecting") link.silent = true;
const now = () => w.env.now;

applyTheme(getTheme("joyrest"));
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("нет #root");
const board =
  scenario === "over"
    ? Array.from({ length: Math.min(crewsN, 12) }, (_, i) => ({ id: `t${i}`, name: long ? (LONG_TEAMS[i % LONG_TEAMS.length] ?? "") : (TEAMS[i % TEAMS.length] ?? ""), score: 3000 - i * 211 }))
    : [];
createRoot(rootEl).render(
  <div style={{ position: "fixed", inset: 0 }}>
    <BublikatorScreen link={link} code="515042" sessionFinished={scenario === "over"} saboteurs fallbackBoard={board} fallbackTheme={w.s.content.theme} now={now} reduced={reduce} />
  </div>,
);

// Сценарий продолжается, когда экран уже показал первую сводку (иначе момент придёт до подписки и «наступит» без экрана).
const go = () =>
  setTimeout(() => {
    after?.(link);
    (window as unknown as { standReady: boolean }).standReady = true;
  }, 200);
if (scenario === "over" || scenario === "connecting") go();
else link.onFirst = go;
(window as unknown as { stand: unknown }).stand = {
  scenarios: Object.keys(SCENARIOS),
  board: () => document.querySelector<HTMLElement>(".bks")?.dataset.board ?? null,
  crews: () => w.s.crews.length,
};
