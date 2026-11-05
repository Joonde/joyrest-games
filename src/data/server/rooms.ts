/**
 * Быстрый канал своего сервера (CLAUDE.md, «Быстрый канал (комнаты)»): пачки телефона `POST /api/rooms/:id/input`,
 * команды пульта `POST /api/rooms/:id/command`, потоки `GET /api/stream/room/:id/me|screen|host` (опрос без потока —
 * `GET /api/rooms/:id/me|screen|host`).
 *
 * Отправитель копит события и раз в `every` мс (по умолчанию 1 с; первый раз — со случайным сдвигом до 0,3 с, чтобы
 * 500 телефонов не стучались в одну миллисекунду) шлёт пачку; пустая пачка — «я на связи». У каждой пачки свой номер
 * (`seq`) в потоке этой страницы (`stream`): повтор после обрыва сервер не обработает второй раз. Пачку с событиями
 * повторяем, пока не дойдёт (пауза 0,5 → 5 с); пустую — нет, следующая и так скоро. `ago` считается заново перед
 * каждой попыткой: сервер сам решает, верить ли старому событию (не дальше 4 с).
 */
import type { RoomSender, RoomSenderOptions, RoomsRepository } from "../contracts";
import { errorCodeOf, isPermanentError, retryBriefly } from "../retry";
import type { RoomInputEvent, RoomInputReply, RoomStreamEvent, RoomStreamKind } from "../types";
import { api, asRecord, newId } from "./api";
import { openStream } from "./stream";

/** Событий в одной пачке — не больше (как на сервере). */
export const ROOM_BATCH_MAX = 64;
/** Пачек с событиями в очереди повтора — не больше: дольше без связи старое уже не нужно игре. */
export const ROOM_RETRY_MAX = 30;
const RETRY_MS = [500, 1000, 2000, 4000, 5000];
const JITTER_MS = 300;
const INPUT_TIMEOUT_MS = 8000;

export interface SenderDeps {
  post: (path: string, body: unknown) => Promise<unknown>;
  now: () => number;
  random: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

const defaultDeps: SenderDeps = {
  post: (path, body) => api("POST", path, body, { timeoutMs: INPUT_TIMEOUT_MS }),
  now: () => Date.now(),
  random: () => Math.random(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function replyOf(data: unknown): RoomInputReply {
  const r = asRecord(data);
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return { at: num(r.at, 0), every: num(r.every, 1000), paused: r.paused === true, dropped: num(r.dropped, 0), dup: r.dup === true };
}

/** Лимит запросов (429) и обрыв — повторяемы; остальное «настоящее» (не игрок, игра завершена) — стоп. */
function isFatal(error: unknown): boolean {
  return errorCodeOf(error) !== "resource-exhausted" && isPermanentError(error);
}

interface Pending {
  event: RoomInputEvent;
  at: number;
}

export function createRoomSender(sessionId: string, options: RoomSenderOptions = {}, deps: SenderDeps = defaultDeps): RoomSender {
  const path = `/api/rooms/${encodeURIComponent(sessionId)}/input`;
  const stream = newId().slice(0, 16);
  let seq = 0;
  let every = Math.max(250, options.everyMs ?? 1000);
  let queue: Pending[] = [];
  let stopped = false;
  let timer: unknown = null;
  let retrying = 0;

  function fail(error: unknown) {
    if (stopped) return;
    stopped = true;
    if (timer !== null) deps.clearTimer(timer);
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  function send(items: Pending[], attempt = 0, number = ++seq) {
    if (stopped) return;
    const at = deps.now();
    // Сколько мс назад случилось событие — заново перед каждой попыткой.
    const events = items.map(({ event, at: t }) => ({ ...event, ago: Math.max(0, Math.round(at - t)) }));
    deps.post(path, { stream, seq: number, events }).then(
      (data) => {
        if (stopped) return;
        const reply = replyOf(data);
        if (reply.every >= 250 && reply.every <= 10_000) every = reply.every;
        options.onReply?.(reply);
      },
      (error: unknown) => {
        if (isFatal(error)) return fail(error);
        // «Я на связи» не повторяем: следующая пачка уже скоро.
        if (items.length === 0 || stopped || retrying >= ROOM_RETRY_MAX) return;
        retrying += 1;
        deps.setTimer(() => {
          retrying -= 1;
          send(items, attempt + 1, number);
        }, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 5000);
      },
    );
  }

  function flush() {
    if (stopped) return;
    const items = queue.slice(0, ROOM_BATCH_MAX);
    queue = queue.slice(items.length);
    send(items);
  }

  function schedule(ms: number) {
    if (stopped) return;
    timer = deps.setTimer(() => {
      timer = null;
      flush();
      schedule(every);
    }, ms);
  }

  schedule(Math.round(deps.random() * JITTER_MS));

  return {
    push(event, opts) {
      if (stopped) return;
      const item = { event, at: deps.now() };
      if (opts?.now) send([item]);
      else {
        queue.push(item);
        if (queue.length >= ROOM_BATCH_MAX) flush();
      }
    },
    flush,
    stop() {
      stopped = true;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
    },
  };
}

function streamEventOf(value: unknown): RoomStreamEvent | null {
  const r = asRecord(value);
  return typeof r.type === "string" && typeof r.at === "number" ? (r as unknown as RoomStreamEvent) : null;
}

export const serverRoomsRepository: RoomsRepository = {
  sender: (sessionId, options) => createRoomSender(sessionId, options),
  async command(sessionId, cmd, args) {
    // id команды — один на все повторы: дошедшая команда второй раз не выполнится.
    const id = newId();
    const data = await retryBriefly(() => api("POST", `/api/rooms/${encodeURIComponent(sessionId)}/command`, { cmd, args: args ?? null, id }, { timeoutMs: INPUT_TIMEOUT_MS }));
    return asRecord(data).result ?? null;
  },
  subscribe(sessionId, kind: RoomStreamKind, onEvent, onError) {
    const id = encodeURIComponent(sessionId);
    const deliver = (value: unknown) => {
      const event = streamEventOf(value);
      if (event) onEvent(event);
    };
    return openStream<unknown>({
      url: `/api/stream/room/${id}/${kind}`,
      poll: async () => deliver(await api("GET", `/api/rooms/${id}/${kind}`)),
      onEvent: deliver,
      onError,
    });
  },
};
