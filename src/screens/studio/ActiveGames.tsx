import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useConfirm } from "../../components/ConfirmDialog";
import { formatSessionCode } from "../../core/code";
import { mechanicTitle } from "../../mechanics/registry";
import { sessionsRepo, useLoad, type SessionSummary } from "../../data";
import { Icon } from "../../components/Icon";

const NONE: SessionSummary[] = [];

/** Список «Игры сейчас»: лёгкий (свой сервер) или из сессий ведущего (Firebase). */
async function loadOverview(hostId: string): Promise<SessionSummary[]> {
  if (sessionsRepo.overview) return sessionsRepo.overview();
  const list = await sessionsRepo.listByHost(hostId);
  return list.map((s) => ({
    id: s.id,
    code: s.code,
    hostId: s.hostId,
    hostName: "",
    gameTitle: s.gameTitle,
    mechanic: s.mechanic,
    phase: s.state.phase,
    screenMode: s.screenMode,
    players: Object.keys(s.leaderboard).length,
    createdAt: s.createdAt ?? 0,
    updatedAt: s.createdAt ?? 0,
    startedAt: null,
    stale: false,
  }));
}

/** Обновлять список раз в 20 с, пока страница видна. */
function useOverview(hostId: string) {
  const [state, , update] = useLoad(() => loadOverview(hostId).catch(() => NONE), [hostId]);
  // Тихо обновляем без каркаса загрузки: список не мигает.
  const reload = useCallback(() => {
    void loadOverview(hostId)
      .then((fresh) => update(() => fresh))
      .catch(() => undefined);
  }, [hostId, update]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [reload]);
  return [state, reload] as const;
}

const PHASE_TITLES: Record<SessionSummary["phase"], string> = { lobby: "Ждёт гостей", playing: "Идёт игра", finished: "Завершена" };

function ago(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/**
 * Одна игра строкой. Касание — пульт своей идущей игры (или итоги завершённой); «⋯» или свайп
 * влево — действия: пульт, экран зала, «Завершить игру», «Убрать из списка» (с подтверждением).
 */
export function GameRow({ game, own, admin = false, helper = false, onChanged }: { game: SessionSummary; own: boolean; admin?: boolean; helper?: boolean; onChanged?: () => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dialog, confirm] = useConfirm();
  const startX = useRef<number | null>(null);
  const live = game.phase !== "finished";
  // Помощник владельца (роль) завершает и убирает чужую игру, только если она брошена.
  const canClose = live && (own || admin || (helper && game.stale)) && Boolean(sessionsRepo.close);
  const canHide = ((own || admin) ? !live || game.stale : helper && live && game.stale) && Boolean(sessionsRepo.hide);
  const title = game.gameTitle || mechanicTitle(game.mechanic);
  const target = live && own ? `/host/${game.code}` : !live ? `/results/${game.id}` : null;
  const status = live && game.stale ? "Не завершена" : PHASE_TITLES[game.phase];

  function closeGame() {
    confirm({
      title: `Завершить «${title}»?`,
      text: "Игра закончится для всех гостей, итоги сохранятся в истории. Вернуть её будет нельзя.",
      confirmLabel: "Завершить игру",
      run: async () => {
        await sessionsRepo.close?.(game.id, game.players);
        setOpen(false);
        onChanged?.();
      },
    });
  }

  function hideGame() {
    confirm({
      title: "Убрать игру из списка?",
      text: live ? "Игра не завершена, но давно без действий. Она пропадёт из «Игр сейчас», итоги останутся в истории." : "Игра пропадёт из «Игр сейчас». Итоги останутся в «Истории игр».",
      confirmLabel: "Убрать из списка",
      run: async () => {
        await sessionsRepo.hide?.(game.id);
        onChanged?.();
      },
    });
  }

  const hasActions = canClose || canHide || (live && own);
  return (
    <li
      className={`game-row game-row--${game.stale && live ? "stale" : game.phase}${open ? " is-open" : ""}`}
      onTouchStart={(e) => (startX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const from = startX.current;
        const to = e.changedTouches[0]?.clientX ?? null;
        startX.current = null;
        if (from === null || to === null || !hasActions) return;
        if (from - to > 60) setOpen(true);
        if (to - from > 60) setOpen(false);
      }}
    >
      <div className="game-row__main">
        {/* Не <button>: у кнопки в части браузеров (Safari, старый Chrome) содержимое не сжимается по
            ширине, и длинное название вылезает за строку. */}
        <div
          role="button"
          tabIndex={target ? 0 : -1}
          aria-disabled={!target}
          className="game-row__text"
          onClick={() => target && navigate(target)}
          onKeyDown={(e) => {
            if (target && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              navigate(target);
            }
          }}
          aria-label={target ? `${title}, ${status}: открыть ${live ? "пульт" : "итоги"}` : `${title}, ${status}`}
        >
          <span className="game-row__status">
            <span className="game-row__dot" aria-hidden="true" />
            {status}
            {!own && game.hostName ? ` · ${game.hostName}` : ""}
          </span>
          <span className="game-row__title">
            <span className="game-row__name">{title}</span>
            <span className="game-row__code">{formatSessionCode(game.code)}</span>
          </span>
          <span className="muted small line-clamp">
            {game.players > 0 ? `гостей: ${game.players} · ` : ""}
            {live ? ago(game.updatedAt) : `закончилась ${ago(game.updatedAt)}`}
          </span>
        </div>
        {hasActions && (
          <button type="button" className="btn btn--quiet game-row__more" aria-expanded={open} aria-label={`Действия: ${title}`} onClick={() => setOpen((v) => !v)}>
            ⋯
          </button>
        )}
      </div>
      {open && (
        <div className="game-row__actions">
          {live && own && (
            <Link className="tile tile--small" to={`/host/${game.code}`}>
              <Icon name="remote" className="tile__icon" />
              <span className="tile__label">Пульт</span>
            </Link>
          )}
          {live && own && game.screenMode !== "none" && (
            <Link className="tile tile--small" to={`/screen/${game.code}`}>
              <Icon name="screen" className="tile__icon" />
              <span className="tile__label">Экран</span>
            </Link>
          )}
          {canClose && (
            <button type="button" className="btn btn--secondary" onClick={closeGame}>
              Завершить игру
            </button>
          )}
          {canHide && (
            <button type="button" className="btn btn--quiet" onClick={hideGame}>
              Убрать из списка
            </button>
          )}
        </div>
      )}
      {dialog}
    </li>
  );
}

/**
 * «Идёт игра» вверху студии — компактно: строка на игру, кнопки «Пульт» и «Экран зала». Показываем
 * две, остальные — по кнопке, чтобы до своих игр не надо было долго листать.
 */
export function ActiveGames({ hostId }: { hostId: string }) {
  const [state, reload] = useOverview(hostId);
  const [all, setAll] = useState(false);
  const mine = useMemo(() => (state.status === "ready" ? state.data.filter((g) => g.hostId === hostId && g.phase !== "finished") : NONE), [state, hostId]);
  if (mine.length === 0) return null;
  const shown = all ? mine : mine.slice(0, 2);
  return (
    <section className="card active-games" aria-label="Ваши идущие игры">
      <ul className="game-rows">
        {shown.map((g) => (
          <GameRow key={g.id} game={g} own onChanged={reload} />
        ))}
      </ul>
      {mine.length > 2 && (
        <button type="button" className="btn btn--quiet btn--block" onClick={() => setAll((v) => !v)}>
          {all ? "Свернуть" : `Ещё игры: ${mine.length - 2}`}
        </button>
      )}
    </section>
  );
}

/**
 * Владелец: «Игры сейчас» — все ведущие. «По ведущим»: имя, сколько игр идёт и ждёт гостей; касание —
 * его текущие игры и две последние. «Все игры» — общий список: сначала идущие, потом ждущие гостей.
 */
export function LiveOverview({ adminId, owner = true }: { adminId: string; owner?: boolean }) {
  const [state, reload] = useOverview(adminId);
  const [view, setView] = useState<"hosts" | "all">("hosts");
  const [open, setOpen] = useState<string | null>(null);
  const games = state.status === "ready" ? state.data : NONE;
  const hosts = useMemo(() => {
    const map = new Map<string, { id: string; name: string; games: SessionSummary[] }>();
    for (const g of games) {
      const h = map.get(g.hostId) ?? { id: g.hostId, name: g.hostName || "Ведущий", games: [] };
      h.games.push(g);
      map.set(g.hostId, h);
    }
    const live = (h: { games: SessionSummary[] }) => h.games.filter((g) => g.phase !== "finished").length;
    return [...map.values()].sort((a, b) => live(b) - live(a) || a.name.localeCompare(b.name, "ru"));
  }, [games]);
  const active = games.filter((g) => g.phase !== "finished").sort((a, b) => (a.phase === b.phase ? b.updatedAt - a.updatedAt : a.phase === "playing" ? -1 : 1));

  if (state.status === "loading") return <p className="muted">Загружаем игры…</p>;
  return (
    <div className="stack live-overview">
      <div className="seg" role="group" aria-label="Как показать">
        <button type="button" className={view === "hosts" ? "seg__btn is-on" : "seg__btn"} aria-pressed={view === "hosts"} onClick={() => setView("hosts")}>
          По ведущим
        </button>
        <button type="button" className={view === "all" ? "seg__btn is-on" : "seg__btn"} aria-pressed={view === "all"} onClick={() => setView("all")}>
          Все игры · {active.length}
        </button>
      </div>
      {view === "all" ? (
        active.length === 0 ? (
          <p className="muted">Сейчас никто не играет.</p>
        ) : (
          <ul className="game-rows card">
            {active.map((g) => (
              <GameRow key={g.id} game={g} own={g.hostId === adminId} admin={owner} helper={!owner} onChanged={reload} />
            ))}
          </ul>
        )
      ) : hosts.length === 0 ? (
        <p className="muted">За последние 30 дней игр не было.</p>
      ) : (
        <ul className="host-rows">
          {hosts.map((h) => {
            const playing = h.games.filter((g) => g.phase === "playing").length;
            const waiting = h.games.filter((g) => g.phase === "lobby").length;
            const expanded = open === h.id;
            return (
              <li key={h.id} className="card host-row">
                <button type="button" className="host-row__head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : h.id)}>
                  <span className="host-row__name line-clamp">{h.name}</span>
                  <span className="host-row__chips">
                    {playing > 0 && <span className="chip chip--playing">Идёт: {playing}</span>}
                    {waiting > 0 && <span className="chip chip--lobby">Ждёт: {waiting}</span>}
                    {playing + waiting === 0 && <span className="chip">не играет</span>}
                  </span>
                  <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
                </button>
                {expanded && (
                  <ul className="game-rows">
                    {h.games.map((g) => (
                      <GameRow key={g.id} game={g} own={g.hostId === adminId} admin={owner} helper={!owner} onChanged={reload} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
