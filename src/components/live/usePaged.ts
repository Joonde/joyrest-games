import { useEffect, useState } from "react";

/**
 * Длинный список на экране зала — страницами, которые листаются сами (как таблица `BoardView`):
 * в большом зале (16–25 команд, 50–100 гостей) видно всех по очереди, а не только первых.
 */
export function usePaged<T>(items: T[], size: number, seconds = 7): { rows: T[]; page: number; pages: number; from: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (pages <= 1) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [pages, seconds]);
  const page = pages > 1 ? tick % pages : 0;
  return { rows: items.slice(page * size, page * size + size), page, pages, from: page * size };
}
