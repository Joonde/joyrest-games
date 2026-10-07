import type { CSSProperties } from "react";
import { rankedLeaderboard } from "../../core/leaderboard";
import { moveLabel } from "../../core/rounds";
import { NameText } from "../NameText";
import type { Leaderboard } from "../../data";
import { teamColorVar } from "../../themes/registry";

interface Props {
  leaderboard: Leaderboard;
  /** Сколько строк показать (экран зала — первые 10). */
  limit?: number;
  /** Показывать прибавку за последний вопрос. */
  showLast?: boolean;
  title?: string;
  /** Стрелки «↑2» — на сколько мест сдвинулся после последнего ответа. */
  showMoves?: boolean;
  /** Лучшие в раунде — со звёздочкой. */
  stars?: Set<string>;
}

/**
 * Таблица лидеров для экрана зала: места с учётом равных очков, цвета команд,
 * «+100» за последний вопрос. Размеры — в единицах контейнера, как у вопроса.
 */
export function BoardView({ leaderboard, limit = 10, showLast = true, title = "Таблица", showMoves = false, stars }: Props) {
  const ranked = rankedLeaderboard(leaderboard);
  const rows = ranked.slice(0, limit);
  return (
    <div className="board-view">
      <h2 className="board-view__title">{title}</h2>
      {rows.length === 0 ? (
        <p className="board-view__empty">Пока никого</p>
      ) : (
        <ol className="board-view__list">
          {rows.map((e) => (
            <li
              key={e.id}
              className={e.kind === "team" ? "board-view__row board-view__row--team" : "board-view__row"}
              style={e.kind === "team" ? ({ "--team-color": teamColorVar(e.colorIndex) } as CSSProperties) : undefined}
            >
              <span className="board-view__place">{e.place}</span>
              <span className="board-view__name">
                <NameText name={e.name} />
                {stars?.has(e.id) && (
                  <span className="board-view__star" title="Лучший в раунде">
                    {" "}
                    ★
                  </span>
                )}
              </span>
              {showMoves && moveLabel(e.move) && (
                <span className={(e.move ?? 0) > 0 ? "board-view__move is-up" : "board-view__move is-down"}>{moveLabel(e.move)}</span>
              )}
              {showLast && (e.last ?? 0) > 0 && <span className="board-view__last">+{e.last}</span>}
              <span className="board-view__score">{e.score}</span>
            </li>
          ))}
        </ol>
      )}
      {ranked.length > rows.length && <p className="board-view__more">и ещё {ranked.length - rows.length}</p>}
    </div>
  );
}
