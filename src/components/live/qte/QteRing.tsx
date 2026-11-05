import { useEffect, useRef, useState, type CSSProperties } from "react";
import { QTE_GRADE_TITLES, QTE_RING_TRAVEL_MS, gradeOf, ringAccuracy, ringScale, type QteAnswer } from "../../../core/qte";
import { buzzPhone, useQteClock } from "./useQteClock";
import "./qte.css";

type RingResult = Extract<QteAnswer, { kind: "ring" }>;

interface Props {
  /** Старт по часам этого устройства (мс). */
  goAt: number;
  /** Полуширина зоны «Хорошо» (мс), `ringHalfWindow`. */
  half: number;
  /** Нажал — точность и ошибка; не нажал до конца — null. Зовётся один раз. */
  onResult: (result: RingResult | null) => void;
  /** Уже отправленный ответ (после перезагрузки телефона). */
  done?: RingResult | null;
  /** Что сейчас делает герой: «Удар катаной». */
  title?: string;
}

/** Ошибка нажатия словами: «точно в золото», «на 0,12 с раньше». */
export function missText(ms: number | null): string {
  if (ms === null) return "не успели нажать";
  if (Math.abs(ms) < 15) return "точно в золото";
  const s = (Math.abs(ms) / 1000).toFixed(2).replace(".", ",");
  return ms < 0 ? `на ${s} с раньше` : `на ${s} с позже`;
}

/**
 * Телефон гостя: кольцо сжимается к золотой зоне — нажать, когда оно в золоте. Реакция меряется
 * здесь же, от старта на этом телефоне (`useQteClock`). До старта — отсчёт, нажатия не считаются.
 */
export function QteRing({ goAt, half, onResult, done = null, title = "Удар" }: Props) {
  const moving = useRef<HTMLDivElement | null>(null);
  const sent = useRef(done !== null);
  const [mine, setMine] = useState<RingResult | null>(done);
  const [missed, setMissed] = useState(false);
  const liveMs = QTE_RING_TRAVEL_MS + 2 * half;
  const { phase, digit, sinceGo } = useQteClock(goAt, liveMs, (t) => {
    if (moving.current) moving.current.style.transform = `scale(${ringScale(t).toFixed(4)})`;
  });

  useEffect(() => {
    if (phase === "live" && !sent.current) buzzPhone();
    if (phase === "over" && !sent.current) {
      sent.current = true;
      setMissed(true);
      onResult(null);
    }
    // onResult — колбэк родителя: его смена не должна повторять отправку, поэтому только phase.
  }, [phase]);

  function press() {
    if (sent.current || phase !== "live") return;
    sent.current = true;
    const ms = Math.round(sinceGo() - QTE_RING_TRAVEL_MS);
    const result: RingResult = { kind: "ring", acc: ringAccuracy(ms, half), ms };
    setMine(result);
    onResult(result);
  }

  const grade = mine ? gradeOf(mine.acc) : null;
  const state = mine ? `is-done is-${grade}` : missed ? "is-done is-weak" : phase === "live" ? "is-live" : "is-wait";
  // Золотая зона: где будет кольцо за half мс до золота и через half мс после (радиус золота — 40% круга).
  const z = (half / QTE_RING_TRAVEL_MS) * (ringScale(0) - 1);
  const zoneVars = { "--zone-in": `${(40 * (1 - z)).toFixed(1)}%`, "--zone-out": `${(40 * (1 + z)).toFixed(1)}%` } as CSSProperties;

  return (
    <div className={`qte qte--ring ${state}`}>
      <div className="qte__eyebrow">{title}</div>
      <button
        type="button"
        className="qte-ring"
        onPointerDown={(e) => {
          e.preventDefault();
          press();
        }}
        disabled={sent.current || phase !== "live"}
        aria-label="Нажмите, когда кольцо в золотой зоне"
      >
        <span className="qte-ring__zone" style={zoneVars} aria-hidden="true" />
        <span className="qte-ring__gold" aria-hidden="true" />
        <div ref={moving} className="qte-ring__move" aria-hidden="true" />
        <span className="qte-ring__label">{phase === "wait" ? digit : ""}</span>
      </button>
      <div className="qte__plate" role="status" aria-live="assertive">
        {mine ? (
          <>
            <strong className={`qte__grade qte__grade--${grade}`}>{grade ? QTE_GRADE_TITLES[grade] : ""}!</strong>
            <span>
              Точность {mine.acc}% · {missText(mine.ms)}
            </span>
          </>
        ) : missed ? (
          <>
            <strong className="qte__grade qte__grade--weak">Не успели</strong>
            <span>Удар всё равно будет — слабый</span>
          </>
        ) : phase === "wait" ? (
          <>
            <strong>Приготовьтесь</strong>
            <span>Жмите, когда белое кольцо войдёт в золотую зону</span>
          </>
        ) : (
          <>
            <strong>Жмите в золото!</strong>
            <span>Касание в любом месте круга</span>
          </>
        )}
      </div>
    </div>
  );
}
