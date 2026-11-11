/**
 * Телефон «Бубликатора» без React (Блок 2b): поток комнаты → модель → экран. Комната — понарошку (`world.test-kit.ts`):
 * личное телефона — как в настоящей комнате (снимок `personalSnapshot`, дальше куски `{ t: "me" }` и `{ t: "crew" }`).
 */
import { describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../../data/types";
import { DOCK_MS, EVENT_MS, HULL_MAX, LAUNCH_MS, MOVES_PER_SECOND, REPAIR_MS, WARN_MS } from "../rules/constants";
import { crewPlayers } from "../rules/crews";
import { personalSnapshot, personalView } from "../rules/views";
import { World } from "../rules/world.test-kit";
import { cap, THEME_WORDS, verb, wordsOf } from "../lexicon";
import { BUZZ_GAP_MS, BUZZ_MS, buzz, canVibrate, vibrationFor } from "./haptics";
import { chunkUrlOf, importWithRetry } from "./chunk";
import { twoColumns, VOTE_SHORT_NAME } from "./layout";
import { MoveGate, PHONE_MOVES_PER_SECOND } from "./moves";
import { TapBatch } from "./taps";
import { ShakeMeter, shakeMode, shakeReport, type ShakeSent } from "./shake";
import { applyReply, applyStream, clockText, closeFinished, emptyModel, flashOf, leftUntil, localNow, orderLeft, problemOf, ROLE_AUTO_MS, screenOf, serverNow, silent, withClock, type PhoneModel } from "./model";

const NOEV = { events: { meteor: false, pull: false, sos: false, captain: false } };
const ALL_ON = { events: { meteor: true, pull: true, sos: true, captain: true } };

/** Телефон в понарошечной комнате: местные часы отстают от сервера на `lag` мс, события доходят сразу. */
class TestPhone {
  m: PhoneModel;
  constructor(
    readonly w: World,
    readonly pid: string,
    readonly lag = 0,
  ) {
    this.m = emptyModel(this.local);
    this.snapshot();
  }
  get local(): number {
    return this.w.env.now - this.lag;
  }
  snapshot(): void {
    const data = personalSnapshot(this.w.s, this.pid, this.w.env);
    this.feed({ type: "snapshot", at: this.w.env.now, paused: this.w.env.paused, every: 2000, offlineMs: 4000, data });
  }
  feed(e: RoomStreamEvent): void {
    this.m = applyStream(this.m, e, this.local);
  }
  /** Забрать из комнаты всё, что ушло этому телефону. */
  take(): void {
    const mine = this.w.env.sent.filter((x) => x.pid === this.pid);
    this.w.env.sent = this.w.env.sent.filter((x) => x.pid !== this.pid);
    for (const x of mine) this.feed({ type: "event", at: this.w.env.now, data: x.data });
  }
  get screen() {
    return screenOf(this.m, this.local);
  }
}

function endFlight(w: World): void {
  if (w.s.leg?.stage === "launch") w.advance(LAUNCH_MS);
  const leg = w.s.leg;
  if (!leg) throw new Error("нет перелёта");
  leg.event = null;
  leg.schedule = [];
  leg.flight = leg.duration;
  w.step();
}

describe("телефон «Бубликатора»: модель", () => {
  it("снимок, потом куски: телефон, сложив их, видит то же, что сервер; состав экипажа — отдельно", () => {
    const w = new World({ players: 8, content: NOEV });
    const p = new TestPhone(w, "p0");
    expect(p.screen).toBe("lobby");
    w.toFlight();
    w.advance(12_000, 100, () => {
      p.take();
      const m = Object.values(w.s.members).find((x) => x.order && w.env.now % 700 === 0);
      if (m) w.fulfil(m.pid);
    });
    w.advance(600);
    p.take();
    const truth = personalView(w.s, "p0", w.env);
    expect(p.m.view?.panel).toEqual(truth?.panel);
    expect(p.m.view?.me).toEqual(truth?.me);
    expect(p.m.view?.ship).toEqual(truth?.ship);
    expect(p.m.crew).toEqual(truth?.crew);
    expect(p.screen).toBe("panel");
  });

  it("экран по этапу: лобби → экипажи → тренировка → взлёт → пульт → привал → пьедестал (карточка)", () => {
    const w = new World({ players: 6, content: { ...NOEV, legs: 2 } });
    const p = new TestPhone(w, "p0");
    const seen: string[] = [p.screen];
    const look = () => {
      p.take();
      if (seen[seen.length - 1] !== p.screen) seen.push(p.screen);
    };
    w.ok("gather");
    w.step();
    look();
    w.ok("drill");
    w.step();
    look();
    w.ok("start");
    w.step();
    look();
    w.advance(LAUNCH_MS + 200);
    look();
    endFlight(w);
    look();
    w.ok("next");
    w.step();
    look();
    w.advance(LAUNCH_MS + 200);
    look();
    endFlight(w);
    look();
    w.ok("podium");
    w.step();
    look();
    expect(seen).toEqual(["lobby", "crews", "drill", "launch", "panel", "dock", "launch", "panel", "dock", "card"]);
    expect(p.m.view?.card?.total).toBe(personalView(w.s, "p0", w.env)?.card?.total);
    // «Завершить игру» (аудит 2b, №3): поток закрылся с `finished` — карточка остаётся, а не «Игра окончена».
    p.feed({ type: "closed", at: w.env.now, reason: "finished" });
    expect(p.screen).toBe("card");
    // Пачка или подписка получили отказ «игра завершена» — то же самое (часы не трогаются).
    const before = p.m.offset;
    p.m = closeFinished(p.m);
    expect([p.screen, p.m.offset]).toEqual(["card", before]);
  });

  it("ошибки связи (аудит 2b, №4): «завершена» — экран итогов, а не «обновите страницу»; «забыта» — пересоздать отправителя", () => {
    const err = (reason?: string) => Object.assign(new Error("x"), reason ? { reason } : {});
    expect(problemOf(err("finished"))).toBe("finished");
    expect(problemOf(err("abandoned"))).toBe("abandoned");
    for (const r of ["removed", "replaced", "busy"]) expect(problemOf(err(r))).toBe("quiet");
    expect(problemOf(err())).toBe("error");
    expect(problemOf(null)).toBe("error");
    // После перезагрузки завершённой игры: снимка нет, подписка ответила «finished» — «Игра окончена», а не «Подключаемся».
    const m = emptyModel(0);
    expect(screenOf(m)).toBe("connecting");
    expect(screenOf(closeFinished(m))).toBe("over");
  });

  it("пауза: экран «Пауза», остаток приказа — `left` сервера и не тикает; после «Продолжить» — с того же места", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.advance(1500);
    const pid = Object.values(w.s.members).find((m) => m.order)?.pid ?? "p0";
    const p = new TestPhone(w, pid);
    const before = orderLeft(p.m, p.local) ?? 0;
    expect(before).toBeGreaterThan(0);
    w.pause();
    p.feed({ type: "room", at: w.env.now, paused: true });
    w.step();
    p.take();
    const frozen = orderLeft(p.m, p.local);
    w.env.now += 60_000;
    p.take();
    expect(p.screen).toBe("pause");
    expect(orderLeft(p.m, p.local)).toBe(frozen);
    // Любой отсчёт по моменту сервера тоже стоит на паузе.
    const at = serverNow(p.m, p.local) + 5000;
    const l1 = leftUntil(p.m, at, p.local);
    w.env.now += 3000;
    expect(leftUntil(p.m, at, p.local)).toBe(l1);
    w.resume();
    p.feed({ type: "room", at: w.env.now, paused: false });
    w.advance(600);
    p.take();
    expect(p.screen).toBe("panel");
    expect(Math.abs((orderLeft(p.m, p.local) ?? 0) - ((frozen ?? 0) - 600))).toBeLessThanOrEqual(260);
  });

  it("часы: телефон отстаёт на 7 минут — остаток приказа по часам сервера тот же", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.advance(1500);
    const pid = Object.values(w.s.members).find((m) => m.order)?.pid ?? "p0";
    const exact = new TestPhone(w, pid, 0);
    const late = new TestPhone(w, pid, 420_000);
    expect(orderLeft(late.m, late.local)).toBe(orderLeft(exact.m, exact.local));
    // Ответ на пачку с часами раньше прошлого замера сдвиг не портит (пришёл позже, чем ушёл).
    late.m = applyReply(late.m, { at: w.env.now - 400, paused: false }, late.local);
    expect(orderLeft(late.m, late.local)).toBe(orderLeft(exact.m, exact.local));
  });

  it("вспышки приказа: выполнено, помог, не успели, отменён — 1 секунду", () => {
    const w = new World({ players: 6, content: NOEV });
    w.toFlight();
    w.advance(1500);
    const m = Object.values(w.s.members).find((x) => x.order && w.s.controls[x.order.control]?.owner !== x.pid);
    if (!m?.order) throw new Error("приказ");
    const owner = w.s.controls[m.order.control]?.owner ?? "";
    const pm = new TestPhone(w, m.pid);
    const po = new TestPhone(w, owner);
    w.fulfil(m.pid);
    w.advance(800);
    pm.take();
    po.take();
    expect(flashOf(pm.m, pm.local)?.kind).toBe("done");
    expect(["helped", "done"]).toContain(flashOf(po.m, po.local)?.kind);
    w.advance(1100);
    pm.take();
    expect(flashOf(pm.m, pm.local)).toBeNull();
    // Просрочка.
    const late = Object.values(w.s.members).find((x) => x.order);
    if (!late?.order) throw new Error("приказ 2");
    const pl = new TestPhone(w, late.pid);
    late.order.due = -1;
    w.step();
    pl.take();
    expect(flashOf(pl.m, pl.local)?.kind).toBe("fail");
    // Отменён: хозяин прибора пропал со связи.
    const victim = Object.values(w.s.members).find((x) => x.order && w.s.controls[x.order.control]?.owner !== x.pid);
    if (!victim?.order) throw new Error("приказ 3");
    const pv = new TestPhone(w, victim.pid);
    w.offline(w.s.controls[victim.order.control]?.owner ?? "");
    w.advance(200);
    pv.take();
    expect(flashOf(pv.m, pv.local)?.kind).toBe("cancel");
  });

  it("события: предупреждение — пульт с плашкой, потом свой экран события; ремонт; финиш", () => {
    const w = new World({ players: 6, content: ALL_ON });
    w.toFlight();
    const p = new TestPhone(w, "p0");
    const crew = w.s.crews.find((c) => c.id === w.member("p0").crew);
    for (const kind of ["meteor", "pull", "sos", "captain"] as const) {
      // Урон прошлых событий не должен отправить экипаж на ремонт посреди проверки.
      for (const c of w.s.crews) {
        c.hull = HULL_MAX;
        c.repair = null;
      }
      // Только ручные события: расписание — пустое.
      if (w.s.leg) w.s.leg.schedule = [];
      if (w.s.leg?.event) w.ok("event-end");
      w.step();
      expect(w.cmd("event", { kind })).toMatchObject({ ok: true });
      w.step();
      p.take();
      expect(p.screen).toBe("panel");
      expect(p.m.view?.event?.warn).toBe(true);
      w.advance(WARN_MS + 100);
      p.take();
      const captain = crewPlayers(w.s, crew?.id ?? -1)[0]?.pid === "p0";
      expect(p.screen).toBe(kind === "sos" ? (captain ? "sos" : "sos-crew") : kind === "captain" ? "deck" : kind);
      expect(leftUntil(p.m, p.m.view?.event?.endsAt, p.local)).toBeGreaterThan(0);
      w.ok("event-end");
      w.advance(31_000);
      p.take();
    }
    // Ремонт: корпус в ноль.
    if (!crew) throw new Error("экипаж");
    crew.hull = 0.1;
    for (const m of crewPlayers(w.s, crew.id)) if (m.order) m.order.due = -1;
    w.step();
    p.take();
    expect(p.screen).toBe("repair");
    expect(leftUntil(p.m, p.m.view?.repair?.until, p.local)).toBeLessThanOrEqual(REPAIR_MS);
    w.advance(REPAIR_MS + 200);
    p.take();
    expect(p.screen).toBe("panel");
    crew.dist = 999.99;
    const m = crewPlayers(w.s, crew.id).find((x) => x.order);
    if (m) w.fulfil(m.pid);
    w.advance(800);
    p.take();
    if (crew.finishedAt !== null) {
      expect(p.screen).toBe("finish");
      expect(p.m.finishedAt).not.toBeNull();
    }
  });

  it("окно тайной роли (аудит 2b, №6): закрывается само через 8 с после начала полёта, хоть «Понятно» и не нажали", () => {
    const w = new World({ players: 12, content: { ...NOEV, saboteur: true } });
    for (let i = 0; i < 12; i += 1) w.send(`p${i}`, [{ t: "crew", crew: i < 6 ? 0 : 1 }]);
    w.ok("gather");
    w.ok("start");
    w.step();
    const p = new TestPhone(w, "p1");
    expect(p.screen).toBe("role");
    w.advance(LAUNCH_MS + 200);
    p.take();
    expect(p.m.view?.stage).toBe("fly");
    expect(p.screen).toBe("role");
    w.advance(ROLE_AUTO_MS - 1000);
    p.take();
    expect(p.screen).toBe("role");
    w.advance(1500);
    p.take();
    expect(p.screen).toBe("panel");
    // Сервер о «Понятно» не знает — роль не «прочитана», просто окно не загораживает пульт.
    expect(p.m.view?.role?.seen).toBe(false);
  });

  it("диверсант: окно роли до «Понятно», голосование само через 10 с, итог; без диверсанта — «не было»", () => {
    const w = new World({ players: 12, content: { ...NOEV, saboteur: true } });
    for (let i = 0; i < 12; i += 1) w.send(`p${i}`, [{ t: "crew", crew: i < 6 ? 0 : 1 }]);
    w.toFlight();
    const p = new TestPhone(w, "p0");
    expect(p.screen).toBe("role");
    w.send("p0", [{ t: "role-ok" }]);
    w.step();
    p.take();
    expect(p.screen).toBe("panel");
    endFlight(w);
    p.take();
    expect(p.screen).toBe("dock");
    w.advance(DOCK_MS + 200);
    p.take();
    expect(p.screen).toBe("vote");
    const cand = p.m.view?.vote?.candidates[0]?.pid ?? "";
    w.send("p0", [{ t: "vote", pid: cand }]);
    w.step();
    p.take();
    expect(p.m.view?.vote?.mine).toBe(cand);
    w.ok("vote-end");
    w.step();
    p.take();
    expect(p.screen).toBe("voted");
    // Экипаж без диверсанта (меньше 5 человек).
    const s = new World({ players: 12, content: { ...NOEV, saboteur: true } });
    for (let i = 0; i < 12; i += 1) s.send(`p${i}`, [{ t: "crew", crew: i < 3 ? 0 : 1 }]);
    s.toFlight();
    const small = new TestPhone(s, "p0");
    endFlight(s);
    s.ok("vote");
    s.step();
    small.take();
    expect(small.screen).toBe("nosab");
  });

  it("закрытие потока: другая вкладка, забыта, убрали, завершена; дублёр и «нет связи»", () => {
    const base = emptyModel(0);
    const closed = (reason: "busy" | "replaced" | "abandoned" | "removed" | "finished") => screenOf(applyStream(base, { type: "closed", at: 1, reason }, 0));
    expect(closed("busy")).toBe("tab");
    expect(closed("replaced")).toBe("tab");
    expect(closed("abandoned")).toBe("abandoned");
    expect(closed("removed")).toBe("removed");
    expect(closed("finished")).toBe("over");
    // Новый снимок после «Открыть здесь» снимает закрытие.
    const w = new World({ players: 6, content: NOEV });
    const p = new TestPhone(w, "p0");
    p.feed({ type: "closed", at: w.env.now, reason: "busy" });
    expect(p.screen).toBe("tab");
    p.snapshot();
    expect(p.screen).toBe("lobby");
    // Связь: молчит дольше 6 с — «нет связи», браузер без сети — сразу.
    expect(silent(p.m, p.local, true)).toBe(false);
    expect(silent(p.m, p.local + 6100, true)).toBe(true);
    expect(silent(p.m, p.local, false)).toBe(true);
    // Дублёр: опоздавший посреди перелёта видит пульт хозяина.
    w.toFlight();
    w.addPlayer("late");
    const d = new TestPhone(w, "late");
    expect(d.m.view?.me.role).toBe("double");
    expect(d.screen).toBe("panel");
    expect(d.m.view?.panel.map((c) => c.id)).toEqual(w.member(w.member("late").doubleOf ?? "").panel);
  });

  it("сила тряски копится во времени (аудит 2b, круг 2, №1): рывок 0,25 с → щит < 25; трясут 10 с → ~100; на столе → ~0", () => {
    // Датчик 60 Гц, такт телефона 0,4 с: накопленная сила (`ShakeMeter`) → `shakeReport` → комната.
    const run = (accAt: (ms: number) => number): number[] => {
      const w = new World({ players: 6, content: { events: { meteor: true, pull: false, sos: false, captain: false } } });
      w.toFlight();
      if (w.s.leg) w.s.leg.schedule = [];
      w.ok("event", { kind: "meteor" });
      w.advance(WARN_MS + 100);
      const pids = Object.keys(w.s.members);
      const st = new Map(pids.map((p) => [p, { meter: new ShakeMeter(), sent: { id: null, p: 0 } as ShakeSent }]));
      let t = 0;
      while (w.s.leg?.event) {
        for (let k = 0; k < 24; k += 1) for (const x of st.values()) x.meter.add(accAt(t + k * 16.7), t + k * 16.7);
        t += 400;
        w.advance(400);
        const ev = w.s.leg?.event;
        if (!ev) break;
        for (const [p, x] of st) {
          const r = shakeReport(x.sent, ev.id, x.meter.value);
          x.sent = r.next;
          if (r.send !== null) w.send(p, [{ t: "shake", p: r.send }]);
        }
      }
      return w.s.crews.map((c) => Math.round(c.legShield));
    };
    for (const shield of run((ms) => (ms > 300 && ms < 550 ? 20 : 0.3))) expect(shield).toBeLessThan(25);
    for (const shield of run(() => 20)) expect(shield).toBeGreaterThanOrEqual(90);
    for (const shield of run(() => 0.3)) expect(shield).toBeLessThanOrEqual(2);
    // Сам счётчик: пропуск показаний (вкладка уснула) не считается тряской.
    const m = new ShakeMeter();
    m.add(20, 0);
    m.add(20, 5000);
    expect(m.value).toBeLessThan(2);
  });

  it("щит дождя (аудит 2b, №1): трясёт с первой секунды на 90 → щит ~90 — и когда телефон шлёт каждый такт, и когда один раз", () => {
    let cur: World | null = null;
    const w0 = (pid: string, p: number): void => void cur?.send(pid, [{ t: "shake", p }]);
    const meteor = (send: (pid: string, sent: ShakeSent, eventId: string) => ShakeSent): number[] => {
      const w = new World({ players: 6, content: { events: { meteor: true, pull: false, sos: false, captain: false } } });
      cur = w;
      w.toFlight();
      if (w.s.leg) w.s.leg.schedule = [];
      w.ok("event", { kind: "meteor" });
      w.advance(WARN_MS + 100);
      const ev = w.s.leg?.event;
      expect(ev?.kind).toBe("meteor");
      const pids = Object.keys(w.s.members);
      const sent: Record<string, ShakeSent> = {};
      for (let t = 0; t < EVENT_MS.meteor + 1000; t += 400) {
        w.advance(400);
        if (!w.s.leg?.event) continue;
        for (const pid of pids) sent[pid] = send(pid, sent[pid] ?? { id: null, p: 0 }, w.s.leg.event.id);
      }
      expect(w.s.leg?.event).toBeNull();
      return w.s.crews.map((c) => Math.round(c.legShield));
    };
    // Как шлёт телефон: каждый такт, пока трясут.
    const phone = meteor((pid, prev, id) => {
      const r = shakeReport(prev, id, 90);
      if (r.send !== null) w0(pid, r.send);
      return r.next;
    });
    // Один раз в самом начале (вторая пачка потерялась) — сервер всё равно считает силу по времени дождя.
    const once = meteor((pid, prev, id) => {
      if (prev.id !== id) w0(pid, 90);
      return { id, p: 90 };
    });
    for (const shield of [...phone, ...once]) expect(shield).toBeGreaterThanOrEqual(88);
    // Телефон шлёт силу на каждом такте, а не только когда она выросла.
    let st: ShakeSent = { id: null, p: 0 };
    const sends: (number | null)[] = [];
    for (const peak of [0, 90, 90, 40, 90]) {
      const r = shakeReport(st, "e1", peak);
      st = r.next;
      sends.push(r.send);
    }
    expect(sends).toEqual([null, 90, 90, 90, 90]);
    // Новое событие — с нуля.
    expect(shakeReport(st, "e2", 30).send).toBe(30);
  });

  it("тряска или тапы (решение владельца 6 ноября 2026): до системного окна — выбор, «Буду тапать» и отказ — тапы с «Попробовать снова»", () => {
    // Датчик уже присылает движение (Chrome на Android) — трясём, ничего не спрашиваем.
    expect(shakeMode("need", true, null)).toEqual({ mode: "shake", offer: null });
    expect(shakeMode("granted", true, null)).toEqual({ mode: "shake", offer: null });
    // Спросить можно (iPhone): тапы и своя подсказка с двумя кнопками до системного окна.
    expect(shakeMode("need", false, null)).toEqual({ mode: "tap", offer: "ask" });
    // Отказ в системном окне — тапы и «Попробовать тряску снова».
    expect(shakeMode("denied", false, null)).toEqual({ mode: "tap", offer: "retry" });
    // «Буду тапать» — тапы, даже если датчик работает; вернуть тряску можно.
    expect(shakeMode("granted", true, "tap")).toEqual({ mode: "tap", offer: "retry" });
    // Датчика нет совсем (ноутбук) — просто тапы, предлагать нечего.
    expect(shakeMode("none", false, null)).toEqual({ mode: "tap", offer: null });
    expect(shakeMode("none", false, "tap")).toEqual({ mode: "tap", offer: null });
    expect(shakeMode("granted", false, null)).toEqual({ mode: "tap", offer: null });
  });

  it("вибрация (решение владельца 6 ноября 2026, №18): выполнен — одна короткая, не успели — две, отмена — ничего; без вибрации не ломается", () => {
    expect(vibrationFor("done")).toEqual([BUZZ_MS]);
    expect(vibrationFor("helped")).toEqual([BUZZ_MS]);
    expect(vibrationFor("fail")).toEqual([BUZZ_MS, BUZZ_GAP_MS, BUZZ_MS]);
    expect(vibrationFor("cancel")).toBeNull();
    const nav = globalThis.navigator as unknown as Record<string, unknown> | undefined;
    if (!nav) return;
    const had = Object.prototype.hasOwnProperty.call(nav, "vibrate");
    const before = nav.vibrate;
    const calls: unknown[] = [];
    try {
      nav.vibrate = (p: unknown) => {
        calls.push(p);
        return true;
      };
      buzz("fail");
      buzz("cancel");
      expect(calls).toEqual([[BUZZ_MS, BUZZ_GAP_MS, BUZZ_MS]]);
      // Браузер бросил ошибку (Safari, вкладка в фоне) — игра не падает.
      nav.vibrate = () => {
        throw new Error("нет");
      };
      buzz("done");
      expect(canVibrate()).toBe(true);
      // Вибрации нет совсем — ничего, и переключателя «Вибрация» нет (аудит 2b, круг 2, №10).
      delete nav.vibrate;
      buzz("done");
      if (typeof (globalThis.navigator as unknown as { vibrate?: unknown }).vibrate !== "function") expect(canVibrate()).toBe(false);
    } finally {
      if (had) nav.vibrate = before;
      else delete nav.vibrate;
    }
  });

  it("слова тем (аудит 2b, №10): род глагола у субмарины женский, у саней — множественное", () => {
    const say = (theme: keyof typeof THEME_WORDS) => {
      const w = wordsOf(theme);
      return `${cap(w.ship)} ${verb(w, "прибавил", "прибавили", "прибавила")}`;
    };
    expect(say("submarine")).toBe("Субмарина прибавила");
    expect(say("newyear")).toBe("Сани прибавили");
    expect(say("space")).toBe("Корабль прибавил");
    expect(say("wedding")).toBe("Воздушный шар прибавил");
    for (const w of Object.values(THEME_WORDS)) expect(w.fem && w.plural).toBe(false);
  });

  it("местные часы (аудит 2b, №11): перевод часов телефона вперёд не сбивает отсчёт — время монотонное", () => {
    const real = Date.now;
    try {
      const a = localNow();
      Date.now = () => real() + 30_000;
      const b = localNow();
      expect(b - a).toBeLessThan(1000);
      expect(b - a).toBeGreaterThanOrEqual(0);
    } finally {
      Date.now = real;
    }
    // Тот же телефон по монотонным часам: событие через 10 с — через 5 с осталось ~5 с, сколько ни переводи стрелки.
    let m = emptyModel(0);
    m = withClock(m, 1_000_000, 500 + 80);
    for (let i = 1; i <= 5; i += 1) m = withClock(m, 1_000_000 + i * 1000, 500 + i * 1000 + 80);
    expect(leftUntil(m, 1_010_000, 500 + 5000 + 80)).toBe(5000);
  });

  it("движения приборов (аудит 2b, №14): чаще 5 в секунду телефон придерживает и шлёт последнее — на сервере то, что на экране", () => {
    const run = (gated: boolean): { server: number; last: number } => {
      const w = new World({ players: 6, content: NOEV });
      w.toFlight();
      const id = w.member("p0").panel.find((c) => w.s.controls[c]?.type === "slider") ?? w.member("p0").panel[0] ?? "";
      const gate = new MoveGate();
      const send = (c: string, s: number) => w.send("p0", [{ t: "move", c, s }]);
      let last = 0;
      // Гость быстро листает ползунок: 0 → 5 → 0 → 5…, 10 касаний за секунду.
      for (let i = 1; i <= 10; i += 1) {
        w.advance(100);
        last = i % 2 === 0 ? 0 : 5;
        if (!gated || gate.move(w.env.now, id, last)) send(id, last);
        if (gated) for (const [c, s] of gate.release(w.env.now)) send(c, s);
      }
      for (let k = 0; k < 20 && gated && gate.pending.size > 0; k += 1) {
        w.advance(Math.max(20, gate.waitMs(w.env.now)));
        for (const [c, s] of gate.release(w.env.now)) send(c, s);
      }
      w.advance(100);
      return { server: w.s.controls[id]?.state ?? -1, last };
    };
    const g = run(true);
    expect(g.server).toBe(g.last);
    // Без придержки часть движений сервер отбросил бы — прибор «отскочил» бы к другому положению.
    const raw = run(false);
    expect(raw.server).not.toBe(raw.last);
    // Сама придержка: 4 сразу (на одно меньше, чем принимает комната), пятое ждёт ~250 мс, у прибора ждёт последнее положение.
    expect(PHONE_MOVES_PER_SECOND).toBe(MOVES_PER_SECOND - 1);
    const gate = new MoveGate();
    for (let i = 0; i < PHONE_MOVES_PER_SECOND; i += 1) expect(gate.move(0, `c${i}`, 1)).toBe(true);
    expect(gate.move(0, "c9", 1)).toBe(false);
    expect(gate.move(10, "c9", 3)).toBe(false);
    expect([...gate.pending]).toEqual([["c9", 3]]);
    expect(gate.waitMs(10)).toBeGreaterThan(0);
    expect(gate.release(300)).toEqual([["c9", 3]]);
  });

  it("движения и сеть (аудит 2b, круг 2, №4): задержка 40–640 мс, по порядку — последнее положение каждого прибора доходит всегда", () => {
    // Комната — то же «ведро», что `bucketTake` (5 сразу, 5 в секунду), по времени прихода.
    const room = () => {
      let tokens = MOVES_PER_SECOND;
      let at: number | null = null;
      return (t: number) => {
        if (at === null) at = t;
        if (t > at) {
          tokens = Math.min(MOVES_PER_SECOND, tokens + ((t - at) / 1000) * MOVES_PER_SECOND);
          at = t;
        }
        if (tokens < 1) return false;
        tokens -= 1;
        return true;
      };
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    let lostLast = 0;
    for (let trial = 0; trial < 200; trial += 1) {
      const gate = new MoveGate();
      const sends: Array<{ t: number; c: string; s: number }> = [];
      const timeline: Array<{ t: number; e?: { c: string; s: number } }> = [];
      // Гость крутит ползунок каждые 80 мс две секунды, потом другой прибор — каждые 90 мс.
      for (let i = 0; i < 25; i += 1) timeline.push({ t: i * 80, e: { c: "a", s: i % 6 } });
      for (let i = 0; i < 10; i += 1) timeline.push({ t: 2100 + i * 90, e: { c: "b", s: i % 3 } });
      let timer: number | null = null;
      while (timeline.length > 0) {
        timeline.sort((x, y) => x.t - y.t);
        const x = timeline.shift();
        if (!x) break;
        if (x.e) {
          if (gate.move(x.t, x.e.c, x.e.s)) sends.push({ t: x.t, ...x.e });
          else if (timer === null) timeline.push({ t: (timer = x.t + Math.max(20, gate.waitMs(x.t))) });
        } else {
          timer = null;
          for (const [c, s] of gate.release(x.t)) sends.push({ t: x.t, c, s });
          if (gate.pending.size > 0) timeline.push({ t: (timer = x.t + Math.max(20, gate.waitMs(x.t))) });
        }
      }
      const take = room();
      let prev = 0;
      const final: Record<string, number> = {};
      const want: Record<string, number> = {};
      for (const s of sends) {
        const arrive = Math.max(prev, s.t + 40 + rnd() * 600);
        prev = arrive;
        want[s.c] = s.s;
        if (take(arrive)) final[s.c] = s.s;
      }
      if (final.a !== want.a || final.b !== want.b) lostLast += 1;
    }
    expect(lostLast).toBe(0);
  });

  it("нажатия пачкой (аудит 2b, круг 2, №11): `beforeMs` — от первого нажатия пачки, смена вида — прежняя пачка сразу", () => {
    const b = new TapBatch();
    expect(b.flush(0)).toBeNull();
    expect(b.tap("tap", 1000)).toBeNull();
    b.tap("tap", 1100);
    b.tap("tap", 1250);
    expect(b.flush(1300)).toEqual({ event: { t: "tap", n: 3 }, beforeMs: 300 });
    expect(b.flush(1600)).toBeNull();
    b.tap("tap", 1700);
    // Салют после тапа: тапы уходят сразу, у салюта своя пачка от своего первого нажатия.
    expect(b.tap("salute", 1800)).toEqual({ event: { t: "tap", n: 1 }, beforeMs: 100 });
    b.tap("salute", 1850);
    expect(b.flush(2000)).toEqual({ event: { t: "salute", n: 2 }, beforeMs: 200 });
    // Телефон отдаёт отправителю именно это: `push(event, true, beforeMs)` (`Phone.tsx`), отправитель ставит `ago`.
  });

  it("чанк телефона (аудит 2b, круг 2, №2): обрыв — повтор по адресу с меткой (браузер помнит неудачу), три раза — ошибка", async () => {
    const url = "https://games.joy-rest.ru/assets/PlayerView-1a2b.js";
    expect(chunkUrlOf(new TypeError(`Failed to fetch dynamically imported module: ${url}`))).toBe(url);
    expect(chunkUrlOf(new TypeError(`error loading dynamically imported module: ${url}?retry=1`))).toBe(url);
    expect(chunkUrlOf(new TypeError("Importing a module script failed."))).toBeNull();
    const calls: string[] = [];
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    // Первый import() оборвался, повтор по адресу с меткой удался.
    let state = { url: null as string | null, n: 0 };
    const ok = await importWithRetry(
      {
        load: async () => {
          calls.push("load");
          throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
        },
        again: async (u, n) => {
          calls.push(`${u}?retry=${n}`);
          return "телефон";
        },
      },
      state,
      3,
      1500,
      sleep,
    );
    expect([ok, calls, sleeps]).toEqual(["телефон", ["load", `${url}?retry=1`], [1500]]);
    // Сеть не вернулась — три попытки с растущей паузой, потом ошибка (её ловит «Не загрузилось — Повторить»).
    state = { url: null, n: 0 };
    calls.length = 0;
    sleeps.length = 0;
    const fail = (where: string) => async () => {
      calls.push(where);
      throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
    };
    const err = await importWithRetry({ load: fail("load"), again: (u, n) => fail(`${u}?retry=${n}`)() }, state, 3, 1500, sleep).catch((e: unknown) => e);
    expect(err instanceof Error).toBe(true);
    expect([calls.length, sleeps, state.url]).toEqual([3, [1500, 3000], url]);
  });

  it("голосование (аудит 2b, круг 2, №3): два столбца — только короткие имена и больше пяти кандидатов", () => {
    const names = (n: number, name: (i: number) => string) => Array.from({ length: n }, (_, i) => ({ name: name(i) }));
    expect(twoColumns(names(9, (i) => `Аня ${i}`))).toBe(true);
    expect(twoColumns(names(5, (i) => `Аня ${i}`))).toBe(false);
    expect(twoColumns(names(9, (i) => (i === 4 ? "Константинопольская Александра" : `Аня ${i}`)))).toBe(false);
    expect(twoColumns(names(9, () => "А".repeat(VOTE_SHORT_NAME)))).toBe(true);
  });

  it("часы на экране: «0:07», ноль и пусто", () => {
    expect(clockText(7000)).toBe("0:07");
    expect(clockText(6001)).toBe("0:07");
    expect(clockText(65_000)).toBe("1:05");
    expect(clockText(0)).toBe("0:00");
    expect(clockText(null)).toBe("");
  });
});
