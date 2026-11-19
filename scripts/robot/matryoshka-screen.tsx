// Стенд экрана зала «Игр Матрёшки» (Блок 3c): настоящий экран (`MatryoshkaScreen`) против комнаты в памяти — правила, боты и
// сводка экрана из `src/mechanics/matryoshka/` (как на сервере: `screenView`). Адрес: `?s=<сценарий>&n=50&style=night&long=1
// &reduce=1&live=1`. Страница доводит игру ботами до нужного этапа, `matryoshka-screen.mjs` снимает экран на 1920×1080, 1280×800 и
// 1024×768 и проверяет раскладку. `live=1` — игра идёт дальше в реальном времени (проверка поворота, песенки и плавности).
import "../../src/fonts.css";
import "../../src/styles.css";
import { createRoot } from "react-dom/client";
import type { RoomClosedReason, RoomStreamEvent } from "../../src/data/types";
import { MatryoshkaScreen } from "../../src/mechanics/matryoshka/screen/Screen";
import type { ScreenLink } from "../../src/mechanics/matryoshka/screen/link";
import { screenView } from "../../src/mechanics/matryoshka/rules/views";
import { World } from "../../src/mechanics/matryoshka/rules/world.test-kit";
import type { TrialKind } from "../../src/mechanics/matryoshka/rules/types";
import { applyTheme, getTheme } from "../../src/themes/registry";

const params = new URLSearchParams(location.search);
const scenario = params.get("s") ?? "lobby";
const n = Number(params.get("n") ?? 50);
const style = params.get("style") === "night" ? "night" : "sunny";
const long = params.get("long") === "1";
const reduce = params.get("reduce") === "1";
const live = params.get("live") === "1";

const EMOJI = ["🦊", "🐻", "🐼", "🐯", "🦁", "🐸", "🐙", "🦄", "🐝", "🦋", "🐧", "🐢", "🌟", "🔥", "🚀", "🎉", "🎈", "🎯", "🎸", "🍕", "🍩", "🍓", "🌈", "👑"];
const NAMES = ["Аня", "Сева", "Ира", "Лёша", "Маша", "Дима", "Катя", "Олег", "Лена", "Паша", "Оля", "Вова", "Таня", "Гриша", "Юля", "Саша", "Света", "Костя", "Нина", "Миша", "Даша", "Егор", "Вера", "Артём", "Соня"];
const LONG = ["Константинопольская Александра", "Анна-Мария Петровна Шахмухаммедзаде", "Владимир Владимирович Ждановщиков", "Екатерина Великолепная Вторая"];

function world(attempt = 0): World {
  // «Добивка» у ботов-взрослых (одно сердечко) не наступает — к финалу их и так не больше финалистов; ночной двор для неё — с двумя
  // сердечками (экран «Добивки» от сердечек не зависит).
  const lives = scenario.startsWith("dobivka") ? { lives: 2 } : {};
  const w = new World(n, { style, ...lives, ...(params.get("finalists") ? { finalists: Number(params.get("finalists")) } : {}) }, `stand-${scenario}${attempt ? `-${attempt}` : ""}`);
  // Имя — и в составе комнаты (`players`, его сверяет `tick`), и у участника.
  w.players.forEach((p, i) => {
    const base = long ? `${LONG[i % LONG.length]} ${i}` : `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""}`;
    p.name = i % 9 === 4 ? base : `${EMOJI[(i * 7) % EMOJI.length]} ${base}`;
    const m = w.s.members[p.pid];
    if (m) m.name = p.name;
  });
  return w;
}

/** Пульт жмёт главную кнопку (кроме «Второго шанса», если не просили). */
function pult(w: World, chance = false): void {
  const c = w.host().can;
  if (chance && c.chance) w.cmd("chance");
  else if (c.next) w.cmd("next");
  else if (c.duel) w.cmd("duel");
  else if (c.podium) w.cmd("podium");
}

/** В «Замри!» и «Канате» боты играют по-разному: каждый своё время «без связи», иначе 50 фишек шли бы одной колонной, а узел стоял. */
function spread(w: World, t: number): void {
  if (w.s.trial?.kind !== "freeze" && w.s.trial?.kind !== "rope") {
    if (w.offline.size > 0) w.offline.clear();
    return;
  }
  w.players.forEach((p, i) => {
    if ((Math.floor(t / 700) + i) % 9 < (i * 5) % 6) w.offline.add(p.pid);
    else w.offline.delete(p.pid);
  });
}

function until(w: World, cond: () => boolean, limit = 1_500_000, opts: { chance?: boolean; press?: boolean } = {}): boolean {
  for (let t = 0; t < limit; t += 100) {
    if (cond()) return true;
    spread(w, t + (w.now % 7000));
    w.step(100, true);
    if (cond()) return true;
    if (opts.press !== false) pult(w, opts.chance ?? false);
  }
  return cond();
}

const trialIs = (w: World, kind: TrialKind, stage: string) => w.s.phase === "trial" && w.s.trial?.kind === kind && w.s.trial.stage === stage;
const sub = (w: World): string => {
  const v = screenView(w.s, w).trial as Record<string, unknown> | undefined;
  const p = v?.play as Record<string, unknown> | undefined;
  return typeof p?.sub === "string" ? p.sub : "";
};

/** До испытания `kind` на этапе `stage` (пульт открывает следующие матрёшки). */
function toTrial(w: World, kind: TrialKind, stage: string, extra: () => boolean = () => true): boolean {
  w.cmd("start");
  return until(w, () => trialIs(w, kind, stage) && extra());
}

function freezePhrase(w: World): { start: number; at: number; end: number; head: number } | null {
  const p = (screenView(w.s, w).trial as Record<string, unknown> | undefined)?.play as Record<string, unknown> | undefined;
  const ph = p?.phrase as Record<string, number> | null | undefined;
  return ph ? { start: ph.start ?? 0, at: ph.at ?? 0, end: ph.end ?? 0, head: ph.head ?? 0 } : null;
}

const SCENARIOS: Record<string, (w: World) => boolean | void> = {
  lobby: () => undefined,
  open: (w) => toTrial(w, "freeze", "open"),
  rules: (w) => toTrial(w, "freeze", "rules"),
  countdown: (w) => toTrial(w, "freeze", "countdown"),
  "freeze-run": (w) =>
    toTrial(w, "freeze", "play", () => {
      const p = freezePhrase(w);
      return p !== null && w.now > p.start + (p.at - p.start) * 0.55 && w.now < p.head - 150 && w.now - (w.s.trial?.stageAt ?? 0) > 12_000;
    }),
  "freeze-turn": (w) =>
    toTrial(w, "freeze", "play", () => {
      const p = freezePhrase(w);
      return p !== null && w.now > p.at + 1700 && w.now < p.end - 200 && w.now - (w.s.trial?.stageAt ?? 0) > 20_000;
    }),
  judging: (w) => toTrial(w, "freeze", "judging"),
  reveal: (w) => toTrial(w, "freeze", "reveal"),
  results: (w) => toTrial(w, "freeze", "results"),
  "ginger-pick": (w) => toTrial(w, "ginger", "play", () => sub(w) === "pick"),
  "ginger-unbox": (w) => toTrial(w, "ginger", "play", () => sub(w) === "unbox" && ((screenView(w.s, w).trial?.play as { boxes?: unknown[] })?.boxes?.length ?? 0) >= 3),
  "ginger-trace": (w) => toTrial(w, "ginger", "play", () => sub(w) === "trace"),
  "chairs-music": (w) => toTrial(w, "chairs", "play", () => sub(w) === "music"),
  "chairs-stop": (w) =>
    toTrial(w, "chairs", "play", () => {
      const p = screenView(w.s, w).trial?.play as { sub?: string; appearAt?: number | null } | undefined;
      return p?.sub === "stop" && typeof p.appearAt === "number" && w.now > p.appearAt + 300;
    }),
  "chairs-seat": (w) => toTrial(w, "chairs", "play", () => sub(w) === "seat"),
  // Боты тянут ровно (узел стоит на месте) — для снимка стенд сам сдвигает узел к коралловым.
  "rope-pull": (w) => {
    const ok = toTrial(w, "rope", "play", () => sub(w) === "pull" && w.s.trial?.play?.kind === "rope" && w.now - w.s.trial.play.attemptAt > 4000);
    if (ok && w.s.trial?.play?.kind === "rope") w.s.trial.play.knot = 35;
    return ok;
  },
  "rope-rest": (w) => toTrial(w, "rope", "play", () => sub(w) === "rest"),
  "hop-brave": (w) => toTrial(w, "hopscotch", "play", () => sub(w) === "brave"),
  "hop-choose": (w) => toTrial(w, "hopscotch", "play", () => sub(w) === "choose"),
  "hop-crack": (w) => toTrial(w, "hopscotch", "play", () => sub(w) === "crack"),
  "chance-offer": (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "chance" && w.s.chance?.stage === "offer", 1_500_000, { chance: true });
  },
  "chance-question": (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "chance" && w.s.chance?.stage === "question" && Object.keys(w.s.chance.answers).length > 0, 1_500_000, { chance: true });
  },
  "chance-back": (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "chance" && w.s.chance?.stage === "back", 1_500_000, { chance: true });
  },
  "dobivka-rows": (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "dobivka" && w.s.dobivka?.stage === "rows" && (w.s.dobivka.rows.at(-1)?.fell ?? null) === null && Object.keys(w.s.dobivka.rows.at(-1)?.picks ?? {}).length > 0);
  },
  "dobivka-crack": (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "dobivka" && (w.s.dobivka?.rows.at(-1)?.fell ?? null) !== null);
  },
  bracket: (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "final" && w.s.final?.stage === "bracket", 1_500_000, { press: true }) && true;
  },
  "duel-pick": (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "final" && w.s.final?.duel?.stage === "pick");
  },
  "duel-show": (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "final" && (w.s.final?.duel?.stage === "show" || w.s.final?.duel?.stage === "over") && (w.s.final?.duels ?? 0) >= 1);
  },
  bestfan: (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "final" && w.s.final?.duel?.stage === "over" && finalLast(w));
  },
  "reveal-live": (w) => toTrial(w, "freeze", "judging"),
  "open-live": (w) => toTrial(w, "freeze", "open"),
  champion: (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "final" && w.s.final?.stage === "champion", 1_500_000, { press: true });
  },
  podium: (w) => {
    w.cmd("start");
    return until(w, () => w.s.phase === "podium");
  },
  pause: (w) => {
    SCENARIOS["freeze-run"]?.(w);
    w.pause();
  },
  board: (w) => {
    SCENARIOS["freeze-run"]?.(w);
    w.cmd("board");
  },
  tab: () => undefined,
  connecting: () => undefined,
  over: () => undefined,
};

/** Последняя дуэль сыграна (следующая кнопка — к чемпиону). */
function finalLast(w: World): boolean {
  const f = w.s.final;
  if (!f) return false;
  const R = f.rounds.length;
  return f.at?.round === R - 1;
}

/** Что сделать после первого показа (момент наступает при открытом экране). */
const AFTER: Record<string, (w: World) => void> = {
  bestfan: (w) => void w.cmd("duel"),
  "reveal-live": (w) => void until(w, () => w.s.trial?.stage === "reveal", 10_000, { press: false }),
};

// «Второй шанс» и «Добивка» бывают не в каждой игре (решают сердечки) — стенд пробует другие зёрна, пока этап не наступит.
const make = SCENARIOS[scenario] ?? SCENARIOS.lobby;
let w = world();
let reached = make?.(w);
for (let attempt = 1; reached === false && attempt <= 6; attempt += 1) {
  w = world(attempt);
  reached = make?.(w);
}

/** Комната в памяти: экран подписан, сводка приходит после каждого шага. */
class StandLink implements ScreenLink {
  private listeners = new Set<(e: RoomStreamEvent) => void>();
  closed: RoomClosedReason | null = null;
  subError: string | null = null;
  silent = false;
  onFirst: (() => void) | null = null;
  subscribe(onEvent: (e: RoomStreamEvent) => void, onError: (e: Error) => void, take: boolean): () => void {
    this.listeners.add(onEvent);
    if (take) this.closed = null;
    const fail = this.subError;
    queueMicrotask(() => {
      if (fail) return onError(Object.assign(new Error(fail), { reason: fail }));
      if (this.silent) return;
      if (this.closed) onEvent({ type: "closed", at: w.now, reason: this.closed });
      else onEvent(this.event());
      const first = this.onFirst;
      this.onFirst = null;
      first?.();
    });
    return () => this.listeners.delete(onEvent);
  }
  event(): RoomStreamEvent {
    const online = Object.values(w.s.members).filter((m) => w.online(m.pid)).length;
    return { type: "screen", at: w.now, version: w.changes, paused: w.paused, players: Object.keys(w.s.members).length, online, data: screenView(w.s, w) };
  }
  push(): void {
    for (const l of this.listeners) l(this.event());
  }
}

const link = new StandLink();
if (scenario === "tab") link.closed = "busy";
if (scenario === "over") link.subError = "finished";
if (scenario === "connecting") link.silent = true;
let stepPerf = performance.now();
const now = () => (live ? w.now + Math.min(200, performance.now() - stepPerf) : w.now);

applyTheme(getTheme("joyrest"));
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("нет #root");
createRoot(rootEl).render(
  <div style={{ position: "fixed", inset: 0 }}>
    <MatryoshkaScreen link={link} code="482915" sessionFinished={scenario === "over"} fallbackStyle={style} fallbackBoard={scenario === "over" ? [{ id: "a", name: "🦊 Аня", score: 500, place: 1 }] : []} now={now} synced={() => 0} reduced={reduce} />
  </div>,
);

const ready = () => {
  (window as unknown as { standReady: boolean }).standReady = true;
};
const painted = (then: () => void) => {
  const el = document.querySelector<HTMLElement>(".mts");
  if (!el || el.dataset.board === "connecting") return void requestAnimationFrame(() => painted(then));
  requestAnimationFrame(() => requestAnimationFrame(then));
};
if (scenario === "over" || scenario === "connecting") setTimeout(ready, 300);
else
  link.onFirst = () =>
    painted(() => {
      const after = AFTER[scenario];
      if (after) {
        after(w);
        link.push();
      }
      // «Живой» поток: дальше — как настоящий экран (сводка раз в 200 мс).
      if (live) {
        let k = 0;
        setInterval(() => {
          w.step(100, true);
          stepPerf = performance.now();
          pult(w);
          if (++k % 2 === 0) link.push();
        }, 100);
      }
      setTimeout(ready, 60);
    });

(window as unknown as { stand: unknown }).stand = {
  reached: reached !== false,
  board: () => document.querySelector<HTMLElement>(".mts")?.dataset.board ?? null,
  phase: () => w.s.phase,
  push: () => link.push(),
  step: (ms: number) => {
    w.step(ms, true);
    link.push();
  },
  now: () => w.now,
  phrase: () => freezePhrase(w),
};
