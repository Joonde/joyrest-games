/** Общие части календаря и планировщика: время, месяц, плашки. */
import { useRef, type CSSProperties, type ReactNode } from "react";
import { addDays, DAY_MINUTES, dayTitle, endAfter, monthGrid, monthTitle, timeLabel, TIME_OPTIONS, WEEK_SHORT } from "../../core/calendar";
import type { LoadState } from "../../data";

/** id записи создаёт браузер: повтор после обрыва — та же запись. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "c" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}


/** Подпись времени в списке: «02:00 (след. день)» для конца после полуночи. */
function endOptionLabel(start: number, value: number): string {
  return endAfter(start, value) > DAY_MINUTES ? `${timeLabel(value)} (след. день)` : timeLabel(value);
}

export function TimeSelects({ start, end, onChange, disabled }: { start: number; end: number; onChange: (start: number, end: number) => void; disabled?: boolean }) {
  // В списке «до» — время дня; меньше «с» — значит после полуночи.
  const endValue = end % DAY_MINUTES;
  return (
    <div className="cal-times">
      <label className="field">
        <span className="field__label">С</span>
        <select value={start} aria-label="С" disabled={disabled} onChange={(e) => {
          const s = Number(e.target.value);
          onChange(s, endAfter(s, endValue));
        }}>
          {TIME_OPTIONS.map((t) => (
            <option key={t} value={t}>{timeLabel(t)}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">До</span>
        <select value={endValue} aria-label="До" disabled={disabled} onChange={(e) => onChange(start, Math.min(endAfter(start, Number(e.target.value)), DAY_MINUTES + 6 * 60))}>
          {TIME_OPTIONS.map((t) => (
            <option key={t} value={t} disabled={endAfter(start, t) > DAY_MINUTES + 6 * 60}>
              {endOptionLabel(start, t)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function Pill({ color, children }: { color: string; children: string }) {
  return (
    <span className="status-pill" style={{ "--status-color": color } as CSSProperties}>
      {children}
    </span>
  );
}

/** Последние загруженные данные: пока грузится другой месяц, экран показывает прежние, а не заглушку. */
export function useLastReady<T>(state: LoadState<T>): T | null {
  const last = useRef<T | null>(null);
  if (state.status === "ready") last.current = state.data;
  return last.current;
}

/** Месяц для загрузки: с первого по последнее число (сервер добавит прошлый день сам). */
export function monthRange(day: string): { from: string; to: string; year: number; month: number } {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const from = `${day.slice(0, 7)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Ночь последнего дня месяца задевает первое число следующего.
  return { from, to: addDays(`${day.slice(0, 7)}-${String(last).padStart(2, "0")}`, 1), year, month };
}

export function shiftMonth(day: string, delta: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(year, month, 1));
  return d.toISOString().slice(0, 10);
}



// ───────────────────────────── Сетка месяца ─────────────────────────────

export function MonthHeader({ year, month, onPrev, onNext }: { year: number; month: number; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="cal-month">
      <button type="button" className="btn btn--quiet" aria-label="Прошлый месяц" onClick={onPrev}>
        ←
      </button>
      <span className="cal-month__title">{monthTitle(year, month)}</span>
      <button type="button" className="btn btn--quiet" aria-label="Следующий месяц" onClick={onNext}>
        →
      </button>
    </div>
  );
}

export function MonthGrid({
  year,
  month,
  selected,
  today,
  render,
  onPick,
}: {
  year: number;
  month: number;
  selected: string;
  today?: string;
  render: (day: string) => ReactNode;
  onPick: (day: string) => void;
}) {
  const cells = monthGrid(year, month);
  return (
    <div className="cal-grid" role="grid" aria-label={monthTitle(year, month)}>
      {WEEK_SHORT.map((w) => (
        <span key={w} className="cal-grid__week" role="columnheader">
          {w}
        </span>
      ))}
      {cells.map((d, i) =>
        d ? (
          <button
            key={d}
            type="button"
            className={`cal-day${d === selected ? " is-selected" : ""}${d === today ? " is-today" : ""}`}
            aria-pressed={d === selected}
            aria-label={dayTitle(d)}
            onClick={() => onPick(d)}
          >
            <span className="cal-day__n">{Number(d.slice(8, 10))}</span>
            {render(d)}
          </button>
        ) : (
          <span key={`e${i}`} className="cal-day cal-day--empty" />
        ),
      )}
    </div>
  );
}
