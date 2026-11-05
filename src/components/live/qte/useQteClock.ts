import { useEffect, useRef, useState } from "react";
import { countdownDigit } from "../../../core/qte";

export type QtePhase = "wait" | "live" | "over";

/**
 * Часы QTE на устройстве: `goAt` — момент старта по часам этого устройства (часы сервера минус
 * смещение). Время дальше идёт по `performance.now()` — оно не прыгает, если часы телефона
 * подвели посреди события. Каждый кадр зовёт `onFrame(мс после старта)` (кольцо двигается без
 * перерисовки React), а состояние меняет только при смене этапа или цифры отсчёта.
 */
export function useQteClock(goAt: number, liveMs: number, onFrame?: (sinceGo: number) => void) {
  const base = useRef(0);
  const frame = useRef(onFrame);
  frame.current = onFrame;
  const [state, setState] = useState<{ phase: QtePhase; digit: number | null }>({ phase: "wait", digit: 3 });

  useEffect(() => {
    base.current = performance.now() + (goAt - Date.now());
    let raf = 0;
    let last = "";
    const loop = () => {
      const since = performance.now() - base.current;
      frame.current?.(since);
      const phase: QtePhase = since < 0 ? "wait" : since <= liveMs ? "live" : "over";
      const digit = countdownDigit(since);
      const key = `${phase}:${digit ?? ""}`;
      if (key !== last) {
        last = key;
        setState({ phase, digit });
      }
      if (phase !== "over") raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [goAt, liveMs]);

  return { ...state, sinceGo: () => performance.now() - base.current };
}

/**
 * Короткий сигнал старта: вибрация там, где она есть (на iPhone её нет — хватает вспышки). Браузер
 * разрешает её только после касания страницы — гость уже касался телефона при входе в игру.
 */
export function buzzPhone(pattern: number | number[] = 70): void {
  try {
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation && !activation.hasBeenActive) return;
    navigator.vibrate?.(pattern);
  } catch {
    // Вибрации нет — ничего страшного.
  }
}
