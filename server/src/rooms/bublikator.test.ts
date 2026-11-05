/**
 * «Бубликатор» в настоящей игровой комнате (`engine.ts`): реестр (только test), команды пульта с этапом (двойное касание и
 * второй пульт → `moved`), пауза движка, снимок → восстановление, `delayed`, потоки (личное — только своё, экран — без тайн)
 * и сквозная игра: три перелёта ботами по зерну, от сбора экипажей до пьедестала, — числа сходятся.
 */
import { describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../../src/data/types";
import { DRILL_MS, LAUNCH_MS, VOTE_MS } from "../../../src/mechanics/bublikator/rules/constants";
import { crewPlayers } from "../../../src/mechanics/bublikator/rules/crews";
import { crewTotal } from "../../../src/mechanics/bublikator/rules/game";
import type { BubState, CrewSummary, PersonalView, ScreenView, HostView } from "../../../src/mechanics/bublikator/rules/types";
import { bublikator } from "./bublikator";
import { parseInput, Room, seededRandom, type RoomGame, type RoomListener } from "./engine";
import { roomGames } from "./registry";

const game = bublikator as RoomGame<unknown>;

function room(players: number, content: Record<string, unknown> = {}, now = 1_000_000): Room {
  return new Room({
    id: "s1",
    key: "bublikator",
    hostId: "h",
    game,
    players: Array.from({ length: players }, (_, i) => ({ pid: `b${i}`, name: `Бот ${i}`, team: null })),
    teams: [],
    snapshot: { title: "Бубликатор", mechanic: "bublikator", content },
    playMode: "solo",
    now,
  });
}

const state = (r: Room) => r.state as BubState;

/** Телефон бота: свой поток пачек, номера, последнее личное. */
class Phone {
  seq = 0;
  me: PersonalView | null = null;
  events: Array<Record<string, unknown>> = [];
  constructor(
    readonly pid: string,
    readonly r: Room,
    now: number,
  ) {
    const listener: RoomListener = { send: (e) => this.got(e), end: () => undefined };
    r.listen("me", listener, now, pid);
  }
  crew: CrewSummary | null = null;
  /** Сколько байт пришло личным потоком (события после снимка). */
  bytes = 0;
  /** Как телефон: снимок — целиком, дальше `me` — только изменившиеся поля, состав экипажа — отдельным `crew`. */
  private got(e: RoomStreamEvent): void {
    if (e.type === "event") {
      const d = e.data as Record<string, unknown>;
      this.bytes += JSON.stringify(d).length;
      if (d.t === "me") {
        const part = d.me as Partial<PersonalView>;
        this.me = d.full === true || !this.me ? (part as PersonalView) : { ...this.me, ...part };
        if (this.me.crew === undefined) this.me.crew = this.crew;
      } else if (d.t === "crew") {
        this.crew = d.crew as CrewSummary | null;
        if (this.me) this.me.crew = this.crew;
      } else this.events.push(d);
    } else if (e.type === "snapshot") {
      this.me = e.data as PersonalView;
      this.crew = this.me.crew ?? null;
    }
  }
  alive(now: number): void {
    const p = parseInput({ stream: `s-${this.pid}`, events: [] });
    if (p) this.r.input(this.pid, p, now);
  }
  send(now: number, events: Array<Record<string, unknown>>, opts: { ago?: number; retry?: boolean; seq?: number } = {}): void {
    const seq = opts.seq ?? this.seq++;
    const p = parseInput({ stream: `s-${this.pid}`, seq, retry: opts.retry === true ? true : undefined, events: events.map((e) => ({ ago: opts.ago ?? 0, ...e })) });
    if (!p) throw new Error("пачка не разобралась");
    const out = this.r.input(this.pid, p, now);
    if (!out.ok) throw new Error(`пачка: ${out.error}`);
  }
}

function collector() {
  const got: RoomStreamEvent[] = [];
  return { got, listener: { send: (e: RoomStreamEvent) => got.push(e), end: () => undefined } satisfies RoomListener };
}

describe("«Бубликатор» в игровой комнате", () => {
  it("пока экранов нет — только на тестовой версии: на основной комнаты нет", () => {
    expect(roomGames().has("bublikator")).toBe(false);
    expect(roomGames({ check: true }).has("bublikator")).toBe(true);
    expect(bublikator.offlineMs).toBe(4000);
    expect(bublikator.batchMs(10)).toBe(2000);
    expect(bublikator.batchMs(300)).toBe(2000);
  });

  it("команда с этапом: двойное касание и второй пульт — `moved`, ничего не сделано; повтор по id — прежний итог", () => {
    const now = 1_000_000;
    const r = room(6);
    const m0 = r.moment();
    expect(m0).toBe("lobby:0:-:0");
    expect(r.command("gather", null, "c1", now, m0)).toEqual({ ok: true });
    expect(r.command("gather", null, "c1", now, m0)).toEqual({ ok: true });
    expect(r.command("gather", null, "c2", now, m0)).toEqual({ ok: false, error: "moved" });
    const m1 = r.moment();
    expect(r.command("start", null, "c3", now, m1)).toEqual({ ok: true });
    expect(r.command("start", null, "c4", now, m1)).toEqual({ ok: false, error: "moved" });
    expect(state(r).attempts[0]).toBe(1);
  });

  it("пауза движка (туда и обратно): события телефонов на паузе не идут, время перелёта и приказов стоит, после — с того же места", () => {
    let now = 1_000_000;
    const r = room(6, { events: { meteor: false, pull: false, sos: false, captain: false } });
    const phones = Array.from({ length: 6 }, (_, i) => new Phone(`b${i}`, r, now));
    r.command("gather", null, null, now);
    r.command("start", null, null, now);
    for (let t = 0; t < LAUNCH_MS + 3000; t += 100) {
      now += 100;
      if (t % 2000 === 0) for (const p of phones) p.alive(now);
      r.tick(now);
    }
    const s = state(r);
    const flight = s.leg?.flight ?? 0;
    const clocks = s.crews.map((c) => c.clock);
    expect(r.command("pause", null, null, now)).toEqual({ ok: true });
    const order = s.members.b0?.order;
    const ctl = order ? s.controls[order.control] : undefined;
    for (let t = 0; t < 30_000; t += 100) {
      now += 100;
      r.tick(now);
    }
    if (ctl && order) phones.find((p) => p.pid === ctl.owner)?.send(now, [{ t: "move", c: ctl.id, s: order.target }]);
    expect(s.leg?.flight).toBe(flight);
    expect(s.crews.map((c) => c.clock)).toEqual(clocks);
    if (ctl) expect(ctl.movedAt).toBe(-1);
    expect(r.command("resume", null, null, now)).toEqual({ ok: true });
    for (const p of phones) p.alive(now);
    now += 100;
    r.tick(now);
    expect(s.leg?.flight).toBe(flight + 100);
    expect(s.members.b0?.order?.id).toBe(order?.id);
    expect(s.crews.every((c) => c.hull === 5)).toBe(true);
  });

  it("событие не в свой черёд (`delayed`): время — по приходу, раньше прихода прибор не «двинулся»", () => {
    let now = 1_000_000;
    const r = room(6, { events: { meteor: false, pull: false, sos: false, captain: false } });
    const phones = Array.from({ length: 6 }, (_, i) => new Phone(`b${i}`, r, now));
    r.command("gather", null, null, now);
    r.command("start", null, null, now);
    for (let t = 0; t < LAUNCH_MS + 1500; t += 100) {
      now += 100;
      if (t % 1000 === 0) for (const p of phones) p.alive(now);
      r.tick(now);
    }
    const s = state(r);
    const ctl = Object.values(s.controls).find((c) => c.owner === "b0" && c.type !== "button");
    if (!ctl) throw new Error("прибор");
    const phone = phones[0];
    if (!phone) throw new Error("телефон");
    phone.send(now, [{ t: "move", c: ctl.id, s: (ctl.state + 1) % 2 }], { seq: 5 });
    // Повтор старой пачки с `ago` 3 с — помечен `delayed`, время — по приходу.
    phone.send(now, [{ t: "move", c: ctl.id, s: ctl.state === 0 ? 1 : 0 }], { seq: 3, retry: true, ago: 3000 });
    expect(ctl.movedAt).toBe(now - s.offset);
  });

  it("снимок комнаты → «перезапуск» → пауза → продолжение: то же состояние и тот же ход дальше", () => {
    let now = 1_000_000;
    const r = room(10, { saboteur: true });
    const phones = Array.from({ length: 10 }, (_, i) => new Phone(`b${i}`, r, now));
    r.command("gather", null, null, now);
    r.command("start", null, null, now);
    for (let t = 0; t < 40_000; t += 100) {
      now += 100;
      if (t % 2000 === 0) for (const p of phones) p.alive(now);
      r.tick(now);
    }
    const data = JSON.parse(JSON.stringify(r.snapshotData(now))) as ReturnType<Room["snapshotData"]>;
    const again = new Room({ id: "s1", key: "bublikator", hostId: "h", game, players: phones.map((p) => ({ pid: p.pid, name: p.pid, team: null })), teams: [], snapshot: null, playMode: "solo", now: now + 5000, restoreFrom: data });
    expect(again.paused).toBe(true);
    expect(JSON.stringify(bublikator.snapshot(again.state as BubState))).toBe(JSON.stringify(bublikator.snapshot(state(r))));
    const flight = state(again).leg?.flight;
    again.command("resume", null, null, now + 5000);
    expect(state(again).leg?.flight).toBe(flight);
    expect(state(again).offset).toBeGreaterThanOrEqual(5000);
  });

  it("потоки: личное — только своё (нет чужих приказов и ролей), экран и пульт — без диверсантов и ложных приказов", () => {
    let now = 1_000_000;
    const r = room(12, { saboteur: true, events: { meteor: false, pull: false, sos: false, captain: false } });
    const phones = Array.from({ length: 12 }, (_, i) => new Phone(`b${i}`, r, now));
    const screen = collector();
    const host = collector();
    r.listen("screen", screen.listener, now);
    r.listen("host", host.listener, now);
    r.command("gather", null, null, now);
    r.command("start", null, null, now);
    for (let t = 0; t < 30_000; t += 100) {
      now += 100;
      if (t % 2000 === 0) for (const p of phones) p.alive(now);
      r.tick(now);
    }
    const s = state(r);
    const saboteurs = s.crews.map((c) => c.saboteur).filter((x): x is string => x !== null);
    expect(saboteurs.length).toBe(2);
    const screenText = JSON.stringify(screen.got);
    const hostText = JSON.stringify(host.got);
    expect(screenText).not.toContain("saboteur");
    expect(screenText).not.toContain("fake");
    expect(hostText).not.toContain("saboteur");
    expect(hostText).not.toContain("\"mark\"");
    for (const p of phones) {
      const own = s.members[p.pid]?.order?.id;
      for (const other of Object.values(s.members)) {
        if (other.pid === p.pid || !other.order) continue;
        expect(JSON.stringify(p.me)).not.toContain(other.order.id);
      }
      if (own) expect(p.me?.order?.id).toBe(own);
      expect(p.me?.me.pid).toBe(p.pid);
    }
  });

  it("сквозная игра: 4 экипажа ботов, три перелёта со всеми событиями и диверсантом — дальности, корпус, очки и итоги сходятся", () => {
    let now = 1_000_000;
    const N = 22;
    const r = room(N, { saboteur: true, legs: 3, legMinutes: 3 });
    // Зерно комнаты — своё, чтобы ход игры повторялся (create() случайность не тратит).
    (r as unknown as { seed: string }).seed = "a1";
    const kinds = new Set<string>();
    let repairs = 0;
    let finishes = 0;
    const phones = Array.from({ length: N }, (_, i) => new Phone(`b${i}`, r, now));
    const screen = collector();
    r.listen("screen", screen.listener, now);
    const host = collector();
    r.listen("host", host.listener, now);
    const rnd = (key: string) => seededRandom("bots", key);
    const s = () => state(r);
    let k = 0;
    // Пульт ведущего: команда с этапом из его сводки.
    const cmd = (name: string, args: unknown = null) => {
      const out = r.command(name, args, `id${k++}`, now, r.moment());
      if (!out.ok) throw new Error(`${name}: ${out.error}`);
      return out;
    };
    const plan = new Map<string, number>();
    const screenSeen = { warn: 0, glitch: 0 };
    const step = () => {
      now += 100;
      // «Я на связи» раз в 2 с (у двоих связь моргнёт посреди игры).
      if ((now / 100) % 20 === 0) for (const p of phones) if (!(p.pid === "b21" && now > 1_200_000 && now < 1_210_000)) p.alive(now);
      r.tick(now);
      const st = s();
      const leg = st.leg;
      if (st.phase === "drill" || (leg?.stage === "fly" && !leg.event?.started)) {
        // Экипаж «слышит» приказы: хозяин названного прибора двигает его через 1–4 с.
        for (const p of phones) {
          const o = p.me?.order;
          if (!o || o.frozen) continue;
          if (!plan.has(o.id)) plan.set(o.id, now + 1000 + Math.floor(rnd(o.id) * 3000));
          if ((plan.get(o.id) ?? Infinity) > now) continue;
          plan.set(o.id, Infinity);
          const owner = phones.find((x) => x.me?.panel.some((c) => c.name === o.control) && x.me.crew?.id === p.me?.crew?.id);
          const order = st.members[p.pid]?.order;
          const ctl = order ? st.controls[order.control] : undefined;
          if (!owner || !ctl || !order) continue;
          // Иногда ошибаются: двигают не в то положение.
          const wrong = rnd(`w${o.id}`) < 0.15 && ctl.type !== "button";
          owner.send(now, [{ t: "move", c: ctl.id, s: wrong ? (order.target + 1) % (ctl.type === "toggle" ? 2 : 3) : order.target }]);
        }
      }
      const ev = leg?.event;
      if (ev && !ev.started) screenSeen.warn += 1;
      if (ev?.started) {
        for (const p of phones) {
          const pe = p.me?.event;
          if (!pe?.joined) continue;
          if (ev.kind === "meteor" && (now / 100) % 20 === 0) p.send(now, [{ t: "shake", p: Math.floor(rnd(`m${p.pid}${ev.id}`) * 100) }]);
          if (ev.kind === "pull" && pe.pull && !pe.pull.holding && rnd(`h${p.pid}${now}`) < 0.3) p.send(now, [{ t: "hold", on: true }]);
          if (ev.kind === "pull" && pe.pull?.holding && rnd(`r${p.pid}${now}`) < 0.01) p.send(now, [{ t: "hold", on: false }]);
          if (ev.kind === "sos" && pe.sos?.captain && !pe.sos.done && (pe.sos.blockedUntil ?? 0) <= now && rnd(`s${p.pid}${now}`) < 0.2) {
            const scr = screen.got.filter((e) => e.type === "screen").at(-1);
            const seqColors = ((scr?.type === "screen" ? (scr.data as ScreenView).event?.seq : null) ?? []) as number[];
            const want = seqColors[pe.sos.progress] ?? 0;
            p.send(now, [{ t: "sos", color: rnd(`e${p.pid}${now}`) < 0.1 ? (want + 1) % 4 : want }]);
          }
        }
      }
      if (leg?.glitch?.startedAt != null) screenSeen.glitch += 1;
      for (const c of st.crews) {
        if (c.repair && c.repair.taps === 0 && (now / 100) % 10 === 1) repairs += 1;
        if (c.repair) for (const m of crewPlayers(st, c.id)) if ((now / 100) % 10 === 0) phones.find((p) => p.pid === m.pid)?.send(now, [{ t: "tap", n: 12 }]);
        if (c.finishedAt !== null && (now / 100) % 30 === 0) phones.find((p) => p.pid === crewPlayers(st, c.id)[0]?.pid)?.send(now, [{ t: "salute", n: 2 }]);
      }
    };
    cmd("gather");
    expect(s().crews).toHaveLength(4);
    for (let t = 0; t < 2000; t += 100) step();
    cmd("drill");
    for (let t = 0; t < 31_000; t += 100) step();
    const legsDone: number[] = [];
    for (let leg = 0; leg < 3; leg += 1) {
      if (leg === 0) cmd("start");
      else cmd("next");
      let captainAsked = false;
      let guard = 0;
      while (s().leg?.stage !== "dock" && guard < 6000) {
        step();
        guard += 1;
        const L = s().leg;
        // Третий перелёт: вида, которого расписание не дало, ведущий зовёт сам («Событие сейчас»).
        if (leg === 2 && L?.stage === "fly" && !L.event && L.flight > 25_000) {
          const seen = new Set([...kinds, ...(L.history ?? []).map((h) => h.kind)]);
          const missing = (["meteor", "pull", "sos"] as const).find((x) => !seen.has(x));
          if (missing) cmd("event", { kind: missing });
        }
        // Ведущий один раз зовёт «Все на палубу!» и ставит звёзды.
        if (!captainAsked && L?.stage === "fly" && !L.event && L.flight > 60_000) {
          captainAsked = true;
          const id = cmd("event", { kind: "captain", task: "Изобразите двигатель!" }).result as string;
          for (let t = 0; t < 8000; t += 100) step();
          cmd("event-end", { id });
          cmd("rate", { event: id, stars: Object.fromEntries(s().crews.map((c, i) => [String(c.id), i + 1])) });
          cmd("rate", { event: id, stars: Object.fromEntries(s().crews.map((c, i) => [String(c.id), 4 - i])) });
        }
      }
      expect(s().leg?.stage).toBe("dock");
      legsDone.push(leg);
      const st = s();
      // Итог привала = сумма столбцов; дальность от приказов ≤ 1 000; корпус в пределах.
      for (const c of st.crews) {
        const r0 = c.legs[leg];
        expect(r0).toBeDefined();
        if (!r0) continue;
        expect(r0.total).toBe(r0.orders + r0.finish + r0.events);
        expect(r0.orders).toBe(Math.round(c.dist));
        expect(c.dist).toBeLessThanOrEqual(1000);
        expect(c.hull).toBeGreaterThanOrEqual(0);
        expect(c.hull).toBeLessThanOrEqual(5);
        expect(c.bonus.captain[Object.keys(c.bonus.captain)[0] ?? ""] ?? 0).toBeLessThanOrEqual(40);
        const captain = Object.values(c.bonus.captain).reduce((a, b) => a + b, 0);
        expect(r0.events).toBe(c.bonus.meteor + c.bonus.sos + captain);
        if (c.finishedAt !== null) expect(r0.finish).toBe(2 * Math.floor((st.content.legMinutes * 60_000 - c.finishedAt) / 1000));
        else expect(r0.finish).toBe(0);
        const players = crewPlayers(st, c.id);
        expect(players.reduce((a, p) => a + p.legDone, 0)).toBe(c.done);
      }
      // Места на привале — по очкам перелёта.
      const rows = [...st.crews].sort((a, b) => (b.legs[leg]?.total ?? 0) - (a.legs[leg]?.total ?? 0));
      expect(rows[0]?.legs[leg]?.place).toBe(1);
      expect(st.leg?.history.length).toBeGreaterThanOrEqual(2);
      for (const h of st.leg?.history ?? []) kinds.add(h.kind);
      finishes += st.crews.filter((c) => c.finishedAt !== null).length;
      // Голосование: экипажи с диверсантом голосуют.
      cmd("next");
      expect(s().leg?.stage).toBe("vote");
      const v = s();
      for (const c of v.crews) {
        if (!c.saboteur) continue;
        for (const m of crewPlayers(v, c.id)) {
          const guess = rnd(`v${m.pid}${leg}`) < 0.6 ? c.saboteur : crewPlayers(v, c.id).find((x) => x.pid !== m.pid)?.pid;
          phones.find((p) => p.pid === m.pid)?.send(now, [{ t: "vote", pid: guess }]);
        }
      }
      for (let t = 0; t < VOTE_MS + 200; t += 100) step();
      expect(s().leg?.stage).toBe("voted");
    }
    cmd("next");
    const st = s();
    expect(st.phase).toBe("podium");
    // Общий счёт = сумма очков перелётов + бонус за угаданного диверсанта; пьедестал — по нему.
    for (const c of st.crews) {
      expect(crewTotal(c)).toBe(c.legs.reduce((a, x) => a + (x?.total ?? 0), 0) + c.voteBonus);
      expect(c.voteBonus).toBe(50 * c.guessed);
    }
    const podium = (screen.got.filter((e) => e.type === "screen").at(-1) as { data: ScreenView } | undefined)?.data.podium;
    r.tick(now + 300);
    const last = screen.got.filter((e) => e.type === "screen").at(-1);
    const pod = (last?.type === "screen" ? (last.data as ScreenView).podium : podium) ?? [];
    expect(pod.map((p) => p.total)).toEqual([...pod.map((p) => p.total)].sort((a, b) => b - a));
    expect(pod[0]?.place).toBe(1);
    // Карточка телефона сходится с экипажем.
    for (const p of phones) {
      const m = st.members[p.pid];
      const c = st.crews.find((x) => x.id === m?.crew);
      if (!m || !c || !p.me?.card) continue;
      expect(p.me.card.total).toBe(crewTotal(c));
      expect(p.me.card.crewOrders).toBe(c.legs.reduce((a, x) => a + (x?.done ?? 0), 0));
      expect(p.me.card.myOrders).toBe(m.done);
    }
    expect(screenSeen.warn).toBeGreaterThan(0);
    // Ход игры прошёл через всё: все виды событий, ремонт, финиш, и угаданный, и нераскрытый диверсант.
    expect([...kinds].sort()).toEqual(["captain", "meteor", "pull", "sos"]);
    expect(repairs).toBeGreaterThan(0);
    expect(finishes).toBeGreaterThan(0);
    expect(Object.values(st.members).some((m) => m.ribbons > 0)).toBe(true);
    expect(st.crews.some((c) => c.guessed > 0)).toBe(true);
    r.tick(now + 1500);
    const hostLast = host.got.filter((e) => e.type === "host").at(-1);
    expect((hostLast?.type === "host" ? (hostLast.data as HostView).phase : null)).toBe("podium");
    cmd("finish");
    expect(s().phase).toBe("finished");
    expect(legsDone).toEqual([0, 1, 2]);
  });

  it("режим платформы — команды (ТЗ): комната в командной сессии работает, команды платформы — экипажи в лобби", () => {
    let now = 1_000_000;
    const teams = [
      ["t1", "Комета"],
      ["t2", "Орбита"],
    ] as Array<[string, string]>;
    const r = new Room({
      id: "s2",
      key: "bublikator",
      hostId: "h",
      game,
      players: Array.from({ length: 8 }, (_, i) => ({ pid: `b${i}`, name: `Бот ${i}`, team: i < 4 ? "t1" : "t2" })),
      teams,
      snapshot: { title: "Бубликатор", mechanic: "bublikator", content: { events: { meteor: false, pull: false, sos: false, captain: false } } },
      playMode: "teams",
      now,
    });
    const s = state(r);
    expect(s.teamsMode).toBe(true);
    expect(Object.values(s.members).map((m) => m.crew)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(r.command("gather", null, null, now)).toEqual({ ok: true });
    expect(r.command("start", null, null, now)).toEqual({ ok: true });
    for (let t = 0; t < LAUNCH_MS + 2000; t += 100) {
      now += 100;
      if (t % 2000 === 0) for (let i = 0; i < 8; i += 1) r.input(`b${i}`, parseInput({ stream: `s${i}`, events: [] }) ?? { stream: "", retry: false, seq: null, events: [] }, now);
      r.tick(now);
    }
    expect(s.leg?.stage).toBe("fly");
    expect(Object.values(s.members).filter((m) => m.order).length).toBeGreaterThan(0);
    expect(s.crews.map((c) => crewPlayers(s, c.id).length)).toEqual([4, 4]);
  });

  it("пауза и перезапуск (п. 2): команда на паузе считает от момента паузы; перезапуск → на паузе → «Дальше» → «Продолжить» — взлёт 5 с", () => {
    let now = 1_000_000;
    const r = room(6, { events: { meteor: false, pull: false, sos: false, captain: false }, legMinutes: 3 });
    r.command("gather", null, null, now);
    r.command("pause", null, null, now);
    now += 300_000;
    expect(r.command("start", null, null, now)).toEqual({ ok: true });
    now += 2000;
    r.command("resume", null, null, now);
    const s = state(r);
    expect((s.leg?.launchEnds ?? 0) - (now - s.offset)).toBe(LAUNCH_MS);
    // Долетели до привала, сервер перезапустился (снимок без паузы), поднялся на паузе; ведущий жмёт «Дальше», потом «Продолжить».
    for (let t = 0; t < LAUNCH_MS + 3 * 60_000 + 500; t += 100) {
      now += 100;
      r.tick(now);
    }
    expect(s.leg?.stage).toBe("dock");
    const data = JSON.parse(JSON.stringify(r.snapshotData(now))) as ReturnType<Room["snapshotData"]>;
    const again = new Room({ id: "s1", key: "bublikator", hostId: "h", game, players: Array.from({ length: 6 }, (_, i) => ({ pid: `b${i}`, name: `b${i}`, team: null })), teams: [], snapshot: null, playMode: "solo", now: now + 60_000, restoreFrom: data });
    expect(again.paused).toBe(true);
    now += 120_000;
    expect(again.command("next", null, null, now)).toEqual({ ok: true, result: "leg" });
    now += 45_000;
    again.command("resume", null, null, now);
    const s2 = state(again);
    expect(Math.abs((s2.leg?.launchEnds ?? 0) - (now - s2.offset) - LAUNCH_MS)).toBeLessThanOrEqual(100);
    expect(s2.leg?.stage).toBe("launch");
  });

  it("50 гостей (решение владельца 6 ноября 2026), полная игра в настоящей комнате: рассылка всем и любая команда пульта — не дольше 10 мс; объём и снимок не растут", () => {
    // Сервер работает долго: первая игра в процессе «прогревает» код (JIT). Дальше — три игры; у каждой команды берём
    // лучшее из трёх (выброс сборщика мусора общего сборщика CI — не скорость игры), у рассылки — медиана и 95%.
    playFull(50, false);
    const runs = [playFull(50, false), playFull(50, false), playFull(50, true)];
    const cmds = (runs[0]?.cmds ?? []).map((c, i) => ({ name: c.name, ms: Math.min(...runs.map((r) => r.cmds[i]?.ms ?? Infinity)) }));
    console.log("Бубликатор, 50 гостей, лучшее из трёх:", cmds.map((c) => `${c.name} ${c.ms.toFixed(1)}`).join(", "));
    for (const c of cmds) expect(c.ms, c.name).toBeLessThanOrEqual(10);
    for (const m of runs) {
      expect(m.sweepMedian).toBeLessThanOrEqual(10);
      expect(m.sweepP95).toBeLessThanOrEqual(10);
      expect(m.snapshotKb).toBeLessThanOrEqual(120);
      expect(m.kbPerSecHall).toBeLessThanOrEqual(60);
    }
    // Ничего не растёт без предела: после трёх перелётов служебное (отправленное, лимиты) — не больше числа гостей.
    const last = runs[2];
    expect(last?.runtime.sent).toBeLessThanOrEqual(50);
    expect(last?.runtime.moves).toBeLessThanOrEqual(50);
    expect(last?.runtime.taps).toBeLessThanOrEqual(50);
  }, 120_000);
});

/** Полная игра на N гостей с замерами. */
function playFull(N: number, log: boolean) {
  let now = 1_000_000;
  const r = room(N, { saboteur: true, legMinutes: 3 });
  const s = () => state(r);
  // Каждый пятый телефон подписан на личный поток — по ним считаем байты на телефон (личное готовится всем).
  const phones = Array.from({ length: Math.ceil(N / 5) }, (_, i) => new Phone(`b${i * 5}`, r, now));
  const all = Array.from({ length: N }, (_, i) => `b${i}`);
  const cmds: Array<{ name: string; ms: number }> = [];
  let k = 0;
  const alive = () => {
    for (const pid of all) {
      const p = parseInput({ stream: `s-${pid}`, events: [] });
      if (p) r.input(pid, p, now);
    }
  };
  const timed = (name: string, args: unknown = null) => {
    const a = performance.now();
    const out = r.command(name, args, `c${k++}`, now, r.moment());
    cmds.push({ name, ms: performance.now() - a });
    if (!out.ok) throw new Error(`${name}: ${out.error}`);
  };
  const sweeps: number[] = [];
  let span = 0;
  const fly = (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      now += 100;
      span += 100;
      if ((now / 100) % 20 === 0) alive();
      const st = s();
      for (const m of Object.values(st.members)) {
        if (!m.order || seededRandom("bots", `${now}${m.pid}`) > 0.05) continue;
        const ctl = st.controls[m.order.control];
        if (!ctl) continue;
        const p = parseInput({ stream: `m-${ctl.owner}`, seq: k++, events: [{ t: "move", c: ctl.id, s: m.order.target, ago: 0 }] });
        if (p) r.input(ctl.owner, p, now);
      }
      // Раз в 0,5 с — полная рассылка всем (у всех что-то поменялось).
      const full = (now / 100) % 5 === 0;
      if (full) for (const pid of all) st.rt.dirty.add(pid);
      const a = performance.now();
      r.tick(now);
      if (full) sweeps.push(performance.now() - a);
    }
  };
  alive();
  timed("gather");
  timed("drill");
  fly(DRILL_MS + 500);
  timed("start");
  for (let leg = 0; leg < 3; leg += 1) {
    fly(LAUNCH_MS + 20_000);
    timed("time", { delta: 2, from: s().leg?.shift ?? 0 });
    const L = s().leg;
    if (L) {
      L.event = null;
      L.schedule = [];
      L.flight = L.duration;
    }
    fly(200);
    expect(s().leg?.stage).toBe("dock");
    timed("vote");
    timed("vote-end");
    timed("next");
  }
  expect(s().phase).toBe("podium");
  timed("finish");
  const sorted = [...sweeps].sort((a, b) => a - b);
  const bytes = phones.reduce((a, p) => a + p.bytes, 0);
  const m = {
    sweepMedian: +(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(1),
    sweepP95: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
    cmds,
    snapshotKb: Math.round(JSON.stringify(bublikator.snapshot(s())).length / 1024),
    // Личное подписанных телефонов → на весь зал, КБ в секунду.
    kbPerSecHall: Math.round(((bytes / phones.length) * N) / (span / 1000) / 1024),
    runtime: { sent: s().rt.sent.size, moves: s().rt.moves.size, taps: s().rt.taps.size },
  };
  if (log) console.log(`Бубликатор, ${N} гостей:`, JSON.stringify({ ...m, cmds: cmds.map((c) => `${c.name} ${c.ms.toFixed(1)}`) }));
  return m;
}
