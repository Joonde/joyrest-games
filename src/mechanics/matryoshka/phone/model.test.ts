/**
 * Телефон «Игр Матрёшки» без React: разбор личного вида, часы сервера, какой экран на каждом этапе. Личный вид — настоящий
 * (`personalView` правил в мире тестов с ботами), поэтому тест ловит расхождение телефона с правилами.
 */
import { describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../../data/types";
import type { ChairsState, FreezeState, HopState } from "../rules/types";
import { personalView } from "../rules/views";
import { World } from "../rules/world.test-kit";
import { applyReply, applyStream, avatarOf, CLOCK_TRUST_MS, emptyModel, gazeNow, leftUntil, numText, offsetOf, parseMe, reactionMs, screenOf, type PhoneModel } from "./model";

function snap(w: World, pid: string, paused = false): RoomStreamEvent {
  return { type: "snapshot", at: w.now, paused, every: 1000, offlineMs: 3000, data: personalView(w.s, pid, w) };
}

function modelOf(w: World, pid: string): PhoneModel {
  return applyStream(emptyModel(w.now), snap(w, pid), w.now);
}

function toStage(w: World, stage: string): void {
  w.until(() => w.s.trial?.stage === stage, 300_000, true);
}

function toTrial(w: World, kind: string): void {
  if (w.s.phase === "lobby") w.cmd("start");
  for (let i = 0; i < 3000; i += 1) {
    const tr = w.s.trial;
    if (tr && tr.kind === kind && (tr.stage === "open" || tr.stage === "rules")) return;
    if (tr && (tr.stage === "open" || tr.stage === "rules")) w.cmd("skip-trial");
    else if (w.host().can.next) w.cmd("next");
    w.step(100, true);
  }
}

describe("телефон: разбор личного вида", () => {
  it("мусор — null; настоящий вид — номер, роль, сердечки, стиль, сердечек на старте", () => {
    expect(parseMe(null)).toBeNull();
    expect(parseMe({ num: "x" })).toBeNull();
    const w = new World(8, { style: "night" }, "parse");
    w.cmd("start");
    const me = parseMe(personalView(w.s, "p2", w));
    expect(me?.num).toBe(3);
    expect(me?.role).toBe("player");
    expect(me?.hearts).toBe(1);
    expect(me?.lives).toBe(1);
    expect(me?.style).toBe("night");
  });

  it("«№ 027», смайлик из имени для кружка", () => {
    expect(numText(27)).toBe("№ 027");
    expect(avatarOf("🦊 Аня")).toEqual({ mark: "🦊", rest: "Аня" });
    expect(avatarOf("Тимур").mark).toBe("Т");
  });
});

describe("телефон: часы сервера", () => {
  it("замер GET /api/time — основной; нет замера — нижняя граница по потоку; замер ниже границы — граница", () => {
    let m = emptyModel(1000);
    m = applyStream(m, { type: "room", at: 6000, paused: false }, 1000);
    expect(m.floor).toBe(5000);
    expect(offsetOf(m, null)).toBe(5000);
    expect(offsetOf(m, 5200)).toBe(5200);
    expect(offsetOf(m, 5000 - CLOCK_TRUST_MS - 1)).toBe(5000);
    // Позднее событие (долгая дорога) границу не опускает.
    m = applyReply(m, { at: 6500, paused: false }, 2000);
    expect(m.floor).toBe(5000);
  });

  it("на паузе отсчёты стоят", () => {
    let m = emptyModel(0);
    m = applyStream(m, { type: "room", at: 10_000, paused: true }, 0);
    expect(leftUntil(m, 15_000, 12_000)).toBe(5000);
    m = applyStream(m, { type: "room", at: 12_000, paused: false }, 2000);
    expect(leftUntil(m, 15_000, 12_000)).toBe(3000);
  });

  it("реакция — от назначенного момента по сверенным часам (не от отрисовки)", () => {
    expect(reactionMs(10_000, 10_420)).toBe(420);
    expect(reactionMs(10_000, 9_900)).toBe(0);
  });
});

describe("телефон: какой экран на каждом этапе", () => {
  it("лобби, правило, отсчёт, «Замри!», взгляд по сверенным часам, «всматривается», итоги", () => {
    const w = new World(12, {}, "screens");
    expect(screenOf(modelOf(w, "p0"), w.now)).toBe("lobby");
    w.cmd("start");
    toStage(w, "rules");
    expect(screenOf(modelOf(w, "p0"), w.now)).toBe("intro");
    toStage(w, "countdown");
    expect(screenOf(modelOf(w, "p0"), w.now)).toBe("countdown");
    toStage(w, "play");
    const m = modelOf(w, "p0");
    expect(screenOf(m, w.now)).toBe("freeze");
    const g = (w.s.trial?.play as FreezeState).gazes[0];
    expect(g).toBeDefined();
    if (g) {
      w.until(() => w.now >= g.a + w.s.offset - 1000 + 100, 60_000, true);
      const f = modelOf(w, "p0").me?.trial?.freeze ?? null;
      expect(f?.gaze?.at).toBe(g.a + w.s.offset);
      // До поворота — не смотрит; в назначенный момент по часам телефона — смотрит (без новой сводки).
      expect(gazeNow(f, g.a + w.s.offset - 1)).toBe(false);
      expect(gazeNow(f, g.a + w.s.offset)).toBe(true);
      expect(gazeNow(f, g.e + w.s.offset)).toBe(false);
    }
    toStage(w, "judging");
    expect(screenOf(modelOf(w, "p0"), w.now)).toBe("judging");
    toStage(w, "results");
    expect(screenOf(modelOf(w, "p0"), w.now)).toBe("result");
  });

  it("болельщик (опоздавший): прогноз на правиле, «болей» во время бега", () => {
    const w = new World(10, {}, "fan");
    w.cmd("start");
    w.addPlayer("late", "Лёва");
    expect(screenOf(modelOf(w, "late"), w.now)).toBe("guess");
    toStage(w, "play");
    expect(screenOf(modelOf(w, "late"), w.now)).toBe("watch");
  });

  it("«Стулья»: танец → «Стоп!» → стулья по сверенным часам телефона → сел / не хватило", () => {
    const w = new World(12, {}, "chairs");
    toTrial(w, "chairs");
    toStage(w, "play");
    const c = w.s.trial?.play as ChairsState;
    const r = c.rounds[0];
    expect(r).toBeDefined();
    if (!r) return;
    expect(screenOf(modelOf(w, "p0"), w.now)).toBe("chairs-music");
    w.until(() => (w.s.lastTick ?? 0) >= r.stopAt - 900, 60_000, true);
    const m = modelOf(w, "p0");
    const stop = r.stopAt + w.s.offset;
    const appear = r.appearAt + w.s.offset;
    expect(m.me?.trial?.chairs?.appearAt).toBe(appear);
    expect(screenOf(m, stop - 1)).toBe("chairs-music");
    expect(screenOf(m, stop)).toBe("chairs-stop");
    expect(screenOf(m, appear)).toBe("chairs-tap");
    w.until(() => r.seated !== null, 20_000, true);
    const sat = r.seated?.[0];
    const missed = r.players.find((p) => !r.seated?.includes(p));
    if (sat) expect(screenOf(modelOf(w, sat), w.now)).toBe("chairs-seated");
    if (missed) expect(screenOf(modelOf(w, missed), w.now)).toBe("chairs-missed");
  });

  it("«Классики»: смельчак, выбор с клетками смельчаков, лёд; «Канат» — сторона и узел", () => {
    const w = new World(14, {}, "hop");
    toTrial(w, "hopscotch");
    toStage(w, "play");
    expect(screenOf(modelOf(w, "p0"), w.now)).toBe("hop-brave");
    const h = w.s.trial?.play as HopState;
    const row = h.rows[0];
    if (!row) return;
    w.until(() => row.chooseAt !== null && (w.s.lastTick ?? 0) > row.chooseAt, 30_000, true);
    const someone = Object.keys(h.fallen).length === 0 ? row.jumpers.find((p) => !row.braves?.includes(p)) : undefined;
    if (someone) {
      const m = modelOf(w, someone);
      expect(screenOf(m, w.now)).toBe("hop-choose");
      // Куда прыгнули смельчаки — видно; чем кончилось (крепкий лёд) — нет.
      expect(m.me?.trial?.hop?.solid).toBeNull();
    }
    const w2 = new World(12, {}, "rope");
    toTrial(w2, "rope");
    toStage(w2, "play");
    w2.until(() => JSON.stringify(personalView(w2.s, "p0", w2)).includes('"sub":"pull"'), 30_000, true);
    const m2 = modelOf(w2, "p0");
    expect(screenOf(m2, w2.now)).toBe("rope");
    expect(m2.me?.trial?.rope?.side === 0 || m2.me?.trial?.rope?.side === 1).toBe(true);
  });

  it("закрытие потока и пауза сильнее этапа", () => {
    const w = new World(8, {}, "close");
    w.cmd("start");
    toStage(w, "play");
    let m = modelOf(w, "p0");
    expect(screenOf({ ...m, closed: "busy" }, w.now)).toBe("tab");
    expect(screenOf({ ...m, closed: "removed" }, w.now)).toBe("removed");
    expect(screenOf({ ...m, closed: "abandoned" }, w.now)).toBe("abandoned");
    expect(screenOf({ ...m, closed: "finished" }, w.now)).toBe("over");
    m = applyStream(m, { type: "room", at: w.now, paused: true }, w.now);
    expect(screenOf(m, w.now)).toBe("pause");
    expect(screenOf(emptyModel(0), 0)).toBe("connecting");
  });

  it("вся игра ботами: на каждом шаге телефон любого игрока показывает известный экран, вид разбирается без потерь", () => {
    const w = new World(30, {}, "full");
    w.cmd("start");
    const seen = new Set<string>();
    for (let i = 0; i < 40 * 60 * 10 && w.s.phase !== "podium"; i += 1) {
      w.step(100, true);
      if (i % 5 === 0)
        for (const pid of ["p0", "p7", "p19", "p29"]) {
          const m = modelOf(w, pid);
          expect(m.me).not.toBeNull();
          const s = screenOf(m, w.now);
          expect(s).not.toBe("connecting");
          seen.add(s);
        }
      const c = w.host().can;
      if (c.chance) w.cmd("chance");
      else if (c.next) w.cmd("next");
      else if (c.duel) w.cmd("duel");
      else if (c.podium) w.cmd("podium");
    }
    expect(w.s.phase).toBe("podium");
    for (const s of ["intro", "countdown", "freeze", "judging", "result", "ginger-trace", "rope", "hop-choose"]) expect(seen.has(s), s).toBe(true);
    expect(screenOf(modelOf(w, "p0"), w.now)).toBe("podium");
  });
});
