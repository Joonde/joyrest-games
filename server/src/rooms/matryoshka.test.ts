/**
 * «Игры Матрёшки» в настоящей игровой комнате (`engine.ts`, docs/matryoshka.md): реестр (только test), команды с этапом
 * (двойное касание и второй пульт → `moved`), пауза движка (в «Замри!» все отпустили, пачки на паузе выброшены), снимок →
 * восстановление, `delayed`, потоки (личное — только своё, экран — без тайн и ≤ 4 КБ на 100) и сквозные игры ботами на 6, 12, 50
 * и 100 игроков — до пьедестала, в финале ровно F, баллы ведущему (`room_play`, «сыграна до конца»).
 */
import { describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../../src/data/types";
import { botStep, newBot, type Bot } from "../../../src/mechanics/matryoshka/sim/bots";
import { questionsOf } from "../../../src/mechanics/matryoshka/rules/content";
import { reactionFits } from "../../../src/mechanics/matryoshka/rules/env";
import { inGame } from "../../../src/mechanics/matryoshka/rules/members";
import { finalistsFor } from "../../../src/mechanics/matryoshka/rules/target";
import type { FreezeState, MatState } from "../../../src/mechanics/matryoshka/rules/types";
import { parseInput, Room, timedEvent, type RoomGame, type RoomListener } from "./engine";
import { matryoshka } from "./matryoshka";
import { roomGames } from "./registry";

const game = matryoshka as RoomGame<unknown>;

function room(players: number, content: Record<string, unknown> = {}, now = 1_000_000): Room {
  return new Room({
    id: "m1",
    key: "matryoshka",
    hostId: "h",
    game,
    players: Array.from({ length: players }, (_, i) => ({ pid: `b${i}`, name: `Гость номер ${i + 1} с длинным именем`, team: null })),
    teams: [],
    snapshot: { title: "Игры Матрёшки", mechanic: "matryoshka", content },
    playMode: "solo",
    now,
  });
}

const state = (r: Room) => r.state as MatState;

/** Телефон бота: свой поток пачек, последнее личное из потока `me`. */
class Phone {
  seq = 0;
  me: unknown = null;
  paused = false;
  bytes = 0;
  bot: Bot;
  private off: () => void;
  private readonly listener: RoomListener = { send: (e) => this.got(e), end: () => undefined };
  constructor(
    readonly pid: string,
    readonly r: Room,
    now: number,
    seed: string,
  ) {
    this.bot = newBot(pid, seed);
    this.off = r.listen("me", this.listener, now, pid);
  }
  reconnect(now: number): void {
    this.off();
    this.off = this.r.listen("me", this.listener, now, this.pid);
  }
  private got(e: RoomStreamEvent): void {
    if (e.type === "snapshot") {
      this.me = e.data;
      this.paused = e.paused;
    } else if (e.type === "event") {
      const d = e.data as { t?: string; me?: unknown };
      this.bytes += JSON.stringify(d).length;
      if (d.t === "me") this.me = d.me;
    } else if (e.type === "room") this.paused = e.paused;
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
  private pending: Array<{ e: Record<string, unknown>; at: number }> = [];
  private lastSend = -Infinity;
  /** Как телефон: действия копятся и уходят пачкой не чаще раза в 250 мс (`ago` — сколько назад случилось). */
  act(now: number, chanceCorrect?: number): void {
    for (const e of botStep(this.bot, this.me, now, this.paused, { chanceCorrect })) this.pending.push({ e, at: now });
    if (this.pending.length > 0 && now - this.lastSend >= 250) {
      const seq = this.seq++;
      const p = parseInput({ stream: `s-${this.pid}`, seq, events: this.pending.map(({ e, at }) => ({ ...e, ago: now - at })) });
      this.pending = [];
      this.lastSend = now;
      if (!p) throw new Error("пачка не разобралась");
      const out = this.r.input(this.pid, p, now);
      if (!out.ok) throw new Error(`пачка: ${out.error}`);
    } else if (now - this.lastSend >= 1000) {
      this.lastSend = now;
      this.alive(now);
    }
  }
}

function collector() {
  const got: RoomStreamEvent[] = [];
  return { got, listener: { send: (e: RoomStreamEvent) => got.push(e), end: () => undefined } satisfies RoomListener };
}

/** Пульт: главная кнопка по сводке `host` (с этапом), как ведущий. */
function hostStep(r: Room, now: number, host: RoomStreamEvent | undefined): string | null {
  if (!host || host.type !== "host") return null;
  const data = host.data as { can: Record<string, boolean> } | null;
  const can = data?.can ?? {};
  for (const cmd of ["chance", "next", "duel", "podium"]) {
    if (can[cmd]) {
      const out = r.command(cmd, null, `${cmd}-${now}`, now, host.moment);
      return out.ok ? cmd : null;
    }
  }
  return null;
}

/** Сквозная игра ботами в настоящем движке. */
function fullGame(players: number, content: Record<string, unknown>, seed: string) {
  let now = 1_000_000;
  const r = room(players, content, now);
  const phones = Array.from({ length: players }, (_, i) => new Phone(`b${i}`, r, now, seed));
  const screen = collector();
  const host = collector();
  r.listen("screen", screen.listener, now);
  r.listen("host", host.listener, now);
  let maxScreen = 0;
  let maxTick = 0;
  expect(r.command("start", null, "start", now, r.moment())).toEqual({ ok: true, result: { finalists: finalistsFor(Number(content.finalists ?? 4), players) } });
  for (let i = 0; i < 40 * 60 * 10 && state(r).phase !== "podium"; i += 1) {
    now += 100;
    const s = state(r);
    const correct = s.chance ? questionsOf(s.content)[s.chance.question]?.correct : undefined;
    for (const p of phones) p.act(now, correct);
    const t0 = performance.now();
    r.tick(now);
    maxTick = Math.max(maxTick, performance.now() - t0);
    const last = screen.got.at(-1);
    if (last?.type === "screen") maxScreen = Math.max(maxScreen, Buffer.byteLength(JSON.stringify(last.data)));
    screen.got.length = Math.min(screen.got.length, 1);
    hostStep(r, now, host.got.at(-1));
    host.got.length = 0;
  }
  return { r, phones, maxScreen, maxTick };
}

describe("«Игры Матрёшки» в игровой комнате", () => {
  it("комната — только на тестовой версии, пока нет экранов (Блок 3a); «без связи» 3 с, пачка раз в 1 с", () => {
    expect(roomGames().has("matryoshka")).toBe(false);
    expect(roomGames({ check: true }).has("matryoshka")).toBe(true);
    expect(roomGames().has("bublikator")).toBe(true);
    expect(matryoshka.offlineMs).toBe(3000);
    expect(matryoshka.batchMs(100)).toBe(1000);
  });

  it("номера «№ 001…» — в порядке состава комнаты (сервер читает участников по порядку входа)", () => {
    const r = room(5);
    expect(Object.values(state(r).members).map((m) => [m.pid, m.num])).toEqual([
      ["b0", 1],
      ["b1", 2],
      ["b2", 3],
      ["b3", 4],
      ["b4", 5],
    ]);
    r.upsertParticipant({ id: "x", name: "Новый", kind: "player", teamId: null }, 1_000_100);
    expect(state(r).members.x?.num).toBe(6);
  });

  it("команда с этапом: двойное касание и второй пульт — `moved`, ничего не сделано; повтор по id — прежний итог", () => {
    let now = 1_000_000;
    const r = room(8);
    const m0 = r.moment();
    expect(m0).toBe("lobby:0:-:-:0");
    expect(r.command("start", null, "c1", now, m0).ok).toBe(true);
    expect(r.command("start", null, "c1", now, m0).ok).toBe(true);
    expect(r.command("start", null, "c2", now, m0)).toEqual({ ok: false, error: "moved" });
    for (let t = 0; t < 7000; t += 100) r.tick((now += 100));
    const m1 = r.moment();
    expect(m1).toBe("trial:0:rules:-:0");
    expect(r.command("skip-rules", null, "c3", now, m1)).toEqual({ ok: true });
    expect(r.command("skip-rules", null, "c4", now, m1)).toEqual({ ok: false, error: "moved" });
    // «+10 секунд» и «Табло» этап не меняют — но второе касание с тем же этапом (второй пульт) тоже `moved` (аудит 3a).
    for (let t = 0; t < 4000; t += 100) r.tick((now += 100));
    const m2 = r.moment();
    expect(r.command("more-time", null, "c5", now, m2)).toEqual({ ok: true });
    expect(r.command("more-time", null, "c6", now, m2)).toEqual({ ok: false, error: "moved" });
    expect((state(r).trial?.play as FreezeState).extra).toBe(10_000);
    const m3 = r.moment();
    expect(r.command("board", null, "c7", now, m3)).toEqual({ ok: true });
    expect(r.command("board", null, "c8", now, m3)).toEqual({ ok: false, error: "moved" });
    expect(state(r).board).toBe(true);
  });

  it("пауза движка посреди «Замри!»: все «отпустили», пачки на паузе выброшены, путь стоит; после «Продолжить» — жать заново (L7)", () => {
    let now = 1_000_000;
    const r = room(6, { style: "night" });
    const phones = Array.from({ length: 6 }, (_, i) => new Phone(`b${i}`, r, now, "p"));
    r.command("start", null, null, now);
    for (let t = 0; t < 20_000; t += 100) r.tick((now += 100));
    const s = state(r);
    expect(s.trial?.stage).toBe("play");
    const st = s.trial?.play as FreezeState;
    st.gazes = [];
    const phone = phones[0] as Phone;
    phone.send(now, [{ t: "h", on: true }]);
    for (let t = 0; t < 1000; t += 100) r.tick((now += 100));
    expect(st.runners.b0?.holding).toBe(true);
    expect(r.command("pause", null, null, now)).toEqual({ ok: true });
    expect(st.runners.b0?.holding).toBe(false);
    expect(phone.paused).toBe(true);
    const path = st.runners.b0?.path ?? 0;
    // На паузе «нажал» не доходит до игры.
    phone.send(now, [{ t: "h", on: true }]);
    for (let t = 0; t < 10_000; t += 100) r.tick((now += 100));
    expect(st.runners.b0?.holding).toBe(false);
    expect(r.command("resume", null, null, now)).toEqual({ ok: true });
    for (let t = 0; t < 3000; t += 100) r.tick((now += 100));
    expect(st.runners.b0?.path).toBeCloseTo(path, 6);
    phone.send(now, [{ t: "h", on: true }]);
    for (let t = 0; t < 1000; t += 100) r.tick((now += 100));
    expect(st.runners.b0?.holding).toBe(true);
  });

  it("«отпустил» дошло поздно: свежая пачка — по заявленному времени, повтор с отметкой — по отметке, повтор без отметки удержание не продлевает — никто не пойман (L5, второе ревью 3a)", () => {
    let now = 1_000_000;
    const r = room(6, { style: "night" });
    const phones = Array.from({ length: 3 }, (_, i) => new Phone(`b${i}`, r, now, "d"));
    r.command("start", null, null, now);
    for (let t = 0; t < 20_000; t += 100) r.tick((now += 100));
    const s = state(r);
    const st = s.trial?.play as FreezeState;
    const t0 = (now - s.offset) as number;
    st.gazes = [{ ph: t0, a: t0 + 3000, e: t0 + 6000, d: null }];
    for (const p of phones) p.send(now, [{ t: "h", on: true }]);
    for (let t = 0; t < 2900; t += 100) {
      now += 100;
      if (t % 1000 === 0) for (const p of phones) p.send(now, [{ t: "h", on: true }]);
      r.tick(now);
    }
    // Все отпустили за 0,1 с до поворота; пачки пришли через 0,9 с: b0 — свежая, b1 — повтор (`delayed`) без отметки, b2 —
    // повтор с отметкой.
    const releasedAt = now;
    // Пачка «отпустил» у b1 и b2 потерялась (номер ушёл), дошёл её повтор.
    const lost1 = (phones[1] as Phone).seq++;
    const lost2 = (phones[2] as Phone).seq++;
    for (let t = 0; t < 900; t += 100) r.tick((now += 100));
    (phones[0] as Phone).send(now, [{ t: "h", on: false }], { ago: 900 });
    (phones[1] as Phone).send(now, [{ t: "h", on: false }], { ago: 900, retry: true, seq: lost1 });
    (phones[2] as Phone).send(now, [{ t: "h", on: false, st: releasedAt }], { retry: true, seq: lost2 });
    expect(st.runners.b1?.holding).toBe(false);
    expect(st.runners.b2?.holding).toBe(false);
    for (let t = 0; t < 6000; t += 100) r.tick((now += 100));
    expect(st.runners.b0?.caught).toBe(0);
    expect(st.runners.b1?.caught).toBe(0);
    expect(st.runners.b2?.caught).toBe(0);
  });

  it("отметка времени `st`: честное «отпустил» в T+0,25 при дороге запроса 0–400 мс не поймано, в T+0,55 — поймано (окно с T+0,5 с); без отметки дорога съедает окно (аудит 3a)", () => {
    const lats = [0, 50, 100, 150, 250, 400];
    const run = (rel: number, stamped: boolean): boolean[] => {
      let now = 1_000_000;
      const r = room(8, { style: "night" });
      const phones = lats.map((_, i) => new Phone(`b${i}`, r, now, "st"));
      r.command("start", null, null, now);
      for (let t = 0; t < 20_000; t += 100) r.tick((now += 100));
      const s = state(r);
      const st = s.trial?.play as FreezeState;
      expect(s.trial?.stage).toBe("play");
      const t0 = now - s.offset;
      const T = t0 + 3000;
      st.gazes = [{ ph: t0, a: T, e: T + 3000, d: null }];
      const stamp = (at: number) => (stamped ? { st: at } : {});
      // Запросы по времени прихода: нажали сразу, «держу» раз в секунду до T − 0,2 с, «отпустил» в T + rel (по телефону).
      const plan: Array<{ arrive: number; phone: Phone; e: Record<string, unknown> }> = [];
      for (const p of phones) plan.push({ arrive: now, phone: p, e: { t: "h", on: true, ...stamp(now) } });
      for (let x = now + 1000; x < T + s.offset - 200; x += 1000) for (const p of phones) plan.push({ arrive: x, phone: p, e: { t: "h", on: true, ...stamp(x) } });
      lats.forEach((lat, i) => plan.push({ arrive: T + s.offset + rel + lat, phone: phones[i] as Phone, e: { t: "h", on: false, ...stamp(T + s.offset + rel) } }));
      plan.sort((a, b) => a.arrive - b.arrive);
      const end = T + s.offset + 6000;
      while (now < end) {
        while (plan.length > 0 && (plan[0]?.arrive ?? Infinity) <= now) {
          const x = plan.shift();
          if (x) x.phone.send(x.arrive, [x.e]);
        }
        r.tick((now += 50));
      }
      return lats.map((_, i) => (st.runners[`b${i}`]?.caught ?? 0) > 0);
    };
    expect(run(250, true)).toEqual(lats.map(() => false));
    expect(run(550, true)).toEqual(lats.map(() => true));
    // Без отметки (старый телефон) — по «приход − ago»: дорога больше 250 мс уже ловит.
    expect(run(250, false)).toEqual([false, false, false, false, false, true]);
  });

  it("поворот — по назначенному сервером T, окно с T + 0,5 с (реакция 0,3 + запас на часы 0,2): ошибки часов экрана и телефона ±150 мс, дорога 30/150/400 мс (второе ревью 3a)", () => {
    const ERR = [-150, 0, 150];
    const DELAYS = [30, 150, 400];
    /** Человек отпустил через `rt` после поворота, который показал экран (по своим часам, ошибка es); телефон ставит отметку по своим (ep). */
    const run = (rt: number): Array<{ es: number; ep: number; d: number; caught: boolean }> => {
      const combos = ERR.flatMap((es) => ERR.flatMap((ep) => DELAYS.map((d) => ({ es, ep, d }))));
      let now = 1_000_000;
      const r = room(combos.length + 2, { style: "night" });
      const phones = combos.map((_, i) => new Phone(`b${i}`, r, now, "clk"));
      r.command("start", null, null, now);
      for (let t = 0; t < 20_000; t += 100) r.tick((now += 100));
      const s = state(r);
      const st = s.trial?.play as FreezeState;
      expect(s.trial?.stage).toBe("play");
      const T = now - s.offset + 3000;
      st.gazes = [{ ph: T - 3000, a: T, e: T + 3000, d: null }];
      const Ts = T + s.offset;
      const plan: Array<{ arrive: number; i: number; e: Record<string, unknown> }> = [];
      combos.forEach((c, i) => {
        const release = Ts - c.es + rt; // настоящее время, когда отпустил
        for (let x = now; x < release; x += 1000) plan.push({ arrive: x + c.d, i, e: { t: "h", on: true, st: x + c.ep } });
        plan.push({ arrive: release + c.d, i, e: { t: "h", on: false, st: release + c.ep } });
      });
      plan.sort((a, b) => a.arrive - b.arrive);
      while (now < Ts + 6000) {
        while (plan.length > 0 && (plan[0]?.arrive ?? Infinity) <= now) {
          const x = plan.shift();
          if (x) (phones[x.i] as Phone).send(x.arrive, [x.e]);
        }
        r.tick((now += 10));
      }
      return combos.map((c, i) => ({ ...c, caught: (st.runners[`b${i}`]?.caught ?? 0) > 0 }));
    };
    // Честные 0,15–0,2 с — не пойманы ни при каких ошибках часов; 0,25 с — не пойманы, пока часы экрана и телефона расходятся не
    // больше чем на 0,15 с (в угловом случае «экран отстаёт на 0,15, телефон спешит на 0,15» — пойман; docs/matryoshka.md).
    for (const rt of [150, 200]) expect(run(rt).filter((c) => c.caught)).toEqual([]);
    expect(run(250).filter((c) => c.caught && c.ep - c.es <= 150)).toEqual([]);
    // Держал 0,8 с и дольше — пойман, кроме углового «экран спешит на 0,15, телефон отстаёт на 0,15».
    for (const rt of [800, 1200]) expect(run(rt).filter((c) => !c.caught && c.ep - c.es >= -150)).toEqual([]);
    // Без ошибок часов: 0,25 с — нет, 0,55 с — пойман при любой дороге.
    expect(run(550).filter((c) => c.es === 0 && c.ep === 0).every((c) => c.caught)).toBe(true);
  });

  it("реакция — от НАЗНАЧЕННОГО момента по сверенным часам телефона: ошибка часов ±300 мс и отрисовка позже до 500 мс — ни одного отказа; от отрисовки — отказы (требование к телефону 3b)", () => {
    const SHOW = 1_000_000; // назначенный момент (появление стульев, кнопка «Прыгаю первым!», вопрос) по часам сервера
    const rejected = (mode: "schedule" | "paint") => {
      let n = 0;
      for (const e of [-300, -200, -100, 0, 100, 200, 300]) // ошибка сверки часов телефона
        for (const d of [20, 100, 300, 800, 1500]) // дорога запроса
          for (const lag of [0, 100, 250, 400, 500]) // телефон нарисовал позже назначенного
            for (const human of [200, 400, 900, 2000]) {
              const paint = SHOW - e + lag; // телефон рисует, когда его часы показывают SHOW, плюс подвисание
              const tap = paint + human;
              const rt = mode === "schedule" ? tap + e - SHOW : human;
              const arrival = tap + d;
              const ev = timedEvent({ t: "sit", rt, st: tap + e }, arrival, 1500, false, true);
              if (!reactionFits(rt, Math.min(arrival, ev.at), SHOW, ev)) n += 1;
            }
      return n;
    };
    expect(rejected("schedule")).toBe(0);
    expect(rejected("paint")).toBeGreaterThan(0);
  });

  it("снимок посреди испытания → «перезапуск»: комната на паузе, испытание снова с отсчёта, после «Продолжить» — играется до конца", () => {
    let now = 1_000_000;
    const r = room(12, { style: "night" });
    r.command("start", null, null, now);
    for (let t = 0; t < 40_000; t += 100) r.tick((now += 100));
    expect(state(r).trial?.stage).toBe("play");
    const snap = r.snapshotData(now);
    const r2 = new Room({ id: "m1", key: "matryoshka", hostId: "h", game, players: Array.from({ length: 12 }, (_, i) => ({ pid: `b${i}`, name: `Гость ${i}`, team: null })), teams: [], snapshot: null, playMode: "solo", now: now + 5000, restoreFrom: JSON.parse(JSON.stringify(snap)) });
    expect(r2.paused).toBe(true);
    expect(r2.restored).toBe(true);
    const s2 = state(r2);
    expect(s2.trial?.stage).toBe("countdown");
    expect(s2.attempt).toBe(state(r).attempt + 1);
    now += 5000;
    for (let t = 0; t < 10_000; t += 100) r2.tick((now += 100));
    expect(s2.trial?.stage).toBe("countdown");
    expect(r2.command("resume", null, null, now)).toEqual({ ok: true });
    for (let t = 0; t < 200_000 && s2.trial?.stage !== "results"; t += 100) r2.tick((now += 100));
    expect(s2.trial?.stage).toBe("results");
    expect(inGame(s2).length).toBe(s2.trial?.T);
  });

  it("личное — только своё; экран — без тайн; номера болельщиков-опоздавших не мешают", () => {
    let now = 1_000_000;
    const r = room(10);
    const phones = Array.from({ length: 10 }, (_, i) => new Phone(`b${i}`, r, now, "own"));
    r.command("start", null, null, now);
    r.upsertParticipant({ id: "late", name: "Опоздал", kind: "player", teamId: null }, now);
    const late = new Phone("late", r, now, "own");
    expect((late.me as { role: string }).role).toBe("fan");
    for (let t = 0; t < 120_000; t += 100) {
      now += 100;
      for (const p of phones) p.act(now);
      r.tick(now);
      const me = JSON.stringify(phones[3]?.me);
      expect(/"b(?!3")\d+"/.test(me)).toBe(false);
    }
  });

  for (const [players, content, label] of [
    [6, { style: "night" }, "6 гостей, взрослые"],
    [12, { style: "sunny" }, "12 гостей, дети"],
    [50, { style: "sunny" }, "50 гостей, дети (замер)"],
    [50, { style: "night", finalists: 6 }, "50 гостей, взрослые, 6 финалистов"],
    [100, { style: "night", finalists: 8 }, "100 гостей (расчётный максимум), 8 финалистов"],
  ] as Array<[number, Record<string, unknown>, string]>) {
    it(`сквозная игра ботами: ${label} — до пьедестала, в финале ровно F, сводка экрана ≤ 4 КБ, шаг цикла ≤ 10 мс`, () => {
      const { r, maxScreen, maxTick } = fullGame(players, content, label);
      const s = state(r);
      expect(s.phase).toBe("podium");
      expect(s.final?.seeds.length).toBe(finalistsFor(Number(content.finalists ?? 4), players));
      expect(s.final?.champion).not.toBeNull();
      expect(maxScreen).toBeLessThanOrEqual(4096);
      expect(maxTick).toBeLessThan(players >= 100 ? 25 : 10);
      // Баллы ведущему: телефоны играли в нескольких раундах; игра сыграна до конца.
      const played = r.takePlayed();
      const units = new Map<string, Set<number>>();
      for (const { pid, unit } of played) units.set(pid, (units.get(pid) ?? new Set()).add(unit));
      const twoOrMore = [...units.values()].filter((u) => u.size >= 2).length;
      expect(twoOrMore).toBeGreaterThan(players * 0.8);
      expect(game.playedToEnd?.(r.state)).toBe(true);
      r.command("finish", null, null, 9e15);
      expect(s.phase).toBe("finished");
    }, 120_000);
  }
});
