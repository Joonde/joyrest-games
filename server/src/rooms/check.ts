/**
 * «room-check» — проверочная игра быстрого канала без игрового смысла: для тестов и нагрузки (`MODE=room` в
 * `scripts/load.ts`). Телефон шлёт касания пачками (`{ t: "tap", n }`, до 15 за событие) и «движения»
 * (`{ t: "move", id }`, `{ t: "ping", id }`) — на движение сразу приходит личное событие `{ t: "pong", id }`,
 * по нему нагрузка меряет доставку. Экран видит общий счёт, пульт — лучших.
 */
import type { CommandOutcome, RoomContext, RoomEvent, RoomGame, RoomPlayer, RoomView } from "./engine";

export const ROOM_CHECK = "room-check";
/**
 * Касаний с телефона — не больше 15 в секунду (человек больше не может), по времени событий: запас на 2 секунды (30),
 * дальше 15 в секунду. Окно не по календарным секундам: две пачки, попавшие в одну секунду (сдвиг отправки), честного
 * игрока не срезают, а подряд больше 15 в секунду не пройдёт.
 */
export const TAPS_PER_SECOND = 15;
export const TAPS_BURST = 30;

export interface CheckState {
  taps: Record<string, number>;
  total: number;
  echoes: number;
  resets: number;
  /** Запас касаний игрока (ведро жетонов по времени событий). В снимок не идёт. */
  window: Record<string, { tokens: number; at: number }>;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(TAPS_BURST, Math.floor(value))) : 0;
}

function fresh(): CheckState {
  return { taps: {}, total: 0, echoes: 0, resets: 0, window: {} };
}

/** Сколько из `n` касаний ещё влезает в запас игрока к моменту события `at`. */
function fitTaps(state: CheckState, pid: string, at: number, n: number): number {
  const bucket = (state.window[pid] ??= { tokens: TAPS_BURST, at });
  // Событие из прошлого (повтор пачки) запас не пополняет — пополняет только ход времени вперёд.
  if (at > bucket.at) {
    bucket.tokens = Math.min(TAPS_BURST, bucket.tokens + ((at - bucket.at) / 1000) * TAPS_PER_SECOND);
    bucket.at = at;
  }
  const ok = Math.max(0, Math.min(n, Math.floor(bucket.tokens)));
  bucket.tokens -= ok;
  return ok;
}

export const roomCheck: RoomGame<CheckState> = {
  id: ROOM_CHECK,
  offlineMs: 3000,
  eventsPerSecond: 30,
  screenHz: 5,
  batchMs: (players) => (players > 200 ? 2000 : 1000),
  create: () => fresh(),
  onInput(state: CheckState, player: RoomPlayer, events: RoomEvent[], ctx: RoomContext) {
    let changed = false;
    for (const event of events) {
      if (event.t === "tap") {
        const n = fitTaps(state, player.pid, event.at, count(event.n ?? 1));
        if (n === 0) continue;
        state.taps[player.pid] = (state.taps[player.pid] ?? 0) + n;
        state.total += n;
        changed = true;
      } else if (event.t === "move" || event.t === "ping") {
        const id = typeof event.id === "string" ? event.id.slice(0, 40) : "";
        state.echoes += 1;
        ctx.send(player.pid, { t: "pong", id, late: event.late });
        changed = true;
      }
    }
    if (changed) ctx.changed();
  },
  onCommand(state: CheckState, cmd: string, args: unknown, ctx: RoomContext): CommandOutcome {
    if (cmd === "reset") {
      Object.assign(state, fresh(), { resets: state.resets + 1, window: state.window });
      ctx.changed();
      ctx.checkpoint();
      return { ok: true };
    }
    if (cmd === "checkpoint") {
      ctx.checkpoint();
      return { ok: true };
    }
    if (cmd === "echo") return { ok: true, result: args ?? null };
    return { ok: false, error: "invalid-argument" };
  },
  screen: (state: CheckState, view: RoomView) => ({ total: state.total, echoes: state.echoes, players: view.players.length, online: view.onlineCount }),
  personal: (state: CheckState, pid: string) => ({ taps: state.taps[pid] ?? 0, total: state.total }),
  host(state: CheckState, view: RoomView) {
    const top = Object.entries(state.taps)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pid, taps]) => ({ pid, name: view.players.find((p) => p.pid === pid)?.name ?? "", taps }));
    return { total: state.total, echoes: state.echoes, resets: state.resets, top };
  },
  // Этап для `expect` команд: номер сброса (сброс — новый «раунд» проверки).
  moment: (state: CheckState) => `r${state.resets}`,
  snapshot: (state: CheckState) => ({ taps: state.taps, total: state.total, echoes: state.echoes, resets: state.resets }),
  restore(data: unknown): CheckState | null {
    if (typeof data !== "object" || data === null) return null;
    const raw = data as Record<string, unknown>;
    const taps: Record<string, number> = {};
    if (typeof raw.taps === "object" && raw.taps !== null) {
      for (const [pid, n] of Object.entries(raw.taps as Record<string, unknown>)) if (typeof n === "number" && n >= 0) taps[pid] = Math.floor(n);
    }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return { taps, total: num(raw.total), echoes: num(raw.echoes), resets: num(raw.resets), window: {} };
  },
};
