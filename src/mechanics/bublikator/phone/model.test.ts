/**
 * Телефон «Бубликатора» без React (Блок 2b): поток комнаты → модель → экран. Комната — понарошку (`world.test-kit.ts`):
 * личное телефона — как в настоящей комнате (снимок `personalSnapshot`, дальше куски `{ t: "me" }` и `{ t: "crew" }`).
 */
import { describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../../data/types";
import { DOCK_MS, EVENT_MS, HULL_MAX, LAUNCH_MS, REPAIR_MS, WARN_MS } from "../rules/constants";
import { crewPlayers } from "../rules/crews";
import { personalSnapshot, personalView } from "../rules/views";
import { World } from "../rules/world.test-kit";
import { shakeReport, type ShakeSent } from "./shake";
import { applyReply, applyStream, clockText, closeFinished, emptyModel, flashOf, leftUntil, orderLeft, problemOf, ROLE_AUTO_MS, screenOf, serverNow, silent, type PhoneModel } from "./model";

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

  it("часы на экране: «0:07», ноль и пусто", () => {
    expect(clockText(7000)).toBe("0:07");
    expect(clockText(6001)).toBe("0:07");
    expect(clockText(65_000)).toBe("1:05");
    expect(clockText(0)).toBe("0:00");
    expect(clockText(null)).toBe("");
  });
});
