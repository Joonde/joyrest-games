import { useCallback, useEffect, useState } from "react";
import { ensureSignedIn, loadUserProfile, watchAuth, type AuthUser } from "./auth";
import { findSessionByCode, watchSession } from "./sessions";
import type { Session, UserProfile } from "./types";

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
    const unsubscribe = watchAuth(
      (user) => {
        if (!user) {
          setState({ status: "signedOut" });
          return;
        }
        setState({ status: "loading" });
        loadUserProfile(user)
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
    ensureSignedIn()
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

    findSessionByCode(code)
      .then((found) => {
        if (cancelled) return;
        if (!found) {
          setState({ status: "notFound" });
          return;
        }
        setState({ status: "ready", session: found });
        unsubscribe = watchSession(
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
