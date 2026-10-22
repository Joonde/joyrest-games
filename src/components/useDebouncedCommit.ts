import { useCallback, useEffect, useRef } from "react";

/**
 * Поле с черновиком (синонимы через запятую, список строк): правка уходит в игру через `delay` мс после
 * последней буквы, сразу — при сворачивании приложения (`visibilitychange` → hidden, `pagehide`) и при уходе
 * со страницы. Раньше такие поля писали в игру только при потере фокуса: статус говорил «сохранено», а
 * свёрнутое с открытой клавиатурой приложение теряло текст (QA 22 октября 2026).
 */
export function useDebouncedCommit<T>(commit: (value: T) => void, delay = 400): { schedule: (value: T) => void; flush: () => void } {
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p) commitRef.current(p.value);
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    [delay, flush],
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return { schedule, flush };
}
