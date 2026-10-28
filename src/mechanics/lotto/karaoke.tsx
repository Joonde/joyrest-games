// Караоке-строки музыкального лото (решение владельца 27 октября 2026): текст песни, который ведущий вставил и
// разметил в конструкторе. Текущая строка крупно, слова заливаются цветом в такт (равномерно по времени строки),
// следующая — бледно ниже. Перед первой строкой — отсчёт «3 · 2 · 1». Один и тот же вид — на экране зала и в
// проверке в конструкторе.
import type { CSSProperties } from "react";
import { lyricIndex } from "./content";

/** Сколько секунд до строки показываем отсчёт. */
const COUNTDOWN = 3;

export interface KaraokeProps {
  lyrics: string[];
  times: number[];
  /** Секунда трека сейчас; null — песня не играет. */
  t: number | null;
  className?: string;
}

/** Доля строки, которая уже спета: от её начала до начала следующей (последняя — 4 с). */
export function lineProgress(times: number[], index: number, t: number): number {
  const start = times[index];
  if (start === undefined) return 0;
  const end = times[index + 1] ?? start + 4;
  if (end <= start) return 1;
  return Math.max(0, Math.min(1, (t - start) / (end - start)));
}

export function KaraokeLines({ lyrics, times, t, className }: KaraokeProps) {
  const now = t ?? -1;
  const index = lyricIndex(times, now);
  const first = times[0];
  const current = index >= 0 ? lyrics[index] : undefined;
  const nextIndex = index + 1;
  const next = nextIndex < times.length ? lyrics[nextIndex] : undefined;
  const progress = index >= 0 ? lineProgress(times, index, now) : 0;
  const waitFirst = index < 0 && first !== undefined && t !== null ? first - now : null;
  const count = waitFirst !== null && waitFirst <= COUNTDOWN && waitFirst > 0 ? Math.ceil(waitFirst) : null;
  return (
    <div className={`karaoke${className ? ` ${className}` : ""}`} aria-live="off">
      {count !== null ? (
        <p className="karaoke__count" aria-label={`Через ${count}`}>
          {[3, 2, 1].map((n) => (
            <span key={n} className={n === count ? "is-on" : n > count ? "is-past" : ""}>
              {n}
            </span>
          ))}
        </p>
      ) : (
        <p className="karaoke__count karaoke__count--empty" aria-hidden="true" />
      )}
      <p className="karaoke__now" key={index} style={{ "--k": progress } as CSSProperties}>
        {current ? (
          <>
            <span className="karaoke__base">{current}</span>
            <span className="karaoke__fill" aria-hidden="true">
              {current}
            </span>
          </>
        ) : (
          <span className="karaoke__base karaoke__base--wait">{index < 0 ? (lyrics[0] ?? "") : ""}</span>
        )}
      </p>
      <p className="karaoke__next">{index < 0 ? (lyrics[1] ?? "") : (next ?? "")}</p>
    </div>
  );
}
