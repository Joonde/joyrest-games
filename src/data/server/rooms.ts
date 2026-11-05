/**
 * Быстрый канал своего сервера (CLAUDE.md, «Быстрый канал (комнаты)», логика — docs/fast-room.md): пачки телефона
 * `POST /api/rooms/:id/input`, команды пульта `POST /api/rooms/:id/command`, потоки
 * `GET /api/stream/room/:id/me|screen|host` (опрос без потока — `GET /api/rooms/:id/me|screen|host`).
 *
 * Отправитель копит события и раз в `every` мс (по умолчанию 1 с; первый раз — со случайным сдвигом до 0,3 с, чтобы
 * 500 телефонов не стучались в одну миллисекунду) шлёт пачку; пустая пачка — «я на связи», без номера. У каждой пачки
 * с событиями свой номер (`seq`) в потоке этой страницы (`stream`): повтор после обрыва сервер не обработает второй
 * раз. Пачку с событиями повторяем, пока не дойдёт (пауза 0,5 → 5 с, в очереди повтора — до 30, при переполнении
 * уходит самая старая), с пометкой `retry` (сервер считает для неё предел `ago` от прихода предыдущей принятой пачки этой
 * страницы — не больше 4 с, а события помечает `delayed`); пустую —
 * нет. `ago` считается заново перед каждой попыткой. Пачка больше 3,5 КБ делится. Ответ `stale` (номер старше окна
 * сервера в 64 пачки — обработана ли, сервер не знает) — пачка не повторяется: её события старше 4 с, игре уже не
 * нужны; телефон узнаёт об этом из `onReply` (`stale: true`), повтор с новым номером мог бы засчитать их дважды.
 */
import type { RoomSender, RoomSenderOptions, RoomsRepository } from "../contracts";
import { errorCodeOf, isPermanentError, retryBriefly } from "../retry";
import type { RoomInputEvent, RoomInputReply, RoomStreamEvent, RoomStreamKind } from "../types";
import { api, ApiError, asRecord, newId } from "./api";
import { openStream } from "./stream";

/** Событий в одной пачке — не больше (как на сервере). */
export const ROOM_BATCH_MAX = 64;
/** Размер пачки в байтах — не больше (сервер принимает до 4 КБ; запас на `stream`, `seq` и `ago`). */
export const ROOM_BATCH_BYTES = 3500;
/** Пачек с событиями в очереди повтора — не больше: при переполнении уходит самая старая. */
export const ROOM_RETRY_MAX = 30;
/** Отказ «не игрок» повторяем столько раз (вход мог ещё не записаться), потом — настоящая ошибка. */
export const ROOM_FORBIDDEN_RETRIES = 2;
/**
 * «Не игрок» у «я на связи» подряд столько раз — настоящая ошибка (участника убрали). Отдельный счётчик: пустые пачки
 * идут раз в секунду и не должны тратить повторы пачек с событиями.
 */
export const ROOM_FORBIDDEN_BEATS = 5;
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
  return { at: num(r.at, 0), every: num(r.every, 1000), paused: r.paused === true, dropped: num(r.dropped, 0), dup: r.dup === true, stale: r.stale === true };
}

function statusOf(error: unknown): number {
  return error instanceof ApiError ? error.status : 0;
}

interface Pending {
  event: RoomInputEvent;
  at: number;
}

/** События по пачкам: не больше 64 и не больше `ROOM_BATCH_BYTES` в каждой (одно огромное событие — отдельно). */
export function splitBatches(items: Pending[]): Pending[][] {
  const batches: Pending[][] = [];
  let current: Pending[] = [];
  let size = 0;
  for (const item of items) {
    const bytes = new TextEncoder().encode(JSON.stringify(item.event)).length + 16;
    if (current.length > 0 && (current.length >= ROOM_BATCH_MAX || size + bytes > ROOM_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function createRoomSender(sessionId: string, options: RoomSenderOptions = {}, deps: SenderDeps = defaultDeps): RoomSender {
  const path = `/api/rooms/${encodeURIComponent(sessionId)}/input`;
  const stream = newId().slice(0, 16);
  let seq = 0;
  let every = Math.max(250, options.everyMs ?? 1000);
  let queue: Pending[] = [];
  let stopped = false;
  let timer: unknown = null;
  let forbidden = 0;
  let forbiddenBeats = 0;
  /** Пачки, ждущие повтора: при переполнении отменяется самая старая. */
  const retries: Array<{ handle: unknown }> = [];

  function fail(error: unknown) {
    if (stopped) return;
    stop();
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  function stop() {
    stopped = true;
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    for (const r of retries.splice(0)) deps.clearTimer(r.handle);
  }

  function retry(items: Pending[], attempt: number, number: number, ms: number) {
    if (retries.length >= ROOM_RETRY_MAX) {
      const oldest = retries.shift();
      if (oldest) deps.clearTimer(oldest.handle);
    }
    const slot: { handle: unknown } = { handle: null };
    slot.handle = deps.setTimer(() => {
      const i = retries.indexOf(slot);
      if (i >= 0) retries.splice(i, 1);
      send(items, attempt + 1, number);
    }, ms);
    retries.push(slot);
  }

  function send(items: Pending[], attempt = 0, number: number | null = items.length > 0 ? ++seq : null) {
    if (stopped) return;
    const at = deps.now();
    // Сколько мс назад случилось событие — заново перед каждой попыткой.
    const events = items.map(({ event, at: t }) => ({ ...event, ago: Math.max(0, Math.round(at - t)) }));
    const body = number === null ? { stream, events } : attempt > 0 ? { stream, seq: number, retry: true, events } : { stream, seq: number, events };
    deps.post(path, body).then(
      (data) => {
        if (stopped) return;
        if (items.length > 0) forbidden = 0;
        forbiddenBeats = 0;
        const reply = replyOf(data);
        if (reply.every >= 250 && reply.every <= 10_000) every = reply.every;
        options.onReply?.(reply);
      },
      (error: unknown) => {
        if (stopped) return;
        // Пачка больше, чем принимает сервер: эту пачку не повторяем (повтор тоже не пройдёт), отправка идёт дальше.
        if (statusOf(error) === 413) return;
        const code = errorCodeOf(error);
        // «Не игрок» у пустой пачки — не трата повторов: пачки с событиями ещё пробуем (вход мог не дойти до комнаты).
        if (code === "permission-denied" && items.length === 0) {
          forbiddenBeats += 1;
          if (forbiddenBeats >= ROOM_FORBIDDEN_BEATS) fail(error);
          return;
        }
        if (code === "permission-denied" && forbidden < ROOM_FORBIDDEN_RETRIES) {
          // Вход мог ещё не дойти до комнаты (первая пачка сразу после входа) — пару раз пробуем снова.
          forbidden += 1;
          if (number !== null) retry(items, attempt, number, 1000 * forbidden);
          return;
        }
        // Лимит запросов (429) и обрыв — повторяемы; остальное «настоящее» (не игрок, игра завершена) — стоп.
        if (code !== "resource-exhausted" && isPermanentError(error)) return fail(error);
        // «Я на связи» не повторяем: следующая пачка уже скоро.
        if (items.length === 0 || number === null) return;
        retry(items, attempt, number, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 5000);
      },
    );
  }

  function flush() {
    if (stopped) return;
    if (queue.length === 0) return send([]);
    const items = queue;
    queue = [];
    for (const batch of splitBatches(items)) send(batch);
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
    stop,
  };
}

function streamEventOf(value: unknown): RoomStreamEvent | null {
  const r = asRecord(value);
  return typeof r.type === "string" && typeof r.at === "number" ? (r as unknown as RoomStreamEvent) : null;
}

export interface SubscribeDeps {
  get: (path: string) => Promise<unknown>;
  open: typeof openStream;
}

const defaultSubscribeDeps: SubscribeDeps = { get: (path) => api("GET", path), open: openStream };

/**
 * Поток комнаты. «Закрыто» с `finished` — дальше браузер получит 409 и остановится сам; `unloaded` — переподключение.
 * Останавливаемся сразу (`onError`, код и причина — в `ApiError`): `removed` (участника убрали, за него вошёл другой
 * телефон), `replaced` (это устройство открыло такой же поток в четвёртой вкладке: экран показывает «Открыто в другой
 * вкладке — Открыть здесь», а не переподключается — иначе вкладки вытесняли бы друг друга по кругу; пульт ведущего на
 * другом устройстве экран больше не вытесняет — у них разные ключи), `abandoned` (12 часов без игры). Опрос: «не игрок»
 * пару раз и лимит опросов — не окончательно (повтор).
 */
export function subscribeRoom(
  sessionId: string,
  kind: RoomStreamKind,
  onEvent: (event: RoomStreamEvent) => void,
  onError: (error: Error) => void,
  deps: SubscribeDeps = defaultSubscribeDeps,
): () => void {
  const id = encodeURIComponent(sessionId);
  let stopped = false;
  let forbidden = 0;
  let unsubscribe: () => void = () => undefined;
  const halt = (error: Error) => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    onError(error);
  };
  const deliver = (value: unknown) => {
    if (stopped) return;
    const event = streamEventOf(value);
    if (!event) return;
    onEvent(event);
    if (event.type === "closed") {
      if (event.reason === "removed") halt(new ApiError("permission-denied", 403, "removed"));
      else if (event.reason === "replaced") halt(new ApiError("already-exists", 409, "replaced"));
      else if (event.reason === "abandoned") halt(new ApiError("failed-precondition", 409, "abandoned"));
    }
  };
  unsubscribe = deps.open<unknown>({
    url: `/api/stream/room/${id}/${kind}`,
    poll: async () => {
      try {
        deliver(await deps.get(`/api/rooms/${id}/${kind}`));
        forbidden = 0;
      } catch (error) {
        const code = errorCodeOf(error);
        if (code === "resource-exhausted" || (code === "permission-denied" && forbidden++ < ROOM_FORBIDDEN_RETRIES)) {
          throw new ApiError("unavailable", 0);
        }
        throw error;
      }
    },
    onEvent: deliver,
    onError: (error) => halt(error),
  });
  if (stopped) unsubscribe();
  return () => {
    stopped = true;
    unsubscribe();
  };
}

export const serverRoomsRepository: RoomsRepository = {
  sender: (sessionId, options) => createRoomSender(sessionId, options),
  async command(sessionId, cmd, args, options) {
    // id команды — один на все повторы: дошедшая команда второй раз не выполнится.
    const id = newId();
    const body = { cmd, args: args ?? null, id, expect: options?.expect ?? null };
    const data = await retryBriefly(() => api("POST", `/api/rooms/${encodeURIComponent(sessionId)}/command`, body, { timeoutMs: INPUT_TIMEOUT_MS }));
    return asRecord(data).result ?? null;
  },
  subscribe: (sessionId, kind, onEvent, onError) => subscribeRoom(sessionId, kind, onEvent, onError),
};
