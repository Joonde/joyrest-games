import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { UNDO_MS } from "./undoRemove";

/**
 * «Убрано · Вернуть» на 7 секунд (как у вариантов и раундов квиза). `offer(text, undo)` — показать плашку;
 * `undo` вызывается по «Вернуть» и сам берёт свежее содержимое игры (ref `latest`), а не то, что было при удалении.
 * Новое удаление заменяет прежнюю плашку (вернуть можно последнее).
 */
export function useUndoRemove(): { offer: (text: string, undo: () => void) => void; bar: ReactElement } {
  const [pending, setPending] = useState<{ text: string; undo: () => void } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const offer = useCallback((text: string, undo: () => void) => {
    window.clearTimeout(timer.current);
    setPending({ text, undo });
    timer.current = window.setTimeout(() => setPending(null), UNDO_MS);
  }, []);

  const run = () => {
    if (!pending) return;
    window.clearTimeout(timer.current);
    pending.undo();
    setPending(null);
  };

  const bar = (
    <div role="status" aria-live="polite">
      {pending && (
        <div className="toast toast--undo">
          <span>{pending.text}</span>
          <button type="button" className="toast__action" onClick={run}>
            Вернуть
          </button>
        </div>
      )}
    </div>
  );
  return { offer, bar };
}
