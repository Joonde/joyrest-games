import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** Кнопка действия называет действие: «Удалить игру», «Отключить». */
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  /** Вторая кнопка: «Отмена» по умолчанию, «Закрыть» — у окон для просмотра. */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Подтверждение необратимого действия. Системный <dialog>: фокус и Esc работают сами. */
export function ConfirmDialog({ open, title, children, confirmLabel, busy, error, cancelLabel = "Отмена", onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="card">
        <h2 id={titleId}>{title}</h2>
        {children}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn btn--block" disabled={busy} onClick={onConfirm}>
            {busy ? "Подождите…" : confirmLabel}
          </button>
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** Что спросить «Вы точно уверены?» и что сделать после «да». */
export interface ConfirmRequest {
  title: string;
  text?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Действие; ошибка — окно остаётся открытым с текстом «Не получилось…». */
  run: () => Promise<unknown> | unknown;
}

/**
 * Защита от случайного касания: `ask({ title, confirmLabel, run })` открывает окно подтверждения,
 * действие выполняется только после «да». Окно (`dialog`) вставить в разметку экрана.
 */
export function useConfirm(): [ReactNode, (request: ConfirmRequest) => void] {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = useCallback((next: ConfirmRequest) => {
    setError(null);
    setRequest(next);
  }, []);
  const dialog = (
    <ConfirmDialog
      open={request !== null}
      title={request?.title ?? ""}
      confirmLabel={request?.confirmLabel ?? "Да"}
      cancelLabel={request?.cancelLabel}
      busy={busy}
      error={error}
      onCancel={() => setRequest(null)}
      onConfirm={() => {
        const current = request;
        if (!current || busy) return;
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            await current.run();
            setRequest(null);
          } catch (e) {
            // Постоянная ошибка (нет доступа, уже удалено, уже изменено) — повтор не поможет.
            const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
            setError(
              code === "permission-denied"
                ? "Нет доступа к этому действию."
                : code === "not-found"
                  ? "Этого уже нет — возможно, кто-то удалил раньше. Закройте окно и обновите страницу."
                  : code === "failed-precondition"
                    ? "Уже изменилось на другом устройстве. Закройте окно и обновите страницу."
                    : "Не получилось. Проверьте интернет и нажмите ещё раз.",
            );
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      {typeof request?.text === "string" ? <p>{request.text}</p> : request?.text}
    </ConfirmDialog>
  );
  return [dialog, ask];
}
