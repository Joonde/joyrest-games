import { useEffect, useState, type ReactNode } from "react";

/** Через сколько миллисекунд загрузка считается долгой. */
export const SLOW_LOADING_MS = 8000;

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
  /** Повторить загрузку. Без него «Повторить» перезагружает страницу. */
  onRetry?: () => void;
  /** Что именно грузится — для экранного диктора. */
  label: string;
}

/**
 * Каркас экрана вместо надписи «Загружаем…». Если загрузка идёт дольше 8 секунд,
 * показывает понятное сообщение и кнопку «Повторить».
 */
export function Pending({ skeleton, onRetry, label }: PendingProps) {
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOADING_MS);
    return () => window.clearTimeout(timer);
  }, [attempt]);

  function retry() {
    if (onRetry) {
      onRetry();
      setAttempt((n) => n + 1);
    } else {
      window.location.reload();
    }
  }

  if (slow) {
    return (
      <LoadFailed title="Загрузка идёт дольше обычного" onRetry={retry}>
        Похоже, интернет на площадке медленный. Проверьте связь или подойдите ближе к Wi‑Fi.
      </LoadFailed>
    );
  }
  return (
    <div aria-busy="true" aria-label={label}>
      {skeleton}
    </div>
  );
}

/** Ошибка загрузки с кнопкой «Повторить». */
export function LoadFailed({
  title = "Нет связи",
  children = "Проверьте интернет и попробуйте ещё раз.",
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
