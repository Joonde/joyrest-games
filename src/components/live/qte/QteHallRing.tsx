import { useRef, type CSSProperties } from "react";
import { QTE_RING_TRAVEL_MS, ringScale } from "../../../core/qte";
import { useQteClock } from "./useQteClock";
import "./qte.css";

interface Props {
  /** Старт по часам этого устройства (мс): экран зала берёт часы сервера минус смещение. */
  goAt: number;
  /** Полуширина зоны «Хорошо» (мс) — на экране зала самая широкая из команд, только для вида. */
  half: number;
  /** Подпись под кольцом. */
  caption?: string;
}

/**
 * Экран зала: то же кольцо, что на телефонах, в тот же момент (общий старт по часам сервера) —
 * зал видит, когда жать. Размер — от контейнера (`cqw`), как остальной экран зала.
 */
export function QteHallRing({ goAt, half, caption = "Жмите в золото" }: Props) {
  const moving = useRef<HTMLDivElement | null>(null);
  const { phase, digit } = useQteClock(goAt, QTE_RING_TRAVEL_MS + 2 * half + 600, (t) => {
    if (moving.current) moving.current.style.transform = `scale(${ringScale(t).toFixed(4)})`;
  });
  const z = (half / QTE_RING_TRAVEL_MS) * (ringScale(0) - 1);
  const zoneVars = { "--zone-in": `${(40 * (1 - z)).toFixed(1)}%`, "--zone-out": `${(40 * (1 + z)).toFixed(1)}%` } as CSSProperties;
  return (
    <div className={`qte-hall is-${phase}`} aria-hidden="true">
      <div className="qte-hall__ring">
        <span className="qte-ring__zone" style={zoneVars} />
        <span className="qte-ring__gold" />
        <div ref={moving} className="qte-ring__move" />
        <span className="qte-hall__digit">{phase === "wait" ? digit : ""}</span>
      </div>
      <div className="qte-hall__caption">{phase === "wait" ? "Приготовьтесь…" : phase === "live" ? caption : "Удар!"}</div>
    </div>
  );
}
