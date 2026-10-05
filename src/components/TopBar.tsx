import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "./Logo";

export type TopBarAction = { label: string; to: string } | { label: string; onClick: () => void };

interface Props {
  /** Название экрана: «Студия», «Пульт», «Ведущие». */
  title: string;
  /** Пункты справа: на телефоне — в меню ☰, на широком экране — кнопками в ряд. */
  actions?: TopBarAction[];
}

function ActionButton({ action, onDone }: { action: TopBarAction; onDone?: () => void }) {
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

/** Единая шапка пульта, студии и админки: монограмма, «JoyRest Games», название экрана и действия. */
export function TopBar({ title, actions = [] }: Props) {
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
    <header className="topbar">
      <div className="topbar__brand">
        <Logo kind="monogram" className="logo--mark" title="" />
        <div className="topbar__titles">
          <p className="eyebrow">JoyRest Games</p>
          <h1>{title}</h1>
        </div>
      </div>
      {actions.length > 0 && (
        <>
          <nav className="topbar__actions" aria-label="Действия">
            {actions.map((action) => (
              <ActionButton key={action.label} action={action} />
            ))}
          </nav>
          <div className="topbar__menu" ref={wrapRef}>
            <button
              type="button"
              className="btn btn--secondary menu-button"
              aria-label="Меню"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={menuId}
              onClick={() => setOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
        </>
      )}
    </header>
  );
}
