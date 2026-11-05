/**
 * Правила «Бубликатора» (docs/bublikator.md, таблица «действие → тест»): каждое правило и каждая команда пульта, туда и
 * обратно. Комната — понарошку (`world.test-kit.ts`), время двигаем сами.
 */
import { describe, expect, it } from "vitest";
import {
  DRILL_MS,
  EVENT_EDGE_END_MS,
  EVENT_EDGE_START_MS,
  EVENT_GAP_MS,
  HULL_AFTER_REPAIR,
  HULL_MAX,
  LAUNCH_MS,
  METEOR_BONUS,
  PULL_DRIFT_PER_S,
  REPAIR_MIN_MS,
  REPAIR_MS,
  SOS_BLOCK_MS,
  SOS_BONUS,
  VOTE_BONUS,
  VOTE_MS,
  WARN_MS,
  WRONG_STOP_MS,
} from "./constants";
import { defaultTasks, parseContent } from "./content";
import { crewCountFor, crewMembers, crewPlayers } from "./crews";
import { chooseControl, crewTotal, impulse, orderDamage, orderSeconds, places, restore, resume, scheduleEvents, snapshot, tallyVote } from "./game";
import { CREW_NAMES, distance, ENDINGS, isBlocked, joinName, KIDS_ITEMS, nameCandidates, ROOTS, rootClashes, THEME_ROOTS } from "./names";
import { cleanState, controlsPerPlayer, dealPanels, orderText, randomTarget, STATES } from "./panels";
import type { Control, Crew, Member } from "./types";
import { hostView, personalView, screenView } from "./views";
import { hashRandom, World } from "./world.test-kit";

const NOEV = { events: { meteor: false, pull: false, sos: false, captain: false } };
const ALL_ON = { events: { meteor: true, pull: true, sos: true, captain: true } };

function seq(seed: string): () => number {
  let n = 0;
  return () => hashRandom(`${seed}:${n++}`);
}

function crewOf(w: World, pid: string): Crew {
  const c = w.s.crews.find((x) => x.id === w.member(pid).crew);
  if (!c) throw new Error(`нет экипажа у ${pid}`);
  return c;
}

/** Игрок с активным приказом на прибор нужного вида (кнопка или «положенческий»). */
function orderWith(w: World, button: boolean): { m: Member; ctl: Control } {
  for (const m of Object.values(w.s.members)) {
    const o = m.order;
    const ctl = o ? w.s.controls[o.control] : undefined;
    if (o && ctl && (ctl.type === "button") === button) return { m, ctl };
  }
  throw new Error("нет подходящего приказа");
}

/** Довести перелёт до конца времени (без ожидания минут). */
function endFlight(w: World): void {
  if (w.s.leg?.stage === "launch") w.advance(LAUNCH_MS);
  const leg = w.s.leg;
  if (!leg) throw new Error("нет перелёта");
  leg.event = null;
  leg.schedule = [];
  leg.flight = leg.duration;
  w.step();
}

/** Ручное событие: предупреждение 3 с и начало. */
function startEvent(w: World, kind: string, extra: Record<string, unknown> = {}): string {
  const out = w.cmd("event", { kind, ...extra });
  if (!out.ok) throw new Error(`событие: ${out.error}`);
  w.advance(WARN_MS + 100);
  const ev = w.s.leg?.event;
  if (!ev?.started) throw new Error("событие не началось");
  return ev.id;
}

// ===================================================================== содержимое и названия

describe("содержимое игры", () => {
  it("значения по умолчанию из ТЗ; непонятное — по умолчанию; в детской сложности диверсанта нет", () => {
    const c = parseContent(undefined);
    expect(c.theme).toBe("space");
    expect(c.difficulty).toBe("normal");
    expect(c.legs).toBe(3);
    expect(c.legMinutes).toBe(4);
    expect(c.events).toEqual({ meteor: true, pull: true, sos: true, captain: true });
    expect(c.captainTasks).toHaveLength(10);
    expect(c.saboteur).toBe(false);
    expect(c.crewSize).toEqual({ min: 3, max: 10 });
    expect(parseContent({ legs: 2, legMinutes: 9, theme: "?", saboteur: true }).legMinutes).toBe(5);
    expect(parseContent({ legs: 2 }).legs).toBe(2);
    expect(parseContent({ saboteur: true }).saboteur).toBe(true);
    expect(parseContent({ saboteur: true, difficulty: "kids" }).saboteur).toBe(false);
    expect(parseContent({ events: { sos: false } }).events.sos).toBe(false);
    expect(parseContent({ captainTasks: ["  Спойте\u0007  гимн  "] }).captainTasks).toEqual(["Спойте гимн"]);
    expect(defaultTasks("newyear")).toContain("Изобразите оленью упряжку!");
  });
});

describe("генератор названий приборов", () => {
  it("40 корней и 12 окончаний; Бублико + атор = Бубликатор, Чихо + метр = Чихометр", () => {
    expect(ROOTS).toHaveLength(40);
    expect(ENDINGS).toHaveLength(12);
    expect(joinName("Бублико", "атор")).toBe("Бубликатор");
    expect(joinName("Бублико", "атрон")).toBe("Бубликатрон");
    expect(joinName("Чихо", "метр")).toBe("Чихометр");
  });
  it("стоп-лист: грубое не выдаётся, ни одно сочетание темы его не содержит", () => {
    expect(isBlocked("Хуеметр")).toBe(true);
    expect(isBlocked("Жопотрон")).toBe(true);
    expect(isBlocked("Чмокофон")).toBe(true);
    expect(isBlocked("Хрюкодуй")).toBe(true);
    expect(isBlocked("Бубликатор")).toBe(false);
    for (const theme of ["space", "pirates", "newyear", "submarine", "wedding"] as const) {
      const all = nameCandidates(theme, [], seq(theme));
      expect(all.length).toBeGreaterThan(400);
      expect(all.filter((c) => isBlocked(c.name))).toEqual([]);
      expect(new Set(all.map((c) => c.name.toLowerCase())).size).toBe(all.length);
      // Корни темы идут первыми.
      if (THEME_ROOTS[theme].length > 0) expect(THEME_ROOTS[theme]).toContain(all[0]?.root);
    }
  });
  it("названия не повторяют корни экипажей: у «Снежинки» нет «Снежкомёта»", () => {
    expect(rootClashes("Снежко", ["Снежинка"])).toBe(true);
    expect(rootClashes("Бублико", ["Снежинка"])).toBe(false);
    const names = nameCandidates("newyear", ["Снежинка", "Леденец"], seq("x")).map((c) => c.name);
    expect(names.some((n) => n.startsWith("Снежк"))).toBe(false);
    expect(names.some((n) => n.startsWith("Леденц"))).toBe(false);
  });
  it("расстояние между названиями — по буквам без регистра", () => {
    expect(distance("Бубликатор", "Бубликатрон")).toBe(2);
    expect(distance("Бубликотор", "Бубликофон")).toBe(2);
    expect(distance("Бубликотор", "Бубликомёт")).toBe(3);
    expect(distance("Ёжик", "ежик")).toBe(0);
  });
  it("у каждой темы 20 названий экипажей", () => {
    for (const list of Object.values(CREW_NAMES)) expect(new Set(list).size).toBe(20);
  });
});

// ===================================================================== раздача приборов

function deal(opts: { legNo: number; crews: number; per: number; difficulty?: "kids" | "normal" | "crazy"; drill?: boolean; seed?: string }) {
  let id = 0;
  const crews = Array.from({ length: opts.crews }, (_, c) => ({ id: c, players: Array.from({ length: opts.per }, (_, i) => `c${c}p${i}`) }));
  return dealPanels({
    theme: "newyear",
    difficulty: opts.difficulty ?? "normal",
    legNo: opts.legNo,
    drill: opts.drill ?? false,
    crews,
    crewNames: crews.map((c) => CREW_NAMES.newyear[c.id] ?? ""),
    customNames: [],
    rand: seq(opts.seed ?? "deal"),
    nextId: () => `k${id++}`,
  });
}

describe("раздача приборов", () => {
  it("перелёты 1–2: у каждого 3 прибора разных типов, названия уникальны на весь зал и в экипаже отличаются на 3 буквы", () => {
    for (const legNo of [0, 1]) {
      const r = deal({ legNo, crews: 6, per: 8 });
      expect(r.relaxed).toBe(false);
      expect(new Set(r.controls.map((c) => c.name.toLowerCase())).size).toBe(r.controls.length);
      for (const [pid, ids] of Object.entries(r.panels)) {
        expect(ids).toHaveLength(3);
        const types = ids.map((id) => r.controls.find((c) => c.id === id)?.type);
        expect(new Set(types).size).toBe(3);
        expect(pid).toMatch(/^c\dp\d$/);
      }
      for (let c = 0; c < 6; c += 1) {
        const names = r.controls.filter((x) => x.crew === c).map((x) => x.name);
        for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) expect(distance(names[i] ?? "", names[j] ?? "")).toBeGreaterThanOrEqual(3);
      }
      for (const ctl of r.controls) {
        expect(isBlocked(ctl.name)).toBe(false);
        expect(rootClashes(ctl.name, [CREW_NAMES.newyear[ctl.crew] ?? ""])).toBe(false);
        if (STATES[ctl.type] > 0) expect(ctl.state).toBeLessThan(STATES[ctl.type]);
      }
    }
  });
  it("перелёт 3: 4 прибора, у каждого пара-близнец (тот же корень, отличие ≤ 2 буквы), остальные — на 3 буквы", () => {
    const r = deal({ legNo: 2, crews: 4, per: 6 });
    for (const ids of Object.values(r.panels)) {
      expect(ids).toHaveLength(4);
      const names = ids.map((id) => r.controls.find((c) => c.id === id)?.name ?? "");
      const close: Array<[string, string]> = [];
      for (let i = 0; i < 4; i += 1) for (let j = i + 1; j < 4; j += 1) if (distance(names[i] ?? "", names[j] ?? "") < 3) close.push([names[i] ?? "", names[j] ?? ""]);
      expect(close).toHaveLength(1);
      expect(distance(close[0]?.[0] ?? "", close[0]?.[1] ?? "")).toBeLessThanOrEqual(2);
    }
    expect(new Set(r.controls.map((c) => c.name.toLowerCase())).size).toBe(r.controls.length);
    // Тренировка — без близнецов.
    const drill = deal({ legNo: 2, crews: 2, per: 4, drill: true });
    for (const ids of Object.values(drill.panels)) expect(ids).toHaveLength(4);
  });
  it("детская сложность: кнопка, тумблер, рычаг с картинками; без близнецов; 2 прибора, если в экипаже больше 6", () => {
    const r = deal({ legNo: 2, crews: 3, per: 6, difficulty: "kids" });
    for (const ids of Object.values(r.panels)) expect(ids).toHaveLength(3);
    for (const c of r.controls) {
      expect(["button", "toggle", "lever"]).toContain(c.type);
      expect(KIDS_ITEMS.some((k) => k.name === c.name && k.icon === c.icon && k.acc === c.acc)).toBe(true);
    }
    for (let c = 0; c < 3; c += 1) {
      const names = r.controls.filter((x) => x.crew === c).map((x) => x.name);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(controlsPerPlayer("kids", 0, 7)).toBe(2);
    expect(controlsPerPlayer("kids", 2, 6)).toBe(3);
    const big = deal({ legNo: 0, crews: 1, per: 10, difficulty: "kids" });
    expect(new Set(big.controls.map((c) => c.name)).size).toBe(20);
  });
  it("зал на 200 человек: сочетаний не хватает на весь зал — уникальны хотя бы в экипаже", () => {
    const r = deal({ legNo: 2, crews: 20, per: 10 });
    expect(r.controls).toHaveLength(800);
    for (let c = 0; c < 20; c += 1) {
      const names = r.controls.filter((x) => x.crew === c).map((x) => x.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
  });
  it("цель приказа всегда отличается от текущего положения; у кнопки — «нажать»", () => {
    const rand = seq("t");
    for (const type of ["toggle", "slider", "lever", "dial"] as const) {
      for (let state = 0; state < STATES[type]; state += 1) for (let i = 0; i < 30; i += 1) {
        const t = randomTarget({ type, state }, rand);
        expect(t).not.toBe(state);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(STATES[type]);
      }
    }
    expect(randomTarget({ type: "button", state: 4 }, rand)).toBe(-1);
  });
  it("тексты приказов по шаблонам типа; детские — с винительным падежом", () => {
    expect(orderText({ type: "button", name: "Кукарекатор" }, -1, false)).toBe("Жми Кукарекатор!");
    expect(orderText({ type: "toggle", name: "Бубликатор" }, 1, false)).toBe("Включите Бубликатор!");
    expect(orderText({ type: "toggle", name: "Бубликатор" }, 0, false)).toBe("Выключите Бубликатор!");
    expect(orderText({ type: "slider", name: "Чихометр" }, 3, false)).toBe("Чихометр на три!");
    expect(orderText({ type: "lever", name: "Мурлыкатель" }, 2, false)).toBe("Мурлыкатель — вниз!");
    expect(orderText({ type: "lever", name: "Мурлыкатель" }, 1, false)).toBe("Мурлыкатель — в середину!");
    expect(orderText({ type: "dial", name: "Ветродуй" }, 3, false)).toBe("Ветродуй на синий!");
    expect(orderText({ type: "button", name: "Лягушка", acc: "лягушку" }, -1, true)).toBe("Нажми лягушку!");
    expect(orderText({ type: "toggle", name: "Банан", acc: "банан" }, 1, true)).toBe("Включи банан!");
    expect(orderText({ type: "lever", name: "Ракета", acc: "ракету" }, 0, true)).toBe("Ракету — вверх!");
    expect(cleanState("slider", 6)).toBeNull();
    expect(cleanState("dial", 3)).toBe(3);
    expect(cleanState("toggle", 0.5)).toBeNull();
  });
});

// ===================================================================== экипажи

describe("экипажи", () => {
  it("сколько экипажей: ceil(N / 7), от 2 до 20, не меньше min в каждом", () => {
    expect(crewCountFor(2, 3)).toBe(1);
    expect(crewCountFor(5, 3)).toBe(1);
    expect(crewCountFor(6, 3)).toBe(2);
    expect(crewCountFor(14, 3)).toBe(2);
    expect(crewCountFor(15, 3)).toBe(3);
    expect(crewCountFor(35, 3)).toBe(5);
    expect(crewCountFor(84, 3)).toBe(12);
    expect(crewCountFor(500, 3)).toBe(20);
  });
  it("лобби: выбор экипажа, полный экипаж не пускает; «Собрать экипажи» — выбранные остаются, остальные в самые маленькие", () => {
    const w = new World({ players: 14, content: { crewSize: { min: 3, max: 5 } } });
    for (let i = 0; i < 5; i += 1) w.send(`p${i}`, [{ t: "crew", crew: 1 }]);
    w.send("p5", [{ t: "crew", crew: 1 }]);
    expect(w.member("p5").crew).toBeNull();
    expect(w.env.sent.some((x) => x.pid === "p5" && x.data.t === "full")).toBe(true);
    w.send("p5", [{ t: "crew", crew: 0 }]);
    w.send("p6", [{ t: "crew", crew: 99 }]);
    expect(w.member("p6").crew).toBeNull();
    w.ok("gather");
    expect(w.s.phase).toBe("crews");
    for (let i = 0; i < 5; i += 1) expect(w.member(`p${i}`).crew).toBe(1);
    expect(w.member("p5").crew).toBe(0);
    const sizes = w.s.crews.map((c) => crewMembers(w.s, c.id).length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(14);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(5);
    expect(w.cmd("gather")).toEqual({ ok: false, error: "wrong-phase" });
  });
  it("5 и 12 экипажей: до 5 — только цвет, дальше пара «цвет + значок» не повторяется", () => {
    const five = new World({ players: 35 });
    five.ok("gather");
    expect(five.s.crews).toHaveLength(5);
    expect(five.s.crews.every((c) => c.icon === null)).toBe(true);
    expect(new Set(five.s.crews.map((c) => c.color)).size).toBe(5);
    const twelve = new World({ players: 84 });
    twelve.ok("gather");
    expect(twelve.s.crews).toHaveLength(12);
    expect(new Set(twelve.s.crews.map((c) => `${c.color}:${c.icon}`)).size).toBe(12);
    expect(twelve.s.crews.every((c) => c.icon !== null)).toBe(true);
    expect(twelve.s.crews.every((c) => crewMembers(twelve.s, c.id).length === 7)).toBe(true);
  });
  it("больше 10 в экипаже — дублёры: тот же пульт, двигать прибор может любой из двоих, приказов дублёр не получает", () => {
    const w = new World({ players: 12, content: { ...NOEV } });
    w.ok("gather");
    const [a, b] = w.s.crews;
    if (!a || !b) throw new Error("два экипажа");
    expect(w.cmd("merge", { from: b.id, to: a.id })).toEqual({ ok: true });
    expect(crewPlayers(w.s, a.id)).toHaveLength(10);
    const doubles = crewMembers(w.s, a.id).filter((m) => m.role === "double");
    expect(doubles).toHaveLength(2);
    expect(new Set(doubles.map((d) => d.doubleOf)).size).toBe(2);
    w.ok("start");
    w.advance(LAUNCH_MS + 1500);
    const d = doubles[0];
    if (!d?.doubleOf) throw new Error("дублёр");
    expect(d.order).toBeNull();
    expect(d.panel).toEqual([]);
    const me = personalView(w.s, d.pid, w.env);
    expect(me?.panel.map((p) => p.id)).toEqual(w.member(d.doubleOf).panel);
    expect(me?.me.doubleOf).toBe(w.member(d.doubleOf).name);
    // Дублёр двигает прибор своего игрока — принято; чужой — нет.
    const own = w.s.controls[w.member(d.doubleOf).panel[0] ?? ""];
    const foreign = Object.values(w.s.controls).find((c) => c.owner !== d.doubleOf);
    if (!own || !foreign) throw new Error("приборы");
    const want = own.type === "button" ? 0 : (own.state + 1) % STATES[own.type];
    const before = own.state;
    w.send(d.pid, [{ t: "move", c: own.id, s: want }]);
    expect(own.state).not.toBe(before);
    expect(own.by).toBe(d.pid);
    const fBefore = foreign.state;
    w.send(d.pid, [{ t: "move", c: foreign.id, s: foreign.type === "button" ? 0 : (foreign.state + 1) % STATES[foreign.type] }]);
    expect(foreign.state).toBe(fBefore);
    w.advance(20_000);
    expect(doubles.every((x) => x.order === null)).toBe(true);
  });
  it("два дублёра двинули прибор почти одновременно — побеждает более позднее по часам сервера", () => {
    const w = new World({ players: 12, content: { ...NOEV, crewSize: { min: 3, max: 5 } } });
    w.ok("gather");
    const a = w.s.crews[0];
    if (!a) throw new Error("экипаж");
    // Сажаем лишних в первый экипаж: два дублёра одного игрока.
    const owner = crewPlayers(w.s, a.id)[0];
    if (!owner) throw new Error("игрок");
    w.ok("start");
    w.advance(LAUNCH_MS + 200);
    w.addPlayer("late1");
    w.addPlayer("late2");
    const l1 = w.member("late1");
    const l2 = w.member("late2");
    l1.crew = a.id;
    l1.doubleOf = owner.pid;
    l2.crew = a.id;
    l2.doubleOf = owner.pid;
    const ctl = Object.values(w.s.controls).find((c) => c.owner === owner.pid && c.type === "slider") ?? Object.values(w.s.controls).find((c) => c.owner === owner.pid && c.type !== "button");
    if (!ctl) throw new Error("прибор");
    const n = STATES[ctl.type];
    const s1 = (ctl.state + 1) % n;
    const s2 = (ctl.state + 2) % n === ctl.state ? s1 : (ctl.state + 2) % n;
    w.send("late2", [{ t: "move", c: ctl.id, s: s2 }], { ago: 100 });
    w.send("late1", [{ t: "move", c: ctl.id, s: s1 }], { ago: 300 });
    // Движение late1 было раньше — не перебивает позднее.
    expect(ctl.state).toBe(s2);
    expect(ctl.by).toBe("late2");
  });
  it("опоздавший посреди перелёта — дублёр в самом маленьком экипаже, полноценно — со следующего перелёта", () => {
    const w = new World({ players: 13, content: { ...NOEV, legs: 2 } });
    w.ok("gather");
    w.ok("start");
    w.advance(LAUNCH_MS + 500);
    const small = [...w.s.crews].sort((x, y) => crewMembers(w.s, x.id).length - crewMembers(w.s, y.id).length)[0];
    w.addPlayer("late");
    const late = w.member("late");
    expect(late.crew).toBe(small?.id ?? -1);
    expect(late.role).toBe("double");
    expect(late.pending).toBe(true);
    expect(late.doubleOf).not.toBeNull();
    expect(personalView(w.s, "late", w.env)?.me.pending).toBe(true);
    w.advance(2000);
    expect(late.order).toBeNull();
    endFlight(w);
    w.ok("next");
    expect(late.role).toBe("player");
    expect(late.panel).toHaveLength(3);
    expect(late.pending).toBe(false);
  });
  it("до сбора — гость выбирает; после сбора, до перелёта — сразу игрок своего экипажа", () => {
    const w = new World({ players: 6 });
    w.ok("gather");
    w.addPlayer("x");
    expect(w.member("x").role).toBe("player");
    expect(w.member("x").pending).toBe(false);
  });
  it("экипаж из 1–2 человек: n в формулах не меньше 3, пульт предлагает объединить", () => {
    const w = new World({ players: 4, content: { ...NOEV, crewSize: { min: 1, max: 10 } } });
    w.ok("gather");
    expect(w.s.crews).toHaveLength(2);
    expect(hostView(w.s, w.env).crews.every((c) => c.small)).toBe(true);
    const a = w.s.crews[0];
    if (!a) throw new Error("экипаж");
    expect(orderDamage(2)).toBeCloseTo(4 / 3, 6);
    expect(impulse(4, 1)).toBeCloseTo(1000 / (30 * 3), 6);
    w.ok("merge", { from: w.s.crews[1]?.id, to: a.id });
    expect(crewPlayers(w.s, a.id)).toHaveLength(4);
    expect(hostView(w.s, w.env).crews).toHaveLength(1);
  });
  it("пульт: пересадить в лобби, на «Экипажах» и между перелётами; посреди полёта — нельзя", () => {
    const w = new World({ players: 8, content: NOEV });
    w.ok("move", { pid: "p0", crew: 1 });
    expect(w.member("p0").crew).toBe(1);
    w.ok("gather");
    const target = w.s.crews.find((c) => c.id !== w.member("p1").crew);
    w.ok("move", { pid: "p1", crew: target?.id });
    expect(w.member("p1").crew).toBe(target?.id ?? -1);
    w.ok("start");
    expect(w.cmd("move", { pid: "p1", crew: w.s.crews[0]?.id })).toEqual({ ok: false, error: "busy" });
    expect(w.cmd("merge", { from: 0, to: 1 })).toEqual({ ok: false, error: "busy" });
    endFlight(w);
    w.ok("move", { pid: "p1", crew: w.s.crews[0]?.id });
    expect(w.cmd("move", { pid: "nobody", crew: 0 })).toEqual({ ok: false, error: "not-found" });
  });
});

// ===================================================================== приказы

describe("приказы", () => {
  it("80% приказов — про чужой прибор, 20% — свой (10 000 выдач, ±2%); только что использованный не повторяется", () => {
    const own: Control[] = Array.from({ length: 3 }, (_, i) => ({ id: `own${i}`, crew: 0, owner: "me", name: "", type: "toggle", state: 0, movedAt: -1, by: null, lastOrder: -1 }));
    const foreign: Control[] = Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, crew: 0, owner: `o${i % 3}`, name: "", type: "toggle", state: 0, movedAt: -1, by: null, lastOrder: -1 }));
    const rand = seq("8020");
    let mine = 0;
    let last: string | null = null;
    for (let i = 0; i < 10_000; i += 1) {
      const c = chooseControl([...own, ...foreign], "me", last, rand);
      if (!c) throw new Error("пусто");
      expect(c.id).not.toBe(last);
      if (c.owner === "me") mine += 1;
      last = c.id;
    }
    expect(mine / 10_000).toBeGreaterThan(0.18);
    expect(mine / 10_000).toBeLessThan(0.22);
    // Чужих нет — свой; кандидат один — даже прошлый.
    expect(chooseControl(own, "me", null, rand)?.owner).toBe("me");
    expect(chooseControl([foreign[0] as Control], "me", "f0", rand)?.id).toBe("f0");
    expect(chooseControl([], "me", null, rand)).toBeNull();
  });
  it("предпочтение приборам, о которых давно не было приказа", () => {
    const list: Control[] = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, crew: 0, owner: "o", name: "", type: "toggle", state: 0, movedAt: -1, by: null, lastOrder: i * 1000 }));
    const rand = seq("old");
    for (let i = 0; i < 200; i += 1) {
      const c = chooseControl(list, "me", null, rand);
      expect(Number(c?.id.slice(1))).toBeLessThan(5);
    }
  });
  it("у каждого на связи — ровно один приказ; приказ всегда выполним; двух приказов на один прибор в экипаже нет", () => {
    const w = new World({ players: 21, content: NOEV });
    w.toFlight();
    const seen = new Set<string>();
    w.advance(60_000, 100, () => {
      for (const c of w.s.crews) {
        const orders = crewPlayers(w.s, c.id).map((m) => m.order).filter((o) => o !== null);
        expect(new Set(orders.map((o) => o?.control)).size).toBe(orders.length);
      }
      for (const m of Object.values(w.s.members)) {
        const o = m.order;
        if (!o || seen.has(o.id)) continue;
        seen.add(o.id);
        const ctl = w.s.controls[o.control];
        expect(ctl).toBeDefined();
        expect(ctl?.crew).toBe(m.crew);
        if (ctl && ctl.type !== "button") expect(o.target).not.toBe(ctl.state);
        expect(w.env.onlineSet.has(ctl?.owner ?? "")).toBe(true);
      }
      // Иногда кто-то выполняет — приборы движутся.
      const any = Object.values(w.s.members).find((m) => m.order && (w.env.now / 100) % 7 === 0);
      if (any) w.fulfil(any.pid);
    });
    expect(seen.size).toBeGreaterThan(100);
  });
  it("выполнение: прибор простоял в нужном положении 0,7 с — импульс, «✓» получателю и тому, кто двигал", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.advance(1100);
    const { m, ctl } = orderWith(w, false);
    const crew = crewOf(w, m.pid);
    const id = m.order?.id;
    w.send(ctl.owner, [{ t: "move", c: ctl.id, s: m.order?.target }]);
    w.advance(600);
    expect(m.order?.id).toBe(id);
    w.advance(200);
    expect(m.order?.id).not.toBe(id);
    expect(crew.done).toBe(1);
    expect(crew.dist).toBeCloseTo(impulse(4, crewPlayers(w.s, crew.id).length), 6);
    expect(w.env.sent.some((x) => x.pid === m.pid && x.data.t === "done" && x.data.order === id)).toBe(true);
    if (ctl.owner !== m.pid) expect(w.env.sent.some((x) => x.pid === ctl.owner && x.data.t === "done" && x.data.helped === true)).toBe(true);
    expect(m.done).toBe(1);
    expect(w.member(ctl.owner).moved).toBe(1);
    // Новый приказ — через 0,5 с.
    expect(m.order).toBeNull();
    w.advance(600);
    expect(m.order).not.toBeNull();
  });
  it("«через цель» не считается: прошёл нужное положение, не остановившись на 0,7 с", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.advance(1100);
    const { m, ctl } = orderWith(w, false);
    const id = m.order?.id;
    const target = m.order?.target ?? 0;
    w.send(ctl.owner, [{ t: "move", c: ctl.id, s: target }]);
    w.advance(300);
    const away = (target + 1) % STATES[ctl.type];
    w.send(ctl.owner, [{ t: "move", c: ctl.id, s: away }]);
    w.advance(1500);
    expect(m.order?.id).toBe(id);
    expect(crewOf(w, m.pid).done).toBe(0);
  });
  it("повтор того же положения (пачка ушла дважды) — не движение: удержание не сбрасывается", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.advance(1100);
    const { m, ctl } = orderWith(w, false);
    const id = m.order?.id;
    const target = m.order?.target ?? 0;
    w.send(ctl.owner, [{ t: "move", c: ctl.id, s: target }]);
    w.advance(400);
    const movedAt = w.s.controls[ctl.id]?.movedAt;
    w.send(ctl.owner, [{ t: "move", c: ctl.id, s: target }]);
    expect(w.s.controls[ctl.id]?.movedAt).toBe(movedAt);
    w.advance(400);
    expect(m.order?.id).not.toBe(id);
    expect(crewOf(w, m.pid).done).toBe(1);
  });
  it("кнопка: нажата после выдачи — выполнено", () => {
    let w = new World({ players: 9, content: NOEV, seed: "btn" });
    for (let i = 0; i < 20; i += 1) {
      w = new World({ players: 9, content: NOEV, seed: `btn${i}` });
      w.toFlight();
      w.advance(1100);
      if (Object.values(w.s.members).some((m) => m.order && w.s.controls[m.order.control]?.type === "button")) break;
    }
    const { m, ctl } = orderWith(w, true);
    const id = m.order?.id;
    w.send(ctl.owner, [{ t: "move", c: ctl.id }]);
    w.step();
    expect(m.order?.id).not.toBe(id);
    expect(crewOf(w, m.pid).done).toBe(1);
  });
  it("остановился в неверном положении — у приказа сгорает 2 секунды (один раз за остановку)", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.advance(1100);
    const { m, ctl } = orderWith(w, false);
    const due = m.order?.due ?? 0;
    const target = m.order?.target ?? 0;
    const wrong = [...Array(STATES[ctl.type]).keys()].find((v) => v !== target && v !== ctl.state) ?? ctl.state;
    if (wrong === ctl.state) return; // у тумблера неверное положение — только текущее
    w.send(ctl.owner, [{ t: "move", c: ctl.id, s: wrong }]);
    w.advance(500);
    expect(m.order?.due).toBe(due);
    w.advance(300);
    expect(m.order?.due).toBe(due - WRONG_STOP_MS);
    w.advance(1000);
    expect(m.order?.due).toBe(due - WRONG_STOP_MS);
  });
  it("просрочка: прочность −4 ÷ n, «Не успели!»; на тренировке корпус не страдает", () => {
    const w = new World({ players: 7, content: { ...NOEV, crewSize: { min: 3, max: 10 } } });
    w.ok("gather");
    expect(w.s.crews).toHaveLength(2);
    w.ok("drill");
    w.advance(14_000);
    for (const c of w.s.crews) expect(c.hull).toBe(HULL_MAX);
    expect(w.s.crews.some((c) => c.failSeq > 0)).toBe(true);
    w.advance(DRILL_MS);
    expect(Object.values(w.s.members).every((m) => m.order === null)).toBe(true);
    w.ok("start");
    w.advance(LAUNCH_MS + 1100 + orderSeconds(w.s) * 1000);
    const c = w.s.crews.find((x) => x.failed > 0 && x.repair === null);
    if (!c) throw new Error("нет просрочек");
    const n = Math.max(3, crewPlayers(w.s, c.id).length);
    expect(c.hull).toBeCloseTo(HULL_MAX - c.failed * (4 / n), 6);
    expect(c.streak).toBe(0);
    expect(w.env.sent.some((x) => x.data.t === "fail")).toBe(true);
  });
  it("импульс 1000 ÷ (c × n): экипажи 4 и 8 человек с одинаковой слаженностью идут одинаково", () => {
    expect(impulse(4, 4) * 4).toBeCloseTo(impulse(4, 8) * 8, 9);
    expect(impulse(3, 5)).toBeCloseTo(1000 / (22.5 * 5), 9);
    expect(orderDamage(8) * 8).toBeCloseTo(orderDamage(4) * 4, 9);
    const w = new World({ players: 12, content: { ...NOEV, crewSize: { min: 3, max: 10 } } });
    for (let i = 0; i < 4; i += 1) w.send(`p${i}`, [{ t: "crew", crew: 0 }]);
    for (let i = 4; i < 12; i += 1) w.send(`p${i}`, [{ t: "crew", crew: 1 }]);
    w.toFlight();
    const plan = new Map<string, number>();
    w.advance(90_000, 100, () => {
      for (const m of Object.values(w.s.members)) {
        const o = m.order;
        if (!o) continue;
        if (!plan.has(o.id)) plan.set(o.id, w.env.now + 2000);
        if (plan.get(o.id) === w.env.now) w.fulfil(m.pid);
      }
    });
    const [a, b] = w.s.crews;
    expect(a && b).toBeTruthy();
    expect(Math.abs((a?.dist ?? 0) - (b?.dist ?? 0)) / Math.max(1, b?.dist ?? 1)).toBeLessThan(0.08);
  });
  it("хозяин прибора пропал — приказ на его прибор снят без штрафа, новый через 1 с; получатель пропал — его приказ снят", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.advance(1100);
    const m = Object.values(w.s.members).find((x) => x.order && w.s.controls[x.order.control]?.owner !== x.pid);
    if (!m?.order) throw new Error("нет чужого приказа");
    const owner = w.s.controls[m.order.control]?.owner ?? "";
    const crew = crewOf(w, m.pid);
    w.offline(owner);
    w.step();
    expect(m.order).toBeNull();
    expect(crew.hull).toBe(HULL_MAX);
    expect(w.env.sent.some((x) => x.pid === m.pid && x.data.t === "cancel" && x.data.reason === "owner")).toBe(true);
    expect(w.member(owner).order).toBeNull();
    w.advance(1100);
    expect(m.order).not.toBeNull();
    expect(w.s.controls[m.order?.control ?? ""]?.owner).not.toBe(owner);
    // Вернулся — снова получает приказ и свой пульт в прежнем состоянии.
    const panel = [...w.member(owner).panel];
    w.online(owner);
    w.advance(1200);
    expect(w.member(owner).order).not.toBeNull();
    expect(w.member(owner).panel).toEqual(panel);
  });
  it("время на приказ по сложности и перелёту; «Медленнее / Быстрее» ±2 с до конца перелёта, в пределах 4–30 с", () => {
    const w = new World({ players: 6, content: { ...NOEV, difficulty: "crazy" } });
    w.toFlight();
    expect(orderSeconds(w.s)).toBe(10);
    w.ok("time", { delta: 2 });
    expect(orderSeconds(w.s)).toBe(12);
    for (let i = 0; i < 4; i += 1) w.ok("time", { delta: -2 });
    expect(orderSeconds(w.s)).toBe(4);
    expect(w.cmd("time", { delta: -2 })).toEqual({ ok: false, error: "limit" });
    expect(w.cmd("time", { delta: 3 })).toEqual({ ok: false, error: "invalid-argument" });
    w.advance(1100);
    const o = Object.values(w.s.members).find((m) => m.order)?.order;
    expect((o?.due ?? 0) - (o?.issuedClock ?? 0)).toBe(4000);
    expect(new World({ content: { difficulty: "kids" } }).s.content.difficulty).toBe("kids");
    const kids = new World({ players: 6, content: { difficulty: "kids" } });
    expect([0, 1, 2].map((i) => orderSeconds(kids.s, i, 0))).toEqual([16, 14, 12]);
    expect([0, 1, 2].map((i) => orderSeconds(w.s, i, 0))).toEqual([10, 8, 6]);
    endFlight(w);
    expect(w.cmd("time", { delta: 2 })).toEqual({ ok: false, error: "wrong-phase" });
  });
  it("пауза (туда и обратно): таймеры приказов стоят, после продолжения идут с того же места", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.advance(3000);
    const crew = w.s.crews[0];
    const m = crewPlayers(w.s, crew?.id ?? 0)[0];
    const view = personalView(w.s, m?.pid ?? "", w.env);
    const left = view?.order?.left;
    const clock = crew?.clock;
    // Комната на паузе: шаги цикла не идут, 60 с часов сервера.
    w.env.now += 60_000;
    resume(w.s, 60_000, w.env);
    w.step();
    expect(crew?.clock).toBe((clock ?? 0) + 100);
    expect(personalView(w.s, m?.pid ?? "", w.env)?.order?.left).toBe((left ?? 0) - 100);
    expect(w.s.crews.every((c) => c.hull === HULL_MAX)).toBe(true);
  });
  it("серия приказов без просрочки: «Слаженнее всех» и шлейф от 5", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    for (let k = 0; k < 7; k += 1) {
      w.advance(600);
      const m = crewPlayers(w.s, w.s.crews[0]?.id ?? 0).find((x) => x.order);
      if (m) w.fulfil(m.pid);
      w.advance(800);
    }
    const sv = screenView(w.s, w.env);
    const c0 = sv.crews.find((c) => c.id === w.s.crews[0]?.id);
    expect(c0?.streak).toBeGreaterThanOrEqual(5);
    expect(c0?.fire).toBe(true);
    expect(sv.best?.crew).toBe(w.s.crews[0]?.id ?? -1);
  });
});

// ===================================================================== корпус и ремонт

describe("корпус и ремонт", () => {
  function brokenWorld() {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    const crew = w.s.crews[0];
    if (!crew) throw new Error("экипаж");
    crew.hull = 0.01;
    w.advance(1100 + orderSeconds(w.s) * 1000);
    if (!crew.repair) throw new Error("ремонт не начался");
    return { w, crew };
  }
  it("прочность 0 — «Аварийный ремонт» 10 с, приказы на паузе, после — прочность 3", () => {
    const { w, crew } = brokenWorld();
    expect(crew.hull).toBe(0);
    expect(crew.repair?.target).toBe(30 * 3);
    // Сроки приказов отодвигаем: проверяем ровно прочность после ремонта.
    for (const m of crewPlayers(w.s, crew.id)) if (m.order) m.order.due += 600_000;
    const clock = crew.clock;
    const orders = crewPlayers(w.s, crew.id).map((m) => m.order?.id);
    w.advance(5000);
    expect(crew.clock).toBe(clock);
    expect(crewPlayers(w.s, crew.id).map((m) => m.order?.id)).toEqual(orders);
    expect(personalView(w.s, crewPlayers(w.s, crew.id)[0]?.pid ?? "", w.env)?.repair).not.toBeNull();
    w.advance(REPAIR_MS - 5000 + 200);
    expect(crew.repair).toBeNull();
    expect(crew.hull).toBe(HULL_AFTER_REPAIR);
    w.advance(500);
    expect(crew.clock).toBeGreaterThan(clock);
  });
  it("«Чиним вместе»: 30 × n нажатий — ремонт раньше, но не быстрее 5 секунд", () => {
    const { w, crew } = brokenWorld();
    for (const m of crewPlayers(w.s, crew.id)) if (m.order) m.order.due += 600_000;
    const players = crewPlayers(w.s, crew.id);
    for (let k = 0; k < 2; k += 1) {
      for (const p of players) w.send(p.pid, [{ t: "tap", n: 15 }]);
      w.advance(1000);
    }
    expect((crew.repair?.taps ?? 0) >= 90 || crew.repair === null).toBe(true);
    const started = crew.repair?.startedAt ?? 0;
    w.advance(REPAIR_MIN_MS - (w.g - started) - 200);
    expect(crew.repair).not.toBeNull();
    w.advance(400);
    expect(crew.repair).toBeNull();
    expect(crew.hull).toBe(HULL_AFTER_REPAIR);
  });
  it("нажатий больше 15 в секунду не засчитывается (запас 30)", () => {
    const { w, crew } = brokenWorld();
    const p = crewPlayers(w.s, crew.id)[0];
    for (let i = 0; i < 10; i += 1) w.send(p?.pid ?? "", [{ t: "tap", n: 30 }]);
    expect(crew.repair?.taps).toBe(30);
  });
});

// ===================================================================== события

describe("события", () => {
  it("расписание: 2–3 события, не в первые 30 и не в последние 20 с, между — от 30 с; ничего не включено — нет событий", () => {
    for (let i = 0; i < 300; i += 1) {
      for (const minutes of [3, 4, 5] as const) {
        const content = parseContent({ legMinutes: minutes });
        const d = minutes * 60_000;
        const list = scheduleEvents(content, d, seq(`sch${i}`));
        expect(list.length).toBeGreaterThanOrEqual(2);
        expect(list.length).toBeLessThanOrEqual(3);
        list.forEach((e, k) => {
          expect(e.at).toBeGreaterThanOrEqual(EVENT_EDGE_START_MS);
          expect(e.at).toBeLessThanOrEqual(d - EVENT_EDGE_END_MS);
          expect(e.kind).not.toBe("captain");
          if (k > 0) expect(e.at - (list[k - 1]?.at ?? 0)).toBeGreaterThanOrEqual(EVENT_GAP_MS);
        });
      }
    }
    expect(scheduleEvents(parseContent(NOEV), 240_000, seq("x"))).toEqual([]);
    const onlyPull = scheduleEvents(parseContent({ events: { meteor: false, sos: false } }), 240_000, seq("y"));
    expect(onlyPull.every((e) => e.kind === "pull")).toBe(true);
  });
  it("по расписанию: предупреждение за 3 с, во время события таймер перелёта и приказы стоят, потом продолжаются", () => {
    const w = new World({ players: 6 });
    w.toFlight();
    const first = w.s.leg?.schedule[0];
    if (!first) throw new Error("расписание");
    let warned = false;
    let flightAtStart = 0;
    while (!w.s.leg?.event?.started) {
      // Корабли целы: экипаж на ремонте событие пропустил бы.
      for (const c of w.s.crews) {
        c.hull = HULL_MAX;
        c.repair = null;
      }
      w.step();
      if (w.s.leg?.event && !w.s.leg.event.started) warned = true;
      flightAtStart = w.s.leg?.flight ?? 0;
    }
    expect(warned).toBe(true);
    expect(Math.abs(flightAtStart - first.at)).toBeLessThanOrEqual(200);
    const clocks = w.s.crews.map((c) => c.clock);
    const dues = Object.values(w.s.members).map((m) => m.order?.due);
    w.advance(3000);
    expect(w.s.leg?.flight).toBe(flightAtStart);
    expect(screenView(w.s, w.env).flight?.stopped).toBe(true);
    expect(w.s.crews.map((c) => c.clock)).toEqual(clocks);
    expect(Object.values(w.s.members).map((m) => m.order?.due)).toEqual(dues);
  });
  it("«Метеоритный дождь»: щит < 50 — корпус −1, < 25 — −2; лучший +20; без датчика 6 нажатий в секунду = 100", () => {
    const w = new World({ players: 21, content: ALL_ON });
    w.ok("gather");
    w.ok("start");
    w.advance(LAUNCH_MS + 200);
    const crews = w.s.crews;
    expect(crews).toHaveLength(3);
    startEvent(w, "meteor");
    const shake = [80, 40, 10];
    crews.forEach((c, i) => {
      for (const m of crewMembers(w.s, c.id)) w.send(m.pid, [{ t: "shake", p: shake[i] }]);
    });
    w.advance(10_100);
    expect(w.s.leg?.event).toBeNull();
    expect(crews.map((c) => c.hull)).toEqual([5, 4, 3]);
    expect(crews.map((c) => c.bonus.meteor)).toEqual([METEOR_BONUS, 0, 0]);
    expect(crews.map((c) => c.legShield)).toEqual([80, 40, 10]);
    // Тапы: 6 в секунду × 10 с = 100.
    startEventLater(w);
    const c0 = crews[0];
    for (let k = 0; k < 10; k += 1) {
      for (const m of crewMembers(w.s, c0?.id ?? 0)) w.send(m.pid, [{ t: "tap", n: 6 }]);
      w.advance(1000);
    }
    expect(c0?.legShield).toBe(100);
  });
  function startEventLater(w: World): void {
    const leg = w.s.leg;
    if (leg) leg.flight += 40_000;
    startEvent(w, "meteor");
  }
  it("«Метеоритный дождь» у детей: урона нет, только бонус", () => {
    const w = new World({ players: 6, content: { ...ALL_ON, difficulty: "kids" } });
    w.toFlight();
    startEvent(w, "meteor");
    w.advance(10_100);
    expect(w.s.crews.every((c) => c.hull === HULL_MAX)).toBe(true);
  });
  it("«Притяжение»: счёт идёт, только пока держат все на связи; отпустил — в ноль; без связи не ждут; сносит назад; не вырвались за 20 с — −1", () => {
    const w = new World({ players: 6, content: ALL_ON });
    w.toFlight();
    const [a, b] = w.s.crews;
    if (!a || !b) throw new Error("экипажи");
    a.dist = 100;
    b.dist = 100;
    startEvent(w, "pull");
    const pa = crewPlayers(w.s, a.id);
    for (const p of pa) w.send(p.pid, [{ t: "hold", on: true }]);
    w.advance(2000);
    expect(screenView(w.s, w.env).crews.find((c) => c.id === a.id)?.pull?.held).toBeGreaterThanOrEqual(1900);
    w.send(pa[0]?.pid ?? "", [{ t: "hold", on: false }]);
    w.step();
    expect(a.pull?.holdStart).toBeNull();
    expect(screenView(w.s, w.env).crews.find((c) => c.id === a.id)?.pull?.notHolding).toEqual([pa[0]?.name]);
    // Он пропал со связи — его не ждут.
    w.offline(pa[0]?.pid ?? "");
    w.advance(3200);
    expect(a.pull?.escaped).toBe(true);
    const distA = a.dist;
    w.advance(2000);
    expect(a.dist).toBe(distA);
    // Экипаж b не держит — сносит назад 3 деления в секунду, через 20 с — −1.
    expect(b.dist).toBeLessThan(100);
    w.advance(20_000);
    expect(w.s.leg?.event).toBeNull();
    expect(b.dist).toBeCloseTo(100 - PULL_DRIFT_PER_S * 20, 0);
    expect(b.hull).toBe(HULL_MAX - 1);
    expect(a.hull).toBe(HULL_MAX);
  });
  it("«Притяжение» кончается раньше, если вырвались все", () => {
    const w = new World({ players: 6, content: ALL_ON });
    w.toFlight();
    startEvent(w, "pull");
    for (const m of Object.values(w.s.members)) w.send(m.pid, [{ t: "hold", on: true }]);
    w.advance(3300);
    expect(w.s.leg?.event).toBeNull();
    expect(w.s.leg?.history.map((h) => h.kind)).toEqual(["pull"]);
  });
  it("«Сигнал SOS»: длина 4 / 5 / 6 по перелётам; ошибка — с начала и 1,5 с пауза; верно — +30; жмёт только капитан, пропал — следующий", () => {
    const w = new World({ players: 6, content: { ...ALL_ON, legs: 3 } });
    w.toFlight();
    const lengths: number[] = [];
    for (let leg = 0; leg < 3; leg += 1) {
      const id = startEvent(w, "sos");
      lengths.push(w.s.leg?.event?.seq?.length ?? 0);
      const crew = w.s.crews[0];
      if (!crew) throw new Error("экипаж");
      const seqColors = w.s.leg?.event?.seq ?? [];
      const players = crewPlayers(w.s, crew.id);
      const captain = players[0];
      if (!captain) throw new Error("капитан");
      if (leg === 0) {
        // Не капитан — не считается.
        w.send(players[1]?.pid ?? "", [{ t: "sos", color: seqColors[0] }]);
        expect(crew.sos?.progress).toBe(0);
        w.send(captain.pid, [{ t: "sos", color: seqColors[0] }]);
        expect(crew.sos?.progress).toBe(1);
        w.send(captain.pid, [{ t: "sos", color: ((seqColors[1] ?? 0) + 1) % 4 }]);
        expect(crew.sos?.progress).toBe(0);
        w.advance(1000);
        w.send(captain.pid, [{ t: "sos", color: seqColors[0] }]);
        expect(crew.sos?.progress).toBe(0);
        w.advance(SOS_BLOCK_MS - 1000 + 100);
        // Капитан пропал — роль у следующего.
        w.offline(captain.pid);
        w.send(players[1]?.pid ?? "", [{ t: "sos", color: seqColors[0] }]);
        expect(crew.sos?.progress).toBe(1);
        for (const c of seqColors.slice(1)) w.send(players[1]?.pid ?? "", [{ t: "sos", color: c }]);
        expect(crew.sos?.done).toBe(true);
        expect(crew.bonus.sos).toBe(SOS_BONUS);
        w.online(captain.pid);
      }
      w.ok("event-end", { id });
      endFlight(w);
      if (leg < 2) {
        w.ok("next");
        w.advance(LAUNCH_MS + 200);
      }
    }
    expect(lengths).toEqual([4, 5, 6]);
  });
  it("«Все на палубу!»: задание на экране, приказы стоят; звёзды 0–5 × 10; повторное «Начислить» заменяет", () => {
    const w = new World({ players: 6, content: ALL_ON });
    w.toFlight();
    const id = startEvent(w, "captain", { task: "Изобразите двигатель!" });
    expect(screenView(w.s, w.env).event?.task).toBe("Изобразите двигатель!");
    const clocks = w.s.crews.map((c) => c.clock);
    w.advance(5000);
    expect(w.s.crews.map((c) => c.clock)).toEqual(clocks);
    w.ok("event-end", { id });
    const [a, b] = w.s.crews;
    w.ok("rate", { event: id, stars: { [String(a?.id)]: 5, [String(b?.id)]: 2 } });
    expect(a?.bonus.captain[id]).toBe(50);
    expect(b?.bonus.captain[id]).toBe(20);
    w.ok("rate", { event: id, stars: { [String(a?.id)]: 3, [String(b?.id)]: 9 } });
    expect(a?.bonus.captain[id]).toBe(30);
    expect(b?.bonus.captain[id]).toBe(50);
    expect(w.cmd("rate", { event: "nope", stars: {} })).toEqual({ ok: false, error: "not-found" });
    expect(hostView(w.s, w.env).captain[0]?.stars).toEqual({ [String(a?.id)]: 3, [String(b?.id)]: 5 });
    // Задание по умолчанию — первое из списка.
    w.s.leg && (w.s.leg.flight += 40_000);
    startEvent(w, "captain");
    expect(w.s.leg?.event?.task).toBe(w.s.content.captainTasks[0]);
  });
  it("«Событие сейчас»: только в полёте, если нет другого, не на паузе и если включено", () => {
    const w = new World({ players: 6, content: { events: { meteor: true, pull: true, sos: false, captain: true } } });
    w.ok("gather");
    expect(w.cmd("event", { kind: "meteor" })).toEqual({ ok: false, error: "wrong-phase" });
    w.ok("start");
    w.advance(LAUNCH_MS + 200);
    expect(w.cmd("event", { kind: "sos" })).toEqual({ ok: false, error: "disabled" });
    expect(w.cmd("event", { kind: "dragon" })).toEqual({ ok: false, error: "invalid-argument" });
    w.env.paused = true;
    expect(w.cmd("event", { kind: "meteor" })).toEqual({ ok: false, error: "paused" });
    w.env.paused = false;
    w.ok("event", { kind: "meteor" });
    expect(w.cmd("event", { kind: "pull" })).toEqual({ ok: false, error: "busy" });
    // Закончить раньше прямо на предупреждении — события не было.
    w.ok("event-end");
    expect(w.s.leg?.event).toBeNull();
    expect(w.s.leg?.history).toEqual([]);
    expect(w.cmd("event-end")).toEqual({ ok: false, error: "no-event" });
    w.ok("event", { kind: "pull" });
    expect(w.cmd("event-end", { id: "e999" })).toEqual({ ok: false, error: "moved" });
  });
  it("ведущий закончил событие раньше — без урона", () => {
    const w = new World({ players: 6, content: ALL_ON });
    w.toFlight();
    startEvent(w, "pull");
    w.advance(2000);
    w.ok("event-end");
    expect(w.s.crews.every((c) => c.hull === HULL_MAX)).toBe(true);
    w.s.leg && (w.s.leg.flight += 40_000);
    startEvent(w, "meteor");
    w.ok("event-end");
    expect(w.s.crews.every((c) => c.hull === HULL_MAX)).toBe(true);
  });
  it("экипаж на ремонте событие пропускает без штрафа; долетевшие событий не получают", () => {
    const w = new World({ players: 21, content: ALL_ON });
    w.toFlight();
    const [a, b, c] = w.s.crews;
    if (!a || !b || !c) throw new Error("три экипажа");
    a.hull = 0;
    a.repair = { startedAt: w.g, taps: 0, target: 90 };
    b.finishedAt = 10_000;
    b.dist = 1000;
    startEvent(w, "meteor");
    expect(w.s.leg?.event?.crews).toEqual([c.id]);
    w.advance(10_100);
    expect(a.hull).toBe(HULL_AFTER_REPAIR);
    expect(b.hull).toBe(HULL_MAX);
    expect(c.hull).toBeLessThan(HULL_MAX);
    expect(personalView(w.s, crewPlayers(w.s, b.id)[0]?.pid ?? "", w.env)?.finished).toBe(true);
  });
  it("событие и после него — следующее по расписанию не раньше чем через 30 с полёта", () => {
    const w = new World({ players: 6 });
    w.toFlight();
    const leg = w.s.leg;
    if (!leg) throw new Error("перелёт");
    leg.schedule = [{ at: 40_000, kind: "meteor" }];
    leg.flight = 30_000;
    startEvent(w, "pull");
    w.ok("event-end");
    expect(leg.schedule[0]?.at).toBeGreaterThanOrEqual(30_000 + EVENT_GAP_MS);
  });
});

// ===================================================================== «Глюк» и «Переворот»

describe("особые эффекты перелётов", () => {
  function legWorld(index: number, content: Record<string, unknown> = NOEV) {
    const w = new World({ players: 6, content: { ...content, legs: 3 } });
    w.toFlight();
    for (let i = 0; i < index; i += 1) {
      endFlight(w);
      w.ok("next");
      w.advance(LAUNCH_MS + 100);
    }
    return w;
  }
  it("перелёт 2: «Глюк» один раз — плитки меняются местами, приборы те же; первые 0,7 с нажатия не считаются", () => {
    const w = legWorld(1);
    const glitch = w.s.leg?.glitch;
    if (!glitch) throw new Error("нет глюка");
    expect(legWorld(0).s.leg?.glitch).toBeNull();
    const before = Object.fromEntries(Object.values(w.s.members).map((m) => [m.pid, [...m.panel]]));
    w.s.leg && (w.s.leg.flight = glitch.at - 50);
    w.step();
    expect(glitch.startedAt).not.toBeNull();
    for (const m of Object.values(w.s.members)) {
      expect([...m.panel].sort()).toEqual([...(before[m.pid] ?? [])].sort());
      expect(m.panel).not.toEqual(before[m.pid]);
    }
    expect(screenView(w.s, w.env).glitchUntil).not.toBeNull();
    // Движение сразу после глюка: удержание считается с конца 0,7 с.
    const { m, ctl } = orderWith(w, false);
    const id = m.order?.id;
    w.send(ctl.owner, [{ t: "move", c: ctl.id, s: m.order?.target }]);
    w.advance(700);
    expect(m.order?.id).toBe(id);
    w.advance(800);
    expect(m.order?.id).not.toBe(id);
  });
  it("перелёт 3: «Переворот» на 10 с у телефонов; у детей — нет", () => {
    const w = legWorld(2);
    const flip = w.s.leg?.flip;
    if (!flip) throw new Error("нет переворота");
    w.s.leg && (w.s.leg.flight = flip.at - 50);
    w.step();
    const pid = Object.keys(w.s.members)[0] ?? "";
    const until = personalView(w.s, pid, w.env)?.flipUntil ?? 0;
    expect(until).toBeGreaterThan(w.env.now);
    expect(until).toBeLessThanOrEqual(w.env.now + 10_000);
    w.advance(10_100);
    expect(personalView(w.s, pid, w.env)?.flipUntil).toBeNull();
    expect(legWorld(2, { ...NOEV, difficulty: "kids" }).s.leg?.flip).toBeNull();
  });
});

// ===================================================================== финиш, привал, места

describe("финиш, привал и места", () => {
  it("финиш: дальность от приказов дошла до 1 000 — «Вы у цели!», +2 за каждую оставшуюся секунду, «Салют» без очков", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    const crew = w.s.crews[0];
    if (!crew) throw new Error("экипаж");
    crew.dist = 999.9;
    w.advance(1100);
    const m = crewPlayers(w.s, crew.id).find((p) => p.order);
    if (!m) throw new Error("приказ");
    w.fulfil(m.pid);
    w.advance(800);
    expect(crew.finishedAt).not.toBeNull();
    expect(crew.dist).toBe(1000);
    expect(crewPlayers(w.s, crew.id).every((p) => p.order === null)).toBe(true);
    expect(w.env.sent.some((x) => x.data.t === "finish")).toBe(true);
    w.send(m.pid, [{ t: "salute", n: 3 }]);
    expect(crew.salutes).toBe(3);
    w.advance(5000);
    expect(crewPlayers(w.s, crew.id).every((p) => p.order === null)).toBe(true);
    const finishedAt = crew.finishedAt ?? 0;
    endFlight(w);
    const r = crew.legs[0];
    expect(r?.finish).toBe(2 * Math.floor((240_000 - finishedAt) / 1000));
    expect(r?.total).toBe((r?.orders ?? 0) + (r?.finish ?? 0) + (r?.events ?? 0));
    expect(r?.first).toBe(true);
  });
  it("все долетели раньше времени — перелёт кончается сразу", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    for (const c of w.s.crews) {
      c.finishedAt = 1000;
      c.dist = 1000;
    }
    w.step();
    expect(w.s.leg?.stage).toBe("dock");
  });
  it("места: при равных очках — общее (10, 10, 7 → 1, 1, 3)", () => {
    const items = [{ v: 10 }, { v: 7 }, { v: 10 }];
    const p = places(items, (x) => x.v);
    expect(items.map((x) => p.get(x))).toEqual([1, 3, 1]);
  });
  it("привал: итог = «За приказы» + «Финиш раньше» + «События»; пьедестал — по общему счёту", () => {
    const w = new World({ players: 6, content: { ...ALL_ON, legs: 2 } });
    w.toFlight();
    const [a, b] = w.s.crews;
    if (!a || !b) throw new Error("экипажи");
    a.dist = 500.4;
    a.bonus.sos = 30;
    b.dist = 700;
    endFlight(w);
    expect(a.legs[0]).toMatchObject({ orders: 500, finish: 0, events: 30, total: 530, place: 2 });
    expect(b.legs[0]).toMatchObject({ orders: 700, total: 700, place: 1 });
    expect(screenView(w.s, w.env).dock?.rows.map((r) => r.crew)).toEqual([b.id, a.id]);
    w.ok("next");
    w.advance(LAUNCH_MS + 100);
    a.dist = 900;
    b.dist = 100;
    endFlight(w);
    w.ok("next");
    expect(w.s.phase).toBe("podium");
    expect(crewTotal(a)).toBe(1430);
    expect(crewTotal(b)).toBe(800);
    expect(screenView(w.s, w.env).podium?.map((p) => [p.crew, p.place])).toEqual([[a.id, 1], [b.id, 2]]);
    expect(personalView(w.s, crewPlayers(w.s, a.id)[0]?.pid ?? "", w.env)?.card?.place).toBe(1);
    w.ok("finish");
    expect(w.s.phase).toBe("finished");
    expect(w.cmd("finish")).toEqual({ ok: false, error: "wrong-phase" });
  });
});

// ===================================================================== диверсант

describe("режим «Диверсант на борту»", () => {
  function sabWorld(players = 10, content: Record<string, unknown> = {}) {
    const w = new World({ players, content: { ...NOEV, saboteur: true, ...content } });
    w.toFlight();
    return w;
  }
  it("в каждом экипаже от 5 человек — тайный диверсант; меньше 5 и у детей — нет", () => {
    const w = sabWorld(10);
    expect(w.s.crews.every((c) => c.saboteur !== null && crewPlayers(w.s, c.id).some((p) => p.pid === c.saboteur))).toBe(true);
    const small = sabWorld(8);
    expect(small.s.crews.every((c) => c.saboteur === null)).toBe(true);
    expect(small.s.leg?.saboteurs).toBe(false);
    expect(sabWorld(10, { difficulty: "kids" }).s.crews.every((c) => c.saboteur === null)).toBe(true);
  });
  it("окно роли одного вида у всех экипажа; экран и пульт диверсантов не знают", () => {
    const w = sabWorld(10);
    const crew = w.s.crews[0];
    if (!crew) throw new Error("экипаж");
    const views = crewMembers(w.s, crew.id).map((m) => personalView(w.s, m.pid, w.env));
    const shapes = new Set(views.map((v) => JSON.stringify(Object.keys(v?.role ?? {}))));
    expect(shapes.size).toBe(1);
    expect(views.filter((v) => v?.role?.saboteur === true)).toHaveLength(1);
    const screen = JSON.stringify(screenView(w.s, w.env));
    const host = JSON.stringify(hostView(w.s, w.env));
    for (const c of w.s.crews) {
      expect(screen.includes(`"saboteur"`)).toBe(false);
      expect(host.includes(`"saboteur"`)).toBe(false);
      void c;
    }
    w.send(crewMembers(w.s, crew.id)[0]?.pid ?? "", [{ t: "role-ok" }]);
    expect(personalView(w.s, crewMembers(w.s, crew.id)[0]?.pid ?? "", w.env)?.role?.seen).toBe(true);
  });
  it("примерно каждый третий приказ диверсанта — ложный; пометку видит только он; выполнили — прочность −4 ÷ n, не выполнили — ничего", () => {
    const w = sabWorld(10);
    const crew = w.s.crews[0];
    if (!crew?.saboteur) throw new Error("диверсант");
    const sab = w.member(crew.saboteur);
    let total = 0;
    let fakes = 0;
    const seen = new Set<string>();
    let checkedDone = false;
    let checkedFail = false;
    w.advance(200_000, 100, () => {
      const o = sab.order;
      if (o && !seen.has(o.id)) {
        seen.add(o.id);
        total += 1;
        if (o.fake) fakes += 1;
        // Пометка — только у него.
        expect(personalView(w.s, sab.pid, w.env)?.order?.mark === true).toBe(o.fake);
        for (const m of crewMembers(w.s, crew.id)) if (m.pid !== sab.pid) expect(JSON.stringify(personalView(w.s, m.pid, w.env))).not.toContain(o.id);
        // Чужие приказы этого экипажа не сгорают, пока проверяем ложный (корпус меняет только он).
        if (o.fake) for (const m of crewPlayers(w.s, crew.id)) if (m.pid !== sab.pid && m.order) m.order.due += 600_000;
        if (o.fake && !checkedDone) {
          checkedDone = true;
          const hull = crew.hull;
          const dist = crew.dist;
          const ctl = w.s.controls[o.control];
          w.send(ctl?.owner ?? "", [{ t: "move", c: o.control, s: o.target }]);
          w.advance(900);
          expect(crew.dist).toBe(dist);
          expect(crew.hull).toBeCloseTo(Math.max(0, hull - 4 / crewPlayers(w.s, crew.id).length), 6);
          expect(crew.fakeDone).toBe(1);
        } else if (o.fake && checkedDone && !checkedFail && crew.repair === null) {
          checkedFail = true;
          const hull = crew.hull;
          const wait = o.due - crew.clock + 200;
          w.advance(wait);
          expect(crew.hull).toBe(hull);
        }
      }
      // Остальные приказы диверсанта выполняют сразу — больше выдач для подсчёта доли.
      if (checkedDone && checkedFail && sab.order) w.fulfil(sab.pid);
      crew.hull = Math.max(crew.hull, 2);
      crew.dist = Math.min(crew.dist, 500);
      w.s.leg && (w.s.leg.flight = Math.min(w.s.leg.flight, 100_000));
    });
    expect(total).toBeGreaterThan(60);
    expect(fakes / total).toBeGreaterThan(0.2);
    expect(fakes / total).toBeLessThan(0.46);
    expect(checkedDone && checkedFail).toBe(true);
  });
  it("голосование: голос диверсанта не считается; поровну — не угадали; большинство — +50, иначе — лента «Мастер обмана»", () => {
    const w = sabWorld(10);
    const [a, b] = w.s.crews;
    if (!a?.saboteur || !b?.saboteur) throw new Error("диверсанты");
    endFlight(w);
    w.ok("next");
    expect(w.s.leg?.stage).toBe("vote");
    const ma = crewMembers(w.s, a.id);
    const honestA = ma.filter((m) => m.pid !== a.saboteur);
    // Экипаж a: все честные — за диверсанта.
    for (const m of honestA) w.send(m.pid, [{ t: "vote", pid: a.saboteur }]);
    // Диверсант голосует за другого — не считается.
    w.send(a.saboteur, [{ t: "vote", pid: honestA[0]?.pid }]);
    // За себя нельзя.
    w.send(honestA[0]?.pid ?? "", [{ t: "vote", pid: honestA[0]?.pid }]);
    expect(w.member(honestA[0]?.pid ?? "").vote).toBe(a.saboteur);
    // Экипаж b: поровну.
    const mb = crewMembers(w.s, b.id).filter((m) => m.pid !== b.saboteur);
    const other = mb[0]?.pid ?? "";
    mb.forEach((m, i) => w.send(m.pid, [{ t: "vote", pid: i % 2 === 0 ? b.saboteur : m.pid === other ? mb[1]?.pid : other }]));
    const tb = tallyVote(w.s, b);
    expect(tb?.guessed).toBe(false);
    expect(screenView(w.s, w.env).vote?.voted[String(a.id)]).toBe(5);
    expect(JSON.stringify(screenView(w.s, w.env).vote)).not.toContain(a.saboteur);
    w.advance(VOTE_MS + 200);
    expect(w.s.leg?.stage).toBe("voted");
    expect(a.voteBonus).toBe(VOTE_BONUS);
    expect(b.voteBonus).toBe(0);
    expect(w.member(b.saboteur).ribbons).toBe(1);
    expect(w.member(a.saboteur).ribbons).toBe(0);
    expect(screenView(w.s, w.env).reveal?.map((r) => r.guessed)).toEqual([true, false]);
    expect(personalView(w.s, a.saboteur, w.env)?.voted?.me).toBe(true);
    expect(crewTotal(a)).toBe((a.legs[0]?.total ?? 0) + VOTE_BONUS);
  });
  it("ничья 1:1 и никто не голосовал — не угадали; в экипаже без диверсанта — «диверсанта не было»", () => {
    const w = new World({ players: 13, content: { ...NOEV, saboteur: true } });
    for (let i = 0; i < 13; i += 1) w.send(`p${i}`, [{ t: "crew", crew: i < 9 ? 0 : 1 }]);
    w.toFlight();
    const small = w.s.crews.find((c) => c.saboteur === null);
    const big = w.s.crews.find((c) => c.saboteur !== null);
    if (!small || !big?.saboteur) throw new Error("нужны большой и маленький экипажи");
    endFlight(w);
    w.ok("vote");
    expect(personalView(w.s, crewMembers(w.s, small.id)[0]?.pid ?? "", w.env)?.vote?.none).toBe(true);
    expect(tallyVote(w.s, big)?.guessed).toBe(false);
    w.ok("vote-end");
    expect(personalView(w.s, crewMembers(w.s, small.id)[0]?.pid ?? "", w.env)?.voted?.none).toBe(true);
    expect(w.cmd("vote")).toEqual({ ok: false, error: "wrong-phase" });
  });
  it("без диверсантов «Дальше» с привала — сразу следующий перелёт; голосование вручную — нельзя", () => {
    const w = new World({ players: 8, content: { ...NOEV, saboteur: true } });
    w.toFlight();
    endFlight(w);
    expect(w.cmd("vote")).toEqual({ ok: false, error: "no-saboteur" });
    expect(w.cmd("next")).toEqual({ ok: true, result: "leg" });
  });
});

// ===================================================================== что видит телефон

describe("личное — только своё", () => {
  it("в личном нет чужих приказов, чужих ролей и зерна", () => {
    const w = new World({ players: 10, content: { ...NOEV, saboteur: true } });
    w.toFlight();
    w.advance(1500);
    for (const m of Object.values(w.s.members)) {
      const text = JSON.stringify(personalView(w.s, m.pid, w.env));
      for (const o of Object.values(w.s.members)) if (o.pid !== m.pid && o.order) expect(text).not.toContain(o.order.id);
      expect(text).not.toContain("fake");
    }
    // Отправленное телефонам «me» — тоже только своё.
    for (const x of w.env.sent.filter((e) => e.data.t === "me")) {
      const me = (x.data.me as { me: { pid: string } }).me;
      expect(me.pid).toBe(x.pid);
    }
  });
  it("личное уходит только при переменах: одинаковое второй раз не шлётся", () => {
    const w = new World({ players: 6, content: NOEV });
    w.ok("gather");
    w.advance(1000);
    const before = w.env.sent.filter((x) => x.data.t === "me").length;
    w.advance(3000);
    expect(w.env.sent.filter((x) => x.data.t === "me").length).toBe(before);
  });
});

// ===================================================================== команды пульта, «Назад», снимок

describe("команды пульта", () => {
  it("переходы фаз: «Собрать экипажи» → «Тренировка» → «Старт перелёта» → взлёт 5 с → полёт; не в свою фазу — отказ", () => {
    const w = new World({ players: 6 });
    expect(w.cmd("drill")).toEqual({ ok: false, error: "wrong-phase" });
    expect(w.cmd("start")).toEqual({ ok: false, error: "wrong-phase" });
    expect(w.cmd("next")).toEqual({ ok: false, error: "wrong-phase" });
    w.ok("gather");
    w.ok("drill");
    expect(w.s.phase).toBe("drill");
    expect(Object.values(w.s.members).every((m) => m.panel.length === 3)).toBe(true);
    w.ok("start");
    expect(w.s.leg?.stage).toBe("launch");
    expect(screenView(w.s, w.env).endsAt).toBe(w.env.now + LAUNCH_MS);
    w.advance(LAUNCH_MS);
    expect(w.s.leg?.stage).toBe("fly");
    expect(w.cmd("podium")).toEqual({ ok: false, error: "wrong-phase" });
    expect(w.cmd("unknown")).toEqual({ ok: false, error: "invalid-argument" });
    expect(new World({ players: 0 }).cmd("gather")).toEqual({ ok: false, error: "no-players" });
  });
  it("«Убрать игрока» — только после минуты без связи; приказов нет, «Притяжение» его не ждёт; вернулся — дублёр в своём экипаже", () => {
    const w = new World({ players: 6, content: ALL_ON });
    w.toFlight();
    w.offline("p0");
    w.advance(30_000);
    expect(w.cmd("remove", { pid: "p0" })).toEqual({ ok: false, error: "online" });
    expect(w.cmd("remove", { pid: "zz" })).toEqual({ ok: false, error: "not-found" });
    w.advance(31_000);
    expect(hostView(w.s, w.env).removable.map((r) => r.pid)).toContain("p0");
    w.ok("remove", { pid: "p0" });
    w.ok("remove", { pid: "p0" });
    const crew = w.member("p0").crew;
    expect(w.member("p0").role).toBe("out");
    w.online("p0");
    w.step();
    expect(w.member("p0").role).toBe("double");
    expect(w.member("p0").pending).toBe(true);
    expect(w.member("p0").crew).toBe(crew);
    endFlight(w);
    w.ok("next");
    expect(w.member("p0").role).toBe("player");
  });
  it("убранного не ждут в «Притяжении», приборы — товарищам со следующего перелёта", () => {
    const w = new World({ players: 6, content: { ...ALL_ON, legs: 3 } });
    w.toFlight();
    w.offline("p0");
    w.advance(61_000);
    w.ok("remove", { pid: "p0" });
    endFlight(w);
    w.ok("next");
    expect(w.member("p0").panel).toEqual([]);
    expect(Object.values(w.s.controls).some((c) => c.owner === "p0")).toBe(false);
  });
  it("«Назад — переиграть перелёт» (туда и обратно): то же состояние, что было до перелёта; новая попытка — новая случайность", () => {
    const w = new World({ players: 10, content: { ...ALL_ON, saboteur: true } });
    w.ok("gather");
    w.ok("drill");
    w.advance(DRILL_MS + 200);
    const before = w.core();
    w.ok("start");
    const firstNames = Object.values(w.s.controls).map((c) => c.name).join();
    w.advance(LAUNCH_MS + 20_000, 100, () => {
      const m = Object.values(w.s.members).find((x) => x.order);
      if (m && w.env.now % 900 === 0) w.fulfil(m.pid);
    });
    endFlight(w);
    expect(hostView(w.s, w.env).canBack).toBe(true);
    w.ok("next");
    expect(w.s.leg?.stage).toBe("vote");
    w.ok("back");
    expect(w.core()).toBe(before);
    expect(w.cmd("back")).toEqual({ ok: false, error: "nothing-to-undo" });
    w.ok("start");
    expect(w.s.attempts[0]).toBe(2);
    expect(Object.values(w.s.controls).map((c) => c.name).join()).not.toBe(firstNames);
    // Второй перелёт и «Назад» — к привалу первого с его итогами.
    endFlight(w);
    w.ok("vote");
    w.ok("vote-end");
    const dock1 = w.core();
    w.ok("next");
    w.advance(LAUNCH_MS + 3000);
    endFlight(w);
    w.ok("back");
    expect(w.core()).toBe(dock1);
  });
  it("«Назад»: вошедший за время перелёта остаётся в игре", () => {
    const w = new World({ players: 6, content: NOEV });
    w.ok("gather");
    w.ok("start");
    w.advance(LAUNCH_MS + 100);
    w.addPlayer("new");
    endFlight(w);
    w.ok("back");
    expect(w.member("new").crew).not.toBeNull();
    expect(w.member("new").role).toBe("player");
  });
  it("снимок → восстановление → то же состояние и тот же ход игры дальше", () => {
    const w = new World({ players: 9, content: { ...ALL_ON, saboteur: true } });
    w.toFlight();
    w.advance(20_000, 100, () => {
      const m = Object.values(w.s.members).find((x) => x.order);
      if (m && w.env.now % 700 === 0) w.fulfil(m.pid);
    });
    const data = JSON.parse(JSON.stringify(snapshot(w.s))) as unknown;
    const back = restore(data);
    if (!back) throw new Error("не восстановилось");
    expect(JSON.stringify(snapshot(back))).toBe(JSON.stringify(snapshot(w.s)));
    const twin = new World({ players: 9, content: ALL_ON });
    twin.env.now = w.env.now;
    twin.s = back;
    for (const x of [w, twin]) {
      x.advance(30_000, 100, () => {
        const m = Object.values(x.s.members).find((y) => y.order);
        if (m && x.env.now % 1100 === 0) x.fulfil(m.pid);
      });
    }
    expect(twin.core()).toBe(w.core());
    expect(restore({ v: 2 })).toBeNull();
    expect(restore(null)).toBeNull();
    expect(restore({ v: 1, phase: "space" })).toBeNull();
  });
  it("повторные и двойные команды: второй «Старт» и второе «Дальше» не проходят", () => {
    const w = new World({ players: 6, content: NOEV });
    w.ok("gather");
    w.ok("start");
    expect(w.cmd("start")).toEqual({ ok: false, error: "wrong-phase" });
    endFlight(w);
    w.ok("next");
    const leg = w.s.legIndex;
    w.advance(LAUNCH_MS + 100);
    expect(w.cmd("next")).toEqual({ ok: false, error: "wrong-phase" });
    expect(w.s.legIndex).toBe(leg);
  });
  it("гость без связи и вернулся: «без связи» в сводке экипажа и пульта, вернулся — тот же пульт", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.offline("p1");
    w.advance(500);
    const crew = w.member("p1").crew;
    const mate = Object.values(w.s.members).find((m) => m.crew === crew && m.pid !== "p1");
    expect(personalView(w.s, mate?.pid ?? "", w.env)?.crew?.offline).toContain(w.member("p1").name);
    expect(hostView(w.s, w.env).crews.find((c) => c.id === crew)?.members.find((m) => m.pid === "p1")?.online).toBe(false);
    w.online("p1");
    w.advance(500);
    expect(personalView(w.s, mate?.pid ?? "", w.env)?.crew?.offline).toEqual([]);
  });
  it("гостя убрали на платформе — он ушёл из игры; пришёл снова — дублёр", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.env.players = w.env.players.filter((p) => p.pid !== "p2");
    w.step();
    expect(w.member("p2").gone).toBe(true);
    expect(w.member("p2").order).toBeNull();
    w.env.players.push({ pid: "p2", name: "Гость 2", team: null });
    w.step();
    expect(w.member("p2").gone).toBe(false);
    expect(w.member("p2").role).toBe("double");
  });
  it("тренировка 30 с: приказы идут все 30 секунд, потом стоп", () => {
    const w = new World({ players: 6, content: NOEV });
    w.ok("gather");
    w.ok("drill");
    w.advance(1500);
    expect(Object.values(w.s.members).every((m) => m.order !== null)).toBe(true);
    w.advance(DRILL_MS);
    expect(Object.values(w.s.members).every((m) => m.order === null)).toBe(true);
    expect(screenView(w.s, w.env).endsAt).toBeNull();
  });
});
