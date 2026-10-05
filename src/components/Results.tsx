import type { CSSProperties } from "react";
import { formatResultsText, places } from "../core/results";
import type { GameResult } from "../data";
import { teamColorVar } from "../themes/registry";
import { resultsUrl } from "./links";

/** Итоговая таблица: место, имя (с цветом команды) и очки. */
export function ResultsTable({ result, limit }: { result: GameResult; limit?: number }) {
  const rows = limit === undefined ? result.board : result.board.slice(0, limit);
  const placeList = places(result.board);
  if (rows.length === 0) return <p className="muted">Очков никто не набрал.</p>;
  return (
    <ol className="list results">
      {rows.map((row, i) => (
        <li key={`${i}-${row.name}`}>
          <span className="results__name">
            <span className="results__place">{placeList[i]}</span>
            {row.colorIndex !== undefined && (
              <span
                className="team-dot"
                style={{ "--team-color": teamColorVar(row.colorIndex) } as CSSProperties}
                aria-hidden
              />
            )}
            <span className="line-clamp">{row.name}</span>
          </span>
          <span className="results__score">{row.score}</span>
        </li>
      ))}
      {limit !== undefined && result.board.length > limit && (
        <li className="results__more muted">…и ещё {result.board.length - limit}</li>
      )}
    </ol>
  );
}

/**
 * «Поделиться» открывает системное меню телефона (мессенджеры), а где его нет —
 * копирует ссылку. «Скопировать текстом» — таблица для чата.
 */
export function ShareResults({
  result,
  onToast,
  primary = false,
}: {
  result: GameResult;
  onToast: (text: string) => void;
  primary?: boolean;
}) {
  const link = resultsUrl(result.id);

  async function share() {
    const title = `Итоги игры «${result.gameTitle || "Игра"}»`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: formatResultsText(result), url: link });
        return;
      } catch (error) {
        // Гость закрыл меню «Поделиться» — ничего не делаем.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copy(link, "Ссылка на итоги скопирована");
  }

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      onToast(done);
    } catch {
      onToast("Не удалось скопировать");
    }
  }

  return (
    <div className="actions">
      <button type="button" className={primary ? "btn btn--block" : "btn btn--secondary btn--block"} onClick={() => void share()}>
        Поделиться итогами
      </button>
      <button
        type="button"
        className="btn btn--secondary btn--block"
        onClick={() => void copy(formatResultsText(result, link), "Итоги скопированы текстом")}
      >
        Скопировать текстом
      </button>
    </div>
  );
}
