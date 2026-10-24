import { useContext, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { noticesRepo, permissions } from "../data";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoticeBell } from "./NoticeBell";
import { ProfileContext } from "./profileContext";
import { Logo } from "./Logo";
import { ActionButton, ActionMenu, type MenuAction } from "./Menu";
import { setStudioTheme } from "../themes/registry";
import { useStudioThemeId } from "../themes/studioTheme";

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
  /** Своя обработка ухода по монограмме (например, конструктор спросит про несохранённые правки). */
  onHome?: () => void;
}

/** Единая шапка пульта, студии и админки: монограмма, «JoyRest Games», название экрана и действия. */
/** Сколько кнопок помещается в шапку на компьютере, не обрезая название экрана. */
const INLINE_ACTIONS = 3;

export function TopBar({ title, actions = [], leaveWarning, onHome }: Props) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const overflow = actions.length > INLINE_ACTIONS + 1;
  const inline = overflow ? actions.slice(0, INLINE_ACTIONS) : actions;
  const more = overflow ? actions.slice(INLINE_ACTIONS) : [];
  const profile = useContext(ProfileContext);
  // Колокольчик — владельцу и менеджеру по продажам в студии (не на пульте: там свои дела).
  const bell = !leaveWarning && noticesRepo !== null && profile !== null && permissions.canManageClients(profile);
  // Светлая и тёмная тема — в студии (вошедший человек), не на пульте: там тема игры.
  const themeToggle = !leaveWarning && profile !== null;
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Link
          to="/studio"
          className="topbar__home"
          aria-label="В студию"
          onClick={(event) => {
            if (onHome) {
              event.preventDefault();
              onHome();
              return;
            }
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
      {(actions.length > 0 || bell || themeToggle) && (
        <div className="topbar__tools">
          {themeToggle && <ThemeToggle />}
          {bell && <NoticeBell />}
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
        </div>
      )}
      {leaveWarning && (
        <ConfirmDialog open={asking} title="Перейти в студию?" confirmLabel="Перейти в студию" cancelLabel="Остаться" onCancel={() => setAsking(false)} onConfirm={() => navigate("/studio")}>
          <p>{leaveWarning}</p>
        </ConfirmDialog>
      )}
    </header>
  );
}

/** ☀️ / 🌙 — светлая или тёмная студия на этом устройстве (решение владельца 24 октября 2026). */
function ThemeToggle() {
  const id = useStudioThemeId();
  const light = id === "joyrest-day";
  const label = light ? "Тёмная тема" : "Светлая тема";
  return (
    <button
      type="button"
      className="btn btn--secondary menu-button theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setStudioTheme(light ? "joyrest" : "joyrest-day")}
    >
      {light ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth={1.8} />
          <path
            d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
