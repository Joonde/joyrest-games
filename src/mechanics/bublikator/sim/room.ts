/**
 * Игровая комната «Бубликатора» в памяти браузера (Блок 2d): предпросмотр в конструкторе, «Репетиция» и стенд пульта. Правила —
 * те же функции, что у сервера (`rules/game.ts`, `rules/views.ts`), обёртка повторяет движок комнаты (`server/src/rooms/engine.ts`):
 * этап `moment` и отказ `moved`, пауза и «Продолжить», сводки экрана (5 раз в секунду) и пульта (раз в секунду и после команды),
 * личное одному телефону. Гостей играют боты: двигают приборы по приказам с разной слаженностью экипажей, трясут в дождь,
 * держат «Тягу», капитан вводит SOS, голосуют. Отличия от сервера — в `docs/bublikator.md`, раздел 2d.
 */
import type { RoomInputEvent, RoomInputReply, RoomStreamEvent } from "../../../data/types";
import type { HostLink } from "../host/link";
import type { PhoneLink, PhoneSender } from "../phone/link";
import type { ScreenLink } from "../screen/link";
import { captainOf } from "../rules/crews";
import { command, createState, input, moment, pause, resume, tick, voteCandidates, voteCrewOf, type Env, type InEvent } from "../rules/game";
import type { BubState } from "../rules/types";
import { flushPersonal, hostView, personalSnapshot, screenView } from "../rules/views";
import { hashRandom } from "./random";

export const SIM_TEAM_NAMES = ["🦊 Лисы", "🚀 Ракеты", "🐻 Медведи", "🌟 Звёзды", "🎩 Джентльмены", "🍀 Клевер", "🐙 Осьминоги", "⚡ Молнии", "🎈 Шарики", "🍕 Пицца"];
export const SIM_NAMES = ["Аня", "Костя", "Оля", "Дима", "Маша", "Серёжа", "Катя", "Вова", "Лена", "Миша", "Света", "Паша", "Юля", "Игорь", "Таня", "Рома", "Настя", "Женя", "Даша", "Артём"];

export interface SimOptions {
  content: unknown;
  /** Сколько команд (экипажей) и гостей всего (по кругу команд). */
  teams: number;
  guests: number;
  seed?: string;
  teamNames?: (i: number) => string;
  names?: (i: number) => string;
  /** Часы: по умолчанию `Date.now()`. Предпросмотр ускоряет время своими часами. */
  clock?: () => number;
}

/** Телефон, за которого играет человек (вкладка «Телефон»): боты за него не играют, пока он смотрит. */
export const SIM_VIEWER = "p0";

class SimEnv implements Env {
  now: number;
  paused = false;
  players: Array<{ pid: string; name: string; team: string | null }> = [];
  teams = new Map<string, string>();
  offlineSet = new Set<string>();
  sent: Array<{ pid: string; data: unknown }> = [];
  changes = 0;
  constructor(
    now: number,
    readonly seed: string,
  ) {
    this.now = now;
  }
  online(pid: string): boolean {
    return !this.offlineSet.has(pid);
  }
  send(pid: string, data: unknown): void {
    if (pid === SIM_VIEWER) this.sent.push({ pid, data });
  }
  changed(): void {
    this.changes += 1;
  }
  checkpoint(): void {
    /* в памяти снимков нет */
  }
  random(key: string): number {
    return hashRandom(`${this.seed}:${key}`);
  }
}

type Listener = (event: RoomStreamEvent) => void;

export class SimRoom {
  readonly env: SimEnv;
  s: BubState;
  private readonly clock: () => number;
  private pausedAt = 0;
  private screens = new Set<Listener>();
  private hosts = new Set<Listener>();
  private phones = new Set<Listener>();
  private lastScreen = 0;
  private lastHost = 0;
  private lastBot = new Map<string, number>();
  private maxLag = 0;
  private lastReal = 0;
  /** Человек смотрит телефон `SIM_VIEWER` — боты за него не играют. */
  viewerActive = false;
  /** Сколько команд выполнено и отклонено (для стенда). */
  commands: Array<{ cmd: string; ok: boolean; error?: string }> = [];

  constructor(opts: SimOptions) {
    this.clock = opts.clock ?? (() => Date.now());
    this.env = new SimEnv(this.clock(), opts.seed ?? "preview");
    const teams = Math.max(1, Math.min(20, opts.teams));
    for (let t = 0; t < teams; t += 1) this.env.teams.set(`t${t}`, opts.teamNames?.(t) ?? SIM_TEAM_NAMES[t % SIM_TEAM_NAMES.length] + (t >= SIM_TEAM_NAMES.length ? ` ${t + 1}` : ""));
    for (let i = 0; i < opts.guests; i += 1) {
      const name = opts.names?.(i) ?? `${SIM_NAMES[i % SIM_NAMES.length]}${i >= SIM_NAMES.length ? ` ${Math.floor(i / SIM_NAMES.length) + 1}` : ""}`;
      this.env.players.push({ pid: `p${i}`, name, team: `t${i % teams}` });
    }
    this.s = createState(opts.content, true, this.env);
  }

  now(): number {
    return this.clock();
  }

  /** Один шаг цикла (как цикл комнат, 100 мс): правила, боты, сводки. */
  step(): void {
    const t = this.clock();
    // Задержка цикла — как у комнаты: насколько шаг опоздал против 100 мс (в браузере — по настоящим часам).
    const real = Date.now();
    if (this.lastReal > 0) this.maxLag = Math.max(this.maxLag * 0.95, real - this.lastReal - 100, 0);
    this.lastReal = real;
    this.env.now = t;
    if (!this.env.paused) {
      tick(this.s, this.env);
      this.bots(t);
      flushPersonal(this.s, this.env);
    }
    this.pump();
    if (t - this.lastScreen >= 200) this.flushScreen();
    if (t - this.lastHost >= 1000) this.flushHost();
  }

  private view() {
    return { now: this.env.now, paused: this.env.paused, online: (pid: string) => this.env.online(pid) };
  }

  private counts(): { players: number; online: number } {
    const players = this.env.players.length;
    return { players, online: players - this.env.offlineSet.size };
  }

  screenEvent(): RoomStreamEvent {
    return { type: "screen", at: this.env.now, version: this.env.changes, paused: this.env.paused, ...this.counts(), data: screenView(this.s, this.view()) };
  }

  hostEvent(): RoomStreamEvent {
    const offline = this.env.players.filter((p) => this.env.offlineSet.has(p.pid)).map((p) => ({ pid: p.pid, name: p.name }));
    return {
      type: "host",
      at: this.env.now,
      version: this.env.changes,
      moment: moment(this.s),
      paused: this.env.paused,
      restored: false,
      ...this.counts(),
      offline,
      loop: { lagMs: 0, maxLagMs: Math.round(this.maxLag), memoryMb: 0 },
      data: hostView(this.s, this.view()),
    };
  }

  flushScreen(): void {
    this.lastScreen = this.env.now;
    const e = this.screenEvent();
    for (const l of this.screens) l(e);
  }

  flushHost(): void {
    this.lastHost = this.env.now;
    const e = this.hostEvent();
    for (const l of this.hosts) l(e);
  }

  /** Всё, что комната отправила телефону человека, — в его поток. */
  private pump(): void {
    const mine = this.env.sent;
    this.env.sent = [];
    for (const x of mine) for (const l of this.phones) l({ type: "event", at: this.env.now, data: x.data });
  }

  private room(): void {
    const e: RoomStreamEvent = { type: "room", at: this.env.now, paused: this.env.paused };
    for (const l of [...this.screens, ...this.hosts, ...this.phones]) l(e);
  }

  /** Команда пульта как у движка: пауза и «Продолжить» — без этапа; иначе другой этап — отказ `moved`. */
  command(cmd: string, args: unknown, expect?: string): { ok: true; result?: unknown } | { ok: false; error: string } {
    this.env.now = this.clock();
    let out: { ok: true; result?: unknown } | { ok: false; error: string };
    if (cmd === "pause") {
      if (!this.env.paused) {
        this.env.paused = true;
        this.pausedAt = this.env.now;
        pause(this.s, this.env);
        this.room();
      }
      out = { ok: true };
    } else if (cmd === "resume") {
      if (this.env.paused) {
        this.env.paused = false;
        resume(this.s, this.env.now - this.pausedAt, this.env);
        this.room();
      }
      out = { ok: true };
    } else if (expect !== undefined && expect !== moment(this.s)) out = { ok: false, error: "moved" };
    else out = command(this.s, cmd, args, this.env);
    flushPersonal(this.s, this.env);
    this.pump();
    this.commands.push(out.ok ? { cmd, ok: true } : { cmd, ok: false, error: out.error });
    this.flushHost();
    this.flushScreen();
    return out;
  }

  /** Событие телефона человека (как пачка: `ago` — сколько назад). */
  phoneInput(event: RoomInputEvent, beforeMs = 0): void {
    if (this.env.paused) return;
    this.env.now = this.clock();
    const { t, ...rest } = event as RoomInputEvent & Record<string, unknown>;
    const e: InEvent = { ...rest, t: String(t), at: this.env.now - Math.max(0, beforeMs), late: false, delayed: false };
    input(this.s, SIM_VIEWER, [e], this.env);
    flushPersonal(this.s, this.env);
    this.pump();
  }

  private send(pid: string, events: Array<Record<string, unknown>>): void {
    const evs: InEvent[] = events.map((e) => ({ ...e, t: String(e.t), at: this.env.now, late: false, delayed: false }));
    input(this.s, pid, evs, this.env);
  }

  private every(pid: string, key: string, ms: number): boolean {
    const k = `${pid}:${key}`;
    const last = this.lastBot.get(k) ?? -Infinity;
    if (this.env.now - last < ms) return false;
    this.lastBot.set(k, this.env.now);
    return true;
  }

  /** Боты: за каждого гостя (кроме того, за кого играет человек). */
  private bots(t: number): void {
    const s = this.s;
    const leg = s.leg;
    const ev = leg?.event ?? null;
    for (const m of Object.values(s.members)) {
      if (m.gone || m.role === "out" || m.crew === null) continue;
      if (m.pid === SIM_VIEWER && this.viewerActive) continue;
      const crew = s.crews.find((c) => c.id === m.crew);
      if (!crew) continue;
      if (!m.roleSeen && this.every(m.pid, "role", 1500)) this.send(m.pid, [{ t: "role-ok" }]);
      // Приказ: хозяин прибора (бот) ставит его в нужное положение — с слаженностью своего экипажа.
      const skill = 0.25 + 0.6 * hashRandom(`skill:${crew.id}`);
      for (const other of Object.values(s.members)) {
        const order = other.order;
        if (!order || other.crew !== m.crew) continue;
        const ctl = s.controls[order.control];
        if (!ctl || ctl.owner !== m.pid || ctl.state === order.target) continue;
        if (hashRandom(`${m.pid}:${order.id}:${Math.floor(t / 500)}`) < skill * 0.35 && this.every(m.pid, `mv${order.id}`, 400)) this.send(m.pid, [{ t: "move", c: ctl.id, s: order.target }]);
      }
      if (crew.repair && this.every(m.pid, "repair", 300)) this.send(m.pid, [{ t: "tap", n: 3 }]);
      if (crew.finishedAt !== null && leg?.stage === "fly" && this.every(m.pid, "salute", 2500)) this.send(m.pid, [{ t: "salute", n: 2 }]);
      if (ev && ev.started && ev.crews.includes(crew.id) && leg?.stage === "fly") {
        const since = Math.max(0, t - s.offset - ev.startAt);
        if (ev.kind === "meteor" && this.every(m.pid, "shake", 400)) this.send(m.pid, [{ t: "shake", p: Math.min(100, (since / 100) * (0.5 + skill * 0.6)) }]);
        if (ev.kind === "pull" && this.every(m.pid, "hold", 1200)) this.send(m.pid, [{ t: "hold", on: hashRandom(`${m.pid}:hold:${Math.floor(t / 1200)}`) < 0.5 + skill * 0.5 }]);
        if (ev.kind === "sos" && crew.sos && !crew.sos.done && this.every(m.pid, "sos", 700)) {
          if (captainOf(s, crew.id, (pid) => this.env.online(pid))?.pid === m.pid) {
            const next = (ev.seq ?? [])[crew.sos.progress] ?? 0;
            const wrong = hashRandom(`${m.pid}:sos:${Math.floor(t / 700)}`) > 0.6 + skill * 0.4;
            this.send(m.pid, [{ t: "sos", color: wrong ? (next + 1) % 4 : next }]);
          }
        }
      }
      if (leg?.stage === "vote" && m.vote === null && this.every(m.pid, "vote", 2500)) {
        const own = voteCrewOf(s, m);
        const list = own === null ? [] : voteCandidates(s, own).filter((c) => c.pid !== m.pid);
        const pick = list[Math.floor(hashRandom(`${m.pid}:vote`) * list.length)];
        if (pick) this.send(m.pid, [{ t: "vote", pid: pick.pid }]);
      }
    }
  }

  // ---------------------------------------------------------------- связи для экрана, телефона и пульта

  screenLink(): ScreenLink {
    return {
      subscribe: (onEvent) => {
        this.screens.add(onEvent);
        queueMicrotask(() => onEvent(this.screenEvent()));
        return () => this.screens.delete(onEvent);
      },
    };
  }

  hostLink(): HostLink {
    return {
      subscribe: (onEvent) => {
        this.hosts.add(onEvent);
        queueMicrotask(() => onEvent(this.hostEvent()));
        return () => this.hosts.delete(onEvent);
      },
      command: async (cmd, args, expect) => {
        const out = this.command(cmd, args ?? null, expect);
        if (out.ok) return out.result ?? null;
        throw Object.assign(new Error(out.error), { code: out.error === "invalid-argument" ? "invalid-argument" : "failed-precondition", reason: out.error });
      },
    };
  }

  phoneLink(): PhoneLink {
    return {
      subscribe: (onEvent) => {
        this.phones.add(onEvent);
        queueMicrotask(() =>
          onEvent({ type: "snapshot", at: this.env.now, paused: this.env.paused, every: 2000, offlineMs: 4000, data: personalSnapshot(this.s, SIM_VIEWER, this.view()) }),
        );
        return () => this.phones.delete(onEvent);
      },
      sender: (onReply): PhoneSender => ({
        push: (event, _now, beforeMs) => {
          this.phoneInput(event, beforeMs ?? 0);
          const reply: RoomInputReply = { at: this.env.now, every: 2000, paused: this.env.paused, dropped: 0, dup: false, stale: false };
          onReply(reply);
        },
        stop: () => undefined,
      }),
    };
  }
}

/**
 * Ведущий-автопилот предпросмотра: следующий шаг игры, когда этап готов (нажимает те же кнопки, что пульт). null — ждать.
 * `since` — сколько игры прошло на этом этапе (мс времени комнаты).
 */
export function autopilot(s: BubState, since: number): { cmd: string; args?: unknown } | null {
  if (s.phase === "lobby") return since >= 2500 ? { cmd: "gather" } : null;
  if (s.phase === "crews") return since >= 4000 ? { cmd: "start" } : null;
  if (s.phase === "drill") return since >= 8000 ? { cmd: "start" } : null;
  if (s.phase === "leg") {
    const stage = s.leg?.stage;
    if (stage === "dock") return since >= 6000 && !(s.leg?.saboteurs && s.leg.vote === null) ? { cmd: "next" } : null;
    if (stage === "voted") return since >= 6000 ? { cmd: "next" } : null;
  }
  return null;
}
