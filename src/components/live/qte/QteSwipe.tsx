import { useEffect, useRef, useState } from "react";
import type { QteAnswer, QteDir } from "../../../core/qte";
import { buzzPhone, useQteClock } from "./useQteClock";
import "./qte.css";

type SwipeResult = Extract<QteAnswer, { kind: "swipe" }>;

interface Props {
  /** Старт по часам этого устройства (мс). */
  goAt: number;
  /** Сколько мс даётся на уворот (`dodgeWindow`). */
  window: number;
  /** Куда смахнуть этому телефону (`arrowFor`). */
  dir: QteDir;
  /** Смахнул или нажал стрелку — ответ; не успел — null. Зовётся один раз. */
  onResult: (result: SwipeResult | null) => void;
  done?: SwipeResult | null;
}

/** Палец сдвинулся вбок хотя бы на столько px — это свайп. */
const SWIPE_PX = 40;

/**
 * Телефон гостя: «Уворот!» — у каждого своя стрелка, смахнуть в её сторону или нажать большую
 * кнопку-стрелку (свайп на iPhone иногда ловит жест «назад»). Прокрутка в зоне свайпа выключена.
 */
export function QteSwipe({ goAt, window: windowMs, dir, onResult, done = null }: Props) {
  const sent = useRef(done !== null);
  const startX = useRef<number | null>(null);
  const drain = useRef<HTMLDivElement | null>(null);
  const [mine, setMine] = useState<SwipeResult | null>(done);
  const [missed, setMissed] = useState(false);
  const { phase, digit, sinceGo } = useQteClock(goAt, windowMs, (t) => {
    if (drain.current) drain.current.style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - t / windowMs)).toFixed(4)})`;
  });

  useEffect(() => {
    if (phase === "live" && !sent.current) buzzPhone([60, 40, 60]);
    if (phase === "over" && !sent.current) {
      sent.current = true;
      setMissed(true);
      onResult(null);
    }
    // onResult — колбэк родителя: его смена не должна повторять отправку, поэтому только phase.
  }, [phase]);

  function act(chosen: QteDir) {
    if (sent.current || phase !== "live") return;
    sent.current = true;
    const result: SwipeResult = { kind: "swipe", dir: chosen, ms: Math.max(0, Math.round(sinceGo())) };
    setMine(result);
    onResult(result);
  }

  const ok = mine ? mine.dir === dir : false;
  const state = mine ? (ok ? "is-done is-good" : "is-done is-weak") : missed ? "is-done is-weak" : phase === "live" ? "is-live" : "is-wait";
  const arrow = dir === "left" ? "←" : "→";

  return (
    <div className={`qte qte--swipe ${state}`}>
      <div className="qte__eyebrow">Атака дракона</div>
      <div
        className="qte-swipe"
        onPointerDown={(e) => {
          startX.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (startX.current === null) return;
          const dx = e.clientX - startX.current;
          startX.current = null;
          if (Math.abs(dx) >= SWIPE_PX) act(dx < 0 ? "left" : "right");
        }}
        onPointerCancel={() => {
          startX.current = null;
        }}
        role="group"
        aria-label={`Уворот: смахните ${dir === "left" ? "влево" : "вправо"}`}
      >
        {phase === "wait" ? (
          <span className="qte-swipe__digit">{digit}</span>
        ) : (
          <span className={`qte-swipe__arrow qte-swipe__arrow--${dir}`} aria-hidden="true">
            {arrow}
          </span>
        )}
        <div className="qte-swipe__drain" aria-hidden="true">
          <div ref={drain} />
        </div>
      </div>
      <div className="qte-swipe__buttons">
        <button type="button" className="qte-swipe__btn" disabled={sent.current || phase !== "live"} onClick={() => act("left")} aria-label="Влево">
          ←
        </button>
        <button type="button" className="qte-swipe__btn" disabled={sent.current || phase !== "live"} onClick={() => act("right")} aria-label="Вправо">
          →
        </button>
      </div>
      <div className="qte__plate" role="status" aria-live="assertive">
        {mine ? (
          ok ? (
            <>
              <strong className="qte__grade qte__grade--good">Увернулись!</strong>
              <span>За {(mine.ms / 1000).toFixed(1).replace(".", ",")} с. Ждём остальных из команды</span>
            </>
          ) : (
            <>
              <strong className="qte__grade qte__grade--weak">Не в ту сторону</strong>
              <span>Команда ещё может увернуться, если успеют другие</span>
            </>
          )
        ) : missed ? (
          <>
            <strong className="qte__grade qte__grade--weak">Не успели</strong>
            <span>Команда ещё может увернуться, если успеют другие</span>
          </>
        ) : phase === "wait" ? (
          <>
            <strong>Сейчас ударит лучом!</strong>
            <span>Появится стрелка — смахните в её сторону или нажмите её внизу</span>
          </>
        ) : (
          <>
            <strong>Смахните {dir === "left" ? "влево" : "вправо"}!</strong>
            <span>Или нажмите стрелку внизу</span>
          </>
        )}
      </div>
    </div>
  );
}
