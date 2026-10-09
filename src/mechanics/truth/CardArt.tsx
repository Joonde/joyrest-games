// Дизайнерские карты «Правды или действия» (решение владельца 8 октября 2026: рубашка с разрезом,
// на лице — эмблема водяным знаком). Рубашка — диагональный разрез: «Правда» (винная, сверху
// слева) и «Действие» (золотая, снизу справа), по центру разреза — медальон с эмблемой JoyRest. На
// телефоне игрока половины рубашки — кнопки выбора. Лицевые стороны — рамка с вензелями, уголки как у
// игральных карт, знак вида и текст. Анимации — только transform/opacity, при «уменьшить движение» стоят.
import { useId } from "react";
import { Logo } from "../../components/Logo";
import { NameText } from "../../components/NameText";
import { KIND_TITLES, type TruthKind } from "./content";

/** Знак вида: «Правда» — сердце с замочной скважиной, «Действие» — молния. */
export function KindMark({ kind, className = "td-mark" }: { kind: TruthKind; className?: string }) {
  return kind === "truth" ? (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 56 C13 43 5 32 5 21 C5 12 12 6 20 6 C25 6 29 9 32 13 C35 9 39 6 44 6 C52 6 59 12 59 21 C59 32 51 43 32 56 Z" fill="currentColor" />
      <circle cx="32" cy="25" r="5.5" fill="var(--td-hole)" />
      <path d="M29.6 28 h4.8 l1.8 11 h-8.4 Z" fill="var(--td-hole)" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M38 3 L11 37 H29 L23 61 L53 24 H34 Z" fill="currentColor" />
    </svg>
  );
}

/** Кайма по краю карты: повторяющаяся монограмма J✦R в цветах палитры JoyRest. */
function Band() {
  return (
    <span className="td-band" aria-hidden="true">
      <span className="td-band__strip td-band__strip--top" />
      <span className="td-band__strip td-band__strip--bottom" />
      <span className="td-band__strip td-band__strip--left" />
      <span className="td-band__strip td-band__strip--right" />
    </span>
  );
}

/**
 * Рубашка с диагональным разрезом. `onPick` — половины становятся кнопками (телефон того, чья очередь).
 * `chosen` — выбранная половина приподнимается.
 */
export function SplitBack({ size = "screen", onPick, disabled = false, chosen = null }: { size?: "screen" | "phone" | "mini"; onPick?: (kind: TruthKind) => void; disabled?: boolean; chosen?: TruthKind | null }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const half = (kind: TruthKind) => {
    const inner = (
      <>
        <span className="td-back__pattern" aria-hidden="true" />
        <span className="td-back__label">
          <KindMark kind={kind} className="td-back__icon" />
          <span className="td-back__word">{KIND_TITLES[kind]}</span>
        </span>
      </>
    );
    const cls = `td-back__half td-back__half--${kind}${chosen === kind ? " is-chosen" : ""}${chosen && chosen !== kind ? " is-dim" : ""}`;
    return onPick ? (
      <button key={kind} type="button" className={cls} disabled={disabled} onClick={() => onPick(kind)} aria-label={`Выбрать: ${KIND_TITLES[kind]}`}>
        {inner}
      </button>
    ) : (
      <span key={kind} className={cls}>
        {inner}
      </span>
    );
  };
  return (
    <div className={`td-back td-back--${size}${onPick ? " is-pickable" : ""}`}>
      {half("truth")}
      {half("dare")}
      <svg className="td-back__seam" viewBox="0 0 200 300" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`seam-${uid}`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff6dc" />
            <stop offset="0.5" stopColor="#e3c68c" />
            <stop offset="1" stopColor="#fff6dc" />
          </linearGradient>
        </defs>
        <line x1="200" y1="0" x2="0" y2="300" stroke={`url(#seam-${uid})`} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <line className="td-back__spark" x1="200" y1="0" x2="0" y2="300" stroke="#fffaf0" strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength="100" strokeDasharray="6 94" />
      </svg>
      <Band />
      <span className="td-back__frame" aria-hidden="true" />
      <span className="td-back__medal" aria-hidden="true">
        <span className="td-back__ring" />
        <Logo kind="emblem" tone="gold" title="" className="td-back__emblem" />
      </span>
      <span className="td-back__sheen" aria-hidden="true" />
    </div>
  );
}

/** Лицевая сторона: кайма с монограммами, эмблема водяным знаком под текстом, уголки, вид, текст. */
export function CardFace({ kind, text, from, size = "screen", stamp = null }: { kind: TruthKind; text: string; from?: string | null; size?: "screen" | "phone"; stamp?: "done" | "refused" | null }) {
  return (
    <div className={`td-face td-face--${kind} td-face--${size}`}>
      <Band />
      <span className="td-face__frame" aria-hidden="true" />
      <span className="td-watermark" aria-hidden="true">
        <Logo kind="emblem" tone={kind === "truth" ? "gold" : "dark"} title="" />
      </span>
      <span className="td-face__corner td-face__corner--tl" aria-hidden="true">
        <KindMark kind={kind} className="td-face__corner-icon" />
      </span>
      <span className="td-face__corner td-face__corner--br" aria-hidden="true">
        <KindMark kind={kind} className="td-face__corner-icon" />
      </span>
      <span className="td-face__head">
        <span className="td-face__kind">{KIND_TITLES[kind]}</span>
      </span>
      <p className="td-face__text">{text}</p>
      {from && (
        <span className="td-face__from">
          от гостя: <NameText name={from} />
        </span>
      )}
      {stamp && <span className={`td-stamp td-stamp--${stamp}`}>{stamp === "done" ? "Выполнено!" : "Отказ"}</span>}
    </div>
  );
}
