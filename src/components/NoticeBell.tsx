import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { noticesRepo, type Notice, type NoticesState } from "../data";

/** Как часто колокольчик сам проверяет новое (и сразу — при возврате на вкладку). */
const POLL_MS = 30_000;

function agoLabel(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} ч назад` : `${Math.floor(h / 24)} дн назад`;
}

/**
 * Колокольчик уведомлений в шапке студии (владелец и менеджер по продажам): число новых обращений клиентов и
 * клиентов, которые ждут ответа в Telegram; касание — список, касание строки — карточка клиента в «Клиентах».
 */
export function NoticeBell() {
  const navigate = useNavigate();
  const [state, setState] = useState<NoticesState | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // Телефон и планшет: окно — во всю ширину экрана под кнопкой (у края колокольчика оно уезжало за левый край).
  const [panelTop, setPanelTop] = useState(0);
  useEffect(() => {
    if (!open) return;
    const place = () => setPanelTop(Math.round((buttonRef.current?.getBoundingClientRect().bottom ?? 0) + 8));
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [open]);

  // Поколение ответов: открыли колокольчик и отметили прочитанным — ответы на запросы, ушедшие раньше, устарели
  // (в них прежнее число новых) и не должны вернуть погасшее число после закрытия (22 октября 2026, QA).
  const generation = useRef(0);

  const refresh = useCallback(() => {
    if (!noticesRepo || document.visibilityState !== "visible") return;
    const asked = generation.current;
    noticesRepo
      .load()
      .then((fresh) => {
        if (asked === generation.current) setState(fresh);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

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

  /** Новое прочитано: на колокольчике остаются только ждущие ответа, точки у строк гаснут. */
  const markReadLocally = () =>
    setState((s) =>
      s ? { ...s, unread: s.items.filter((i) => i.kind === "waiting").length, items: s.items.map((i) => (i.kind === "new" ? { ...i, unread: false } : i)) } : s,
    );

  // Закрыли любым способом (кнопка, касание мимо, Escape, переход к клиенту) — новое прочитано и здесь.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) markReadLocally();
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || !noticesRepo) return;
    // Открыли — новое прочитано: точки у строк остаются до закрытия, число на колокольчике гаснет.
    const repo = noticesRepo;
    generation.current += 1;
    const asked = generation.current;
    repo
      .load()
      .then((fresh) => {
        if (asked !== generation.current) return;
        setState(fresh);
        if (!fresh.items.some((n) => n.unread && n.kind === "new")) return;
        return repo.markSeen().then(() => {
          // Отметка дошла до сервера: всё, что было запрошено до неё, — устарело.
          generation.current += 1;
          markReadLocally();
        });
      })
      .catch(() => undefined);
  }

  function go(n: Notice) {
    setOpen(false);
    navigate(`/studio/clients?id=${encodeURIComponent(n.clientId)}`);
  }

  const unread = state?.unread ?? 0;

  // Число новых — и во вкладке браузера: «(2) JoyRest Games» видно, даже когда открыта другая вкладка.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, "");
    document.title = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
  }, [unread]);
  useEffect(
    () => () => {
      document.title = document.title.replace(/^\(\d+\+?\) /, "");
    },
    [],
  );
  // После открытия новые прочитаны: на колокольчике остаются только ждущие ответа.
  const badge = open ? (state?.items.filter((i) => i.kind === "waiting").length ?? 0) : unread;
  const items = state?.items ?? [];
  const now = Date.now();

  return (
    <div className="notice-bell" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--secondary menu-button notice-bell__button"
        aria-label={unread > 0 ? `Уведомления: новых ${unread}` : "Уведомления"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {/* Число — рядом с кнопкой, а не внутри: внутри оно выступало за край и «распирало» кнопку. */}
      {badge > 0 && (
        <span className="notice-bell__count" aria-hidden="true">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {open && (
        <div className="notice-panel" id={panelId} role="dialog" aria-label="Уведомления" style={{ ["--notice-top" as string]: `${panelTop}px` } as CSSProperties}>
          <p className="notice-panel__title">Уведомления</p>
          {items.length === 0 ? (
            <p className="muted small">Пока тихо. Новые заявки клиентов появятся здесь.</p>
          ) : (
            <ul className="notice-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={["notice-item", n.unread ? "is-unread" : "", n.kind === "waiting" ? "is-waiting" : ""].filter(Boolean).join(" ")} onClick={() => go(n)}>
                    <span className="notice-item__head">
                      <span className="notice-item__title">
                        {n.kind === "waiting" ? "⏰ " : n.unread ? "🔔 " : ""}
                        {n.title}
                      </span>
                      <span className="notice-item__when">{n.kind === "waiting" ? `ждёт ${agoLabel(now - n.at).replace(" назад", "")}` : agoLabel(now - n.at)}</span>
                    </span>
                    <span className="notice-item__name">{n.name}</span>
                    {n.line && <span className="notice-item__line">{n.line}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn btn--quiet btn--block"
            onClick={() => {
              setOpen(false);
              navigate("/studio/clients?f=new");
            }}
          >
            Все новые клиенты →
          </button>
        </div>
      )}
    </div>
  );
}
