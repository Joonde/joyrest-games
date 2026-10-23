import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { TimerLook } from "../../themes/types";
import "./hallTimer.css";

/**
 * Таймер экрана зала под тему вечера (решение владельца 23 октября 2026, макет «Таймеры под темы»).
 * Только вид: сколько осталось (`left`) и сколько было (`total`) считает игра, как раньше, — таймер ничего не отсчитывает сам.
 * Вид берётся из темы (`effects.timer` → CSS-переменная `--timer-look`): кольцо JoyRest, песочные часы «Гэтсби», свеча
 * «Свадьбы», неон «Диско», гирлянда «Нового года». Крупные цифры есть у всех видов.
 */
export type { TimerLook };

export const TIMER_LOOKS: readonly TimerLook[] = ["ring", "hourglass", "candle", "neon", "garland"];

export function parseTimerLook(value: string | null | undefined): TimerLook {
  const v = (value ?? "").trim();
  return (TIMER_LOOKS as readonly string[]).includes(v) ? (v as TimerLook) : "ring";
}

/** Доля оставшегося времени 0…1; не начат — полный, без длительности — по нулю. */
export function timerFraction(left: number | null, total: number | null): number {
  if (left === null) return 1;
  if (!total || total <= 0) return left > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, left / total));
}

/** Последние секунды — тревога (не дольше трети отсчёта, чтобы короткий таймер не горел красным с начала). */
export function timerUrgent(left: number | null, total: number | null): boolean {
  if (left === null || left <= 0) return false;
  const limit = total && total > 0 ? Math.min(10, Math.max(3, Math.floor(total / 3))) : 10;
  return left <= limit;
}

/**
 * Длительность отсчёта, когда игра хранит только время конца (речь, обсуждение): самое большое «осталось»,
 * увиденное для этого отсчёта (`key` — время конца). Открыли экран посреди речи — кольцо полное с этой минуты.
 */
export function useCountdownTotal(key: string | number | null, left: number | null): number | null {
  const seen = useRef<{ key: string | number | null; max: number }>({ key: null, max: 0 });
  if (key === null || left === null) return null;
  if (seen.current.key !== key) seen.current = { key, max: left };
  else if (left > seen.current.max) seen.current.max = left;
  return seen.current.max;
}

export interface HallTimerProps {
  /** Осталось секунд (целое); null — отсчёт ещё не идёт. */
  left: number | null;
  /** Всего секунд на отсчёт. */
  total: number | null;
  /** Высота таймера (CSS-длина), по умолчанию 12cqh — как плашка в верхней строке экрана. */
  size?: string;
  /** Что писать, когда время вышло. */
  stopText?: string;
  className?: string;
  /** Вид без темы — только для макетов и тестов. */
  look?: TimerLook;
}

function useThemeLook(ref: React.RefObject<HTMLElement | null>, forced?: TimerLook): TimerLook {
  const [look, setLook] = useState<TimerLook>(forced ?? "ring");
  useLayoutEffect(() => {
    if (forced) {
      if (look !== forced) setLook(forced);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const next = parseTimerLook(getComputedStyle(el).getPropertyValue("--timer-look"));
    if (next !== look) setLook(next);
  });
  return look;
}

const pad = (n: number) => n.toFixed(2);

/** Секунды цифрами: до минуты — «45», дольше — «1:05». */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? String(s) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function polar(r: number, deg: number, cx = 110, cy = 110): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

const RING_TICKS = Array.from({ length: 60 }, (_, i) => {
  const major = i % 5 === 0;
  const [x1, y1] = polar(major ? 84 : 89, i * 6);
  const [x2, y2] = polar(96, i * 6);
  return { i, major, d: `M${pad(x1)} ${pad(y1)}L${pad(x2)} ${pad(y2)}` };
});

const NEON_SEGMENTS = Array.from({ length: 30 }, (_, i) => {
  const k = i / 29;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * k);
  return { i, color: `rgb(${mix(255, 58)},${mix(79, 240)},${mix(216, 255)})` };
});

const GARLAND_COLORS = ["#FF6B6B", "#FFD166", "#7CDB8A", "#6EC6FF", "#C79BFF"];
const GARLAND_BULBS = Array.from({ length: 20 }, (_, i) => {
  const deg = i * 18;
  const [x, y] = polar(141, deg, 160, 160);
  const [cx, cy] = polar(129, deg, 160, 160);
  return { i, deg, x, y, cx, cy, color: GARLAND_COLORS[i % GARLAND_COLORS.length] };
});
const GARLAND_WIRE = (() => {
  let d = "";
  for (let i = 0; i <= 20; i++) {
    const [x, y] = polar(132, i * 18, 160, 160);
    if (i === 0) {
      d = `M${pad(x)} ${pad(y)}`;
      continue;
    }
    const [qx, qy] = polar(120, (i - 0.5) * 18, 160, 160);
    d += ` Q${pad(qx)} ${pad(qy)} ${pad(x)} ${pad(y)}`;
  }
  return d;
})();

export function HallTimer({ left, total, size = "12cqh", stopText = "Стоп", className, look: forced }: HallTimerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const look = useThemeLook(ref, forced);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const frac = timerFraction(left, total);
  const urgent = timerUrgent(left, total);
  const over = left === 0;
  const digits = left === null ? clockText(total ?? 0) : over ? stopText : clockText(left);

  // Песочные часы переворачиваются, когда отсчёт начался заново (новый вопрос, «+10 секунд» — нет: доля растёт мало).
  const prevFrac = useRef(frac);
  const [flip, setFlip] = useState(0);
  useEffect(() => {
    if (frac - prevFrac.current > 0.35) setFlip((n) => n + 1);
    prevFrac.current = frac;
  }, [frac]);

  const classes = ["hall-timer", `hall-timer--${look}`, urgent ? "is-urgent" : "", over ? "is-over" : "", className ?? ""].filter(Boolean).join(" ");
  const style = { "--ht-size": size } as CSSProperties;
  const label = left === null ? `На ответ ${total ?? ""} секунд` : over ? "Время вышло" : `Осталось ${left} секунд`;

  return (
    <span ref={ref} className={classes} style={style} role="timer" aria-label={label}>
      {look === "ring" && <Ring uid={uid} frac={frac} />}
      {look === "hourglass" && <Hourglass uid={uid} frac={frac} running={left !== null && left > 0 && frac < 1} flip={flip} />}
      {look === "candle" && <Candle uid={uid} frac={frac} lit={!over} />}
      {look === "neon" && <Neon frac={frac} />}
      {look === "garland" && <Garland frac={frac} />}
      <span className={over ? "hall-timer__digits hall-timer__digits--stop" : digits.length > 2 ? "hall-timer__digits hall-timer__digits--long" : "hall-timer__digits"} aria-hidden="true">
        {digits}
      </span>
    </span>
  );
}

function Ring({ uid, frac }: { uid: string; frac: number }) {
  const lit = Math.ceil(frac * 60 - 0.0001);
  const C = 464.96;
  return (
    <svg className="hall-timer__art" viewBox="0 0 220 220" aria-hidden="true">
      <defs>
        <radialGradient id={`${uid}face`} cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stopColor="var(--color-surface-alt)" />
          <stop offset="1" stopColor="var(--color-bg)" />
        </radialGradient>
      </defs>
      <circle cx="110" cy="110" r="107" fill="none" className="ht-ring__bezel-thin" />
      <circle cx="110" cy="110" r="103" fill={`url(#${uid}face)`} className="ht-ring__bezel" />
      {RING_TICKS.map((t) => (
        <path key={t.i} d={t.d} className={`ht-ring__tick${t.major ? " is-major" : ""}${t.i < lit ? " is-lit" : ""}`} />
      ))}
      <circle cx="110" cy="110" r="74" fill="none" className="ht-ring__track" />
      <circle
        cx="110"
        cy="110"
        r="74"
        fill="none"
        className="ht-ring__arc"
        strokeDasharray={C}
        style={{ strokeDashoffset: C * (1 - frac) }}
        transform="rotate(-90 110 110)"
      />
      <circle cx="110" cy="110" r="63" fill="none" className="ht-ring__inner" />
      <g className="ht-ring__head" style={{ transform: `rotate(${360 * frac}deg)`, opacity: frac > 0.01 ? 1 : 0 }}>
        <circle cx="122" cy="36.6" r="1.6" className="ht-ring__trail" opacity="0.25" />
        <circle cx="118" cy="36.2" r="2.2" className="ht-ring__trail" opacity="0.4" />
        <circle cx="114" cy="36" r="2.8" className="ht-ring__trail" opacity="0.6" />
        <circle cx="110" cy="36" r="4.6" className="ht-ring__comet" />
      </g>
      <path d="M110 4 L113 11 L110 18 L107 11 Z" className="ht-ring__marker" />
    </svg>
  );
}

function Hourglass({ uid, frac, running, flip }: { uid: string; frac: number; running: boolean; flip: number }) {
  return (
    <svg className="hall-timer__art" viewBox="0 0 200 270" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}wood`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9A6A3C" />
          <stop offset="0.45" stopColor="#6E4524" />
          <stop offset="1" stopColor="#3E2614" />
        </linearGradient>
        <linearGradient id={`${uid}brass`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6E5424" />
          <stop offset="0.35" stopColor="#E9CF93" />
          <stop offset="0.55" stopColor="#FFF1C9" />
          <stop offset="0.8" stopColor="#B8924E" />
          <stop offset="1" stopColor="#5E4620" />
        </linearGradient>
        <linearGradient id={`${uid}glass`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.16" />
          <stop offset="0.3" stopColor="#FFFFFF" stopOpacity="0.03" />
          <stop offset="0.75" stopColor="#FFFFFF" stopOpacity="0.02" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.14" />
        </linearGradient>
        <linearGradient id={`${uid}sand`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#B57E3E" />
          <stop offset="0.45" stopColor="#F2D49A" />
          <stop offset="1" stopColor="#C08844" />
        </linearGradient>
        <pattern id={`${uid}grain`} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.55" fill="#7A4E22" opacity="0.55" />
          <circle cx="4" cy="3.5" r="0.5" fill="#FFF0C8" opacity="0.6" />
          <circle cx="2.5" cy="5" r="0.45" fill="#8A5A2A" opacity="0.5" />
        </pattern>
        <clipPath id={`${uid}top`}>
          <path d="M60 40 C60 98 96 120 100 142 C104 120 140 98 140 40 Z" />
        </clipPath>
        <clipPath id={`${uid}bot`}>
          <path d="M100 142 C96 164 60 186 60 244 L140 244 C140 186 104 164 100 142 Z" />
        </clipPath>
      </defs>
      <ellipse cx="100" cy="263" rx="78" ry="6" className="ht-glass__shadow" />
      <g key={flip} className={flip > 0 ? "ht-glass__body is-flipping" : "ht-glass__body"}>
        <g clipPath={`url(#${uid}top)`}>
          <g className="ht-glass__top" style={{ transform: `scaleY(${frac})` }}>
            <rect x="60" y="56" width="80" height="90" fill={`url(#${uid}sand)`} />
            <rect x="60" y="56" width="80" height="90" fill={`url(#${uid}grain)`} />
            <ellipse cx="100" cy="56" rx="34" ry="4" fill="#F7DFAE" />
          </g>
        </g>
        <g clipPath={`url(#${uid}bot)`}>
          <g className="ht-glass__pile" style={{ transform: `scaleY(${1 - frac})` }}>
            <path d="M58 246 L58 178 Q78 174 100 158 Q122 174 142 178 L142 246 Z" fill={`url(#${uid}sand)`} />
            <path d="M58 246 L58 178 Q78 174 100 158 Q122 174 142 178 L142 246 Z" fill={`url(#${uid}grain)`} />
          </g>
        </g>
        {running && <line x1="100" y1="140" x2="100" y2="236" className="ht-glass__stream" />}
        <path
          d="M58 38 C58 98 95 120 98 142 C95 164 58 186 58 246 L142 246 C142 186 105 164 102 142 C105 120 142 98 142 38 Z"
          fill={`url(#${uid}glass)`}
          className="ht-glass__glass"
        />
        <path d="M66 46 C66 86 80 106 91 124" className="ht-glass__shine" strokeWidth="3" opacity="0.28" />
        <path d="M70 50 C70 74 76 88 82 98" className="ht-glass__shine" strokeWidth="1.2" opacity="0.5" />
        <path d="M66 238 C66 204 79 184 91 162" className="ht-glass__shine" strokeWidth="3" opacity="0.22" />
        {[34, 156].map((x) => (
          <path
            key={x}
            transform={`translate(${x} 0)`}
            d="M0 34 h10 c1 18 -4 26 0 44 c4 18 4 26 0 44 c-3 10 -3 16 0 22 c4 18 4 26 0 44 c-4 18 1 26 0 58 h-10 c-1 -32 4 -40 0 -58 c-4 -18 -4 -26 0 -44 c3 -6 3 -12 0 -22 c-4 -18 -4 -26 0 -44 c4 -18 -1 -26 0 -44 Z"
            fill={`url(#${uid}brass)`}
          />
        ))}
        <rect x="24" y="22" width="152" height="16" rx="4" fill={`url(#${uid}wood)`} />
        <rect x="28" y="34" width="144" height="3" fill={`url(#${uid}brass)`} />
        <rect x="24" y="246" width="152" height="16" rx="4" fill={`url(#${uid}wood)`} />
        <rect x="28" y="246" width="144" height="3" fill={`url(#${uid}brass)`} />
        <path d="M92 22 L100 12 L108 22 Z" fill={`url(#${uid}brass)`} />
        <path d="M92 262 L100 270 L108 262 Z" fill={`url(#${uid}brass)`} />
      </g>
    </svg>
  );
}

function Candle({ uid, frac, lit }: { uid: string; frac: number; lit: boolean }) {
  const drop = (1 - frac) * 98;
  return (
    <svg className="hall-timer__art" viewBox="0 0 200 250" aria-hidden="true">
      <defs>
        <radialGradient id={`${uid}glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFD9A0" stopOpacity="0.75" />
          <stop offset="1" stopColor="#FFD9A0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}flame`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#E9734A" />
          <stop offset="0.45" stopColor="#F5B451" />
          <stop offset="1" stopColor="#FFF1C9" />
        </linearGradient>
        <linearGradient id={`${uid}wax`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#F3E6D8" />
          <stop offset="0.5" stopColor="#FFFBF5" />
          <stop offset="1" stopColor="#EADAC8" />
        </linearGradient>
        <linearGradient id={`${uid}gold`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#A9823F" />
          <stop offset="0.4" stopColor="#F3DFAE" />
          <stop offset="0.6" stopColor="#FFF4D6" />
          <stop offset="1" stopColor="#B08A46" />
        </linearGradient>
        <linearGradient id={`${uid}ribbon`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E9C2B9" />
          <stop offset="1" stopColor="#C98F84" />
        </linearGradient>
      </defs>
      <g className="ht-candle__petals">
        <path d="M22 34 C30 26 40 30 38 40 C36 48 24 46 22 34 Z" fill="#EDC3BA" />
        <path d="M166 62 C174 56 184 60 181 69 C178 76 168 72 166 62 Z" fill="#DCC5E0" />
        <path d="M14 146 C20 140 30 143 28 151 C26 158 16 155 14 146 Z" fill="#CFDCC9" />
        <path d="M170 170 C178 163 189 167 186 176 C183 184 172 180 170 170 Z" fill="#EDC3BA" />
      </g>
      <path d="M150 36 L152 42 L158 44 L152 46 L150 52 L148 46 L142 44 L148 42 Z" className="ht-candle__spark" />
      <path d="M44 66 L45.5 70 L49.5 71.5 L45.5 73 L44 77 L42.5 73 L38.5 71.5 L42.5 70 Z" className="ht-candle__spark ht-candle__spark--2" />
      <g className="ht-candle__wax" style={{ transform: `scaleY(${(138 - drop) / 138})` }}>
        <rect x="78" y="74" width="44" height="138" rx="3" fill={`url(#${uid}wax)`} stroke="#E2CDBA" strokeWidth="1" />
        <path d="M86 96 L86 178 M91 108 L91 170" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" fill="none" />
      </g>
      <g className="ht-candle__top" style={{ transform: `translateY(${drop}px)` }}>
        <circle cx="100" cy="48" r={lit ? 46 : 0} fill={`url(#${uid}glow)`} className="ht-candle__glow" />
        <path
          d="M78 78 L122 78 L122 90 C118 96 114 86 110 88 C106 104 100 100 99 86 C94 92 86 84 84 94 C80 98 78 88 78 84 Z"
          fill="#FFFBF5"
          stroke="#E2CDBA"
          strokeWidth="1"
        />
        <ellipse cx="100" cy="74.5" rx="18" ry="3.2" fill="#F6E7D4" stroke="#E2CDBA" strokeWidth="0.8" />
        <line x1="100" y1="74" x2="100" y2="66" stroke="#4A3A30" strokeWidth="2" strokeLinecap="round" />
        {lit ? (
          <g transform="translate(100 68)">
            <g className="ht-candle__flame">
              <path d="M0 0 C-12 -9 -11 -25 0 -46 C11 -25 12 -9 0 0 Z" fill={`url(#${uid}flame)`} opacity="0.92" />
              <path d="M0 -1 C-6 -4 -6 -10 0 -14 C6 -10 6 -4 0 -1 Z" fill="#7FA6E8" opacity="0.55" />
              <path d="M0 -4 C-4.5 -10 -4.5 -18 0 -27 C4.5 -18 4.5 -10 0 -4 Z" fill="#FFF8E6" />
            </g>
          </g>
        ) : (
          <path d="M100 62 C92 50 110 40 100 24" className="ht-candle__smoke" />
        )}
      </g>
      <rect x="77" y="182" width="46" height="12" fill={`url(#${uid}ribbon)`} />
      <path d="M100 188 C92 178 82 180 86 188 C82 196 92 198 100 188 Z" fill="#D9A59A" stroke="#B9786C" strokeWidth="0.8" />
      <path d="M100 188 C108 178 118 180 114 188 C118 196 108 198 100 188 Z" fill="#D9A59A" stroke="#B9786C" strokeWidth="0.8" />
      <path d="M98 190 L92 206 L96 205 L99 209 Z M102 190 L108 206 L104 205 L101 209 Z" fill="#C98F84" />
      <circle cx="100" cy="188" r="3" fill="#B9786C" />
      <path d="M60 212 C60 205 140 205 140 212 L138 216 L62 216 Z" fill={`url(#${uid}gold)`} />
      <path d="M66 216 L134 216 C140 222 136 228 100 228 C64 228 60 222 66 216 Z" fill={`url(#${uid}gold)`} />
      <ellipse cx="100" cy="230" rx="56" ry="6" fill={`url(#${uid}gold)`} />
      <g fill="none" stroke={`url(#${uid}gold)`} strokeWidth="3">
        <ellipse cx="146" cy="232" rx="9" ry="6" />
        <ellipse cx="157" cy="234" rx="9" ry="6" />
      </g>
    </svg>
  );
}

function Neon({ frac }: { frac: number }) {
  const on = Math.ceil(frac * 30 - 0.0001);
  return (
    <svg className="hall-timer__art" viewBox="0 0 300 300" aria-hidden="true">
      {NEON_SEGMENTS.map((s) => (
        <rect
          key={s.i}
          x="145"
          y="4"
          width="10"
          height="30"
          rx="5"
          transform={`rotate(${s.i * 12} 150 150)`}
          className={s.i < on ? "ht-neon__seg is-on" : "ht-neon__seg"}
          style={s.i < on ? ({ "--seg": s.color } as CSSProperties) : undefined}
        />
      ))}
    </svg>
  );
}

function Garland({ frac }: { frac: number }) {
  const on = Math.ceil(frac * 20 - 0.0001);
  return (
    <svg className="hall-timer__art" viewBox="0 0 320 320" aria-hidden="true">
      <path d={GARLAND_WIRE} fill="none" stroke="#3B5578" strokeWidth="2" />
      <g className="ht-garland__flake">
        <path d="M160 72 L160 248 M84 116 L236 204 M84 204 L236 116 M160 96 L146 82 M160 96 L174 82 M160 224 L146 238 M160 224 L174 238" />
      </g>
      {GARLAND_BULBS.map((b) => (
        <g key={b.i}>
          <rect x={b.cx - 4} y={b.cy - 4} width="8" height="8" rx="2" fill="#5B7499" transform={`rotate(${b.deg} ${b.cx} ${b.cy})`} />
          <ellipse
            cx={b.x}
            cy={b.y}
            rx="8"
            ry="11"
            transform={`rotate(${b.deg} ${b.x} ${b.y})`}
            className={b.i < on ? "ht-garland__bulb is-on" : "ht-garland__bulb"}
            style={b.i < on ? ({ "--bulb": b.color, animationDelay: `${(b.i % 5) * 0.37}s` } as CSSProperties) : undefined}
          />
        </g>
      ))}
    </svg>
  );
}
