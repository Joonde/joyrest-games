import { useEffect, useState } from "react";
import { connection } from "../data";

/** Короткие обрывы (и данные из кэша при открытии) не пугают: полоса — через 1,5 с. */
const SHOW_AFTER_MS = 1500;
const RESTORED_MS = 3000;

/**
 * Тонкая полоса сверху: «Нет связи — переподключаемся…». Экран при этом не закрывается,
 * Firestore сам переподключится и обновит данные; после этого — «Связь восстановлена».
 */
export function ConnectionBanner() {
  const [state, setState] = useState<"online" | "offline" | "restored">("online");

  useEffect(() => {
    let showTimer: number | null = null;
    let hideTimer: number | null = null;
    let shown = false;
    const clear = () => {
      if (showTimer !== null) window.clearTimeout(showTimer);
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      showTimer = hideTimer = null;
    };
    const onChange = (online: boolean) => {
      clear();
      if (!online) {
        showTimer = window.setTimeout(() => {
          shown = true;
          setState("offline");
        }, SHOW_AFTER_MS);
      } else if (shown) {
        shown = false;
        setState("restored");
        hideTimer = window.setTimeout(() => setState("online"), RESTORED_MS);
      } else {
        setState("online");
      }
    };
    if (!connection.isOnline()) onChange(false);
    const unsubscribe = connection.subscribe(onChange);
    return () => {
      clear();
      unsubscribe();
    };
  }, []);

  return (
    <div role="status" aria-live="polite" className="connection-slot">
      {state !== "online" && (
        <div className={`connection-banner connection-banner--${state}`}>
          {state === "offline" ? (
            <>
              <span className="spinner spinner--small" aria-hidden="true" />
              Нет связи — переподключаемся…
            </>
          ) : (
            "Связь восстановлена"
          )}
        </div>
      )}
    </div>
  );
}
