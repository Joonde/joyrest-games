import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const CHECK_MS = 60_000;

/**
 * Экран зала во время игры не перезагружается сам (иначе браузер снова просит коснуться для звука): он
 * сообщает, что сейчас идёт игра, и обновится в паузе — в лобби, перерыве вечера или после финала.
 */
let hallBusy = false;
const busyListeners = new Set<() => void>();
export function setHallBusy(busy: boolean): void {
  if (hallBusy === busy) return;
  hallBusy = busy;
  busyListeners.forEach((l) => l());
}

/** Версия сервера (`/health`); нет ответа (Netlify, нет сети) — null. */
async function serverVersion(): Promise<string | null> {
  try {
    const res = await fetch("/health", { cache: "no-store" });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const v = typeof body === "object" && body !== null ? (body as { version?: unknown }).version : null;
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Вышло обновление, а вкладка открыта давно (пульт, телефон, экран зала): старый код в браузере не
 * знает новых кнопок. Раз в минуту и при возврате на вкладку сверяем версию с сервером. Экран зала
 * перезагружается сам — игра на сервере, ничего не теряется; на остальных — полоса «Обновить».
 */
export function UpdateBanner() {
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(hallBusy);
  useEffect(() => {
    const listener = () => setBusy(hallBusy);
    busyListeners.add(listener);
    return () => {
      busyListeners.delete(listener);
    };
  }, []);
  const { pathname } = useLocation();
  const hall = pathname.startsWith("/screen/") || pathname === "/s";

  useEffect(() => {
    let first: string | null = null;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      const v = await serverVersion();
      if (stopped || !v) return;
      if (first === null) first = v;
      else if (v !== first) setFresh(true);
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_MS);
    const onShow = () => void check();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);

  useEffect(() => {
    if (!fresh || !hall || busy) return;
    const timer = window.setTimeout(() => window.location.reload(), 3000);
    return () => window.clearTimeout(timer);
  }, [fresh, hall, busy]);

  if (!fresh) return null;
  return (
    <div className={hall && busy ? "update-banner update-banner--quiet" : "update-banner"} role="status">
      <span>{hall ? (busy ? "Есть обновление — экран обновится в паузе" : "Вышло обновление — экран обновится через пару секунд") : "Вышло обновление платформы"}</span>
      {!hall && (
        <button type="button" className="update-banner__btn" onClick={() => window.location.reload()}>
          Обновить
        </button>
      )}
    </div>
  );
}
