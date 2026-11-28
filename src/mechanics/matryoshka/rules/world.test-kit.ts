/**
 * Мир для тестов правил «Игр Матрёшки»: часы, кто на связи, зерно, отправка личного, боты по личному виду. Не тест сам по себе
 * (vitest берёт только `*.test.ts`).
 */
import { botStep, newBot, type Bot } from "../sim/bots";
import { questionsOf } from "./content";
import type { Env, InEvent } from "./env";
import { command, createState, input, join, pause, resume, tick, type Outcome } from "./game";
import type { MatState } from "./types";
import { flushPersonal, hostView, personalView, screenView } from "./views";

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

export class World implements Env {
  now = 1_000_000;
  paused = false;
  players: Array<{ pid: string; name: string; team: string | null }> = [];
  offline = new Set<string>();
  sent: Array<{ pid: string; data: unknown }> = [];
  changes = 0;
  checkpoints = 0;
  s: MatState;
  bots = new Map<string, Bot>();

  constructor(
    n: number,
    content: Record<string, unknown> = {},
    readonly seed = "seed",
  ) {
    for (let i = 0; i < n; i += 1) this.players.push({ pid: `p${i}`, name: `Игрок ${i + 1}`, team: null });
    this.s = createState(content, this);
  }

  online(pid: string): boolean {
    return !this.offline.has(pid);
  }
  send(pid: string, data: unknown): void {
    this.sent.push({ pid, data });
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

  addPlayer(pid: string, name: string): void {
    this.players.push({ pid, name, team: null });
    join(this.s, { pid, name }, this);
  }

  cmd(name: string, args: unknown = null): Outcome {
    const out = command(this.s, name, args, this);
    flushPersonal(this.s, this);
    return out;
  }

  /**
   * Событие телефона: `ago` — сколько мс назад (свежее), `delayed` — из повторённой пачки (время — приход). Число `st` — отметка
   * телефона (часы сервера), как у движка с `stampedTime`: время — она (не позже «сейчас»), `stamped`.
   */
  in(pid: string, events: Array<Record<string, unknown>>, opts: { ago?: number; delayed?: boolean } = {}): boolean {
    const ev = events.map((e) => {
      const { st, ...rest } = e;
      const stamped = typeof st === "number" && Number.isFinite(st);
      return { ...rest, t: String(e.t), at: stamped ? Math.min(this.now, st) : this.now - (opts.ago ?? 0), late: false, delayed: opts.delayed === true, ...(stamped ? { stamped: true } : {}) };
    }) as InEvent[];
    const played = input(this.s, pid, ev, this);
    flushPersonal(this.s, this);
    return played;
  }

  pause(): void {
    this.paused = true;
    pause(this.s, this);
  }
  resume(ms: number): void {
    this.paused = false;
    resume(this.s, ms, this);
  }

  /** Шаг цикла 100 мс (как комната); боты — по своему личному виду. */
  step(ms: number, bots = false): void {
    for (let x = 0; x < ms; x += 100) {
      this.now += 100;
      if (this.paused) continue;
      tick(this.s, this);
      if (bots) this.botsAct();
      flushPersonal(this.s, this);
    }
  }

  botsAct(): void {
    const correct = this.s.chance ? questionsOf(this.s.content)[this.s.chance.question]?.correct : undefined;
    for (const p of this.players) {
      if (this.offline.has(p.pid)) continue;
      let b = this.bots.get(p.pid);
      if (!b) {
        b = newBot(p.pid, this.seed);
        this.bots.set(p.pid, b);
      }
      const me = personalView(this.s, p.pid, this);
      const events = botStep(b, me, this.now, this.paused, { chanceCorrect: correct });
      if (events.length > 0) this.in(p.pid, events);
    }
  }

  /** Шагать, пока условие не выполнится (не дольше `limit` мс). */
  until(cond: () => boolean, limit = 600_000, bots = false): boolean {
    for (let t = 0; t < limit; t += 100) {
      if (cond()) return true;
      this.step(100, bots);
    }
    return cond();
  }

  screen() {
    return screenView(this.s, this);
  }
  me(pid: string) {
    return personalView(this.s, pid, this);
  }
  host() {
    return hostView(this.s, this);
  }
}
