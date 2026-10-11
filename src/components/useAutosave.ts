import { useCallback, useEffect, useRef, useState } from "react";
import { dataBackend, errorCodeOf } from "../data";

/**
 * saved — всё подтверждено сервером; saving — запись в пути; offline — связи нет, правки
 * ждут в очереди на устройстве; error — сервер отказал, повторяем.
 */
export type SaveStatus = "saved" | "saving" | "offline" | "error";

/** Через сколько после последней правки уходит запись. */
const SAVE_DELAY_MS = 700;
/** Если сервер молчит дольше, связи, скорее всего, нет. */
const OFFLINE_AFTER_MS = 5000;
const RETRY_DELAY_MS = 4000;

const DRAFT_PREFIX = "joyrest.draft.";

/** Неподтверждённые правки, оставшиеся на устройстве (вкладку закрыли без связи). `at` — когда записаны. */
export function readDraft<Patch>(key: string): { at: number; patch: Patch } | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; patch?: unknown };
    return typeof parsed.at === "number" && typeof parsed.patch === "object" && parsed.patch !== null ? { at: parsed.at, patch: parsed.patch as Patch } : null;
  } catch {
    return null;
  }
}

export function dropDraft(key: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Нет хранилища — нечего убирать.
  }
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Автосохранение правок. Правки копятся 0,7 с и уходят пачкой, не дожидаясь ответа на
 * предыдущую: слой данных сразу кладёт запись в очередь на устройстве (локальный кэш
 * Firestore), поэтому при плохом интернете и даже после закрытия вкладки ничего не теряется.
 * После отказа сервера пачка повторяется с самыми свежими значениями полей.
 *
 * Свой сервер: пачки уходят по одной (следующая — после ответа на предыдущую), иначе сервер мог
 * бы записать старую пачку поверх новой.
 */
export function useAutosave<Patch extends object>(
  save: (patch: Patch) => Promise<void>,
  /** Ключ черновика: неподтверждённые правки лежат на устройстве и переживают закрытие вкладки без связи. */
  draftKey?: string,
): { status: SaveStatus; change: (patch: Patch) => void; flush: (force?: unknown) => void } {
  const [, rerender] = useState(0);
  const pending = useRef<Patch | null>(null);
  /** Самые свежие значения всех полей, которые меняли: для повтора после ошибки. */
  const latest = useRef<Partial<Patch>>({});
  const timer = useRef<number | null>(null);
  const inFlight = useRef(0);
  const oldestSent = useRef<number | null>(null);
  const failed = useRef(false);
  const [online, setOnline] = useState(isOnline);
  const [slow, setSlow] = useState(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  /** Все правки, которые сервер ещё не подтвердил (для черновика на устройстве). */
  const unsent = useRef<Partial<Patch>>({});
  const writeDraft = useCallback(() => {
    if (!draftKey) return;
    try {
      if (Object.keys(unsent.current).length === 0) localStorage.removeItem(DRAFT_PREFIX + draftKey);
      else localStorage.setItem(DRAFT_PREFIX + draftKey, JSON.stringify({ at: Date.now(), patch: unsent.current }));
    } catch {
      // Хранилище переполнено или закрыто — правки живут до закрытия вкладки.
    }
  }, [draftKey]);
  /** Нет связи (сбой сети, сервер недоступен) — это не «сервер отказал». */
  const networkFail = useRef(false);

  const update = useCallback(() => rerender((n) => n + 1), []);

  const flush = useCallback((force?: unknown) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    if (!patch) return;
    // По одной: следующая пачка уйдёт, как только ответят на эту (и при сворачивании вкладки —
    // иначе старая пачка могла бы лечь поверх новой).
    void force;
    if (dataBackend() === "server" && inFlight.current > 0) return;
    pending.current = null;
    inFlight.current += 1;
    oldestSent.current ??= Date.now();
    update();
    saveRef
      .current(patch)
      .then(() => {
        failed.current = false;
        networkFail.current = false;
        // Всё отправленное дошло — черновик на устройстве больше не нужен.
        if (!pending.current && inFlight.current <= 1) {
          unsent.current = {};
          writeDraft();
        }
      })
      .catch((error: unknown) => {
        failed.current = true;
        networkFail.current = errorCodeOf(error) === "unavailable";
        const retry = {} as Patch;
        for (const key of Object.keys(patch) as Array<keyof Patch>) {
          retry[key] = latest.current[key] as Patch[keyof Patch];
        }
        pending.current = { ...retry, ...pending.current };
        if (timer.current === null) timer.current = window.setTimeout(flush, RETRY_DELAY_MS);
      })
      .finally(() => {
        inFlight.current -= 1;
        if (inFlight.current === 0) {
          oldestSent.current = null;
          setSlow(false);
        }
        update();
        // Пока ждали ответа, накопились правки — отправляем их сразу.
        if (pending.current && timer.current === null && !failed.current) flush();
      });
  }, [update, writeDraft]);

  const change = useCallback(
    (patch: Patch) => {
      pending.current = { ...pending.current, ...patch } as Patch;
      latest.current = { ...latest.current, ...patch };
      unsent.current = { ...unsent.current, ...patch };
      writeDraft();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
      update();
    },
    [flush, update, writeDraft],
  );

  // Сервер долго не подтверждает запись — показываем «Нет связи».
  useEffect(() => {
    if (oldestSent.current === null) return;
    const wait = Math.max(0, oldestSent.current + OFFLINE_AFTER_MS - Date.now());
    const t = window.setTimeout(() => setSlow(true), wait);
    return () => window.clearTimeout(t);
  });

  useEffect(() => {
    // Телефон сворачивает вкладку без предупреждения: отправляем сразу.
    const onHide = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const onPageHide = () => flush(true);
    const onOnline = () => {
      setOnline(true);
      flush();
    };
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      flush(true);
    };
  }, [flush]);

  const busy = pending.current !== null || inFlight.current > 0;
  let status: SaveStatus = "saved";
  if (busy) status = failed.current && !networkFail.current ? "error" : !online || slow || networkFail.current ? "offline" : "saving";

  return { status, change, flush };
}
