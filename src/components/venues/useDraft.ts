import { useEffect, useRef, useState } from "react";

/**
 * Черновик длинной анкеты на этом телефоне: случайно закрытая вкладка не стирает заполненное.
 * Только удобство: в приватном режиме хранилище может не работать — тогда просто без черновика.
 */
export function useDraft<T>(key: string, initial: () => T, parse: (raw: unknown) => T): [T, (value: T) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? parse(JSON.parse(raw)) : initial();
    } catch {
      return initial();
    }
  });
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Хранилище недоступно — черновика не будет.
      }
    }, 400);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [key, value]);

  function clear() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    try {
      localStorage.removeItem(key);
    } catch {
      // Ничего страшного.
    }
  }

  return [value, setValue, clear];
}
