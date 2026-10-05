import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Кнопки внизу: остаются видны, даже когда содержимое прокручивается. */
  footer?: ReactNode;
}

/**
 * Большое окно поверх страницы (импорт, предпросмотр). На телефоне — во весь экран,
 * содержимое прокручивается, заголовок и кнопки остаются на месте.
 */
export function Sheet({ open, title, onClose, children, footer }: Props) {
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
      className="dialog sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && (
        <div className="card sheet__card">
          <div className="sheet__head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn btn--quiet sheet__close" aria-label="Закрыть" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="sheet__body">{children}</div>
          {footer && <div className="sheet__footer actions">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
