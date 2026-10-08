import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ConfirmDialog } from "./ConfirmDialog";
import { Logo } from "./Logo";
import { ActionButton, ActionMenu, type MenuAction } from "./Menu";

export type TopBarAction = MenuAction;

interface Props {
  /** Название экрана: «Студия», «Пульт», «Ведущие». */
  title: string;
  /** Пункты справа: на телефоне — в меню ☰, на широком экране — кнопками в ряд. */
  actions?: TopBarAction[];
  /**
   * Монограмма слева ведёт домой — в студию. Во время игры (пульт) сначала спрашиваем: случайное
   * касание не должно уводить с пульта.
   */
  leaveWarning?: string;
}

/** Единая шапка пульта, студии и админки: монограмма, «JoyRest Games», название экрана и действия. */
/** Сколько кнопок помещается в шапку на компьютере, не обрезая название экрана. */
const INLINE_ACTIONS = 3;

export function TopBar({ title, actions = [], leaveWarning }: Props) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const overflow = actions.length > INLINE_ACTIONS + 1;
  const inline = overflow ? actions.slice(0, INLINE_ACTIONS) : actions;
  const more = overflow ? actions.slice(INLINE_ACTIONS) : [];
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Link
          to="/studio"
          className="topbar__home"
          aria-label="В студию"
          onClick={(event) => {
            if (!leaveWarning) return;
            event.preventDefault();
            setAsking(true);
          }}
        >
          <Logo kind="monogram" className="logo--mark" title="" />
        </Link>
        <div className="topbar__titles">
          <p className="eyebrow">JoyRest Games</p>
          <h1>{title}</h1>
        </div>
      </div>
      {actions.length > 0 && (
        <>
          {/* На компьютере — первые кнопки в ряд, остальное в «Ещё»; на телефоне — всё в меню ☰. */}
          <nav className="topbar__actions" aria-label="Действия">
            {inline.map((action) => (
              <ActionButton key={action.label} action={action} />
            ))}
            {more.length > 0 && <ActionMenu className="topbar__more" actions={more} label="Ещё" icon="dots" />}
          </nav>
          <ActionMenu className="topbar__menu" actions={actions} label="Меню" />
        </>
      )}
      {leaveWarning && (
        <ConfirmDialog open={asking} title="Перейти в студию?" confirmLabel="Перейти в студию" cancelLabel="Остаться" onCancel={() => setAsking(false)} onConfirm={() => navigate("/studio")}>
          <p>{leaveWarning}</p>
        </ConfirmDialog>
      )}
    </header>
  );
}
