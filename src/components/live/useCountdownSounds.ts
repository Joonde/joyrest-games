import { useEffect, useRef } from "react";
import { playSound } from "./sound";

/**
 * Последние `from` секунд (по умолчанию 5) таймера на экране зала — тиканье, на нуле — «время вышло». Только при смене
 * значения (открытие экрана посреди отсчёта не играет прошлые секунды).
 */
export function useCountdownSounds(left: number | null, from = 5): void {
  const previous = useRef(left);
  useEffect(() => {
    const was = previous.current;
    previous.current = left;
    if (left === null || was === null || left === was) return;
    if (left === 0 && was > 0) playSound("timeUp");
    else if (left > 0 && left <= from && left < was) playSound("tick");
  }, [left, from]);
}
