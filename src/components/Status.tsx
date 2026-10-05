import { useEffect, useState, type ReactNode } from "react";

/** Через сколько миллисекунд загрузка считается долгой и через сколько — очень долгой. */
export const SLOW_LOADING_MS = 8000;
export const VERY_SLOW_LOADING_MS = 30_000;

export function Loading({ text = "Загружаем…" }: { text?: string }) {
  return (
    <main className="page page--center" aria-busy="true">
      <p className="muted">{text}</p>
    </main>
  );
}

export function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="page page--center">
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

interface PendingProps {
  /** Каркас экрана, пока идёт загрузка. */
  skeleton: ReactNode;
  /** Что именно грузится — для экранного диктора. */
  label: string;
}

/**
 * Каркас экрана вместо надписи «Загружаем…». Загрузка не прерывается: данные
 * запрашиваются, пока не придут (повторы — в слое данных), и экран откроется сам.
 * Через 8 секунд под каркасом появляется спокойная плашка, через 30 — подсказка про связь.
 */
export function Pending({ skeleton, label }: PendingProps) {
  const [waited, setWaited] = useState<"normal" | "slow" | "verySlow">("normal");

  useEffect(() => {
    const slow = window.setTimeout(() => setWaited("slow"), SLOW_LOADING_MS);
    const verySlow = window.setTimeout(() => setWaited("verySlow"), VERY_SLOW_LOADING_MS);
    return () => {
      window.clearTimeout(slow);
      window.clearTimeout(verySlow);
    };
  }, []);

  return (
    <div aria-busy="true" aria-label={label}>
      {skeleton}
      {waited !== "normal" && (
        <div className="slow-note" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="slow-note__text">
            {waited === "slow"
              ? "Подключаемся… интернет медленный, подождите"
              : "Всё ещё подключаемся — проверьте связь или Wi‑Fi"}
          </span>
          <button type="button" className="btn btn--quiet slow-note__reload" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        </div>
      )}
    </div>
  );
}

/** Ошибка загрузки с кнопкой «Повторить». */
export function LoadFailed({
  title = "Не удалось открыть",
  children = "Нет доступа или данные удалены. Если вы уверены, что всё верно, попробуйте ещё раз.",
  onRetry,
}: {
  title?: string;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <Message title={title}>
      <p className="muted">{children}</p>
      <button className="btn btn--block" onClick={onRetry ?? (() => window.location.reload())}>
        Повторить
      </button>
    </Message>
  );
}

/** Ошибка загрузки внутри экрана (вкладки), без смены всего экрана. */
export function LoadFailedInline({ onRetry, text = "Не удалось загрузить. Проверьте интернет." }: { onRetry: () => void; text?: string }) {
  return (
    <section className="card">
      <p className="muted">{text}</p>
      <div className="actions">
        <button type="button" className="btn btn--secondary btn--block" onClick={onRetry}>
          Повторить
        </button>
      </div>
    </section>
  );
}
