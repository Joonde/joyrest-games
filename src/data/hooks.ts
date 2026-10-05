import { useCallback, useEffect, useRef, useState } from "react";
import { authService } from "./auth";
import type { AuthUser } from "./contracts";
import { Cancelled, withRetry } from "./retry";
import { sessionsRepository } from "./sessions";
import type { Session, UserProfile } from "./types";
import { usersRepository } from "./users";

/** Счётчик попыток: смена значения перезапускает загрузку в эффекте. */
function useAttempt(): [number, () => void] {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [attempt, retry];
}

export type AuthState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: AuthUser; profile: UserProfile | null };

/** Текущий вход и профиль ведущего (для гостя profile = null). */
export function useAuth(): [AuthState, () => void] {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [attempt, retry] = useAttempt();

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const unsubscribe = authService.watch(
      (user) => {
        if (!user) {
          setState({ status: "signedOut" });
          return;
        }
        setState({ status: "loading" });
        // Медленная сеть — не повод сказать «нет доступа»: профиль грузится, пока не придёт.
        withRetry(() => usersRepository.loadProfile(user), () => cancelled)
          .catch(() => null)
          .then((profile) => {
            if (!cancelled) setState({ status: "signedIn", user, profile });
          });
      },
      // SDK не загрузился (оборвалась сеть) — пробуем снова, экран остаётся в загрузке.
      () => window.setTimeout(() => !cancelled && retry(), 2000),
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [attempt, retry]);

  return [state, retry];
}

export type GuestSignInState = { status: "loading" } | { status: "error" } | { status: "ready"; uid: string };

/** Анонимный вход гостя или экрана зала (или уже существующий вход). */
export function useGuestSignIn(): [GuestSignInState, () => void] {
  const [state, setState] = useState<GuestSignInState>({ status: "loading" });
  const [attempt, retry] = useAttempt();

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    withRetry(() => authService.ensureSignedIn(), () => cancelled)
      .then((user) => {
        if (!cancelled) setState({ status: "ready", uid: user.uid });
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof Cancelled)) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return [state, retry];
}

export type SessionLoadState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error"; message: string }
  | { status: "ready"; session: Session };

// Телефон запоминает id сессий, в которые входил: после «Завершить игру» сессию уже
// не найти по коду, а гость с погасшим экраном должен увидеть финал своей игры.
const KNOWN_SESSIONS_KEY = "joyrest.knownSessions";
const KNOWN_SESSIONS_MAX = 10;

function knownSessions(): Array<[string, string]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KNOWN_SESSIONS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string")
      : [];
  } catch {
    return [];
  }
}

function rememberSession(code: string, sessionId: string): void {
  const list = [[code, sessionId] as [string, string], ...knownSessions().filter(([c]) => c !== code)];
  try {
    localStorage.setItem(KNOWN_SESSIONS_KEY, JSON.stringify(list.slice(0, KNOWN_SESSIONS_MAX)));
  } catch {
    // Приватный режим браузера: после завершения игры гость увидит «Игра не найдена».
  }
}

async function findSession(code: string, hostId: string | undefined): Promise<Session | null> {
  if (hostId) return sessionsRepository.findHostSessionByCode(code, hostId);
  const active = await sessionsRepository.findByCode(code);
  if (active) return active;
  const knownId = knownSessions().find(([c]) => c === code)?.[1];
  if (!knownId) return null;
  const known = await sessionsRepository.get(knownId);
  return known?.code === code ? known : null;
}

export interface SessionByCodeOptions {
  /** false откладывает запрос, пока не готов вход. */
  enabled?: boolean;
  /** Пульт: искать среди своих сессий, в том числе завершённых. */
  hostId?: string;
}

/**
 * Находит сессию по коду и слушает её документ. Firestore сам переподключается
 * после потери сети, поэтому гость автоматически видит текущий шаг.
 * Второе значение — повторить.
 */
export function useSessionByCode(
  code: string,
  { enabled = true, hostId }: SessionByCodeOptions = {},
): [SessionLoadState, () => void] {
  const [state, setState] = useState<SessionLoadState>({ status: "loading" });
  const [attempt, retry] = useAttempt();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    setState({ status: "loading" });

    withRetry(() => findSession(code, hostId), () => cancelled)
      .then((found) => {
        if (cancelled) return;
        if (!found) {
          setState({ status: "notFound" });
          return;
        }
        rememberSession(code, found.id);
        setState({ status: "ready", session: found });
        unsubscribe = sessionsRepository.watch(
          found.id,
          (session) => setState(session ? { status: "ready", session } : { status: "notFound" }),
          // Обрыв сети подписка переживает сама; ошибка здесь — только отказ в доступе.
          () => setState({ status: "error", message: "Нет доступа к этой сессии." }),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof Cancelled)) {
          setState({ status: "error", message: "Нет доступа к этой сессии." });
        }
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [code, enabled, hostId, attempt]);

  return [state, retry];
}

export type LoadState<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };

/**
 * Загрузка данных для экрана: состояние, «Повторить» и замена данных после правки
 * (например, удалили игру — список обновился без нового запроса).
 */
export function useLoad<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): [LoadState<T>, () => void, (update: (data: T) => T) => void] {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [attempt, retry] = useAttempt();
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    withRetry(() => loadRef.current(), () => cancelled)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof Cancelled)) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, attempt]);

  const update = useCallback((fn: (data: T) => T) => {
    setState((prev) => (prev.status === "ready" ? { status: "ready", data: fn(prev.data) } : prev));
  }, []);

  return [state, retry, update];
}
