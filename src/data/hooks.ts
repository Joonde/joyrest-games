import { useEffect, useState } from "react";
import { loadUserProfile, watchAuth, type AuthUser } from "./auth";
import { findSessionByCode, watchSession } from "./sessions";
import type { Session, UserProfile } from "./types";

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: AuthUser; profile: UserProfile | null };

/** Текущий вход и профиль ведущего (для гостя profile = null). */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = watchAuth((user) => {
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
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}

export type SessionLoadState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error"; message: string }
  | { status: "ready"; session: Session };

/**
 * Находит сессию по коду и слушает её документ. Firestore сам переподключается
 * после потери сети, поэтому гость автоматически видит текущий шаг.
 * `enabled = false` откладывает запрос, пока не готов вход.
 */
export function useSessionByCode(code: string, enabled = true): SessionLoadState {
  const [state, setState] = useState<SessionLoadState>({ status: "loading" });

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
          () => setState({ status: "error", message: "Потеряна связь с сессией. Обновите страницу." }),
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Не удалось загрузить сессию. Проверьте интернет." });
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [code, enabled]);

  return state;
}
