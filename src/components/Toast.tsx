import { useCallback, useEffect, useState } from "react";

/** Короткое уведомление внизу экрана: «Ссылка скопирована». */
export function useToast(durationMs = 2500): [string | null, (text: string) => void] {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!text) return;
    const timer = window.setTimeout(() => setText(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [text, durationMs]);

  const show = useCallback((next: string) => setText(next), []);
  return [text, show];
}

export function Toast({ text }: { text: string | null }) {
  // Область для экранного диктора есть всегда, текст появляется в ней.
  return (
    <div role="status" aria-live="polite">
      {text && <div className="toast">{text}</div>}
    </div>
  );
}
