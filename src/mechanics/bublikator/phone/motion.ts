/**
 * Тряска телефона для «Метеоритного дождя» (ТЗ: без разрешения — частые нажатия). Сила 0–100 — накопленная во времени
 * (`ShakeMeter`): 10 с энергичной тряски = 100, один рывок — почти ничего. Разрешение — `DeviceMotionEvent.requestPermission` по касанию (шаг тренировки и экран дождя).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { loadShakeChoice, saveShakeChoice } from "./prefs";
import { ShakeMeter, type MotionState, type ShakeChoice } from "./shake";

export type { MotionState } from "./shake";

interface MotionPermission {
  requestPermission?: () => Promise<"granted" | "denied">;
}

function initialState(): MotionState {
  if (typeof window === "undefined" || typeof DeviceMotionEvent === "undefined") return "none";
  const ask = (DeviceMotionEvent as unknown as MotionPermission).requestPermission;
  return typeof ask === "function" ? "need" : "granted";
}

/** Ответ на запрос быстрее — окна не было (браузер отказал сам). */
export const QUICK_DENY_MS = 250;

export interface Motion {
  state: MotionState;
  /** «Попробовать снова» получило отказ сразу, без окна. */
  quickDenied: boolean;
  /** «Буду тапать» — выбор гостя на этом устройстве. */
  choice: ShakeChoice;
  /** «Буду тапать»: без системного окна, датчик не слушаем. */
  taps: () => void;
  /** Датчик уже присылал движение на этой странице — тряска работает (Android без вопроса, iPhone после разрешения). */
  live: boolean;
  ask: () => Promise<void>;
  /** Накопленная сила тряски с последнего `reset` (`ShakeMeter`). */
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
  const [choice, setChoice] = useState<ShakeChoice>(loadShakeChoice);
  const [quickDenied, setQuickDenied] = useState(false);
  const meter = useRef(new ShakeMeter());
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (state === "none" || state === "denied" || choice === "tap") return;
    let seen = false;
    const on = (e: DeviceMotionEvent) => {
      const mag = magnitudeOf(e);
      if (mag === null) return;
      if (!seen) {
        seen = true;
        setLive(true);
      }
      if (!activeRef.current) return;
      meter.current.add(mag, e.timeStamp);
    };
    window.addEventListener("devicemotion", on);
    return () => window.removeEventListener("devicemotion", on);
  }, [state, choice]);
  return useMemo(
    () => ({
      state,
      live,
      choice,
      quickDenied,
      taps() {
        saveShakeChoice("tap");
        setChoice("tap");
        setLive(false);
      },
      // «Разрешить тряску» и «Попробовать тряску снова»: выбор «тапать» снимается, системное окно — только по касанию.
      async ask() {
        saveShakeChoice(null);
        setChoice(null);
        const ask = (DeviceMotionEvent as unknown as MotionPermission).requestPermission;
        if (typeof ask !== "function") {
          setState("granted");
          return;
        }
        const started = performance.now();
        let answer: "granted" | "denied" = "denied";
        try {
          answer = (await ask()) === "granted" ? "granted" : "denied";
        } catch {
          answer = "denied";
        }
        setState(answer);
        // Отказ пришёл сразу, без окна (Safari помнит прошлый отказ до перезапуска) — скажем, что делать.
        setQuickDenied(answer === "denied" && performance.now() - started < QUICK_DENY_MS);
      },
      peak: () => meter.current.value,
      reset() {
        meter.current.reset();
      },
    }),
    [state, live, choice, quickDenied],
  );
}
