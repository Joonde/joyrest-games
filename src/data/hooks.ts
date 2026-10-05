import { useCallback, useEffect, useRef, useState } from "react";
import { authService } from "./auth";
import type { AuthUser } from "./contracts";
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
        usersRepository.loadProfile(user)
          .catch(() => null)
          .then((profile) => {
            if (!cancelled) setState({ status: "signedIn", user, profile });
          });
      },
      () => setState({ status: "error" }),
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [attempt]);

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
    authService
      .ensureSignedIn()
      .then((user) => {
        if (!cancelled) setState({ status: "ready", uid: user.uid });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
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

/**
 * Находит сессию по коду и слушает её документ. Firestore сам переподключается
 * после потери сети, поэтому гость автоматически видит текущий шаг.
 * `enabled = false` откладывает запрос, пока не готов вход. Второе значение — повторить.
 */
export function useSessionByCode(code: string, enabled = true): [SessionLoadState, () => void] {
  const [state, setState] = useState<SessionLoadState>({ status: "loading" });
  const [attempt, retry] = useAttempt();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    setState({ status: "loading" });

    sessionsRepository
      .findByCode(code)
      .then((found) => {
        if (cancelled) return;
        if (!found) {
          setState({ status: "notFound" });
          return;
        }
        setState({ status: "ready", session: found });
        unsubscribe = sessionsRepository.watch(
          found.id,
          (session) => setState(session ? { status: "ready", session } : { status: "notFound" }),
          () => setState({ status: "error", message: "Потеряна связь с сессией. Проверьте интернет." }),
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Не удалось загрузить сессию. Проверьте интернет." });
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [code, enabled, attempt]);

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
    loadRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
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
