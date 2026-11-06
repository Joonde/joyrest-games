/**
 * Тряска телефона для «Метеоритного дождя» (ТЗ: без разрешения — частые нажатия). Сила 0–100: сглаженное ускорение без
 * силы тяжести, ~15 м/с² — 100. Разрешение — `DeviceMotionEvent.requestPermission` по касанию (шаг тренировки и экран дождя).
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
  /** Датчик уже присылал движение на этой странице — тряска работает (Android без вопроса, iPhone после разрешения). */
  live: boolean;
  ask: () => Promise<void>;
  /** Наибольшая сила с последнего `reset`. */
  peak: () => number;
  reset: () => void;
}

/** Есть ли в событии движение (у ноутбука без датчика событие приходит пустым). */
function magnitudeOf(e: DeviceMotionEvent): number | null {
  const a = e.acceleration;
  if (a && a.x !== null && a.y !== null && a.z !== null) return Math.hypot(a.x, a.y, a.z);
  const g = e.accelerationIncludingGravity;
  if (!g || g.x === null || g.y === null || g.z === null) return null;
  return Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
}

/**
 * Датчик слушаем сразу, а не после «Разрешить тряску»: `requestPermission` есть и в свежем Chrome на Android, но там события
 * идут и без вопроса — тогда тряска работает и после перезагрузки, у опоздавших и без тренировки. Пришло движение — `live`.
 * Сила копится, только пока `active` (экран дождя).
 */
export function useMotion(active: boolean): Motion {
  const [state, setState] = useState<MotionState>(initialState);
  const [live, setLive] = useState(false);
  const peakRef = useRef(0);
  const ema = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (state === "none" || state === "denied") return;
    let seen = false;
    const on = (e: DeviceMotionEvent) => {
      const mag = magnitudeOf(e);
      if (mag === null) return;
      if (!seen) {
        seen = true;
        setLive(true);
      }
      if (!activeRef.current) return;
      ema.current = ema.current * 0.8 + mag * 0.2;
      peakRef.current = Math.max(peakRef.current, powerOf(ema.current));
    };
    window.addEventListener("devicemotion", on);
    return () => window.removeEventListener("devicemotion", on);
  }, [state]);
  return useMemo(
    () => ({
      state,
      live,
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
    [state, live],
  );
}
