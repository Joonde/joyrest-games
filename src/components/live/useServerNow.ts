import { useEffect, useState } from "react";
import { clock } from "../../data";

/**
 * Текущее время по часам сервера, обновляется каждые `tickMs`. Смещение часов измеряют экран
 * зала и пульт (`clock.sync()` при открытии): там таймер должен совпадать с сервером, который
 * закрывает приём ответов. Телефоны гостей не тратят на это запись и чтение: их часы и так
 * сверены с интернетом, а лишняя секунда на телефоне ничего не решает.
 */
export function serverNowForRender(enabled: boolean, sampledNow: number, currentNow: number): number {
  // Таймер только запускает следующий рендер. На первом кадре после enabled=false → true сохранённое
  // sampledNow могло быть записано при открытии страницы: например, пульт лото тогда показывал лишние минуты.
  return enabled ? currentNow : sampledNow;
}

export function useServerNow(tickMs = 250, enabled = true): number {
  const [now, setNow] = useState(() => Date.now() + clock.offset());

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now() + clock.offset()), tickMs);
    return () => window.clearInterval(timer);
  }, [tickMs, enabled]);

  return serverNowForRender(enabled, now, Date.now() + clock.offset());
}
