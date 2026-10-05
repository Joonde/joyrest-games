import { useEffect } from "react";

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/**
 * Экран не гаснет, пока идёт игра: на экране зала и телефоне гостя. Браузер снимает блокировку,
 * когда вкладку сворачивают, поэтому при возвращении просим её снова. Где Wake Lock нет —
 * ничего не делаем.
 */
export function useWakeLock(active = true): void {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!active || !wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let stopped = false;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      wakeLock
        .request("screen")
        .then((s) => {
          if (stopped) void s.release();
          else sentinel = s;
        })
        .catch(() => undefined);
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", request);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
