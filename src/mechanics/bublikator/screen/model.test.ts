import { describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../../data/types";
import { LAUNCH_MS, PULL_HOLD_MS, WARN_MS } from "../rules/constants";
import type { ScreenCrewView, ScreenView } from "../rules/types";
import { screenView } from "../rules/views";
import { World } from "../rules/world.test-kit";
import {
  applyScreen,
  BEEP_EVERY_MS,
  boardOf,
  captainLayout,
  cardColumns,
  chipsShown,
  clock,
  emptyScreen,
  flightLeft,
  guessedOf,
  hullCells,
  lanesOf,
  leftUntil,
  momentsFor,
  momentsOf,
  nextBumps,
  num,
  placesText,
  plural,
  pullOf,
  revealedCount,
  REVEAL_STEP_MS,
  sosCycleMs,
  shieldLook,
  sosLit,
  sosToneOf,
  soundsOf,
  speedText,
  tickOf,
  type ScreenModel,
} from "./model";

function crew(id: number, over: Partial<ScreenCrewView> = {}): ScreenCrewView {
  return {
    id,
    name: `Экипаж ${id}`,
    color: id % 5,
    icon: null,
    place: id + 1,
    members: 5,
    online: 5,
    names: [],
    dist: 0,
    score: 0,
    total: 0,
    hull: 5,
    speed: 1,
    ratio: 1,
    repair: null,
    finished: false,
    streak: 0,
    fire: false,
    shield: null,
    pull: null,
    sos: null,
    okSeq: 0,
    failSeq: 0,
    salutes: 0,
    ...over,
  };
}

function view(over: Partial<ScreenView> = {}): ScreenView {
  return {
    phase: "leg",
    stage: "fly",
    leg: 0,
    legs: 3,
    theme: "newyear",
    difficulty: "normal",
    endsAt: null,
    flight: { elapsed: 60_000, duration: 180_000, stopped: false },
    crews: [crew(0), crew(1)],
    lobby: null,
    event: null,
    glitchUntil: null,
    best: null,
    ordersDone: 0,
    dock: null,
    vote: null,
    reveal: null,
    podium: null,
    pausedAt: null,
    voteAhead: false,
    ...over,
  };
}

function screenEvent(v: ScreenView, at: number, paused = false): RoomStreamEvent {
  return { type: "screen", at, version: 1, paused, players: 10, online: 9, data: v };
}

function model(v: ScreenView, at = 1_000_000, local = 1_000_000): ScreenModel {
  return applyScreen(emptyScreen(local), screenEvent(v, at), local);
}

describe("экран зала «Бубликатора»: модель потока", () => {
  it("сводка экрана — вид, время вида, гости; закрытие и пауза", () => {
    const m = model(view());
    expect(m.view?.phase).toBe("leg");
    expect(m.viewAt).toBe(1_000_000);
    expect(m.players).toBe(10);
    expect(m.online).toBe(9);
    const paused = applyScreen(m, { type: "room", at: 1_000_500, paused: true }, 1_000_500);
    expect(paused.paused).toBe(true);
    expect(paused.pausedAt).toBe(1_000_500);
    const closed = applyScreen(paused, { type: "closed", at: 1_000_600, reason: "abandoned" }, 1_000_600);
    expect(boardOf(closed)).toBe("abandoned");
    // Снова пришла сводка (комнату подняли) — закрытие снято.
    expect(boardOf(applyScreen(closed, screenEvent(view(), 1_001_000), 1_001_000))).toBe("flight");
    // Сводка без данных вид не стирает.
    expect(applyScreen(m, { type: "screen", at: 1_000_100, version: 2, paused: false, players: 11, online: 11, data: null }, 1_000_100).view).not.toBeNull();
  });

  it("какой экран: этапы, события (предупреждение — ещё полёт), вкладка, конец", () => {
    expect(boardOf(emptyScreen(0))).toBe("connecting");
    expect(boardOf(model(view({ phase: "lobby", stage: null })))).toBe("lobby");
    expect(boardOf(model(view({ phase: "crews", stage: null })))).toBe("crews");
    expect(boardOf(model(view({ phase: "drill", stage: null })))).toBe("drill");
    expect(boardOf(model(view({ stage: "launch" })))).toBe("launch");
    expect(boardOf(model(view({ stage: "dock" })))).toBe("dock");
    expect(boardOf(model(view({ stage: "vote" })))).toBe("vote");
    expect(boardOf(model(view({ stage: "voted", reveal: [] })))).toBe("dock");
    expect(boardOf(model(view({ stage: "voted", reveal: [{ crew: 0, saboteur: "p1", name: "Аня", guessed: true, votes: {}, fakes: 2 }] })))).toBe("reveal");
    const ev = (kind: "meteor" | "pull" | "sos" | "captain", warn: boolean) => view({ event: { id: "e1", kind, warn, startsAt: 0, endsAt: 1, seq: null, task: null, crews: [0, 1] } });
    expect(boardOf(model(ev("pull", true)))).toBe("flight");
    expect(boardOf(model(ev("pull", false)))).toBe("pull");
    expect(boardOf(model(ev("sos", false)))).toBe("sos");
    expect(boardOf(model(ev("captain", false)))).toBe("captain");
    expect(boardOf(model(ev("meteor", false)))).toBe("flight");
    expect(boardOf(model(view({ phase: "podium", stage: null, podium: [{ crew: 0, name: "А", place: 1, total: 10 }] })))).toBe("podium");
    for (const reason of ["busy", "replaced"] as const) expect(boardOf({ ...model(view()), closed: reason })).toBe("tab");
    expect(boardOf({ ...model(view()), closed: "finished" })).toBe("over");
    expect(boardOf({ ...model(view({ phase: "podium", stage: null, podium: [{ crew: 0, name: "А", place: 1, total: 10 }] })), closed: "finished" })).toBe("podium");
  });

  it("дорожки: до 8 — все по порядку экипажей; больше — 8 лучших по месту, остальные строкой по местам", () => {
    const few = [crew(2, { place: 1 }), crew(0, { place: 3 }), crew(1, { place: 2 })];
    expect(lanesOf(few).lanes.map((c) => c.id)).toEqual([0, 1, 2]);
    const many = Array.from({ length: 12 }, (_, i) => crew(i, { place: 12 - i }));
    const { lanes, rest } = lanesOf(many);
    expect(lanes).toHaveLength(8);
    expect(lanes.map((c) => c.id)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(rest.map((c) => c.place)).toEqual([9, 10, 11, 12]);
  });

  it("время полёта: досчитывает между сводками, стоит во время события и на паузе, не убегает больше чем на 2 с", () => {
    const m = model(view());
    expect(flightLeft(m, 1_000_000)).toBe(120_000);
    expect(flightLeft(m, 1_001_000)).toBe(119_000);
    expect(flightLeft(m, 1_010_000)).toBe(118_000);
    const stopped = model(view({ flight: { elapsed: 60_000, duration: 180_000, stopped: true } }));
    expect(flightLeft(stopped, 1_005_000)).toBe(120_000);
    const paused = applyScreen(m, { type: "room", at: 1_000_000, paused: true }, 1_000_000);
    expect(flightLeft(paused, 1_005_000)).toBe(120_000);
    expect(flightLeft(model(view({ flight: null })), 0)).toBeNull();
  });

  it("отсчёты по часам сервера: на паузе стоят", () => {
    // Часы экрана отстают от сервера на 5 с.
    const m = applyScreen(emptyScreen(0), screenEvent(view({ endsAt: 1_010_000 }), 1_000_000), 995_000);
    expect(leftUntil(m, 1_010_000, 995_000)).toBe(10_000);
    expect(leftUntil(m, 1_010_000, 999_000)).toBe(6_000);
    const p = applyScreen(m, { type: "room", at: 1_004_000, paused: true }, 999_000);
    expect(leftUntil(p, 1_010_000, 1_100_000)).toBe(6_000);
    expect(leftUntil(m, null, 0)).toBeNull();
  });

  it("«Сигнал SOS»: огоньки по одному, пауза и повтор", () => {
    expect(sosCycleMs(4)).toBe(5000);
    expect(sosLit(4, 1000, 999)).toBeNull();
    expect(sosLit(4, 1000, 1000)).toBe(0);
    expect(sosLit(4, 1000, 1800)).toBeNull();
    expect(sosLit(4, 1000, 2100)).toBe(1);
    expect(sosLit(4, 1000, 4100)).toBe(3);
    expect(sosLit(4, 1000, 5500)).toBeNull();
    expect(sosLit(4, 1000, 6000)).toBe(0);
    expect(sosLit(0, 0, 100)).toBeNull();
  });

  it("подписи: прочность, скорость, «Притяжение», раскрытие, числа", () => {
    expect(hullCells(5)).toEqual([100, 100, 100, 100, 100]);
    expect(hullCells(2.5)).toEqual([100, 100, 50, 0, 0]);
    expect(hullCells(-1)).toEqual([0, 0, 0, 0, 0]);
    expect(speedText({ ratio: 1.24, repair: null, finished: false })).toBe("×1,2");
    expect(speedText({ ratio: 1, repair: { until: 0, taps: 0, target: 1 }, finished: false })).toBe("стоит");
    expect(speedText({ ratio: 1, repair: null, finished: true })).toBe("финиш");
    const pull = (p: Partial<NonNullable<ScreenCrewView["pull"]>>) => crew(0, { online: 4, pull: { held: 0, escaped: false, failed: false, notHolding: [], drifting: true, ...p } });
    expect(pullOf(pull({ notHolding: ["Аня"] }), PULL_HOLD_MS)).toMatchObject({ holding: 3, total: 4, tone: "wait", text: "Ждём всех · 0 из 3 с" });
    expect(pullOf(pull({ held: 1100 }), PULL_HOLD_MS)).toMatchObject({ tone: "hold", text: "Держат все · 1,1 из 3 с" });
    expect(pullOf(pull({ escaped: true }), PULL_HOLD_MS)).toMatchObject({ tone: "ok", share: 1 });
    expect(pullOf(pull({ failed: true }), PULL_HOLD_MS).tone).toBe("bad");
    expect(revealedCount(5, null)).toBe(5);
    expect(revealedCount(5, 0)).toBe(1);
    expect(revealedCount(5, REVEAL_STEP_MS * 2)).toBe(3);
    expect(revealedCount(2, REVEAL_STEP_MS * 9)).toBe(2);
    expect(guessedOf({ saboteur: "p1", votes: { p1: 5, p2: 1 } })).toEqual({ right: 5, all: 6 });
    expect(plural(1, "гость", "гостя", "гостей")).toBe("гость");
    expect(plural(3, "гость", "гостя", "гостей")).toBe("гостя");
    expect(plural(11, "гость", "гостя", "гостей")).toBe("гостей");
    expect(plural(21, "гость", "гостя", "гостей")).toBe("гость");
    expect(num(1344)).toBe("1 344");
    expect(clock(18_000)).toBe("0:18");
    expect(clock(61_500)).toBe("1:02");
    const short = (n: number) => Array.from({ length: n }, (_, i) => ["Аня", "Костя", "Оля", "Дима", "Маша", "Катя", "Вова", "Лена", "Миша", "Юля"][i] ?? "Аня");
    const long = (n: number) => Array.from({ length: n }, (_, i) => `Константинопольская Александра ${i}`);
    expect(chipsShown(short(4), 5)).toBe(4);
    expect(chipsShown(short(10), 5)).toBe(5);
    // Длинные имена — по одному в строке, «+N» — рядом с последним (аудит 2c, №2).
    expect(chipsShown(long(10), 5)).toBe(2);
    expect(chipsShown(long(3), 5)).toBe(2);
    expect(chipsShown(long(2), 5)).toBe(2);
    expect(chipsShown([...long(1), ...short(8)], 5)).toBe(4);
    expect(chipsShown(short(10), 8)).toBe(1);
    expect(chipsShown(short(2), 8)).toBe(2);
    expect(chipsShown(short(3), 12)).toBe(0);
    expect(cardColumns(3)).toBe(3);
    expect(cardColumns(12)).toBe(7);
    expect(cardColumns(20)).toBe(7);
  });

  it("моменты: только то, что наступило при открытом экране", () => {
    const fly = view();
    expect(momentsOf(null, fly)).toEqual({ launch: false, event: false, eventKind: null, warn: false, orders: 0, fail: false, repair: false, finish: [], salutes: [], dock: false, reveal: false, podium: false });
    expect(momentsOf(view({ phase: "crews", stage: null }), view({ stage: "launch" })).launch).toBe(true);
    const warn = view({ event: { id: "e1", kind: "meteor", warn: true, startsAt: 0, endsAt: 1, seq: null, task: null, crews: [] } });
    const on = view({ event: { id: "e1", kind: "meteor", warn: false, startsAt: 0, endsAt: 1, seq: null, task: null, crews: [] } });
    expect(momentsOf(fly, warn).event).toBe(false);
    expect(momentsOf(warn, on).event).toBe(true);
    expect(momentsOf(on, on).event).toBe(false);
    const done = view({ crews: [crew(0, { finished: true, salutes: 4 }), crew(1)] });
    expect(momentsOf(view({ crews: [crew(0, { salutes: 0 }), crew(1)] }), done)).toMatchObject({ finish: [0], salutes: [{ crew: 0, n: 4 }] });
    expect(momentsOf(view({ stage: "vote" }), view({ stage: "voted" })).reveal).toBe(true);
    expect(momentsOf(view({ stage: "fly" }), view({ stage: "dock" })).dock).toBe(true);
  });
});

describe("экран зала «Бубликатора»: настоящая сводка правил → экран", () => {
  it("лобби → экипажи → взлёт → полёт → события → привал → пьедестал (50 гостей, 5 команд)", () => {
    const w = new World({ players: 50, teams: 5, content: { theme: "space", legMinutes: 3, saboteur: true, legs: 2 } });
    const board = () => boardOf(model(screenView(w.s, w.env), w.env.now, w.env.now));
    expect(board()).toBe("lobby");
    expect(screenView(w.s, w.env).lobby?.crews).toHaveLength(5);
    w.ok("gather");
    expect(board()).toBe("crews");
    w.ok("start");
    expect(board()).toBe("launch");
    w.advance(LAUNCH_MS + 100);
    if (w.s.leg) w.s.leg.schedule = [];
    expect(board()).toBe("flight");
    w.ok("event", { kind: "pull" });
    expect(board()).toBe("flight");
    w.advance(WARN_MS + 200);
    expect(board()).toBe("pull");
    w.ok("event-end");
    w.ok("event", { kind: "sos" });
    w.advance(WARN_MS + 200);
    expect(board()).toBe("sos");
    expect(screenView(w.s, w.env).event?.seq?.length).toBe(4);
    w.ok("event-end");
    const leg = w.s.leg;
    if (leg) leg.flight = leg.duration;
    w.step();
    expect(board()).toBe("dock");
    // Тайн на экране нет: ни диверсантов, ни ложных приказов до раскрытия.
    expect(JSON.stringify(screenView(w.s, w.env))).not.toMatch(/saboteur|fake|mark/);
    if (w.s.leg?.saboteurs) {
      w.ok("vote");
      expect(board()).toBe("vote");
      w.ok("vote-end");
      expect(board()).toBe("reveal");
    }
    w.ok("podium");
    expect(board()).toBe("podium");
  });
});

describe("экран зала «Бубликатора»: аудит 2c", () => {
  const meteor = (warn: boolean, id = "e1") => ({ id, kind: "meteor" as const, warn, startsAt: 0, endsAt: 1, seq: null, task: null, crews: [] });

  it("№5: экран открыли на паузе — остаток по моменту паузы с сервера (дождь, пауза 60 с)", () => {
    // Дождь до 1 030 000; ведущий остановил игру в 1 010 000 (осталось 20 с); экран открыли через 60 с паузы.
    const v = view({ endsAt: 1_030_000, event: { ...meteor(false), endsAt: 1_030_000 }, pausedAt: 1_010_000 });
    const opened = applyScreen(emptyScreen(1_070_000), screenEvent(v, 1_070_000, true), 1_070_000);
    expect(opened.paused).toBe(true);
    expect(leftUntil(opened, 1_030_000, 1_070_000)).toBe(20_000);
    expect(leftUntil(opened, 1_030_000, 1_200_000)).toBe(20_000);
    // Обратная замена: без момента паузы в виде экран считал бы паузу «с сейчас» — осталось бы 0.
    const old = applyScreen(emptyScreen(1_070_000), screenEvent({ ...v, pausedAt: null }, 1_070_000, true), 1_070_000);
    expect(leftUntil(old, 1_030_000, 1_070_000)).toBe(0);
    // Продолжили — время снова идёт.
    const go = applyScreen(opened, screenEvent({ ...v, pausedAt: null, endsAt: 1_090_000 }, 1_071_000), 1_071_000);
    expect(go.paused).toBe(false);
    expect(leftUntil(go, 1_090_000, 1_071_000)).toBe(19_000);
  });

  it("№6: снимок (подписка, «Открыть здесь», переподключение, после «закрыто») — без моментов и рывков", () => {
    const before = view({ stage: "fly", crews: [crew(0, { salutes: 0, okSeq: 1 }), crew(1)] });
    const after = view({ stage: "dock", crews: [crew(0, { finished: true, salutes: 3, okSeq: 4 }), crew(1)] });
    const live = applyScreen(emptyScreen(0), screenEvent(before, 1000), 1000);
    expect(live.fresh).toBe(true);
    const step = applyScreen(live, screenEvent(after, 2000), 2000);
    expect(step.fresh).toBe(false);
    expect(momentsFor(before, step)).toMatchObject({ dock: true, finish: [0], salutes: [{ crew: 0, n: 3 }] });
    // Сервер пометил сводку снимком — ни аплодисментов, ни фанфар, ни салюта.
    const snap = applyScreen(live, { ...(screenEvent(after, 2000) as Extract<RoomStreamEvent, { type: "screen" }>), fresh: true }, 2000);
    expect(momentsFor(before, snap)).toMatchObject({ dock: false, finish: [], salutes: [] });
    expect(nextBumps(before, after, snap.fresh, {})).toEqual({});
    // После «закрыто» (вкладку вытеснили и вернули) — первая сводка тоже снимок.
    const closed = applyScreen(live, { type: "closed", at: 1500, reason: "replaced" }, 1500);
    expect(applyScreen(closed, screenEvent(after, 2000), 2000).fresh).toBe(true);
  });

  it("№7: рывки — только при росте okSeq / failSeq", () => {
    const a = view({ crews: [crew(0, { okSeq: 2, failSeq: 1 }), crew(1, { okSeq: 0 })] });
    const b = view({ crews: [crew(0, { okSeq: 3, failSeq: 1 }), crew(1, { okSeq: 0 })] });
    expect(nextBumps(a, b, false, {})).toEqual({ 0: { ok: 1, fail: 0 } });
    expect(nextBumps(b, b, false, { 0: { ok: 1, fail: 0 } })).toEqual({ 0: { ok: 1, fail: 0 } });
    const c = view({ crews: [crew(0, { okSeq: 3, failSeq: 2 }), crew(1, { okSeq: 0 })] });
    expect(nextBumps(b, c, false, { 0: { ok: 1, fail: 0 } })).toEqual({ 0: { ok: 1, fail: 1 } });
    expect(nextBumps(null, c, false, {})).toEqual({});
  });

  it("№1, №20: щит растёт от силы и не выходит за дорожку; у детей слабый щит без «беды»", () => {
    expect(shieldLook(0, false)).toEqual({ scale: 0.55, weak: true });
    expect(shieldLook(100, false)).toEqual({ scale: 1, weak: false });
    expect(shieldLook(150, false).scale).toBe(1);
    expect(shieldLook(49, false).weak).toBe(true);
    expect(shieldLook(49, true).weak).toBe(false);
    expect(shieldLook(30, false).scale).toBeLessThan(shieldLook(80, false).scale);
  });

  it("№3: длинное задание капитана — мельче, без кораблей; №16: одно место — одним числом", () => {
    expect(captainLayout("Найдите синий предмет", 5)).toEqual({ size: "short", ships: true, timer: "26cqh" });
    expect(captainLayout("а".repeat(70), 5)).toMatchObject({ size: "mid", ships: true });
    expect(captainLayout("а".repeat(70), 8).ships).toBe(false);
    expect(captainLayout("а".repeat(120), 3)).toEqual({ size: "long", ships: false, timer: "17cqh" });
    expect(placesText(9, 12)).toBe("места 9–12");
    expect(placesText(9, 9)).toBe("место 9");
    expect(placesText(undefined, 3)).toBe("");
  });

  it("№13: перерисовка — только на досках с отсчётом, на паузе — никогда", () => {
    expect(tickOf("sos", false, false)).toBe(100);
    expect(tickOf("flight", false, false)).toBe(500);
    expect(tickOf("reveal", true, false)).toBe(250);
    expect(tickOf("reveal", false, false)).toBeNull();
    for (const b of ["lobby", "crews", "dock", "podium", "over"] as const) expect(tickOf(b, false, false)).toBeNull();
    expect(tickOf("flight", false, true)).toBeNull();
  });

  it("№11: звуки по моментам — сирена, свист, гул, бип (склеенный), удар, лязг, фанфары финиша", () => {
    const fly = view({ ordersDone: 10 });
    const pick = (prev: ScreenView, next: ScreenView, at = 10_000, beepAt = -Infinity) => soundsOf(momentsOf(prev, next), false, at, beepAt).sounds;
    expect(pick(fly, view({ ordersDone: 10, event: meteor(true) }))).toEqual(["siren"]);
    expect(pick(view({ event: meteor(true) }), view({ event: meteor(false) }))).toEqual(["whistle"]);
    expect(pick(fly, view({ event: { ...meteor(false, "e2"), kind: "pull" } }))).toEqual(["hum"]);
    expect(pick(fly, view({ event: { ...meteor(false, "e3"), kind: "sos" } }))).toEqual(["gong"]);
    expect(pick(fly, fly)).toEqual([]);
    // Приказ: «бип», но не чаще раза в полсекунды на весь зал.
    expect(soundsOf(momentsOf(fly, view({ ordersDone: 12 })), false, 10_000, -Infinity)).toEqual({ sounds: ["beep"], beepAt: 10_000 });
    expect(soundsOf(momentsOf(fly, view({ ordersDone: 12 })), false, 10_000 + BEEP_EVERY_MS - 1, 10_000)).toEqual({ sounds: [], beepAt: 10_000 });
    expect(soundsOf(momentsOf(fly, view({ ordersDone: 12 })), false, 10_000 + BEEP_EVERY_MS, 10_000).sounds).toEqual(["beep"]);
    // Под громкий звук бип не добавляется.
    expect(pick(fly, view({ ordersDone: 12, event: meteor(true) }))).toEqual(["siren"]);
    // Новый перелёт (ordersDone с нуля) — не приказ.
    expect(pick(view({ ordersDone: 30, leg: 0 }), view({ ordersDone: 2, leg: 1 }))).toEqual([]);
    // Просрочка — удар, ремонт — лязг.
    expect(pick(view({ crews: [crew(0, { failSeq: 1 }), crew(1)] }), view({ crews: [crew(0, { failSeq: 2 }), crew(1)] }))).toEqual(["thud"]);
    expect(pick(view(), view({ crews: [crew(0, { repair: { until: 5, taps: 0, target: 10 } }), crew(1)] }))).toEqual(["clank"]);
    // Финиш — фанфары, не «динь».
    expect(pick(view(), view({ crews: [crew(0, { finished: true }), crew(1)] }))).toEqual(["fanfare"]);
    expect(pick(view({ stage: "fly" }), view({ stage: "dock" }))).toEqual(["applause"]);
    expect(pick(view({ crews: [crew(0), crew(1)] }), view({ crews: [crew(0, { salutes: 2 }), crew(1)] }))).toEqual(["pop"]);
    // Снимок — ни одного звука.
    expect(soundsOf(momentsOf(null, view({ event: meteor(true) })), false, 0, -Infinity).sounds).toEqual([]);
  });

  it("№11: тон огонька SOS — свой на цвет, только когда загорелся новый", () => {
    const seq = [2, 0, 3, 1];
    expect(sosToneOf(seq, 0, null)).toBe("sos2");
    expect(sosToneOf(seq, 0, 0)).toBeNull();
    expect(sosToneOf(seq, null, 0)).toBeNull();
    expect(sosToneOf(seq, 1, null)).toBe("sos0");
    expect(sosToneOf(seq, 2, 1)).toBe("sos3");
    expect(sosToneOf([9], 0, null)).toBeNull();
  });
});
