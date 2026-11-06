/**
 * Тряска телефона для «Метеоритного дождя» (ТЗ: без разрешения — частые нажатия). Сила 0–100: сглаженное ускорение без
 * силы тяжести, ~15 м/с² — 100. Разрешение на iPhone — `DeviceMotionEvent.requestPermission` по касанию (шаг тренировки).
 */
import { useEffect, useMemo, useRef, useState } from "react";

export type MotionState = "need" | "granted" | "denied" | "none";

interface MotionPermission {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** Ускорение (м/с²) → сила 0–100. */
export function powerOf(acc: number): number {
  return Math.max(0, Math.min(100, (acc / 15) * 100));
}

function initialState(): MotionState {
  if (typeof window === "undefined" || typeof DeviceMotionEvent === "undefined") return "none";
  const ask = (DeviceMotionEvent as unknown as MotionPermission).requestPermission;
  return typeof ask === "function" ? "need" : "granted";
}

export interface Motion {
  state: MotionState;
  ask: () => Promise<void>;
  /** Наибольшая сила с последнего `reset`. */
  peak: () => number;
  reset: () => void;
}

export function useMotion(active: boolean): Motion {
  const [state, setState] = useState<MotionState>(initialState);
  const peakRef = useRef(0);
  const ema = useRef(0);
  useEffect(() => {
    if (!active || state !== "granted") return;
    const on = (e: DeviceMotionEvent) => {
      const a = e.acceleration;
      let mag: number;
      if (a && a.x !== null && a.y !== null && a.z !== null) mag = Math.hypot(a.x, a.y, a.z);
      else {
        const g = e.accelerationIncludingGravity;
        if (!g || g.x === null || g.y === null || g.z === null) return;
        mag = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
      }
      ema.current = ema.current * 0.8 + mag * 0.2;
      peakRef.current = Math.max(peakRef.current, powerOf(ema.current));
    };
    window.addEventListener("devicemotion", on);
    return () => window.removeEventListener("devicemotion", on);
  }, [active, state]);
  return useMemo(
    () => ({
      state,
      async ask() {
        const ask = (DeviceMotionEvent as unknown as MotionPermission).requestPermission;
        if (typeof ask !== "function") {
          setState("granted");
          return;
        }
        try {
          setState((await ask()) === "granted" ? "granted" : "denied");
        } catch {
          setState("denied");
        }
      },
      peak: () => peakRef.current,
      reset() {
        peakRef.current = 0;
        ema.current = 0;
      },
    }),
    [state],
  );
}
