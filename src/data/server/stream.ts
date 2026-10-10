/**
 * Подписка на изменения своего сервера: поток событий (EventSource, `GET /api/stream/...`) —
 * снимок при подключении, дальше только изменения. Обрыв связи EventSource переживает сам и
 * после переподключения получает свежий снимок, поэтому гость сам возвращается в игру.
 * Поток не открылся дважды (или браузер его не умеет) — опрос раз в 2 секунды, а рядом время от
 * времени пробный поток: заработал — возвращаемся на поток, опрос при этом не прерывается.
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
/** В режиме опроса — через столько опросов первая проба потока (40 с), дальше реже. */
const RETRY_STREAM_EVERY = 20;
const MAX_PROBE_EVERY = 150;
const PROBE_TIMEOUT_MS = 3000;
/** Сколько ждать снимок после подключения: дольше — поток где-то застрял (прокси, буфер). */
const SNAPSHOT_TIMEOUT_MS = 8000;
/**
 * Сервер шлёт «я жив» раз в 25 с. Тишина дольше — соединение «повисло» (сменилась сеть, телефон
 * проснулся), хотя браузер считает его открытым: переподключаемся сами и берём свежий снимок.
 */
const SILENCE_MS = 60_000;
/** Вернулись на вкладку или появилась сеть, а данных не было столько — переподключаемся сразу. */
const STALE_ON_WAKE_MS = 30_000;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function openStream<E>(options: StreamOptions<E>): Unsubscribe {
  let stopped = false;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let polls = 0;
  /** Идёт опрос (поток не работает). */
  let polling = false;
  let probeEvery = RETRY_STREAM_EVERY / 2;
  let nextProbeAt = RETRY_STREAM_EVERY;
  /** Когда поток последний раз что-то присылал (событие или «я жив»). */
  let lastSeen = Date.now();
  let watchdog: ReturnType<typeof setInterval> | null = null;

  function stopWatchdog() {
    if (watchdog !== null) clearInterval(watchdog);
    watchdog = null;
  }

  /** Поток открыт, но молчит: закрываем и идём обычным путём сбоя (опрос, затем новый поток). */
  function restartSilent() {
    if (stopped || polling || !source) return;
    stopWatchdog();
    streamFailed();
  }

  function onWake() {
    if (stopped || polling || !source) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (Date.now() - lastSeen > STALE_ON_WAKE_MS) restartSilent();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
  }

  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function giveUp(error: unknown) {
    stopped = true;
    stopWatchdog();
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
        if (stopped || !polling) return;
        polls += 1;
        if (polls >= nextProbeAt && typeof EventSource !== "undefined") probe();
        timer = setTimeout(poll, POLL_MS);
      });
  }

  /**
   * Пробный поток, пока опрос продолжается: пришло событие за 3 с — переходим на поток, нет —
   * закрываем пробу и пробуем реже (40 с, 80 с … до 5 минут). Гость не ждёт ни секунды лишней.
   */
  function probe() {
    probeEvery = Math.min(probeEvery * 2, MAX_PROBE_EVERY);
    nextProbeAt = polls + probeEvery;
    const trial = new EventSource(options.url);
    const give = setTimeout(() => trial.close(), PROBE_TIMEOUT_MS);
    trial.onmessage = () => {
      clearTimeout(give);
      trial.close();
      if (stopped || !polling) return;
      polling = false;
      stopTimer();
      failures = 1;
      probeEvery = RETRY_STREAM_EVERY / 2;
      connect();
    };
    trial.onerror = () => {
      clearTimeout(give);
      trial.close();
    };
  }

  /** Поток сломался: узнаём опросом, настоящая ли это ошибка; после двух сбоев — только опрос. */
  function streamFailed() {
    stopWatchdog();
    source?.close();
    source = null;
    stopTimer();
    if (stopped) return;
    failures += 1;
    reportFromCache(true);
    if (failures >= 2) {
      polling = true;
      return poll();
    }
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
    if (typeof EventSource === "undefined") {
      polling = true;
      return poll();
    }
    let gotSnapshot = false;
    const es = new EventSource(options.url);
    source = es;
    lastSeen = Date.now();
    stopWatchdog();
    watchdog = setInterval(() => {
      if (source === es && Date.now() - lastSeen > SILENCE_MS) restartSilent();
    }, 10_000);
    es.addEventListener("ping", () => {
      lastSeen = Date.now();
    });
    timer = setTimeout(() => {
      if (!gotSnapshot) streamFailed();
    }, SNAPSHOT_TIMEOUT_MS);
    es.onmessage = (message: MessageEvent<string>) => {
      lastSeen = Date.now();
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
    stopWatchdog();
    source?.close();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    }
  };
}
