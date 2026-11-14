/**
 * Поверх сцены: пауза («Матрёшка дремлет», глаза закрыты) и «Табло на экран» (кто в игре и сердечки — страницами по 25, сами
 * листаются раз в 6 с по часам сервера; болельщики — числом).
 */
import { Hearts } from "../art/bits";
import { Doll } from "../art/Doll";
import { folkProps, type BoardProps } from "./boards";
import type { Board } from "./model";
import { numText, plainName } from "./model";
import { Chip, plural } from "./parts";

export function Overlays(props: BoardProps & { board: Board }) {
  const { m, v, board } = props;
  const lives = Math.max(1, ...(v.scoreboard?.rows.map((r) => r[1]) ?? [1]), v.lobby?.lives ?? 1);
  return (
    <>
      {v.board && v.scoreboard && board !== "lobby" && (
        <div className="mts-board" role="status">
          <div className="mts-plate mts-board__card">
            <div className="mts-board__head">
              <div>
                <div className="mts-eyebrow">Табло</div>
                <div className="mts-title">
                  В игре {v.scoreboard.total} · болельщиков {v.fans}
                </div>
              </div>
              {v.scoreboard.pages > 1 && (
                <div className="mts-cap">
                  страница {v.scoreboard.page + 1} из {v.scoreboard.pages}
                </div>
              )}
            </div>
            <div className="mts-board__grid">
              {v.scoreboard.rows.map(([n, h]) => (
                <div key={n} className="mts-board__row">
                  <Chip n={n} m={m} size={44} className="is-static" />
                  <span className="mts-board__who">
                    <b>{numText(n)}</b> {plainName(v.names[n] ?? m.known[n] ?? "")}
                  </span>
                  <Hearts n={h} total={lives} style={v.style} className="mts-board__hearts" />
                </div>
              ))}
            </div>
            <div className="mts-cap">
              {v.scoreboard.total} {plural(v.scoreboard.total, "игрок", "игрока", "игроков")} в игре · {v.out} в сугробе · в Копилке {v.piggy}
            </div>
          </div>
        </div>
      )}
      {m.paused && board !== "tab" && board !== "abandoned" && board !== "connecting" && <Pause {...props} />}
    </>
  );
}

function Pause({ v }: BoardProps) {
  const { folk, glow } = folkProps(v);
  return (
    <div className="mts-pause" role="status">
      <div className="mts-dim" />
      <div className="mts-pause__doll">
        <Doll folk={folk} glow={glow} view="face" eyes="closed" />
      </div>
      <div className="mts-pause__text">
        <div className="mts-title mts-title--xl">Пауза</div>
        <div className="mts-body">Матрёшка дремлет — ведущий скоро продолжит</div>
        <div className="mts-cap">Время испытания остановлено · нажатия на телефонах не считаются</div>
      </div>
    </div>
  );
}
