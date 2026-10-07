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

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function send(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    // Нет сети или сервер не ответил — повторяемая ошибка.
    throw new ApiError("unavailable", 0);
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    // Сбой сервера (5xx) и непонятный ответ — тоже повторяемые.
    throw new ApiError(errorOf(data) ?? STATUS_CODES[response.status] ?? "unavailable", response.status);
  }
  return response;
}

export async function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  const response = await send(path, {
    method,
    cache: "no-store",
    headers: method === "GET" ? { Accept: "application/json" } : { "Content-Type": "application/json", "X-JoyRest": "1" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  return (await response.json().catch(() => null)) as T;
}

/** Картинка как есть (WebP или JPEG, сжатая на устройстве) и её размеры. */
export async function putImage(path: string, image: Blob, width: number, height: number): Promise<void> {
  await send(path, {
    method: "PUT",
    headers: {
      "Content-Type": image.type === "image/jpeg" ? "image/jpeg" : "image/webp",
      "X-JoyRest": "1",
      "X-Width": String(Math.max(1, Math.round(width))),
      "X-Height": String(Math.max(1, Math.round(height))),
    },
    body: image,
  });
}

/** Картинка по адресу; нет такой — null. Кэш браузера (ETag, immutable) работает как обычно. */
export async function getImage(path: string): Promise<Blob | null> {
  try {
    return await (await send(path, { method: "GET" })).blob();
  } catch (error) {
    if (error instanceof ApiError && error.code === "not-found") return null;
    throw error;
  }
}

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 20 случайных символов, как у id Firestore: id создаёт браузер, повтор записи не плодит дубли. */
export function newId(): string {
  let id = "";
  const limit = 256 - (256 % ID_ALPHABET.length);
  while (id.length < 20) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && id.length < 20) id += ID_ALPHABET[byte % ID_ALPHABET.length];
    }
  }
  return id;
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
