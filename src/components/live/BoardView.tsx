import { useEffect, useState, type CSSProperties } from "react";
import { rankedLeaderboard } from "../../core/leaderboard";
import { moveLabel } from "../../core/rounds";
import { NameText } from "../NameText";
import type { Leaderboard } from "../../data";
import { teamColorVar } from "../../themes/registry";

interface Props {
  leaderboard: Leaderboard;
  /** Сколько строк показать (по умолчанию все: длинная таблица листается страницами). */
  limit?: number;
  /** Показывать прибавку за последний вопрос. */
  showLast?: boolean;
  title?: string;
  /** Стрелки «↑2» — на сколько мест сдвинулся после последнего ответа. */
  showMoves?: boolean;
  /** Лучшие в раунде — со звёздочкой. */
  stars?: Set<string>;
}

/** Строк на странице экрана зала, когда участников больше (помещается в кадр 16:9 вместе со строкой «Вход»). */
export const BOARD_PAGE_ROWS = 8;
/** Сколько секунд держится страница длинной таблицы. */
export const BOARD_PAGE_SECONDS = 7;

/** Страницы длинной таблицы: по `size` строк, номера страниц с нуля. */
export function boardPages<T>(rows: T[], size = BOARD_PAGE_ROWS): T[][] {
  if (rows.length <= size) return [rows];
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += size) pages.push(rows.slice(i, i + size));
  return pages;
}

/**
 * Таблица лидеров для экрана зала: места с учётом равных очков, цвета команд,
 * «+100» за последний вопрос. Размеры — в единицах контейнера, как у вопроса.
 * Больше `BOARD_PAGE_ROWS` строк — таблица листается сама страницами (места 1–8, 9–16…) раз в 7 секунд.
 */
export function BoardView({ leaderboard, limit, showLast = true, title = "Таблица", showMoves = false, stars }: Props) {
  const ranked = rankedLeaderboard(leaderboard);
  const all = limit === undefined ? ranked : ranked.slice(0, limit);
  const pages = boardPages(all);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages.length <= 1) return;
    const timer = window.setInterval(() => setPage((p) => p + 1), BOARD_PAGE_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [pages.length]);
  const at = pages.length > 1 ? page % pages.length : 0;
  const rows = pages[at] ?? [];
  const paged = pages.length > 1;
  return (
    <div className={paged ? "board-view board-view--paged" : "board-view"}>
      <h2 className="board-view__title">{title}</h2>
      {rows.length === 0 ? (
        <p className="board-view__empty">Пока никого</p>
      ) : (
        <ol key={at} className="board-view__list">
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
      {paged && (
        <p className="board-view__pages" aria-label={`Страница ${at + 1} из ${pages.length}`}>
          <span className="board-view__range">
            места {rows[0]?.place ?? ""}–{rows[rows.length - 1]?.place ?? ""} из {all.length}
          </span>
          <span className="board-view__dots" aria-hidden="true">
            {pages.map((_, i) => (
              <span key={i} className={i === at ? "board-view__dot is-on" : "board-view__dot"} />
            ))}
          </span>
        </p>
      )}
      {ranked.length > all.length && <p className="board-view__more">и ещё {ranked.length - all.length}</p>}
    </div>
  );
}
