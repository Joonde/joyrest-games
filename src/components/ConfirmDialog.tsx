import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** Кнопка действия называет действие: «Удалить игру», «Отключить». */
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Подтверждение необратимого действия. Системный <dialog>: фокус и Esc работают сами. */
export function ConfirmDialog({ open, title, children, confirmLabel, busy, error, onConfirm, onCancel }: Props) {
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
            Отмена
          </button>
        </div>
      </div>
    </dialog>
  );
}
