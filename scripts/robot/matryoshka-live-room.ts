// Живая игра стенда телефона «Игр Матрёшки» (Блок 3b): настоящий движок комнаты (`server/src/rooms/engine.ts`) с игрой
// `server/src/rooms/matryoshka.ts`, боты — по своему личному виду (`sim/bots.ts`), несколько игроков — настоящие телефоны в
// браузере (их пачки и поток идут через `matryoshka-live.mjs`). Собирается esbuild для Node.
import type { RoomInputReply, RoomStreamEvent } from "../../src/data/types";
import { questionsOf } from "../../src/mechanics/matryoshka/rules/content";
import type { HostView, MatState } from "../../src/mechanics/matryoshka/rules/types";
import { botStep, newBot, type Bot } from "../../src/mechanics/matryoshka/sim/bots";
import { parseInput, Room, type RoomGame } from "../../server/src/rooms/engine";
import { matryoshka } from "../../server/src/rooms/matryoshka";

export interface LiveOptions {
  players: Array<{ pid: string; name: string }>;
  /** Игроки-телефоны (остальные — боты). */
  phones: string[];
  content: Record<string, unknown>;
  now: number;
  seed: string;
  /** Сколько ботов «ленивые» (ничего не жмут): настоящие телефоны доживают до поздних испытаний и финала. */
  lazy?: number;
}

export function createLive(o: LiveOptions) {
  const room = new Room({
    id: "live",
    key: "matryoshka",
    hostId: "h",
    game: matryoshka as RoomGame<unknown>,
    players: o.players.map((p) => ({ pid: p.pid, name: p.name, team: null })),
    teams: [],
    snapshot: { title: "Игры Матрёшки", mechanic: "matryoshka", content: o.content },
    playMode: "solo",
    now: o.now,
  });
  const state = () => room.state as MatState;
  const bots = new Map<string, { bot: Bot; me: unknown; paused: boolean; seq: number }>();
  let lazyLeft = o.lazy ?? 0;
  for (const p of o.players) {
    if (o.phones.includes(p.pid)) continue;
    const lazy = lazyLeft > 0;
    if (lazy) lazyLeft -= 1;
    const b = { bot: newBot(p.pid, o.seed, { lazy, skill: lazy ? 0.1 : undefined }), me: null as unknown, paused: false, seq: 0 };
    bots.set(p.pid, b);
    room.listen(
      "me",
      {
        send: (e: RoomStreamEvent) => {
          if (e.type === "snapshot") {
            b.me = e.data;
            b.paused = e.paused;
          } else if (e.type === "event") {
            const d = e.data as { t?: string; me?: unknown };
            if (d.t === "me") b.me = d.me;
          } else if (e.type === "room") b.paused = e.paused;
        },
        end: () => undefined,
      },
      o.now,
      p.pid,
    );
  }
  const queues = new Map<string, RoomStreamEvent[]>();
  const stamps = { events: 0, stamped: 0 };
  return {
    room,
    state,
    tick(now: number) {
      room.tick(now);
      const s = state();
      const correct = s.chance ? questionsOf(s.content)[s.chance.question]?.correct : undefined;
      for (const [pid, b] of bots) {
        const events = botStep(b.bot, b.me, now, b.paused, { chanceCorrect: correct });
        if (events.length === 0) continue;
        const p = parseInput({ stream: `s-${pid}`, seq: b.seq++, events: events.map((e) => ({ st: now, ...e, ago: 0 })) });
        if (p) room.input(pid, p, now);
      }
    },
    subscribe(pid: string, now: number) {
      queues.set(pid, []);
      room.listen("me", { send: (e: RoomStreamEvent) => queues.get(pid)?.push(e), end: () => undefined }, now, pid);
    },
    drain(pid: string): RoomStreamEvent[] {
      const q = queues.get(pid) ?? [];
      queues.set(pid, []);
      return q;
    },
    input(pid: string, body: unknown, now: number): RoomInputReply | null {
      const p = parseInput(body);
      if (!p) return null;
      for (const e of p.events) {
        stamps.events += 1;
        if (typeof (e as { st?: unknown }).st === "number") stamps.stamped += 1;
      }
      const r = room.input(pid, p, now);
      return r.ok ? { at: r.at, every: r.every, paused: r.paused, dropped: r.dropped, dup: r.dup, stale: r.stale } : null;
    },
    host(now: number): HostView {
      const e = room.hostEvent(now);
      return (e.type === "host" ? e.data : null) as HostView;
    },
    moment: () => room.moment(),
    command(cmd: string, now: number, args: unknown = null) {
      return room.command(cmd, args, null, now, room.moment());
    },
    stamps,
  };
}
