/**
 * Стенд для тестов правил «Бубликатора» (не идёт в сборку: подключают только тесты). Комната понарошку: часы, кто на
 * связи, случайность из зерна (своя хэш-функция — без node:crypto), личные события копятся.
 */
import { command, createState, input, join, pause, resume, tick, type Env, type InEvent } from "./game";
import { flushPersonal } from "./views";
import type { BubState, Member } from "./types";

/** Детерминированное [0, 1) из строки (cyrb53). */
export function hashRandom(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) / 2 ** 53;
}

export class FakeEnv implements Env {
  now = 1_000_000;
  paused = false;
  players: Array<{ pid: string; name: string; team: string | null }> = [];
  teams = new Map<string, string>();
  onlineSet = new Set<string>();
  sent: Array<{ pid: string; data: Record<string, unknown> }> = [];
  changes = 0;
  checkpoints = 0;
  constructor(public seed = "seed") {}
  online(pid: string): boolean {
    return this.onlineSet.has(pid);
  }
  send(pid: string, data: unknown): void {
    this.sent.push({ pid, data: data as Record<string, unknown> });
  }
  changed(): void {
    this.changes += 1;
  }
  checkpoint(): void {
    this.checkpoints += 1;
  }
  random(key: string): number {
    return hashRandom(`${this.seed}:${key}`);
  }
}

export interface WorldOptions {
  players?: number;
  content?: Record<string, unknown>;
  seed?: string;
  names?: (i: number) => string;
  /** Командная сессия: столько команд платформы (гости — по кругу), экипаж = команда. */
  teams?: number;
  /** Названия команд (со смайликом, как при входе). */
  teamNames?: (i: number) => string;
}

export class World {
  env: FakeEnv;
  s: BubState;
  constructor(opts: WorldOptions = {}) {
    this.env = new FakeEnv(opts.seed ?? "seed");
    const n = opts.players ?? 6;
    const teams = opts.teams ?? 0;
    for (let t = 0; t < teams; t += 1) this.env.teams.set(`t${t}`, opts.teamNames?.(t) ?? `Команда ${t + 1}`);
    for (let i = 0; i < n; i += 1) {
      const pid = `p${i}`;
      this.env.players.push({ pid, name: opts.names?.(i) ?? `Гость ${i}`, team: teams > 0 ? `t${i % teams}` : null });
      this.env.onlineSet.add(pid);
    }
    this.s = createState(opts.content ?? {}, teams > 0, this.env);
  }
  get g(): number {
    return this.env.now - this.s.offset;
  }
  private pausedAt: number | null = null;
  /** «Пауза» как в комнате: телефоны и цикл стоят, время игры встаёт. */
  pause(): void {
    if (this.pausedAt !== null) return;
    this.env.paused = true;
    this.pausedAt = this.env.now;
    pause(this.s, this.env);
  }
  /** «Продолжить»: сколько стояли — столько часы игры сдвигаются. */
  resume(): void {
    if (this.pausedAt === null) return;
    this.env.paused = false;
    resume(this.s, this.env.now - this.pausedAt, this.env);
    this.pausedAt = null;
  }
  addPlayer(pid: string, name = pid, team: string | null = null): void {
    this.env.players.push({ pid, name, team });
    this.env.onlineSet.add(pid);
    // Комната зовёт onJoin при новом участнике.
    join(this.s, { pid, name, team }, this.env);
  }
  cmd(name: string, args?: unknown) {
    const out = command(this.s, name, args, this.env);
    flushPersonal(this.s, this.env);
    return out;
  }
  ok(name: string, args?: unknown): void {
    const out = this.cmd(name, args);
    if (!out.ok) throw new Error(`${name}: ${out.error}`);
  }
  step(ms = 100): void {
    this.env.now += ms;
    tick(this.s, this.env);
    flushPersonal(this.s, this.env);
  }
  advance(ms: number, step = 100, each?: () => void): void {
    for (let t = 0; t < ms; t += step) {
      this.step(step);
      each?.();
    }
  }
  send(pid: string, events: Array<Record<string, unknown>>, opts: { ago?: number; delayed?: boolean } = {}): void {
    const evs: InEvent[] = events.map((e) => ({ ...e, t: String(e.t), at: this.env.now - (opts.ago ?? 0), late: false, delayed: opts.delayed === true }));
    input(this.s, pid, evs, this.env);
    flushPersonal(this.s, this.env);
  }
  member(pid: string): Member {
    const m = this.s.members[pid];
    if (!m) throw new Error(`нет ${pid}`);
    return m;
  }
  /** Сбор экипажей → (тренировка) → старт перелёта → полёт. */
  toFlight(drill = false): void {
    this.ok("gather");
    if (drill) this.ok("drill");
    this.ok("start");
    this.advance(5100);
  }
  /** Хозяин (или его дублёр) ставит прибор приказа игрока в цель. */
  fulfil(pid: string, by?: string): boolean {
    const order = this.member(pid).order;
    if (!order) return false;
    const ctl = this.s.controls[order.control];
    if (!ctl) return false;
    this.send(by ?? ctl.owner, [{ t: "move", c: ctl.id, s: order.target }]);
    return true;
  }
  offline(pid: string): void {
    this.env.onlineSet.delete(pid);
  }
  online(pid: string): void {
    this.env.onlineSet.add(pid);
  }
  /** Снимок без служебного, без того, что не откатывается «Назад» (время, случайность, номера), и без самой точки отката. */
  core(): string {
    const { rt: _rt, offset: _o, floor: _f, rng: _r, attempts: _a, lastTick: _l, base: _b, pausedGame: _p, orderSeq: _os, eventSeq: _es, ctlSeq: _cs, joinSeq: _js, ...rest } = this.s;
    void [_rt, _o, _f, _r, _a, _l, _b, _p, _os, _es, _cs, _js];
    return JSON.stringify(rest);
  }
  /** То же без раздачи (приборы, пульты, приказы): точка «Назад» их не хранит — их раздаёт следующий старт. */
  lean(): string {
    const c = JSON.parse(this.core()) as Record<string, unknown> & { members: Record<string, Record<string, unknown>> };
    c.controls = {};
    for (const m of Object.values(c.members)) {
      m.panel = [];
      m.order = null;
      m.lastControl = null;
    }
    return JSON.stringify(c);
  }
}
