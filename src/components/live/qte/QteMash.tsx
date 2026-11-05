import { useEffect, useRef, useState } from "react";
import { QTE_MASH_MAX, QTE_MASH_MS, type QteAnswer } from "../../../core/qte";
import { buzzPhone, useQteClock } from "./useQteClock";
import "./qte.css";

type MashResult = Extract<QteAnswer, { kind: "mash" }>;

interface Props {
  /** Старт по часам этого устройства (мс). */
  goAt: number;
  /** Сколько длится добивание (мс). */
  duration?: number;
  /** Время вышло — сколько раз нажал (один ответ на всё добивание). Зовётся один раз. */
  onResult: (result: MashResult) => void;
  done?: MashResult | null;
}

/**
 * Телефон гостя: «Добивание!» — 10 секунд жать «БЕЙ!». Нажатия считает телефон, на сервер уходит
 * одно число в конце (не каждое нажатие). Считается касание, а не отпускание: можно бить двумя
 * пальцами. Двойное касание не увеличивает страницу (`touch-action: manipulation`).
 */
export function QteMash({ goAt, duration = QTE_MASH_MS, onResult, done = null }: Props) {
  const sent = useRef(done !== null);
  const taps = useRef(done?.taps ?? 0);
  const left = useRef<HTMLSpanElement | null>(null);
  const [count, setCount] = useState(done?.taps ?? 0);
  const [finished, setFinished] = useState(done !== null);
  const { phase, digit, sinceGo } = useQteClock(goAt, duration, (t) => {
    if (left.current && t >= 0) left.current.textContent = Math.max(0, Math.ceil((duration - t) / 1000)).toString();
  });

  useEffect(() => {
    if (phase === "live" && !sent.current) buzzPhone();
    if (phase === "over" && !sent.current) {
      sent.current = true;
      setFinished(true);
      onResult({ kind: "mash", taps: Math.min(QTE_MASH_MAX, taps.current) });
    }
    // onResult — колбэк родителя: его смена не должна повторять отправку, поэтому только phase.
  }, [phase]);

  function hit() {
    if (sent.current || phase !== "live") return;
    const t = sinceGo();
    if (t < 0 || t > duration) return;
    taps.current += 1;
    setCount(taps.current);
  }

  const state = finished ? "is-done is-good" : phase === "live" ? "is-live" : "is-wait";

  return (
    <div className={`qte qte--mash ${state}`}>
      <div className="qte__eyebrow">Добивание</div>
      <div className="qte-mash__time">
        {phase === "wait" ? `Через ${digit}…` : finished ? "Время вышло" : (
          <>
            <span ref={left}>{Math.ceil(duration / 1000)}</span> с
          </>
        )}
      </div>
      <button
        type="button"
        className="qte-mash__btn"
        onPointerDown={(e) => {
          e.preventDefault();
          hit();
        }}
        disabled={finished || phase !== "live"}
      >
        {phase === "wait" ? digit : "БЕЙ!"}
      </button>
      <div className="qte__plate" role="status">
        <strong className="qte-mash__count">
          Ваши удары: <b>{count}</b>
        </strong>
        <span>{finished ? "Удары ушли команде — смотрите на экран" : phase === "live" ? "Жмите как можно быстрее, можно двумя пальцами" : "Жмите «БЕЙ!», как только загорится"}</span>
      </div>
    </div>
  );
}
