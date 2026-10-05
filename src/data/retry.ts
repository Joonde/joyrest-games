// Медленная сеть — не ошибка: загрузка повторяется сама, пока не придут данные.
// Останавливаемся только на настоящих ошибках (нет доступа, не найдено и т. п.).

/** Паузы между попытками: 2, 4, 8 секунд, дальше каждые 10. */
const DELAYS_MS = [2000, 4000, 8000];
const STEADY_MS = 10_000;

export function retryDelay(attempt: number): number {
  return DELAYS_MS[attempt] ?? STEADY_MS;
}

// Коды Firestore и Auth, при которых повтор не поможет.
const PERMANENT = new Set([
  "permission-denied",
  "not-found",
  "unauthenticated",
  "invalid-argument",
  "failed-precondition",
  "already-exists",
  "out-of-range",
  "unimplemented",
  "resource-exhausted",
  "auth/operation-not-allowed",
  "auth/admin-restricted-operation",
  "auth/user-disabled",
]);

export function errorCodeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

/** Настоящая ошибка, а не обрыв или медленная сеть. */
export function isPermanentError(error: unknown): boolean {
  return PERMANENT.has(errorCodeOf(error));
}

export class Cancelled extends Error {}

/** Ждёт паузу, но просыпается сразу, как только браузер снова в сети. */
function pause(ms: number, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const hasEvents = typeof window !== "undefined" && typeof window.addEventListener === "function";
    const done = () => {
      clearTimeout(timer);
      clearInterval(watch);
      if (hasEvents) window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    // Экран ушёл — не держим таймер до конца паузы.
    const watch = setInterval(() => isCancelled() && done(), 500);
    if (hasEvents) window.addEventListener("online", done);
  });
}

/**
 * Выполняет загрузку, повторяя её после сетевых ошибок с нарастающей паузой.
 * Настоящую ошибку пробрасывает сразу; после отмены бросает Cancelled.
 */
export async function withRetry<T>(load: () => Promise<T>, isCancelled: () => boolean = () => false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (isCancelled()) throw new Cancelled();
    try {
      return await load();
    } catch (error) {
      if (isPermanentError(error)) throw error;
      await pause(retryDelay(attempt), isCancelled);
    }
  }
}
