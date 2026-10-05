import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "saved" | "saving" | "error";

/** Через сколько после последней правки уходит сохранение и через сколько повтор после ошибки. */
const SAVE_DELAY_MS = 700;
const RETRY_DELAY_MS = 4000;

/**
 * Автосохранение правок: копит изменения, отправляет их пачкой после паузы, повторяет
 * после ошибки и досылает при уходе со страницы. Ни одна правка не теряется.
 */
export function useAutosave<Patch extends object>(
  save: (patch: Patch) => Promise<void>,
): { status: SaveStatus; change: (patch: Patch) => void; flush: () => void } {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const pending = useRef<Patch | null>(null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current || !pending.current) return;
    const patch = pending.current;
    pending.current = null;
    inFlight.current = true;
    setStatus("saving");
    saveRef
      .current(patch)
      .then(() => {
        inFlight.current = false;
        if (pending.current) flush();
        else setStatus("saved");
      })
      .catch(() => {
        inFlight.current = false;
        // Возвращаем неотправленное, новые правки поверх старых.
        pending.current = { ...patch, ...pending.current };
        setStatus("error");
        timer.current = window.setTimeout(flush, RETRY_DELAY_MS);
      });
  }, []);

  const change = useCallback(
    (patch: Patch) => {
      pending.current = { ...pending.current, ...patch } as Patch;
      setStatus("saving");
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    // Телефон сворачивает вкладку без предупреждения: сохраняем сразу.
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return { status, change, flush };
}
