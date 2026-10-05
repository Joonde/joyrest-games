import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

export type MenuAction = { label: string; to: string } | { label: string; onClick: () => void };

/** Пункт меню — тихая кнопка; вне меню — вторичная. */
export function ActionButton({ action, onDone }: { action: MenuAction; onDone?: () => void }) {
  const className = onDone ? "btn btn--quiet" : "btn btn--secondary";
  if ("to" in action) {
    return (
      <Link className={className} to={action.to} onClick={onDone} role={onDone ? "menuitem" : undefined}>
        {action.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      role={onDone ? "menuitem" : undefined}
      onClick={() => {
        onDone?.();
        action.onClick();
      }}
    >
      {action.label}
    </button>
  );
}

const ICONS = {
  burger: "M4 7h16M4 12h16M4 17h16",
  dots: "M6 12h.01M12 12h.01M18 12h.01",
};

interface Props {
  actions: MenuAction[];
  /** Подпись кнопки для экранного диктора. */
  label: string;
  icon?: keyof typeof ICONS;
  className?: string;
}

/** Квадратная кнопка с выпадающим списком тихих кнопок: меню шапки и действия карточки. */
export function ActionMenu({ actions, label, icon = "burger", className }: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={["action-menu", className].filter(Boolean).join(" ")} ref={wrapRef}>
      <button
        type="button"
        className="btn btn--secondary menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d={ICONS[icon]}
            stroke="currentColor"
            strokeWidth={icon === "dots" ? 3.5 : 2}
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <ul className="menu" id={menuId} role="menu">
          {actions.map((action) => (
            <li key={action.label} role="none">
              <ActionButton action={action} onDone={() => setOpen(false)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
