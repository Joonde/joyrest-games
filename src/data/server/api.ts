/**
 * Запросы к своему серверу (REST `/api/...`, CLAUDE.md, «Платформа на своём сервере»).
 * Вход — cookie `__Host-jr_s` (httpOnly: скрипт её не видит). Изменения идут с заголовком
 * `X-JoyRest: 1` — без него сервер их не принимает.
 *
 * Ошибки — ApiError с кодом как у Firebase: `retry.ts` повторяет обрывы и сбои сервера
 * (`unavailable`) и сразу останавливается на настоящих (нет доступа, не найдено).
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

const STATUS_CODES: Record<number, string> = {
  400: "invalid-argument",
  401: "unauthenticated",
  403: "permission-denied",
  404: "not-found",
  409: "already-exists",
  429: "resource-exhausted",
  501: "unimplemented",
};

function errorOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("error" in data)) return null;
  return typeof data.error === "string" ? data.error : null;
}

export async function api<T = unknown>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: method === "GET" ? { Accept: "application/json" } : { "Content-Type": "application/json", "X-JoyRest": "1" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    // Нет сети или сервер не ответил — повторяемая ошибка.
    throw new ApiError("unavailable", 0);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // Сбой сервера (5xx) и непонятный ответ — тоже повторяемые.
    throw new ApiError(errorOf(data) ?? STATUS_CODES[response.status] ?? "unavailable", response.status);
  }
  return data as T;
}

/** Ещё не перенесено на свой сервер (следующие PR переезда): настоящая ошибка, без повторов. */
export function notYet(): Promise<never> {
  return Promise.reject(new ApiError("unimplemented", 501));
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
