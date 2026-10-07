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
/** Сколько кнопок помещается в шапку на компьютере, не обрезая название экрана. */
const INLINE_ACTIONS = 3;

export function TopBar({ title, actions = [] }: Props) {
  const overflow = actions.length > INLINE_ACTIONS + 1;
  const inline = overflow ? actions.slice(0, INLINE_ACTIONS) : actions;
  const more = overflow ? actions.slice(INLINE_ACTIONS) : [];
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
    </header>
  );
}
