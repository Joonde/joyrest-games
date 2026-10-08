import { useEffect, useRef } from "react";
import { playSound } from "./sound";

/**
 * Последние 5 секунд таймера на экране зала — тиканье, на нуле — «время вышло». Только при смене
 * значения (открытие экрана посреди отсчёта не играет прошлые секунды).
 */
export function useCountdownSounds(left: number | null): void {
  const previous = useRef(left);
  useEffect(() => {
    const was = previous.current;
    previous.current = left;
    if (left === null || was === null || left === was) return;
    if (left === 0 && was > 0) playSound("timeUp");
    else if (left > 0 && left <= 5 && left < was) playSound("tick");
  }, [left]);
}
