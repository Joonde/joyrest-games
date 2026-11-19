/** Комната «Игр Матрёшки» в памяти: те же правила и боты, потоки host/screen/me и команды как у движка. */
import type { RoomInputEvent, RoomInputReply, RoomStreamEvent } from "../../../data/types";
import type { HostLink } from "../host/link";
import type { PhoneLink, PhoneSender } from "../phone/link";
import type { ScreenLink } from "../screen/link";
import { botStep, newBot } from "./bots";
import { questionsOf } from "../rules/content";
import { command } from "../rules/game";
import type { MatContent, MatState } from "../rules/types";
import { flushPersonal, hostView, personalSnapshot, personalView, screenView } from "../rules/views";
import { World } from "../rules/world.test-kit";

export const SIM_VIEWER = "p0";
export const SIM_NAMES = ["Аня", "Костя", "Оля", "Дима", "Маша", "Серёжа", "Катя", "Вова", "Лена", "Миша", "Света", "Паша", "Юля", "Игорь", "Таня", "Рома", "Настя", "Женя", "Даша", "Артём"];

type Listener = (event: RoomStreamEvent) => void;

export interface SimOptions {
  content: MatContent;
  guests: number;
  seed?: string;
  clock?: () => number;
  names?: (index: number) => string;
}

export class SimRoom {
  readonly world: World;
  private readonly clock: () => number;
  private screens = new Set<Listener>();
  private hosts = new Set<Listener>();
  private phones = new Set<Listener>();
  private lastScreen = 0;
  private lastHost = 0;
  private pausedAt = 0;
  private maxLag = 0;
  private lastReal = 0;
  viewerActive = false;
  commands: Array<{ cmd: string; ok: boolean; error?: string }> = [];

  constructor(opts: SimOptions) {
    const guests = Math.max(6, Math.min(100, opts.guests));
    this.clock = opts.clock ?? (() => Date.now());
    this.world = new World(guests, opts.content as unknown as Record<string, unknown>, opts.seed ?? "preview");
    this.world.now = this.clock();
    this.world.players.forEach((p, i) => { p.name = opts.names?.(i) ?? `${SIM_NAMES[i % SIM_NAMES.length]}${i >= SIM_NAMES.length ? ` ${Math.floor(i / SIM_NAMES.length) + 1}` : ""}`; });
  }

  get s(): MatState { return this.world.s; }
  now(): number { return this.clock(); }

  private counts() {
    return { players: this.world.players.length, online: this.world.players.length - this.world.offline.size };
  }

  screenEvent(): RoomStreamEvent {
    return { type: "screen", at: this.world.now, version: this.world.changes, paused: this.world.paused, ...this.counts(), data: screenView(this.s, this.world) };
  }

  hostEvent(): RoomStreamEvent {
    return {
      type: "host", at: this.world.now, version: this.world.changes, moment: this.world.host().moment,
      paused: this.world.paused, restored: false, ...this.counts(),
      offline: this.world.players.filter((p) => this.world.offline.has(p.pid)).map((p) => ({ pid: p.pid, name: p.name })),
      loop: { lagMs: 0, maxLagMs: Math.round(this.maxLag), memoryMb: 0 }, data: hostView(this.s, this.world),
    };
  }

  private phoneSnapshot(): RoomStreamEvent {
    return { type: "snapshot", at: this.world.now, paused: this.world.paused, every: 1000, offlineMs: 3000, data: personalSnapshot(this.s, SIM_VIEWER, this.world) };
  }

  flushScreen(): void { this.lastScreen = this.world.now; const e = this.screenEvent(); for (const l of this.screens) l(e); }
  flushHost(): void { this.lastHost = this.world.now; const e = this.hostEvent(); for (const l of this.hosts) l(e); }

  private pump(): void {
    const sent = this.world.sent;
    this.world.sent = [];
    for (const item of sent) if (item.pid === SIM_VIEWER) for (const l of this.phones) l({ type: "event", at: this.world.now, data: item.data });
  }

  private roomEvent(): void {
    const e: RoomStreamEvent = { type: "room", at: this.world.now, paused: this.world.paused };
    for (const l of [...this.screens, ...this.hosts, ...this.phones]) l(e);
  }

  step(): void {
    const real = Date.now();
    if (this.lastReal > 0) this.maxLag = Math.max(this.maxLag * 0.95, real - this.lastReal - 100, 0);
    this.lastReal = real;
    this.world.now = this.clock();
    this.world.step(100, false);
    if (!this.world.paused) this.botsAct();
    this.pump();
    if (this.world.now - this.lastScreen >= 200) this.flushScreen();
    if (this.world.now - this.lastHost >= 1000) this.flushHost();
  }

  private botsAct(): void {
    const correct = this.s.chance ? questionsOf(this.s.content)[this.s.chance.question]?.correct : undefined;
    for (const p of this.world.players) {
      if (this.world.offline.has(p.pid) || (p.pid === SIM_VIEWER && this.viewerActive)) continue;
      let bot = this.world.bots.get(p.pid);
      if (!bot) { bot = newBot(p.pid, this.world.seed); this.world.bots.set(p.pid, bot); }
      const events = botStep(bot, personalView(this.s, p.pid, this.world), this.world.now, this.world.paused, { chanceCorrect: correct });
      if (events.length > 0) this.world.in(p.pid, events);
    }
  }

  command(cmd: string, args?: unknown, expect?: string): { ok: true; result?: unknown } | { ok: false; error: string } {
    this.world.now = this.clock();
    let out: { ok: true; result?: unknown } | { ok: false; error: string };
    if (cmd === "pause") {
      if (!this.world.paused) { this.pausedAt = this.world.now; this.world.pause(); this.roomEvent(); }
      out = { ok: true };
    } else if (cmd === "resume") {
      if (this.world.paused) { const ms = Math.max(0, this.world.now - this.pausedAt); this.world.resume(ms); this.roomEvent(); }
      out = { ok: true };
    } else if (expect !== undefined && expect !== this.world.host().moment) out = { ok: false, error: "moved" };
    else out = command(this.s, cmd, args, this.world);
    flushPersonal(this.s, this.world);
    this.pump();
    this.commands.push(out.ok ? { cmd, ok: true } : { cmd, ok: false, error: out.error });
    this.flushHost();
    this.flushScreen();
    return out;
  }

  phoneInput(event: RoomInputEvent): void {
    if (this.world.paused) return;
    this.world.now = this.clock();
    this.world.in(SIM_VIEWER, [event as Record<string, unknown>]);
    this.pump();
  }

  hostLink(): HostLink {
    return {
      subscribe: (onEvent) => { this.hosts.add(onEvent); queueMicrotask(() => { if (this.hosts.has(onEvent)) onEvent(this.hostEvent()); }); return () => this.hosts.delete(onEvent); },
      command: async (cmd, args, expect) => {
        const out = this.command(cmd, args, expect);
        if (!out.ok) throw Object.assign(new Error(out.error), { code: "failed-precondition", reason: out.error });
        return out.result ?? null;
      },
    };
  }

  screenLink(): ScreenLink {
    return { subscribe: (onEvent) => { this.screens.add(onEvent); queueMicrotask(() => { if (this.screens.has(onEvent)) onEvent(this.screenEvent()); }); return () => this.screens.delete(onEvent); } };
  }

  phoneLink(): PhoneLink {
    return {
      key: "matryoshka-preview",
      clock: { offset: () => 0, sync: () => undefined },
      subscribe: (onEvent) => { this.phones.add(onEvent); queueMicrotask(() => { if (this.phones.has(onEvent)) onEvent(this.phoneSnapshot()); }); return () => this.phones.delete(onEvent); },
      sender: (onReply, _onError): PhoneSender => {
        const reply = (): RoomInputReply => ({ at: this.world.now, every: 1000, paused: this.world.paused, dropped: 0, dup: false, stale: false });
        return { push: (event) => { this.phoneInput(event); onReply(reply()); }, stop: () => undefined };
      },
    };
  }
}

/** Автопилот ведущего: нажимает только команды, разрешённые серверной сводкой. */
export function autopilot(room: SimRoom): void {
  const v = room.world.host();
  if (v.can.start) room.command("start");
  else if (v.can["skip-rules"]) room.command("skip-rules");
  else if (v.can.chance) room.command("chance");
  else if (v.can.next) room.command("next");
  else if (v.can.duel) room.command("duel");
  else if (v.can.podium) room.command("podium");
}
