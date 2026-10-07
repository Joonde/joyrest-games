import { useEffect, useRef, type CSSProperties } from "react";
import {
  podiumPlaces,
  revealedPlaces,
  revealOrder,
  type PodiumPlace,
  type PodiumPlaceNumber,
} from "../../core/podium";
import { pointsLabel } from "../../core/results";
import type { Session } from "../../data";
import { teamColorVar } from "../../themes/registry";
import { NameText } from "../NameText";
import { playSound } from "./sound";

/** На ступени помещается три имени, остальные — «и ещё N». */
const NAMES_ON_STEP = 3;
/** Слева направо: 2, 1, 3 — как на настоящем пьедестале. */
const LAYOUT: PodiumPlaceNumber[] = [2, 1, 3];
const CONFETTI = 40;

function teamStyle(colorIndex: number | undefined): CSSProperties | undefined {
  return colorIndex === undefined ? undefined : ({ "--team-color": teamColorVar(colorIndex) } as CSSProperties);
}

function Names({ place }: { place: PodiumPlace }) {
  const shown = place.entries.slice(0, NAMES_ON_STEP);
  const more = place.entries.length - shown.length;
  return (
    <div className="podium__names">
      {shown.map((e) => (
        <p
          key={e.id}
          className={e.kind === "team" ? "podium__name podium__name--team" : "podium__name"}
          style={e.kind === "team" ? teamStyle(e.colorIndex) : undefined}
        >
          <NameText name={e.name} />
        </p>
      ))}
      {more > 0 && <p className="podium__more">и ещё {more}</p>}
      <p className="podium__score">{pointsLabel(place.score)}</p>
    </div>
  );
}

/** Салют после первого места: только CSS, при «уменьшить движение» не показывается. */
function Confetti() {
  return (
    <div className="podium__confetti" aria-hidden="true">
      {Array.from({ length: CONFETTI }, (_, i) => (
        <span
          key={i}
          style={
            {
              "--x": `${(i * 37) % 100}%`,
              "--delay": `${(i % 8) * 0.12}s`,
              "--drift": `${((i * 53) % 21) - 10}cqw`,
              "--spin": `${(i % 2 ? 1 : -1) * (360 + ((i * 29) % 360))}deg`,
              background: `var(--team-${(i % 5) + 1}, var(--color-highlight))`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * Пьедестал на экране зала (CLAUDE.md, раздел 6, «Пьедестал»): три ступени, места открываются
 * по одному. final — после «Завершить игру»: всё открыто, без звука и салюта.
 */
export function Podium({ session, final = false }: { session: Pick<Session, "leaderboard" | "state">; final?: boolean }) {
  const places = podiumPlaces(session.leaderboard);
  const shown = final ? new Set(revealOrder(session.leaderboard)) : revealedPlaces(session);
  const firstShown = shown.has(1);
  const previous = useRef(firstShown);

  useEffect(() => {
    // Фанфары — когда открыли первое место, не при перезагрузке экрана.
    if (!final && firstShown && !previous.current) playSound("fanfare");
    previous.current = firstShown;
  }, [final, firstShown]);

  return (
    <div className={final ? "podium podium--final" : "podium"}>
      {!final && <p className="podium__eyebrow">Награждение</p>}
      <div className="podium__stage" aria-live="polite">
        {LAYOUT.map((n) => {
          const place = places.find((p) => p.place === n);
          const open = shown.has(n) && place !== undefined;
          return (
            <div
              key={n}
              className={`podium__slot podium__slot--${n}${open ? " is-open" : ""}${place ? "" : " is-empty"}`}
            >
              {open ? <Names place={place} /> : <div className="podium__names podium__names--hidden">{place ? "?" : ""}</div>}
              <div className="podium__step">
                <span className="podium__num">{n}</span>
              </div>
            </div>
          );
        })}
      </div>
      {!final && firstShown && <Confetti />}
    </div>
  );
}

/** Пьедестал на пульте: кто на каком месте и что уже открыто на экране. */
export function PodiumHostList({ session }: { session: Pick<Session, "leaderboard" | "state"> }) {
  const places = podiumPlaces(session.leaderboard);
  const shown = revealedPlaces(session);
  return (
    <ol className="podium-list">
      {[...places].reverse().map((p) => (
        <li key={p.place} className={shown.has(p.place) ? "podium-list__item is-open" : "podium-list__item"}>
          <span className="podium-list__place">{p.place}</span>
          <span className="podium-list__names">
            {p.entries.map((e, i) => (
              <span key={e.id}>
                {i > 0 && ", "}
                <NameText name={e.name} />
              </span>
            ))}
            <span className="muted small"> · {pointsLabel(p.score)}</span>
          </span>
          <span className="podium-list__mark">{shown.has(p.place) ? "на экране" : "скрыто"}</span>
        </li>
      ))}
    </ol>
  );
}

/** Награждение на телефоне гостя: открытые места и своё место, когда до него дошли. */
export function PodiumPhone({ session, pid }: { session: Pick<Session, "leaderboard" | "state" | "screenMode">; pid: string }) {
  const places = podiumPlaces(session.leaderboard);
  const shown = revealedPlaces(session);
  const mine = places.find((p) => p.entries.some((e) => e.id === pid));
  const me = session.leaderboard[pid];
  const noScreen = session.screenMode === "none";
  const visible = [...places].reverse().filter((p) => shown.has(p.place));

  return (
    <div className="quiz-phone quiz-phone--center" aria-live="polite">
      <p className="eyebrow">Награждение</p>
      {mine && shown.has(mine.place) ? (
        <>
          <p className="quiz-phone__place">{mine.place}</p>
          <p className="quiz-phone__score">место · {pointsLabel(mine.score)}</p>
          <p>{mine.place === 1 ? "Поздравляем с победой!" : "Поздравляем!"}</p>
        </>
      ) : mine ? (
        <p className="quiz-phone__question">{noScreen ? "Ведущий объявляет призёров…" : "Смотрите на экран — объявляют призёров!"}</p>
      ) : (
        <>
          <p className="quiz-phone__question">{noScreen ? "Ведущий объявляет призёров" : "Смотрите на экран!"}</p>
          {me && <p className="muted">{pointsLabel(me.score)} — спасибо за игру!</p>}
        </>
      )}
      {visible.length > 0 && (
        <ul className="podium-phone">
          {visible.map((p) => (
            <li key={p.place}>
              <strong>{p.place} место:</strong>{" "}
              {p.entries.map((e, i) => (
                <span key={e.id}>
                  {i > 0 && ", "}
                  <NameText name={e.name} />
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
