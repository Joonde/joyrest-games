import { Logo } from "./Logo";
import { ActionButton, ActionMenu, type MenuAction } from "./Menu";

export type TopBarAction = MenuAction;

interface Props {
  /** Название экрана: «Студия», «Пульт», «Ведущие». */
  title: string;
  /** Пункты справа: на телефоне — в меню ☰, на широком экране — кнопками в ряд. */
  actions?: TopBarAction[];
}

/** Единая шапка пульта, студии и админки: монограмма, «JoyRest Games», название экрана и действия. */
export function TopBar({ title, actions = [] }: Props) {
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
          <ActionMenu className="topbar__menu" actions={actions} label="Меню" />
        </>
      )}
    </header>
  );
}
