// Есть ли связь с сервером. Источники: события браузера online/offline и метаданные
// подписки на сессию (данные пришли из локального кэша — значит, сервер недоступен).

type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();
let browserOnline = typeof navigator === "undefined" || navigator.onLine !== false;
let serverReachable = true;

function current(): boolean {
  return browserOnline && serverReachable;
}

let last = current();

function emit(): void {
  const now = current();
  if (now === last) return;
  last = now;
  listeners.forEach((l) => l(now));
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    browserOnline = true;
    emit();
  });
  window.addEventListener("offline", () => {
    browserOnline = false;
    emit();
  });
}

/** Подписка на сессию сообщает, откуда пришли данные. */
export function reportFromCache(fromCache: boolean): void {
  serverReachable = !fromCache;
  emit();
}

export const connection = {
  isOnline: current,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
