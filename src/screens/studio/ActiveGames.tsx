import { Link } from "react-router-dom";
import { formatSessionCode } from "../../core/code";
import { sessionsRepo, useLoad, type Session } from "../../data";
import { Icon } from "../../components/Icon";

const NONE: Session[] = [];

/**
 * «Идёт игра» вверху студии: на любом устройстве ведущий одним касанием делает его пультом
 * или экраном зала — без набора адреса и кода.
 */
export function ActiveGames({ hostId }: { hostId: string }) {
  const [state] = useLoad(
    () => sessionsRepo.listByHost(hostId).then((list) => list.filter((s) => s.state.phase !== "finished")).catch(() => NONE),
    [hostId],
  );
  if (state.status !== "ready" || state.data.length === 0) return null;
  return (
    <>
      {state.data.slice(0, 3).map((s) => (
        <section key={s.id} className="card active-game" aria-label={`Идёт игра ${formatSessionCode(s.code)}`}>
          <p className="eyebrow">{s.state.phase === "lobby" ? "Ждёт гостей" : "Идёт игра"}</p>
          <p className="active-game__title line-clamp">
            {s.gameTitle || "Игра"} · <span className="active-game__code">{formatSessionCode(s.code)}</span>
          </p>
          <div className="tiles tiles--two">
            <Link className="tile" to={`/host/${s.code}`}>
              <Icon name="remote" className="tile__icon" />
              <span className="tile__label">Пульт</span>
            </Link>
            {s.screenMode !== "none" && (
              <Link className="tile" to={`/screen/${s.code}`}>
                <Icon name="screen" className="tile__icon" />
                <span className="tile__label">Экран зала</span>
              </Link>
            )}
          </div>
        </section>
      ))}
    </>
  );
}
