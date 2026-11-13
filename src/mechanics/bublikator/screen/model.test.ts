import { existsSync } from "node:fs";
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
  tidyName,
  FLIGHT_MUSIC,
  FLIGHT_MUSIC_FAST_MS,
  FLIGHT_MUSIC_FAST_RATE,
  flightMusicOf,
  LOUD_MS,
  METEOR_HIT_MS,
  meteorHitIndex,
  SOUND_CLOCK,
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
  SNAPSHOT_GAP_MS,
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
    expect(cardColumns(12)).toBe(6);
    expect(cardColumns(13)).toBe(7);
    expect(cardColumns(20)).toBe(7);
  });

  it("моменты: только то, что наступило при открытом экране", () => {
    const fly = view();
    expect(momentsOf(null, fly)).toEqual({ launch: false, event: false, eventKind: null, warn: false, orders: 0, fail: false, repair: false, hull: false, finish: [], salutes: [], dock: false, reveal: false, podium: false });
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

  it("№6: снимок (подписка, «Открыть здесь», переподключение после обрыва, опоздавшие сводки) — без моментов и рывков; опрос — с моментами", () => {
    const before = view({ stage: "fly", crews: [crew(0, { salutes: 0, okSeq: 1 }), crew(1)] });
    const after = view({ stage: "dock", crews: [crew(0, { finished: true, salutes: 3, okSeq: 4 }), crew(1)] });
    // Первая сводка — снимок.
    const live = applyScreen(emptyScreen(1000), screenEvent(before, 1000), 1000);
    expect(live.fresh).toBe(true);
    // Живой поток (через 0,2 с) — моменты есть.
    const step = applyScreen(live, screenEvent(after, 1200), 1200);
    expect(step.fresh).toBe(false);
    expect(momentsFor(before, step)).toMatchObject({ dock: true, finish: [0], salutes: [{ crew: 0, n: 3 }] });
    expect(nextBumps(before, after, step.fresh, {})).toEqual({ 0: { ok: 1, fail: 0 } });
    // Опрос раз в 2 с — тоже живой поток (второй круг аудита, №1: раньше каждая сводка опроса была снимком и экран молчал).
    const polled = applyScreen(live, screenEvent(after, 3000), 3000);
    expect(polled.fresh).toBe(false);
    expect(momentsFor(before, polled).dock).toBe(true);
    // Разрыв больше 3 с (переподключение после обрыва) — снимок: ни аплодисментов, ни фанфар, ни салюта.
    const gap = applyScreen(live, screenEvent(after, 1000 + SNAPSHOT_GAP_MS + 1), 1000 + SNAPSHOT_GAP_MS + 1);
    expect(gap.fresh).toBe(true);
    expect(momentsFor(before, gap)).toMatchObject({ dock: false, finish: [], salutes: [] });
    expect(nextBumps(before, after, gap.fresh, {})).toEqual({});
    // Сводки застряли и дошли пачкой (второй круг, №2): сводка на 0,5 с новее прошлой, но опоздала на 20 с — снимок.
    const stalled = applyScreen(live, screenEvent(after, 1500), 21_500);
    expect(stalled.fresh).toBe(true);
    expect(momentsFor(before, stalled)).toMatchObject({ dock: false, finish: [], salutes: [] });
    // Опоздала на 2 с — ещё живой поток.
    expect(applyScreen(live, screenEvent(after, 1500), 3500).fresh).toBe(false);
    // После «закрыто» (вкладку вытеснили и вернули) — первая сводка тоже снимок.
    const closed = applyScreen(live, { type: "closed", at: 1100, reason: "replaced" }, 1100);
    expect(applyScreen(closed, screenEvent(after, 1200), 1200).fresh).toBe(true);
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
    const pick = (prev: ScreenView, next: ScreenView, at = 10_000, clock = SOUND_CLOCK) => soundsOf(momentsOf(prev, next), false, at, clock).sounds;
    expect(pick(fly, view({ ordersDone: 10, event: meteor(true) }))).toEqual(["siren"]);
    expect(pick(view({ event: meteor(true) }), view({ event: meteor(false) }))).toEqual(["whistle"]);
    expect(pick(fly, view({ event: { ...meteor(false, "e2"), kind: "pull" } }))).toEqual(["hum"]);
    expect(pick(fly, view({ event: { ...meteor(false, "e3"), kind: "sos" } }))).toEqual(["gong"]);
    expect(pick(fly, fly)).toEqual([]);
    // Приказ: «бип», но не чаще раза в полсекунды на весь зал.
    const orders = momentsOf(fly, view({ ordersDone: 12 }));
    expect(soundsOf(orders, false, 10_000, SOUND_CLOCK)).toEqual({ sounds: ["beep"], clock: { beepAt: 10_000, loudUntil: -Infinity } });
    expect(soundsOf(orders, false, 10_000 + BEEP_EVERY_MS - 1, { beepAt: 10_000, loudUntil: -Infinity }).sounds).toEqual([]);
    expect(soundsOf(orders, false, 10_000 + BEEP_EVERY_MS, { beepAt: 10_000, loudUntil: -Infinity }).sounds).toEqual(["beep"]);
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
    expect(soundsOf(momentsOf(null, view({ event: meteor(true) })), false, 0, SOUND_CLOCK).sounds).toEqual([]);
  });

  it("№4 (второй круг): бип не звучит, пока не отзвучал громкий звук — по длительностям", () => {
    const fly = view({ ordersDone: 10 });
    const orders = momentsOf(fly, view({ ordersDone: 12 }));
    // Сирена в 10 с — до 12,3 с громко: бипы в 10,5, 11, 12 молчат, в 12,3 — звучит.
    const siren = soundsOf(momentsOf(fly, view({ ordersDone: 10, event: meteor(true) })), false, 10_000, SOUND_CLOCK);
    expect(siren.clock.loudUntil).toBe(10_000 + (LOUD_MS.siren ?? 0));
    for (const at of [10_500, 11_000, 12_000, 12_299]) expect(soundsOf(orders, false, at, siren.clock).sounds).toEqual([]);
    expect(soundsOf(orders, false, 12_300, siren.clock).sounds).toEqual(["beep"]);
    // Аплодисменты — 3,5 с; хлопок салюта — тихий, бип после него можно.
    const clap = soundsOf(momentsOf(view({ stage: "fly" }), view({ stage: "dock" })), false, 0, SOUND_CLOCK).clock;
    expect(clap.loudUntil).toBe(3500);
    const pop = soundsOf(momentsOf(view({ crews: [crew(0), crew(1)] }), view({ crews: [crew(0, { salutes: 2 }), crew(1)] })), false, 0, SOUND_CLOCK).clock;
    expect(soundsOf(orders, false, BEEP_EVERY_MS, pop).sounds).toEqual(["beep"]);
  });

  it("№5 (второй круг): удары метеорита о щит во время дождя и удар о корпус", () => {
    const rain = { ...meteor(false), startsAt: 10_000, endsAt: 20_000 };
    expect(meteorHitIndex(rain, 9_999)).toBeNull();
    expect(meteorHitIndex(rain, 10_000)).toBe(0);
    expect(meteorHitIndex(rain, 10_000 + METEOR_HIT_MS)).toBe(1);
    expect(meteorHitIndex(rain, 20_000)).toBeNull();
    expect(meteorHitIndex({ ...rain, warn: true }, 12_000)).toBeNull();
    expect(meteorHitIndex({ ...rain, kind: "pull" }, 12_000)).toBeNull();
    expect(meteorHitIndex(null, 12_000)).toBeNull();
    // Прочность убавилась (метеорит пробил слабый щит) — тихий удар; вместе с просрочкой — только удар просрочки.
    const pick = (prev: ScreenView, next: ScreenView) => soundsOf(momentsOf(prev, next), false, 0, SOUND_CLOCK).sounds;
    const rainOn = { event: rain };
    expect(pick(view({ ...rainOn, crews: [crew(0, { hull: 5 }), crew(1)] }), view({ crews: [crew(0, { hull: 4 }), crew(1)] }))).toEqual(["hit"]);
    expect(pick(view({ event: { ...rain, kind: "pull" }, crews: [crew(0, { hull: 5 }), crew(1)] }), view({ crews: [crew(0, { hull: 4 }), crew(1)] }))).toEqual(["hit"]);
    // Без события (выполненный ложный приказ) — не удар метеорита.
    expect(pick(view({ crews: [crew(0, { hull: 5 }), crew(1)] }), view({ crews: [crew(0, { hull: 4 }), crew(1)] }))).toEqual([]);
    expect(pick(view({ ...rainOn, crews: [crew(0, { hull: 5, failSeq: 1 }), crew(1)] }), view({ crews: [crew(0, { hull: 4, failSeq: 2 }), crew(1)] }))).toEqual(["thud"]);
    expect(pick(view({ ...rainOn, crews: [crew(0, { hull: 2 }), crew(1)] }), view({ crews: [crew(0, { hull: 5 }), crew(1)] }))).toEqual([]);
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

  it("№3 (второй круг): музыка полёта — только в полёте, на паузе нет, в последние 30 с быстрее, у каждой темы своя", () => {
    const at = 1_000_000;
    const fly = (over: Partial<ScreenView> = {}) => model(view({ stage: "fly", ...over }), at, at);
    // Полёт — играет, 2 минуты до конца — обычный темп.
    expect(flightMusicOf(fly(), at)).toEqual({ url: FLIGHT_MUSIC.newyear, rate: 1 });
    // Последние 30 с — быстрее.
    const late = fly({ flight: { elapsed: 180_000 - FLIGHT_MUSIC_FAST_MS, duration: 180_000, stopped: false } });
    expect(flightMusicOf(late, at)?.rate).toBe(FLIGHT_MUSIC_FAST_RATE);
    expect(flightMusicOf(fly({ flight: { elapsed: 180_000 - FLIGHT_MUSIC_FAST_MS - 1000, duration: 180_000, stopped: false } }), at)?.rate).toBe(1);
    // Событие в полёте — музыка идёт.
    expect(flightMusicOf(fly({ event: meteor(false) }), at)).not.toBeNull();
    // Не в полёте — тишина.
    for (const over of [{ phase: "lobby" as const, stage: null }, { phase: "crews" as const, stage: null }, { phase: "drill" as const, stage: null }, { stage: "launch" as const }, { stage: "dock" as const }, { stage: "vote" as const }, { stage: "voted" as const }, { phase: "podium" as const, stage: null }]) {
      expect(flightMusicOf(model(view(over), at, at), at)).toBeNull();
    }
    // Пауза комнаты — встаёт.
    expect(flightMusicOf(applyScreen(fly(), { type: "room", at, paused: true }, at), at)).toBeNull();
    // Закрыто (другая вкладка) — тишина.
    expect(flightMusicOf({ ...fly(), closed: "replaced" }, at)).toBeNull();
    // Своя у каждой темы, файлы на месте.
    const themes = ["space", "pirates", "submarine", "wedding", "newyear"] as const;
    expect(new Set(themes.map((t) => flightMusicOf(fly({ theme: t }), at)?.url)).size).toBe(5);
    for (const t of themes) expect(existsSync(new URL(`../../../../public${FLIGHT_MUSIC[t]}`, import.meta.url))).toBe(true);
  });

  it("№7 (второй круг): смайлик не отрывается от названия — неразрывный пробел", () => {
    expect(tidyName("🐻 Медведи из соседнего подъезда")).toBe("🐻\u00A0Медведи из соседнего подъезда");
    expect(tidyName("⚡️ Молнии")).toBe("⚡️\u00A0Молнии");
    expect(tidyName("👩‍🚀 Космос")).toBe("👩‍🚀\u00A0Космос");
    expect(tidyName("Лисы 11")).toBe("Лисы 11");
    expect(tidyName("🦊Лисы")).toBe("🦊Лисы");
  });
});
