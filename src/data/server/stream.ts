/**
 * Подписка на изменения своего сервера: поток событий (EventSource, `GET /api/stream/...`) —
 * снимок при подключении, дальше только изменения. Обрыв связи EventSource переживает сам и
 * после переподключения получает свежий снимок, поэтому гость сам возвращается в игру.
 * Поток не открылся дважды (или браузер его не умеет) — опрос раз в 2 секунды, и раз в ~40 секунд
 * снова пробуем поток: короткий сбой Wi‑Fi не оставляет телефон на опросе до конца игры.
 * Настоящая ошибка (нет доступа, не найдено) — onError, без повторов.
 */
import { reportFromCache } from "../connection";
import { isPermanentError } from "../retry";
import type { Unsubscribe } from "../types";

export interface StreamOptions<E> {
  /** Адрес потока событий. */
  url: string;
  /** Опрос без потока: загружает снимок и передаёт его в onEvent. */
  poll: () => Promise<void>;
  onEvent: (event: E) => void;
  onError: (error: Error) => void;
}

const POLL_MS = 2000;
/** В режиме опроса — каждый такой по счёту опрос заменяем попыткой открыть поток. */
const RETRY_STREAM_EVERY = 20;
/** Сколько ждать снимок после подключения: дольше — поток где-то застрял (прокси, буфер). */
const SNAPSHOT_TIMEOUT_MS = 8000;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function openStream<E>(options: StreamOptions<E>): Unsubscribe {
  let stopped = false;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let polls = 0;

  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function giveUp(error: unknown) {
    stopped = true;
    source?.close();
    stopTimer();
    options.onError(asError(error));
  }

  function poll() {
    if (stopped) return;
    options
      .poll()
      .then(() => reportFromCache(false))
      .catch((error: unknown) => {
        if (isPermanentError(error)) return giveUp(error);
        reportFromCache(true);
      })
      .finally(() => {
        if (stopped) return;
        polls += 1;
        if (polls % RETRY_STREAM_EVERY === 0 && typeof EventSource !== "undefined") {
          // Ещё один сбой потока — и снова опрос.
          failures = 1;
          timer = setTimeout(connect, POLL_MS);
        } else {
          timer = setTimeout(poll, POLL_MS);
        }
      });
  }

  /** Поток сломался: узнаём опросом, настоящая ли это ошибка; после двух сбоев — только опрос. */
  function streamFailed() {
    source?.close();
    source = null;
    stopTimer();
    if (stopped) return;
    failures += 1;
    reportFromCache(true);
    if (failures >= 2) return poll();
    options.poll().then(
      () => {
        if (!stopped) timer = setTimeout(connect, 1000);
      },
      (error: unknown) => {
        if (isPermanentError(error)) giveUp(error);
        else if (!stopped) timer = setTimeout(connect, 2000);
      },
    );
  }

  function connect() {
    if (stopped) return;
    if (typeof EventSource === "undefined") return poll();
    let gotSnapshot = false;
    const es = new EventSource(options.url);
    source = es;
    timer = setTimeout(() => {
      if (!gotSnapshot) streamFailed();
    }, SNAPSHOT_TIMEOUT_MS);
    es.onmessage = (message: MessageEvent<string>) => {
      if (!gotSnapshot) {
        gotSnapshot = true;
        failures = 0;
        stopTimer();
      }
      reportFromCache(false);
      let event: E;
      try {
        event = JSON.parse(message.data) as E;
      } catch {
        return;
      }
      options.onEvent(event);
    };
    es.onerror = () => {
      // CONNECTING — браузер сам переподключится и получит новый снимок; CLOSED — ответ не поток.
      if (es.readyState === EventSource.CLOSED) streamFailed();
      else reportFromCache(true);
    };
  }

  connect();
  return () => {
    stopped = true;
    stopTimer();
    source?.close();
  };
}
