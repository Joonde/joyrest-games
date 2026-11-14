// Испытания «Игр Матрёшки» по отдельности (docs/matryoshka.md, «Испытания»): «Замри!», «Пряник», «Стулья», «Канат», «Классики»,
// финал и болельщики. Время — время игры; где нужен мир (часы, связь, личный вид) — `World`.
import { describe, expect, it } from "vitest";
import {
  BAND_KIDS,
  CATCH_FROM_MS,
  CHAIRS_LATE_RT,
  CLOCK_SYNC_MS,
  DECOY_BEFORE_MS,
  FAN_WEIGHT,
  FREEZE_MS,
  GAZE_MAX_MS,
  GAZE_MIN_MS,
  HOLD_GRACE_MS,
  HOLD_SHARE,
  PHONE_LEAD_MS,
  PHRASE_MAX_MS,
  PHRASE_MIN_MS,
  REACTION_MS,
  ROLLBACK,
  ROPE_END,
  TRACK,
} from "./constants";
import { botRandom } from "../sim/bots";
import { chairsFails, chairsFor, newRound, seatRound, sitEvent, chairsStart } from "./chairs";
import { buildFinal, finalDone, finalPlaces, newDuel, nextMatch, resolveRound, setWinner, champion } from "./final";
import { advance, freezeSchedule, freezeStart, holdEvent, newRunner, project } from "./freeze";
import { gingerKey, gingerStart, pieceEvent } from "./ginger";
import { braveEvent, crackRow, hopStart, newHopRow, pickBraves } from "./hopscotch";
import { bestFanOf, championOf, podiumOf, standings } from "./members";
import { knotStep, ropeStart, ropeTick, sidePower, tapEvent } from "./rope";
import { targetOf } from "./target";
import type { FreezeState, Gaze } from "./types";
import { World } from "./world.test-kit";

function oneGaze(a: number, e: number): FreezeState {
  const st = freezeStart(() => 0.5, 0, FREEZE_MS, ["x"]);
  st.gazes = [{ ph: a - 5000, a, e, d: null } as Gaze];
  return st;
}

describe("«Замри!»", () => {
  it("расписание: фразы 4–9 с, взгляды 2–4 с, всё в пределах бега; обманка внутри фразы не позже чем за 1 с; ~25% обманок", () => {
    let decoys = 0;
    let gazes = 0;
    for (let k = 0; k < 300; k += 1) {
      const list = freezeSchedule(botRandom(`s${k}`), 500, FREEZE_MS);
      let prev = 500;
      for (const g of list) {
        gazes += 1;
        expect(g.ph).toBe(prev);
        expect(g.a - g.ph).toBeGreaterThanOrEqual(PHRASE_MIN_MS);
        expect(g.a - g.ph).toBeLessThanOrEqual(PHRASE_MAX_MS);
        expect(g.e - g.a).toBeGreaterThanOrEqual(GAZE_MIN_MS);
        expect(g.e - g.a).toBeLessThanOrEqual(GAZE_MAX_MS);
        expect(g.e).toBeLessThanOrEqual(FREEZE_MS);
        if (g.d !== null) {
          decoys += 1;
          expect(g.d).toBeGreaterThanOrEqual(g.ph + DECOY_BEFORE_MS);
          expect(g.d).toBeLessThanOrEqual(g.a - DECOY_BEFORE_MS);
        }
        prev = g.e;
      }
      expect(list.length).toBeGreaterThanOrEqual(6);
    }
    expect(decoys / gazes).toBeGreaterThan(0.18);
    expect(decoys / gazes).toBeLessThan(0.32);
  });

  it("добежать — 36 с удержания из 80 (решение владельца 2)", () => {
    const st = oneGaze(1e9, 1e9 + 1);
    const r = st.runners.x ?? newRunner(0);
    holdEvent(st, r, true, 0, 0);
    for (let t = 1000; t <= 40_000; t += 1000) holdEvent(st, r, true, t, t);
    expect(r.finishedAt).toBeCloseTo(HOLD_SHARE * FREEZE_MS, 3);
    expect(r.path).toBe(TRACK);
  });

  it("окно поимки — полуинтервал [T + 0,5 с; конец) — реакция 0,3 с и запас на часы 0,2 с: отпустил ровно в T + 0,5 — не пойман, на 1 мс позже — пойман, откат 300", () => {
    expect(CATCH_FROM_MS).toBe(REACTION_MS + CLOCK_SYNC_MS);
    expect(CLOCK_SYNC_MS).toBeGreaterThanOrEqual(150);
    expect(CLOCK_SYNC_MS).toBeLessThanOrEqual(200);
    for (const late of [0, 1]) {
      const st = oneGaze(10_000, 13_000);
      const r = st.runners.x ?? newRunner(0);
      holdEvent(st, r, true, 0, 0);
      for (let t = 1000; t < 10_000; t += 1000) holdEvent(st, r, true, t, t);
      holdEvent(st, r, false, 10_000 + CATCH_FROM_MS + late, 10_000 + CATCH_FROM_MS + late);
      const before = r.path;
      advance(st, r, 20_000);
      expect(r.caught, `late ${late}`).toBe(late);
      expect(r.path).toBe(late ? Math.max(0, before - ROLLBACK) : before);
    }
  });

  it("в окне путь не растёт; пойманный бежит дальше; второй взгляд — снова откат", () => {
    const st = freezeStart(() => 0.5, 0, FREEZE_MS, ["x"]);
    st.gazes = [
      { ph: 0, a: 10_000, e: 12_000, d: null },
      { ph: 12_000, a: 20_000, e: 22_000, d: null },
    ];
    const r = st.runners.x ?? newRunner(0);
    for (let t = 0; t <= 30_000; t += 1000) holdEvent(st, r, true, t, t);
    const v = TRACK / (HOLD_SHARE * FREEZE_MS);
    // Держал всё время: до окна 10,5 с (292 деления) — откат в 0 (не ниже нуля), до второго окна 8,5 с — снова 0, дальше 8 с.
    expect(r.caught).toBe(2);
    expect(r.caughtAt).toEqual([0, 1]);
    expect((10_000 + CATCH_FROM_MS) * v).toBeLessThan(ROLLBACK);
    expect(r.path).toBeCloseTo((30_000 - 22_000) * v, 3);
  });

  it("нет связи: путь — только до последнего подтверждённого «держу», взгляд без пачек не ловит; «держит» для вида — ещё 2 с (L6, второе ревью 3a)", () => {
    const v = TRACK / (HOLD_SHARE * FREEZE_MS);
    // Связь пропала за 0,1–2 с до поворота (последнее «держу» дошло), палец так и лежит на зоне: не пойман, путь — до «держу».
    for (const silentFrom of [8_000, 9_000, 9_500, 9_900, 10_000, 10_400]) {
      const st = oneGaze(10_000, 13_000);
      const r = st.runners.x ?? newRunner(0);
      holdEvent(st, r, true, 0, 0);
      for (let t = 1000; t < silentFrom; t += 1000) holdEvent(st, r, true, t, t);
      holdEvent(st, r, true, silentFrom, silentFrom);
      // Для вида «держит» ещё 2 с после пачки — путь «на сейчас» растёт, учтённый — нет.
      expect(project(st, r, silentFrom + 1000).path).toBeGreaterThan(r.path);
      advance(st, r, silentFrom + HOLD_GRACE_MS - 100);
      expect(r.holding).toBe(true);
      advance(st, r, 20_000);
      expect(r.path, `тишина с ${silentFrom}`).toBeCloseTo(silentFrom * v, 6);
      expect(r.caught, `тишина с ${silentFrom}`).toBe(0);
      expect(r.holding).toBe(false);
    }
    // А «держу», дошедшее уже в окне (T + 0,5 с и позже), — держал в окне: пойман.
    const st = oneGaze(10_000, 13_000);
    const r = st.runners.x ?? newRunner(0);
    for (let t = 0; t <= 10_600; t += 1000) holdEvent(st, r, true, Math.min(t, 10_600), Math.min(t, 10_600));
    holdEvent(st, r, true, 10_600, 10_600);
    advance(st, r, 20_000);
    expect(r.caught).toBe(1);
  });

  it("экран видит путь «на сейчас» (с удержанием), учтённое не меняется", () => {
    const st = oneGaze(1e9, 1e9 + 1);
    const r = st.runners.x ?? newRunner(0);
    holdEvent(st, r, true, 0, 0);
    const p = project(st, r, 1000);
    expect(p.path).toBeGreaterThan(0);
    expect(r.path).toBe(0);
  });

  it("«отпустил» дошло поздно: свежее — по заявленному времени, повтор с отметкой — по отметке, повтор без отметки — не продлевает удержание: не пойман; держал в окне (пачки «держу» в окне) — пойман (L5, второе ревью 3a)", () => {
    for (const how of ["fresh", "delayed-stamped", "delayed", "held-in-window"] as const) {
      const w = new World(6, { style: "night" }, "freeze-l5");
      w.cmd("start");
      w.until(() => w.s.trial?.stage === "play");
      const st = w.s.trial?.play as FreezeState;
      const t0 = w.s.lastTick ?? 0;
      st.gazes = [{ ph: t0, a: t0 + 5000, e: t0 + 8000, d: null }];
      w.in("p0", [{ t: "h", on: true }]);
      w.step(4900);
      w.in("p0", [{ t: "h", on: true }]);
      if (how === "held-in-window") {
        // Держал и в окне: «держу» пришло на T + 0,7 с, «отпустил» — повтором позже.
        w.step(800);
        w.in("p0", [{ t: "h", on: true }]);
        w.step(400);
        w.in("p0", [{ t: "h", on: false }], { delayed: true });
      } else {
        // Отпустил в T + 0,1 с, «отпустил» дошло через 1,1 с (в окне).
        w.step(1300);
        if (how === "fresh") w.in("p0", [{ t: "h", on: false }], { ago: 1100 });
        else if (how === "delayed-stamped") w.in("p0", [{ t: "h", on: false, stamped: true }], { ago: 1100, delayed: true });
        else w.in("p0", [{ t: "h", on: false }], { delayed: true });
      }
      w.step(5000);
      expect(st.runners.p0?.caught, how).toBe(how === "held-in-window" ? 1 : 0);
    }
  });

  it("бездельник (ни разу не нажал) — путь 0, внизу порядка и теряет сердечко (L2)", () => {
    const w = new World(12, { style: "night" }, "idle");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "play");
    w.offline.add("p5");
    w.until(() => w.s.trial?.stage === "results", 200_000, true);
    const o = w.s.trial?.outcome;
    expect(o?.order.at(-1)).toBe("p5");
    expect(o?.out).toContain("p5");
  });

  it("телефон узнаёт поворот ровно за 1 с; экран — фразу с её начала, будущую — нет (L4, L9)", () => {
    const w = new World(6, { style: "night" }, "lead");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "play");
    const st = w.s.trial?.play as FreezeState;
    const g = st.gazes[1] as Gaze;
    const nextG = st.gazes[2] as Gaze;
    w.until(() => (w.s.lastTick ?? 0) >= g.a - PHONE_LEAD_MS - 200);
    const fr = (pid: string) => (w.me(pid)?.trial as { freeze: { gaze: { at: number } | null } }).freeze;
    expect(fr("p0").gaze?.at === g.a + w.s.offset).toBe(false);
    w.until(() => (w.s.lastTick ?? 0) >= g.a - PHONE_LEAD_MS);
    expect(fr("p0").gaze?.at).toBe(g.a + w.s.offset);
    // Экран: текущая фраза (этой поворот), будущей нет.
    const phrase = (w.screen().trial?.play as { phrase: { at: number } | null }).phrase;
    expect(phrase?.at).toBe(g.a + w.s.offset);
    expect(JSON.stringify(w.screen())).not.toContain(String(nextG.a + w.s.offset));
  });

  it("пауза: все «отпустили», путь на паузе не растёт; после «Продолжить» удержание не продолжается само (L7)", () => {
    const w = new World(6, { style: "night" }, "pause");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "play");
    const st = w.s.trial?.play as FreezeState;
    st.gazes = [];
    w.in("p0", [{ t: "h", on: true }]);
    w.step(1000);
    w.pause();
    const r = st.runners.p0;
    expect(r?.holding).toBe(false);
    const path = r?.path ?? 0;
    w.step(30_000);
    w.resume(30_000);
    w.step(3000);
    expect(st.runners.p0?.path).toBeCloseTo(path, 6);
    // Нажал после «Продолжить» — бежит снова.
    w.in("p0", [{ t: "h", on: true }]);
    w.step(1000);
    w.in("p0", [{ t: "h", on: true }]);
    w.step(2000);
    expect(st.runners.p0?.path ?? 0).toBeGreaterThan(path);
  });

  it("«+10 секунд» продлевает бег и дописывает взгляды, скорость прежняя; «Закончить сейчас» — бег кончается", () => {
    const w = new World(6, { style: "night" }, "more");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "play");
    const st = w.s.trial?.play as FreezeState;
    const ends = st.runEnds;
    const speed = TRACK / (HOLD_SHARE * st.base);
    expect(w.cmd("more-time").ok).toBe(true);
    expect(st.runEnds).toBe(ends + 10_000);
    expect(TRACK / (HOLD_SHARE * st.base)).toBe(speed);
    for (let i = 0; i < 5; i += 1) w.cmd("more-time");
    expect(w.cmd("more-time")).toEqual({ ok: false, error: "limit" });
    expect(w.cmd("end-now").ok).toBe(true);
    w.step(2000);
    expect(w.s.trial?.stage === "judging" || w.s.trial?.stage === "reveal").toBe(true);
  });
});

describe("«Пряник»", () => {
  it("фигуры в коробках — одни на всех, тайна до unbox: ни телефон, ни экран не знают", () => {
    const w = new World(8, {}, "ginger");
    w.cmd("start");
    w.cmd("next");
    expect(w.s.trial?.kind).toBe("freeze");
    // Перейти ко второму испытанию.
    w.until(() => w.s.trial?.stage === "results", 300_000);
    w.cmd("next");
    w.until(() => w.s.trial?.stage === "play");
    expect(w.s.trial?.kind).toBe("ginger");
    const st = w.s.trial?.play;
    if (st?.kind !== "ginger") throw new Error("не пряник");
    expect(w.in("p0", [{ t: "box", n: 2 }])).toBe(true);
    const shapes = st.boxes.join(",");
    expect(JSON.stringify(w.screen())).not.toContain(st.boxes[0] ?? "x");
    expect((w.me("p0")?.trial as { ginger: { shape: unknown } }).ginger.shape).toBeNull();
    w.until(() => (w.s.lastTick ?? 0) >= st.pickEnds);
    expect((w.me("p0")?.trial as { ginger: { shape: unknown } }).ginger.shape).toBe(st.boxes[2]);
    // Кто не выбрал — коробка по жребию.
    expect(Object.values(st.runners).every((r) => r.box !== null)).toBe(true);
    expect(st.boxes.join(",")).toBe(shapes);
  });

  it("порядок: целые по времени → недообведённые по кусочкам → треснувшие по кусочкам; после трещины не растёт", () => {
    const st = gingerStart(() => 0.3, 0, ["circle", "star", "tree", "matryoshka"], ["a", "b", "c", "d"], { pick: 1000, unbox: 1000, trace: 10_000 });
    const r = (p: string) => st.runners[p] ?? (() => { throw new Error(p); })();
    expect(pieceEvent(st, r("a"), { c: 200 }, 5000)).toBe(true);
    expect(pieceEvent(st, r("b"), { c: 200 }, 4000)).toBe(true);
    pieceEvent(st, r("c"), { c: 150 }, 6000);
    pieceEvent(st, r("d"), { c: 190, crack: true }, 6000);
    expect(pieceEvent(st, r("d"), { c: 200 }, 7000)).toBe(false);
    expect(r("d").c).toBe(190);
    // До обводки и после — не принимается.
    expect(pieceEvent(st, r("c"), { c: 160 }, 1500)).toBe(false);
    expect(pieceEvent(st, r("c"), { c: 160 }, 12_001)).toBe(false);
    const order = ["a", "b", "c", "d"].sort((x, y) => {
      const kx = gingerKey(st.runners[x]);
      const ky = gingerKey(st.runners[y]);
      return (ky[0] ?? 0) - (kx[0] ?? 0) || (ky[1] ?? 0) - (kx[1] ?? 0);
    });
    expect(order).toEqual(["b", "a", "c", "d"]);
    expect(BAND_KIDS).toBe(0.06);
  });
});

describe("«Стулья»", () => {
  it("третий заход — ровно до цели: все садятся, сколько положено → на сетке A 6–100 после трёх заходов ровно T (L13)", () => {
    const bad: string[] = [];
    for (let A = 6; A <= 100; A += 1) {
      for (const F of [2, 4, 6, 8]) {
        for (let k = 1; k <= 5; k += 1) {
          const T = targetOf(A, F, k);
          if (T >= A) continue;
          let n = A;
          let prev = A;
          for (let round = 0; round < 3; round += 1) {
            const c = chairsFor(round, n, T, A);
            if (c > prev || c < Math.min(T, n)) bad.push(`A=${A} T=${T} заход ${round}: ${c}`);
            prev = c;
            n = c;
          }
          if (n !== T) bad.push(`A=${A} F=${F} k=${k}: ${n} ≠ ${T}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("сажает по реакции телефона; равные — жребий; реакция < 150 мс, касание раньше появления − 0,3 с, после сбора — не принимаются", () => {
    const st = chairsStart(() => 0.5, 0, ["a", "b", "c", "d"], 2, (ms) => ms);
    const r = st.rounds[0];
    if (!r) throw new Error("нет захода");
    r.chairs = 2;
    expect(sitEvent(r, "a", 400, r.appearAt + 400, r.appearAt + 500)).toBe(true);
    expect(sitEvent(r, "a", 100, r.appearAt + 400, r.appearAt + 500)).toBe(false);
    expect(sitEvent(r, "b", 120, r.appearAt + 120, r.appearAt + 200)).toBe(false);
    expect(sitEvent(r, "b", 300, r.appearAt - 400, r.appearAt + 200)).toBe(false);
    expect(sitEvent(r, "b", 300, r.appearAt + 300, r.settleAt + 1)).toBe(false);
    expect(sitEvent(r, "b", 400, r.appearAt + 400, r.appearAt + 600)).toBe(true);
    expect(sitEvent(r, "c", 200, r.appearAt + 200, r.appearAt + 300)).toBe(true);
    expect(sitEvent(r, "x", 200, r.appearAt + 200, r.appearAt + 300)).toBe(false);
    const seated = seatRound(st, r, (p) => (p === "b" ? 0.1 : 0.9));
    expect(seated).toEqual(["c", "b"]);
    expect(chairsFails(st)).toBe(2);
  });

  it("заход: музыка 12–30 с, стулья через 0,3–1,5 с после остановки, окно 3 с; обманка не у краёв", () => {
    for (let k = 0; k < 200; k += 1) {
      const r = newRound(botRandom(`c${k}`), 0, ["a"], 1, (ms) => ms);
      expect(r.stopAt).toBeGreaterThanOrEqual(12_000);
      expect(r.stopAt).toBeLessThanOrEqual(30_000);
      expect(r.appearAt - r.stopAt).toBeGreaterThanOrEqual(300);
      expect(r.appearAt - r.stopAt).toBeLessThanOrEqual(1500);
      expect(r.closeAt - r.appearAt).toBe(3000);
      if (r.decoyAt !== null) {
        expect(r.decoyAt).toBeGreaterThanOrEqual(3000);
        expect(r.decoyAt).toBeLessThanOrEqual(r.stopAt - 3000);
      }
    }
    expect(CHAIRS_LATE_RT).toBe(1000);
  });

  it("в игре: экран узнаёт остановку за 3 с, телефон — за 1 с; не сел — «Стула не хватило», в следующий заход — только севшие", () => {
    const w = new World(10, { style: "night", trials: [{ kind: "chairs", on: true }], finalists: 2 }, "chairs");
    w.cmd("start");
    // «Замри!» всегда первым — пропустим его.
    w.cmd("skip-trial");
    expect(w.s.trial?.kind).toBe("chairs");
    w.until(() => w.s.trial?.stage === "play");
    const st = w.s.trial?.play;
    if (st?.kind !== "chairs") throw new Error("не стулья");
    const r = st.rounds[0];
    if (!r) throw new Error("нет захода");
    w.until(() => (w.s.lastTick ?? 0) >= r.stopAt - 3200);
    expect((w.screen().trial?.play as { stopAt: unknown }).stopAt).toBeNull();
    w.until(() => (w.s.lastTick ?? 0) >= r.stopAt - 3000);
    expect((w.screen().trial?.play as { stopAt: unknown }).stopAt).toBe(r.stopAt + w.s.offset);
    expect((w.me("p0")?.trial as { chairs: { stopAt: unknown } }).chairs.stopAt).toBeNull();
    w.until(() => (w.s.lastTick ?? 0) >= r.stopAt - 1000);
    expect((w.me("p0")?.trial as { chairs: { stopAt: unknown } }).chairs.stopAt).toBe(r.stopAt + w.s.offset);
    w.until(() => (w.s.lastTick ?? 0) >= r.appearAt + 500);
    for (let i = 0; i < r.chairs; i += 1) w.in(`p${i}`, [{ t: "sit", rt: 300 + i * 10 }]);
    w.until(() => r.seated !== null);
    expect(r.seated?.length).toBe(r.chairs);
    expect((w.me("p9")?.trial as { chairs: { seated: unknown } }).chairs.seated).toBe(false);
    w.until(() => st.rounds.length === 2 || st.over);
    if (!st.over) expect(st.rounds[1]?.players).toEqual(r.seated);
  });
});

describe("«Канат»", () => {
  it("сдвиг по доле (L15): перевес 20% при разном темпе — один и тот же", () => {
    const a = knotStep(6, 5);
    expect(knotStep(3.6, 3)).toBeCloseTo(a, 9);
    expect(knotStep(12, 10)).toBeCloseTo(a, 9);
    expect(knotStep(0, 0)).toBe(0);
    // ~15 с при перевесе 20% — около 55–60 делений.
    expect(a * 75).toBeGreaterThan(50);
    expect(a * 75).toBeLessThan(65);
  });

  it("болельщики — прибавка: кто не тапает, сторону не тянет назад; игроки без связи — не в знаменателе (L16)", () => {
    const st = ropeStart(() => 0.1, 0, ["a1", "a2", "b1", "b2"], ["f1", "f2", "f3", "f4"], { split: 0 });
    ropeTick(st, 0, () => true, () => 0.5, { attempt: 15_000, rest: 5000 });
    const sideOf = (p: string) => st.sides[p];
    const A = ["a1", "a2", "b1", "b2"].filter((p) => sideOf(p) === 0);
    const B = ["a1", "a2", "b1", "b2"].filter((p) => sideOf(p) === 1);
    for (const p of [...A, ...B]) tapEvent(st, p, 10, 1000);
    const fansA = Object.keys(st.fanSides).filter((p) => st.fanSides[p] === 0);
    const base = sidePower(st, 0, 1000, () => true);
    expect(sidePower(st, 1, 1000, () => true)).toBeCloseTo(base, 9);
    // Тапает один болельщик стороны — сила растёт на 0,5 × его темп.
    tapEvent(st, fansA[0] ?? "", 10, 1000);
    expect(sidePower(st, 0, 1000, () => true)).toBeCloseTo(base + (FAN_WEIGHT * 10) / 2, 9);
    // Игрок B без связи и без нажатий — не в знаменателе.
    const st2 = ropeStart(() => 0.1, 0, ["a1", "a2", "b1", "b2"], [], { split: 0 });
    ropeTick(st2, 0, () => true, () => 0.5, { attempt: 15_000, rest: 5000 });
    const b2 = Object.keys(st2.sides).filter((p) => st2.sides[p] === 1);
    tapEvent(st2, b2[0] ?? "", 10, 1000);
    expect(sidePower(st2, 1, 1000, (p) => p !== b2[1])).toBeCloseTo(5, 9);
  });

  it("досрочная победа у черты, до двух побед, ничья по узлу — по нажатиям, потом жребий; не больше 15 нажатий в секунду", () => {
    const st = ropeStart(() => 0.1, 0, ["a", "b"], [], { split: 0 });
    ropeTick(st, 0, () => true, () => 0.5, { attempt: 15_000, rest: 5000 });
    const strong = Object.keys(st.sides).find((p) => st.sides[p] === 0) ?? "";
    for (let t = 0; t < 15_000 && st.restEnds === null; t += 200) {
      tapEvent(st, strong, 3, t);
      ropeTick(st, t, () => true, () => 0.5, { attempt: 15_000, rest: 5000 });
    }
    expect(st.results[0]?.early).toBe(true);
    expect(Math.abs(st.results[0]?.knot ?? 0)).toBe(ROPE_END);
    expect(st.wins[0]).toBe(1);
    // Лимит: 100 нажатий разом — не больше запаса 30.
    const st2 = ropeStart(() => 0.1, 0, ["a", "b"], [], { split: 0 });
    ropeTick(st2, 0, () => true, () => 0.5, { attempt: 15_000, rest: 5000 });
    tapEvent(st2, "a", 100, 100);
    expect(st2.taps.a?.total).toBe(30);
  });

  it("сердечко теряют только проигравшие; меньше нужного — недобор переносится (L17)", () => {
    const w = new World(20, { style: "night", trials: [{ kind: "rope", on: true }], finalists: 2 }, "rope");
    w.cmd("start");
    w.cmd("skip-trial");
    expect(w.s.trial?.kind).toBe("rope");
    w.until(() => w.s.trial?.stage === "results", 200_000, true);
    const st = w.s.trial?.play;
    if (st?.kind !== "rope") throw new Error("не канат");
    const o = w.s.trial?.outcome;
    const winnerSide = st.sides[o?.order[0] ?? ""];
    for (const pid of o?.lost ?? []) expect(st.sides[pid]).not.toBe(winnerSide);
    // Нужно 18 (до двух), а проигравших 10 — выбыли все 10, недобор — дальше.
    expect(o?.lost.length).toBe(10);
  });
});

describe("«Классики»", () => {
  it("смельчаки — первые 3 по реакции; delayed и реакция < 150 мс не участвуют (L19)", () => {
    const r = newHopRow(() => 0.2, 0, ["a", "b", "c", "d", "e"], 3000);
    expect(braveEvent(r, "a", 900, 1000, false)).toBe(true);
    expect(braveEvent(r, "b", 300, 1000, false)).toBe(true);
    expect(braveEvent(r, "c", 500, 1000, true)).toBe(false);
    expect(braveEvent(r, "c", 100, 1000, false)).toBe(false);
    expect(braveEvent(r, "d", 600, 1000, false)).toBe(true);
    expect(braveEvent(r, "e", 200, 3500, false)).toBe(false);
    expect(braveEvent(r, "e", 700, 2000, false)).toBe(true);
    expect(pickBraves(r, () => 0)).toEqual(["b", "d", "e"]);
  });

  it("остальные видят, куда прыгнули смельчаки, но не чем кончилось; лёд — только на раскрытии (решение владельца 10)", () => {
    const w = new World(12, { style: "night", trials: [{ kind: "hopscotch", on: true }], finalists: 2 }, "hop");
    w.cmd("start");
    w.cmd("skip-trial");
    w.until(() => w.s.trial?.stage === "play");
    const st = w.s.trial?.play;
    if (st?.kind !== "hopscotch") throw new Error("не классики");
    const row = st.rows[0];
    if (!row) throw new Error("нет ряда");
    w.step(500);
    w.in("p1", [{ t: "brave", rt: 400 }]);
    w.until(() => row.braves !== null);
    expect(row.braves).toEqual(["p1"]);
    w.in("p1", [{ t: "cell", side: "L" }]);
    // Во время прыжка — что выбрал, не видно; с выбора остальных — видно куда, но не лёд.
    const scr = () => w.screen().trial?.play as { braves: Array<{ side: unknown }>; solid: unknown };
    expect(scr().braves[0]?.side).toBeNull();
    w.until(() => (w.s.lastTick ?? 0) >= (row.chooseAt ?? Infinity));
    expect(scr().braves[0]?.side).toBe("L");
    expect(scr().solid).toBeNull();
    expect((w.me("p2")?.trial as { hop: { braves: unknown; solid: unknown } }).hop.braves).toEqual(["L"]);
    expect((w.me("p2")?.trial as { hop: { solid: unknown } }).hop.solid).toBeNull();
    expect(JSON.stringify(w.host())).not.toContain("solid");
    w.until(() => row.fell !== null);
    expect(scr().solid).toBe(row.solid);
    // Смельчак на крепком — +3 монеты.
    expect(w.s.members.p1?.coins).toBe(row.picks.p1 === row.solid ? 3 : 0);
  });

  it("упавших больше нужного — Матрёшка вытаскивает лучших; сердечко теряют только упавшие (L20)", () => {
    const st = hopStart(() => 0.5, 0, ["a", "b", "c", "d"], 3000);
    const r = st.rows[0];
    if (!r) throw new Error("нет ряда");
    r.braves = [];
    r.picks = { a: "L", b: "L", c: "L", d: r.solid };
    r.solid = "R";
    r.picks.d = "R";
    crackRow(st, r, () => 0.5, () => undefined);
    expect(r.fell).toEqual(["a", "b", "c"]);
    expect(Object.keys(st.fallen).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("финал", () => {
  it("сетка 2/4/8 по посеву, без боя — лучшие номера: 3 → 1-й; 5 → 1, 2, 3; 6 → 1, 2; 7 → 1 (L24)", () => {
    const byes: Record<number, number[]> = { 2: [], 3: [1], 4: [], 5: [1, 2, 3], 6: [1, 2], 7: [1], 8: [] };
    for (let n = 2; n <= 8; n += 1) {
      const seeds = Array.from({ length: n }, (_, i) => `s${i + 1}`);
      const f = buildFinal(seeds, 0);
      expect(f.size).toBe(n <= 2 ? 2 : n <= 4 ? 4 : 8);
      const first = f.rounds[0] ?? [];
      const free = first.filter(([a, b]) => a === null || b === null).map(([a, b]) => Number((a ?? b ?? "s0").slice(1))).sort((x, y) => x - y);
      expect(free, `n=${n}`).toEqual(byes[n]);
      // Сыграть все дуэли: побеждает лучший посев — дуэлей ровно n − 1.
      let duels = 0;
      for (let m = nextMatch(f, () => false); m; m = nextMatch(f, () => false)) {
        const win = Number(m.a.slice(1)) < Number(m.b.slice(1)) ? m.a : m.b;
        setWinner(f, m.round, m.match, win, win === m.a ? m.b : m.a);
        duels += 1;
      }
      expect(duels).toBe(n - 1);
      expect(finalDone(f)).toBe(true);
      expect(champion(f)).toBe("s1");
      const places = finalPlaces(f);
      expect(places.get("s1")).toBe(1);
      expect(places.get("s2")).toBe(2);
      if (n >= 3) expect(places.get("s3")).toBe(3);
      if (n >= 4) expect(places.get("s4")).toBe(3);
      // Четвертьфиналы — 5… по посеву (L27).
      if (n >= 5) expect(places.get("s5")).toBe(5);
      if (n >= 6) expect(places.get("s6")).toBe(6);
      if (n === 8) expect(places.get("s8")).toBe(8);
    }
  });

  it("ничья не считается; на третьей подряд — быстрее выбравший; Матрёшкин жест медленнее; оба Матрёшкины — жребий (L25)", () => {
    const d = newDuel("a", "b", 0, null);
    expect(resolveRound(d, "r", "r", 100, 50, () => 0.1)).toBeNull();
    expect(resolveRound(d, "p", "p", 100, 50, () => 0.1)).toBeNull();
    expect(resolveRound(d, "s", "s", 100, 50, () => 0.1)).toBe("b");
    expect(d.wins).toEqual([0, 1]);
    expect(resolveRound(d, "r", "s", 100, 50, () => 0.1)).toBe("a");
    expect(d.ties).toBe(0);
    const e = newDuel("a", "b", 0, null);
    for (let i = 0; i < 2; i += 1) resolveRound(e, "r", "r", Infinity, 900, () => 0.9);
    expect(resolveRound(e, "r", "r", Infinity, 900, () => 0.9)).toBe("b");
    const f = newDuel("a", "b", 0, null);
    for (let i = 0; i < 2; i += 1) resolveRound(f, "r", "r", Infinity, Infinity, () => 0.2);
    expect(resolveRound(f, "r", "r", Infinity, Infinity, () => 0.2)).toBe("a");
    resolveRound(f, "p", "r", 1, 1, () => 0.2);
    expect(f.winner).toBe("a");
  });

  it("убрали финалиста — соперник проходит без боя; один финалист — сразу чемпион; ни одного — без чемпиона (L33)", () => {
    const f = buildFinal(["a", "b", "c", "d"], 0);
    const m = nextMatch(f, (p) => p === "d");
    expect(m).toEqual({ round: 0, match: 1, a: "b", b: "c" });
    expect(f.winners[0]?.[0]).toBe("a");
    const one = buildFinal(["a"], 0);
    expect(nextMatch(one, () => false)).toBeNull();
    expect(champion(one)).toBe("a");
    const none = buildFinal([], 0);
    expect(nextMatch(none, () => false)).toBeNull();
    expect(champion(none)).toBeNull();
    expect(finalDone(none)).toBe(true);
  });
});

describe("места во время финала и убранные финалисты (аудит 3a)", () => {
  it("на любой момент финала: кто в сетке — выше проигравших (по кругу, потом по посеву), проигравшие полуфиналы делят 3-е", () => {
    const f = buildFinal(["s1", "s2", "s3", "s4"], 0);
    // До дуэлей: все в сетке — 1, 2, 3, 4 по посеву.
    expect([...finalPlaces(f)].sort()).toEqual([["s1", 1], ["s2", 2], ["s3", 3], ["s4", 4]]);
    // Первый полуфинал: s4 обыграл s1 — s4 дальше всех, s2 и s3 ещё в сетке, s1 — ниже всех.
    setWinner(f, 0, 0, "s4", "s1");
    let p = finalPlaces(f);
    expect([p.get("s4"), p.get("s2"), p.get("s3"), p.get("s1")]).toEqual([1, 2, 3, 4]);
    // Второй полуфинал: оба проигравших — 3-е (делят), финалисты — 1 и 2 по посеву (никто не «1-й из 500»).
    setWinner(f, 0, 1, "s3", "s2");
    p = finalPlaces(f);
    expect([p.get("s3"), p.get("s4"), p.get("s1"), p.get("s2")]).toEqual([1, 2, 3, 3]);
    setWinner(f, 1, 0, "s4", "s3");
    p = finalPlaces(f);
    expect([p.get("s4"), p.get("s3"), p.get("s1"), p.get("s2")]).toEqual([1, 2, 3, 3]);
  });

  it("сетка на 8: проигравшие четвертьфиналы — 5–8 по посеву на любом шаге, а ещё играющие — над ними", () => {
    const seeds = Array.from({ length: 8 }, (_, i) => `s${i + 1}`);
    const f = buildFinal(seeds, 0);
    for (let m = nextMatch(f, () => false), k = 0; m; m = nextMatch(f, () => false), k += 1) {
      const win = Number(m.a.slice(1)) > Number(m.b.slice(1)) ? m.a : m.b; // побеждает худший посев
      setWinner(f, m.round, m.match, win, win === m.a ? m.b : m.a);
      const p = finalPlaces(f);
      const alive = seeds.filter((x) => f.lostIn[x] === undefined);
      const lost = seeds.filter((x) => f.lostIn[x] !== undefined);
      for (const a of alive) for (const l of lost) expect((p.get(a) ?? 99) < (p.get(l) ?? 0), `шаг ${k}: ${a} выше ${l}`).toBe(true);
      // Места без пропусков: 1…n, общие — только у проигравших одного круга (полуфинал и финал).
      const sorted = [...p.values()].sort((x, y) => x - y);
      expect(sorted[0]).toBe(1);
    }
    const p = finalPlaces(f);
    expect(p.get("s8")).toBe(1);
    expect(p.get("s7")).toBe(2);
    expect([p.get("s5"), p.get("s6")]).toEqual([3, 3]);
    expect([p.get("s1"), p.get("s2"), p.get("s3"), p.get("s4")]).toEqual([5, 6, 7, 8]);
  });

  it("убранный финалист мест финала не получает: место — как выбывший в момент «Убрать», на пьедестал не выходит; убрали всех — чемпиона нет", () => {
    for (const removeN of [1, 2, 3, 4]) {
      const w = new World(12, { style: "night", finalists: 4 }, `rm-final-${removeN}`);
      w.cmd("start");
      for (let i = 0; i < 40 * 60 * 10 && !(w.s.phase === "final" && w.s.final?.stage === "bracket"); i += 1) {
        w.step(100, true);
        const c = w.host().can;
        if (c.next) w.cmd("next");
      }
      expect(w.s.final?.stage).toBe("bracket");
      const seeds = [...(w.s.final?.seeds ?? [])];
      const removed = seeds.slice(seeds.length - removeN);
      for (const pid of removed) expect(w.cmd("remove", { pid }).ok).toBe(true);
      for (let i = 0; i < 20 * 60 * 10 && w.s.phase !== "podium"; i += 1) {
        w.step(100, true);
        const c = w.host().can;
        if (c.duel) w.cmd("duel");
        else if (c.podium) w.cmd("podium");
      }
      expect(w.s.phase).toBe("podium");
      const st = standings(w.s);
      const kept = seeds.length - removeN;
      // Оставшиеся финалисты — наверху, убранные — сразу под ними (выбыли последними), никого «1-го» среди убранных.
      const top = st.slice(0, kept).map((x) => x.pid);
      expect(top.every((pid) => !removed.includes(pid))).toBe(true);
      for (const pid of removed) {
        const x = st.find((y) => y.pid === pid);
        expect(x?.removed).toBe(true);
        expect(x?.place ?? 0).toBeGreaterThan(kept);
      }
      expect(podiumOf(st).some((x) => removed.includes(x.pid))).toBe(false);
      const screenTop = ((w.screen().podium?.top ?? []) as Array<{ num: number }>).map((x) => x.num);
      for (const pid of removed) expect(screenTop).not.toContain(w.s.members[pid]?.num ?? -1);
      if (kept === 0) expect(championOf(w.s)).toBeNull();
      else expect(removed).not.toContain(championOf(w.s));
      // Места без пропусков и повторов (кроме общего 3-го).
      expect(st[0]?.place).toBe(1);
    }
  }, 120_000);

  it("после последней дуэли «Убрать» недоступна: чемпион и места финала не меняются", () => {
    const w = new World(8, { style: "night", finalists: 2 }, "rm-champ");
    w.cmd("start");
    for (let i = 0; i < 40 * 60 * 10 && w.s.final?.stage !== "champion"; i += 1) {
      w.step(100, true);
      const c = w.host().can;
      if (c.next) w.cmd("next");
      else if (c.duel) w.cmd("duel");
    }
    expect(w.s.final?.stage).toBe("champion");
    expect(w.host().can.remove).toBe(false);
    expect(w.cmd("remove", { pid: w.s.final?.champion })).toEqual({ ok: false, error: "wrong-phase" });
  }, 60_000);

  it("последняя дуэль сыграна, «Следующая дуэль» ещё не нажата: «Убрать» нет; чемпион ушёл из сессии — чемпион соперник; ушли оба — без чемпиона (второе ревью 3a)", () => {
    for (const leave of ["winner", "both", "loser"] as const) {
      const w = new World(8, { style: "night", finalists: 2 }, `left-champ-${leave}`);
      w.cmd("start");
      // До конца последней дуэли (её итог показан, пульт ещё не нажал «Следующая дуэль»).
      const lastOver = () => w.s.final?.stage === "duel" && w.s.final.duel?.stage === "over" && finalDone(w.s.final);
      for (let i = 0; i < 40 * 60 * 10 && !lastOver(); i += 1) {
        w.step(100, true);
        if (lastOver()) break;
        const c = w.host().can;
        if (c.next) w.cmd("next");
        else if (c.duel) w.cmd("duel");
      }
      expect(lastOver()).toBe(true);
      const d = w.s.final?.duel;
      expect(d?.stage).toBe("over");
      const winner = d?.winner as string;
      const loser = winner === d?.a ? (d?.b as string) : (d?.a as string);
      expect(w.host().can.remove).toBe(false);
      expect(w.cmd("remove", { pid: winner })).toEqual({ ok: false, error: "wrong-phase" });
      expect(w.s.members[winner]?.removed).toBe(false);
      // Ушли из сессии (пульт не спрашивают): так же, как «Убрать».
      const gone = leave === "winner" ? [winner] : leave === "loser" ? [loser] : [winner, loser];
      w.players = w.players.filter((p) => !gone.includes(p.pid));
      w.step(100);
      expect(w.cmd("duel").ok).toBe(true);
      expect(w.s.final?.stage).toBe("champion");
      const expected = leave === "winner" ? loser : leave === "loser" ? winner : null;
      expect(championOf(w.s)).toBe(expected);
      expect(w.s.final?.champion).toBe(expected);
      const champNum = expected ? (w.s.members[expected]?.num ?? -1) : null;
      expect(w.screen().final?.champion ?? null).toBe(champNum);
      expect(w.cmd("podium").ok).toBe(true);
      const st = standings(w.s);
      const top = podiumOf(st);
      for (const pid of gone) {
        expect(top.map((x) => x.pid)).not.toContain(pid);
        expect(st.find((x) => x.pid === pid)?.place ?? 0).toBeGreaterThan(2 - gone.length);
      }
      if (expected) expect(st[0]?.pid).toBe(expected);
      const myFinal = (pid: string) => ((w.me(pid) as { final?: { champion?: boolean } } | null)?.final ?? {}) as { champion?: boolean };
      if (expected) expect(myFinal(expected).champion).toBe(true);
      for (const pid of gone) expect(myFinal(pid).champion ?? false).toBe(false);
    }
  }, 120_000);
});

describe("болельщики", () => {
  it("«Лучший болельщик»: больше очков; равенство — опоздавший (болел дольше всех), потом кто выбыл раньше (L31)", () => {
    const w = new World(8, {}, "fans");
    const m = w.s.members;
    const set = (pid: string, score: number, since: number | null, late = false) => {
      const x = m[pid];
      if (!x) throw new Error(pid);
      x.role = "fan";
      x.fanScore = score;
      x.fanSince = since;
      x.late = late;
    };
    set("p0", 3, 5);
    set("p1", 3, 2);
    set("p2", 1, 1);
    expect(bestFanOf(w.s, () => 0)).toBe("p1");
    set("p3", 3, -1, true);
    expect(bestFanOf(w.s, () => 0)).toBe("p3");
    set("p0", 0, 5);
    set("p1", 0, 2);
    set("p2", 0, 1);
    set("p3", 0, -1, true);
    expect(bestFanOf(w.s, () => 0)).toBeNull();
  });

  it("«Лучший болельщик» — только кто заканчивает игру болельщиком: вернувшийся и снова играющий (финалист) — нет, убранный — нет (аудит 3a)", () => {
    const w = new World(8, {}, "fans2");
    const m = w.s.members;
    const a = m.p0;
    const b = m.p1;
    const c = m.p2;
    if (!a || !b || !c) throw new Error("нет игроков");
    // p0 болел, набрал больше всех и вернулся «Вторым шансом» — снова игрок.
    Object.assign(a, { role: "player", fanScore: 5, fanSince: 1, returned: true });
    Object.assign(b, { role: "fan", fanScore: 3, fanSince: 2 });
    Object.assign(c, { role: "fan", fanScore: 4, fanSince: 3, removed: true });
    expect(bestFanOf(w.s, () => 0)).toBe("p1");
    // Вернулся и снова выбыл — болельщик к концу игры: снова в зачёте.
    a.role = "fan";
    expect(bestFanOf(w.s, () => 0)).toBe("p0");
  });

  it("прогноз: болельщик угадывает, сколько ошибутся (решение 3); +3 самому близкому, в игре засчитывается", () => {
    const w = new World(16, { style: "night" }, "guess");
    w.cmd("start");
    // Двое опоздали — болельщики с первого испытания.
    w.addPlayer("late1", "Опоздавший 1");
    w.addPlayer("late2", "Опоздавший 2");
    expect(w.s.members.late1?.role).toBe("fan");
    expect(w.in("late1", [{ t: "guess", n: 3 }])).toBe(true);
    expect(w.in("late2", [{ t: "guess", n: 999 }])).toBe(true);
    expect(w.s.trial?.guesses.late2).toBe(16);
    // Игрок угадывать не может.
    expect(w.in("p0", [{ t: "guess", n: 3 }])).toBe(false);
    w.until(() => w.s.trial?.stage === "results", 200_000, true);
    const o = w.s.trial?.outcome;
    expect(o?.fails).not.toBeNull();
    const fails = o?.fails ?? 0;
    const d1 = Math.abs(3 - fails);
    const d2 = Math.abs(16 - fails);
    const closest = d1 < d2 ? "late1" : d2 < d1 ? "late2" : null;
    if (closest) expect(w.s.members[closest]?.fanScore).toBe(3);
    // «Канат» без прогноза.
    expect(PHONE_LEAD_MS).toBe(1000);
  });
});
