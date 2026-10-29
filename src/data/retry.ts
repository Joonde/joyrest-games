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

/** Короткие паузы перед повтором отправки ответа гостя (ревью 29 октября 2026). */
export const BRIEF_RETRY_MS: readonly number[] = [1000, 2000];

/**
 * Отправка с двумя быстрыми повторами после обрыва сети: обрыв на секунду проходит сам, без нового касания.
 * Повторять можно только повторяемые записи (ответ гостя: дошедший ответ сервер второй раз не принимает —
 * «rejected», и телефон берёт записанный). Настоящую ошибку пробрасывает сразу, после повторов — последнюю.
 */
export async function retryBriefly<T>(
  send: () => Promise<T>,
  pauses: readonly number[] = BRIEF_RETRY_MS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  /** Повтор ещё нужен (ответ гостя — тот же показ шага); нет — `Cancelled`, старый ответ не уходит в новый показ. */
  wanted: () => boolean = () => true,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      const ms = pauses[attempt];
      if (isPermanentError(error) || ms === undefined) throw error;
      if (!wanted()) throw new Cancelled();
      await wait(ms);
      if (!wanted()) throw new Cancelled();
    }
  }
}
