import { useEffect, useState } from "react";

/**
 * Начатый на пульте выбор (соперник батла, ставка «Кости лжеца»), который переживает перезагрузку пульта: хранится на
 * устройстве (sessionStorage) до смены `scope` — шага или хода игры. Другой шаг — снова `initial`.
 * Хранилище недоступно (приватный режим) — просто обычное состояние.
 */
export function usePultDraft<T>(sessionId: string, name: string, scope: string, initial: T): [T, (value: T) => void] {
  const key = `joyrest.pult.${sessionId}.${name}`;
  const [state, setState] = useState<{ scope: string; value: T }>(() => ({ scope, value: (read<T>(key, scope) ?? { value: initial }).value }));
  // Шаг сменился — черновик прошлого шага не в счёт.
  const current = state.scope === scope ? state.value : ((read<T>(key, scope) ?? { value: initial }).value);
  useEffect(() => {
    if (state.scope !== scope) setState({ scope, value: (read<T>(key, scope) ?? { value: initial }).value });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при смене шага
  }, [scope, key]);

  function set(value: T) {
    setState({ scope, value });
    try {
      if (value === null || value === undefined) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify({ scope, value }));
    } catch {
      // Нет хранилища — выбор живёт до перезагрузки.
    }
  }
  return [current, set];
}

function read<T>(key: string, scope: string): { value: T } | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { scope?: unknown; value?: T };
    return saved.scope === scope && saved.value !== undefined ? { value: saved.value } : null;
  } catch {
    return null;
  }
}
