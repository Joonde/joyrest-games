import type { CSSProperties } from "react";
import type { BuzzState } from "../../core/buzz";
import type { Leaderboard } from "../../data/types";
import { teamColorVar } from "../../themes/registry";
import { NameText } from "../NameText";

/**
 * Сколько полос в колонке и колонок (решение владельца 25 октября 2026 — игроки должны видеть себя): до 8 — одна колонка,
 * до 16 — две, дальше три; больше 30 — лидеры гонки и «ещё N».
 */
const PER_COLUMN = 10;
const MAX_LANES = 30;

/** Сколько колонок под столько участников. */
export function raceColumns(count: number): number {
  return count <= 8 ? 1 : count <= 16 ? 2 : 3;
}

/**
 * Гонка на экране зала: у каждого участника полоса из делений до клетчатого «Финиша» и столбец
 * «Сейчас»: отвечает, следующий, мимо, деления. Полосы — лидеры гонки, затем по очереди нажатий.
 */
export function RaceLanes({ leaderboard, buzz, target }: { leaderboard: Leaderboard; buzz: BuzzState | null; target: number }) {
  const order = buzz?.order ?? [];
  const rows = Object.entries(leaderboard)
    .map(([id, e]) => ({ id, e, race: Math.min(target, e.race ?? 0) }))
    .sort((a, b) => {
      const pa = order.indexOf(a.id);
      const pb = order.indexOf(b.id);
      return b.race - a.race || (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb) || a.e.name.localeCompare(b.e.name, "ru");
    });
  // Отвечающий и очередь видны всегда, даже если их полоса ниже лидеров.
  const must = new Set([buzz?.current, ...(buzz?.order ?? []).slice(0, 3)].filter(Boolean));
  const shown = rows.slice(0, MAX_LANES);
  for (const r of rows.slice(MAX_LANES)) if (must.has(r.id) && shown.length < MAX_LANES + 3) shown.push(r);
  const hidden = rows.length - shown.length;
  const queue = (buzz?.order ?? []).filter((pid) => !(buzz?.out ?? []).includes(pid));
  const columns = raceColumns(shown.length);
  const rowsPerColumn = columns === 1 ? shown.length : Math.min(PER_COLUMN, Math.ceil(shown.length / columns));

  return (
    <div className={`race race--cols-${columns}`} role="list" aria-label="Гонка до финиша">
      {columns === 1 ? (
        <div className="race__head" aria-hidden="true">
          <span>Участник</span>
          <span>Старт → {target}</span>
          <span className="race__finish-label">Финиш</span>
          <span>Сейчас</span>
        </div>
      ) : (
        <p className="race__caption" aria-hidden="true">
          Старт → финиш за {target} {target === 1 ? "деление" : target < 5 ? "деления" : "делений"}
        </p>
      )}
      <div className="race__grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, rowsPerColumn)}, minmax(0, 7.4cqh))` }}>
      {shown.map(({ id, e, race }) => {
        const current = buzz?.current === id;
        const out = (buzz?.out ?? []).includes(id);
        const winner = buzz?.winner === id;
        const place = queue.indexOf(id);
        const style = { "--team-color": teamColorVar(e.colorIndex) } as CSSProperties;
        let status: string;
        if (winner) status = "Верно!";
        else if (current) status = "Отвечает";
        else if (out) status = "Мимо ✕";
        else if (place === 1 || (place === 0 && !buzz?.current)) status = "Следующий";
        else if (race >= target) status = "Финиш!";
        else status = columns === 1 ? `${race} / ${target}` : `${race}/${target}`;
        const cls = ["race__lane", current ? "is-current" : "", out ? "is-out" : "", winner ? "is-winner" : "", race >= target ? "is-finished" : ""].join(" ");
        return (
          <div key={id} className={cls} role="listitem" style={e.colorIndex !== undefined ? style : undefined}>
            <span className="race__name">
              <NameText name={e.name} />
            </span>
            <span className="race__track" style={{ gridTemplateColumns: `repeat(${target}, minmax(0, 1fr))` }}>
              {Array.from({ length: target }, (_, i) => (
                <i key={i} className={i < race ? "is-on" : undefined} />
              ))}
            </span>
            <span className="race__flag" aria-hidden="true" />
            <span className="race__status">{status}</span>
          </div>
        );
      })}
      </div>
      {hidden > 0 && <p className="race__more">и ещё {hidden}</p>}
    </div>
  );
}
