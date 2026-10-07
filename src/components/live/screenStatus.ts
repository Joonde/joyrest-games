import { useEffect, useRef, useState } from "react";
import { SCREEN_REPORT_MS, screenRepo, type ScreenReport, type ScreenStatus } from "../../data";

/**
 * Экран зала сообщает пульту о себе (CLAUDE.md, раздел 7, «Звуки»): сразу при изменении и раз в
 * 20 с. Ошибки сети не мешают игре — следующее сообщение уйдёт по таймеру.
 */
export function useScreenReport(sessionId: string, report: ScreenReport, enabled: boolean): void {
  const latest = useRef(report);
  latest.current = report;
  const key = `${report.soundReady}:${report.muted}:${report.musicBlocked}`;

  useEffect(() => {
    if (!enabled || !screenRepo) return;
    const repo = screenRepo;
    const send = () => void repo.report(sessionId, latest.current).catch(() => undefined);
    send();
    const timer = window.setInterval(send, SCREEN_REPORT_MS);
    return () => window.clearInterval(timer);
  }, [sessionId, enabled, key]);
}

/**
 * Пульт: что с экраном зала. `undefined` — не знаем (Firebase или ещё не спросили), `null` — экран
 * не открыт или давно молчит.
 */
export function useScreenStatus(sessionId: string, enabled: boolean): ScreenStatus | null | undefined {
  const [status, setStatus] = useState<ScreenStatus | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !screenRepo) {
      setStatus(undefined);
      return;
    }
    const repo = screenRepo;
    let stopped = false;
    const check = () =>
      void repo.get(sessionId).then(
        (s) => {
          if (!stopped) setStatus(s);
        },
        () => undefined,
      );
    check();
    const timer = window.setInterval(check, 10_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [sessionId, enabled]);

  return status;
}

/** Строка для пульта: коротко и понятно, что делать. */
export function screenStatusLabel(status: ScreenStatus | null): { text: string; ok: boolean } {
  if (!status) return { text: "экран зала не открыт", ok: false };
  if (status.muted) return { text: "экран: звук выключен — нажмите «Включить звук» на экране", ok: false };
  if (!status.soundReady) return { text: "экран: коснитесь экрана, чтобы включить звук", ok: false };
  if (status.musicBlocked) return { text: "экран: коснитесь экрана, чтобы включить музыку", ok: false };
  return { text: "экран на связи · звук ✓", ok: true };
}
