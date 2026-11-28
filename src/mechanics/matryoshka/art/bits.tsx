/**
 * Мелкие рисунки «Игр Матрёшки» (экран зала и телефон): монета JR, Копилка — стеклянная банка с монетами, сердечки, пряник с
 * фигурой (контур — тот же, что обводит телефон: `rules/shapes.ts`), жестяная коробка, табурет, рука в рукаве матрёшки (финал),
 * значки испытаний. По макетам второй версии (`matryoshka-mockups/src/lib.js`, `hall.js`).
 */
import { useMemo, type ReactNode } from "react";
import { shapeOf } from "../rules/shapes";
import type { ShapeId, Style } from "../rules/types";
import { icon, type NestKind } from "./folk";

/** Случайность по зерну (одинаковый рисунок при каждой отрисовке). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Монета JR. */
export function Coin({ className }: { className?: string }) {
  return (
    <svg className={className ? `mt-coin ${className}` : "mt-coin"} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill="#E3C68C" stroke="#9A7444" strokeWidth="3" />
      <circle cx="20" cy="20" r="12.5" fill="none" stroke="#9A7444" strokeWidth="1.5" opacity=".7" />
      <text x="20" y="25" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontWeight="700" fontSize="15" fill="#5A3A2E">
        JR
      </text>
    </svg>
  );
}

/**
 * Копилка — стеклянная банка с монетами JR (решение владельца: банка оставлена). `count` — монет (по одной за каждого
 * выбывшего), `fill` — доля заполнения 0–1. Надпись «КОПИЛКА» и число — на кремовой этикетке (контраст не зависит от двора).
 */
export function Jar({ count, fill, style, className }: { count: number; fill: number; style: Style; className?: string }) {
  const coins = useMemo(() => {
    const r = seeded(17);
    const level = 196 - Math.max(0, Math.min(1, fill)) * 130;
    const n = Math.round(46 * Math.max(0, Math.min(1, fill))) + (count > 0 ? 6 : 0);
    return Array.from({ length: n }, (_, i) => {
      const x = 34 + r() * 92;
      const y = level + r() * (190 - level);
      return { i, x, y, a: r() * 30 - 15 };
    });
  }, [count, fill]);
  const night = style === "night";
  const clip = `mtJar${night ? "n" : "d"}`;
  return (
    <svg className={className ? `mt-jar ${className}` : "mt-jar"} viewBox="0 0 160 192" aria-hidden="true">
      <rect x="22" y="30" width="116" height="160" rx="26" fill={night ? "rgba(227,198,140,.10)" : "rgba(255,255,255,.45)"} />
      <clipPath id={clip}>
        <rect x="24" y="32" width="112" height="156" rx="24" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {coins.map((c) => (
          <ellipse key={c.i} cx={c.x} cy={c.y} rx="11" ry="5.5" fill="#E3C68C" stroke="#9A7444" strokeWidth="1.6" transform={`rotate(${c.a.toFixed(0)} ${c.x.toFixed(1)} ${c.y.toFixed(1)})`} />
        ))}
      </g>
      <rect x="22" y="30" width="116" height="160" rx="26" fill="url(#mtGlass)" stroke={night ? "#E3C68C" : "#7A6E66"} strokeWidth="3.5" filter={night ? "url(#mtNeon)" : undefined} />
      <rect x="30" y="8" width="100" height="26" rx="8" fill="#9A7444" stroke="#5A3A2E" strokeWidth="2.5" />
      <rect x="62" y="14" width="36" height="6" rx="3" fill="#2A1C17" />
      <rect x="40" y="70" width="80" height="54" rx="10" fill="#FBF6F1" stroke="#9A7444" strokeWidth="2" />
      <text x="80" y="91" textAnchor="middle" fontFamily="Jost, system-ui, sans-serif" fontWeight="600" fontSize="13" fill="#5A3A2E">
        КОПИЛКА
      </text>
      <text x="80" y="117" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontWeight="700" fontSize="27" fill="#362E29">
        {count}
      </text>
    </svg>
  );
}

/** Сердечки: n из total (пустое — перечёркнуто). */
export function Hearts({ n, total, style, className }: { n: number; total: number; style: Style; className?: string }) {
  const night = style === "night";
  return (
    <span className={className ? `mt-hearts ${className}` : "mt-hearts"} role="img" aria-label={`Сердечки: ${n} из ${total}`}>
      {Array.from({ length: Math.max(0, total) }, (_, i) => {
        const on = i < n;
        return (
          <svg key={i} viewBox="0 0 40 40" aria-hidden="true">
            <path d="M20 35C8 26 3 19 3 12.5a8.5 8.5 0 0 1 17-2 8.5 8.5 0 0 1 17 2C37 19 32 26 20 35z" fill={on ? (night ? "#E0453A" : "#C96F62") : "none"} stroke={night ? "#F3D27A" : "#8A5148"} strokeWidth="3" />
            {!on && <path d="M14 14l12 12M26 14L14 26" stroke={night ? "#E2CBA6" : "#3D4F7A"} strokeWidth="2.6" strokeLinecap="round" />}
          </svg>
        );
      })}
    </span>
  );
}

/** Значок испытания (контурный, цветом текста). */
export function TrialIcon({ kind, className }: { kind: NestKind; className?: string }) {
  return <svg className={className ? `mt-ico ${className}` : "mt-ico"} viewBox="0 0 40 40" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon(kind, "currentColor") }} />;
}

const shapePaths = new Map<ShapeId, string>();
/** Контур фигуры «Пряника» в поле 0…100 (тот же, что обводит телефон). */
export function shapePath(id: ShapeId): string {
  const known = shapePaths.get(id);
  if (known) return known;
  const pts = shapeOf(id).points;
  const d = "M" + pts.map(([x, y]) => `${(x * 64 + 18).toFixed(1)} ${(y * 64 + 18).toFixed(1)}`).join(" L") + " Z";
  shapePaths.set(id, d);
  return d;
}

/** Пряник с фигурой: кольцо прогресса обводки золотом (`prog` 0–1), треснувший — расколот на три куска. */
export function Cookie({ shape, prog = 0, cracked = false, night = false, className }: { shape: ShapeId; prog?: number; cracked?: boolean; night?: boolean; className?: string }) {
  const icing = night ? "#F3DFAE" : "#FBF6F1";
  const d = shapePath(shape);
  if (cracked)
    return (
      <svg className={className ? `mt-cookie ${className}` : "mt-cookie"} viewBox="0 0 100 100" aria-hidden="true">
        <g transform="translate(-3 -2) rotate(-6 50 50)">
          <path d="M50 50 L50 4 A46 46 0 0 0 6 40 Z" fill="#B5764A" stroke="#7A4A2A" strokeWidth="2" />
        </g>
        <g transform="translate(4 -1) rotate(7 50 50)">
          <path d="M50 50 L50 4 A46 46 0 0 1 92 58 Z" fill="#B5764A" stroke="#7A4A2A" strokeWidth="2" />
        </g>
        <g transform="translate(-1 5)">
          <path d="M50 50 L92 58 A46 46 0 0 1 6 40 Z" fill="#B5764A" stroke="#7A4A2A" strokeWidth="2" />
        </g>
        <path d={d} fill="none" stroke="#5A3A2E" strokeWidth="2" opacity=".6" />
      </svg>
    );
  const p = Math.max(0, Math.min(1, prog));
  return (
    <svg className={className ? `mt-cookie ${className}` : "mt-cookie"} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="#C8875A" stroke="#7A4A2A" strokeWidth="3" />
      <circle cx="50" cy="50" r="40" fill="none" stroke={icing} strokeWidth="2" strokeDasharray="3 5" opacity=".8" />
      <path d={d} fill="none" stroke="#7A4A2A" strokeWidth="2.2" strokeLinejoin="round" />
      {p > 0 && <path d={d} fill="none" stroke="#F3D27A" strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" pathLength={100} strokeDasharray={`${(p * 100).toFixed(1)} 200`} />}
    </svg>
  );
}

const TIN = ["#C96F62", "#7FA889", "#9A8FD0", "#C9A15F"];

/** Жестяная коробка «Пряника»: закрытая или открытая с пряником внутри. */
export function TinBox({ n, shape, open, className }: { n: number; shape: ShapeId | null; open: boolean; className?: string }) {
  const pat = TIN[(n - 1) % TIN.length] ?? "#C96F62";
  const box = (
    <>
      <rect x="18" y="96" width="164" height="78" rx="14" fill={pat} stroke="#5A3A2E" strokeWidth="3" />
      <path d="M18 135 H182" stroke="#FBF6F1" strokeWidth="3" strokeDasharray="6 6" />
      <circle cx="100" cy="135" r="20" fill="#FBF6F1" stroke="#5A3A2E" strokeWidth="3" />
      <text x="100" y="144" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontWeight="700" fontSize="26" fill="#362E29">
        {n}
      </text>
    </>
  );
  return (
    <svg className={className ? `mt-tin ${className}` : "mt-tin"} viewBox="0 0 200 180" aria-hidden="true">
      {!open || !shape ? (
        <>
          <rect x="12" y="78" width="176" height="24" rx="8" fill={pat} stroke="#5A3A2E" strokeWidth="3" />
          {box}
          <g fill="#FBF6F1" opacity=".75">
            <circle cx="40" cy="160" r="4" />
            <circle cx="160" cy="160" r="4" />
            <circle cx="40" cy="112" r="4" />
            <circle cx="160" cy="112" r="4" />
          </g>
        </>
      ) : (
        <>
          <g transform="translate(14 46) rotate(-24 20 10)">
            <rect x="0" y="0" width="70" height="20" rx="7" fill={pat} stroke="#5A3A2E" strokeWidth="3" />
          </g>
          <rect x="22" y="90" width="156" height="14" rx="5" fill="#5A3A2E" />
          <g transform="translate(48 0) scale(1.04)">
            <circle cx="50" cy="50" r="46" fill="#C8875A" stroke="#7A4A2A" strokeWidth="3" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="#FBF6F1" strokeWidth="2" strokeDasharray="3 5" opacity=".8" />
            <path d={shapePath(shape)} fill="none" stroke="#5A3A2E" strokeWidth="3" strokeLinejoin="round" />
          </g>
          {box}
        </>
      )}
    </svg>
  );
}

/** Табурет «Стульев». */
export function Stool({ className }: { className?: string }) {
  return (
    <svg className={className ? `mt-stool ${className}` : "mt-stool"} viewBox="0 0 40 36" aria-hidden="true">
      <rect x="4" y="6" width="32" height="7" rx="3.5" fill="#C9A15F" stroke="#5A3A2E" strokeWidth="2" />
      <path d="M9 13 L6 34 M31 13 L34 34 M11 25 H29" stroke="#5A3A2E" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** Рука в рукаве матрёшки: камень, ножницы, бумага; левая — коралловый рукав, правая — шалфейный (решение владельца). */
export function Hand({ kind, side, className }: { kind: "r" | "p" | "s" | null; side: "L" | "R"; className?: string }) {
  const skin = "#F3D9C4";
  const line = "#5A3A2E";
  const sleeve = side === "L" ? "#C96F62" : "#7FA889";
  let palm: ReactNode;
  if (kind === "r")
    palm = (
      <>
        <rect x="300" y="150" width="150" height="130" rx="54" fill={skin} stroke={line} strokeWidth="5" />
        <path d="M340 160 v40 M375 156 v44 M410 160 v40" stroke={line} strokeWidth="4" strokeLinecap="round" />
        <rect x="292" y="210" width="70" height="44" rx="22" fill={skin} stroke={line} strokeWidth="5" />
      </>
    );
  else if (kind === "p")
    palm = (
      <>
        <rect x="300" y="160" width="130" height="120" rx="40" fill={skin} stroke={line} strokeWidth="5" />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x="420" y={150 + i * 32} width="120" height="28" rx="14" fill={skin} stroke={line} strokeWidth="5" />
        ))}
        <rect x="330" y="104" width="34" height="80" rx="17" fill={skin} stroke={line} strokeWidth="5" transform="rotate(-30 347 144)" />
      </>
    );
  else if (kind === "s")
    palm = (
      <>
        <rect x="300" y="160" width="140" height="120" rx="50" fill={skin} stroke={line} strokeWidth="5" />
        <rect x="400" y="132" width="150" height="30" rx="15" fill={skin} stroke={line} strokeWidth="5" transform="rotate(-16 420 145)" />
        <rect x="400" y="198" width="150" height="30" rx="15" fill={skin} stroke={line} strokeWidth="5" transform="rotate(16 420 215)" />
        <path d="M340 240 h60" stroke={line} strokeWidth="4" strokeLinecap="round" />
      </>
    );
  else
    // Жест ещё не открыт: кулак «Раз, два, три!» (тот же камень, но наклонён — качается).
    palm = (
      <>
        <rect x="300" y="150" width="150" height="130" rx="54" fill={skin} stroke={line} strokeWidth="5" />
        <path d="M340 160 v40 M375 156 v44 M410 160 v40" stroke={line} strokeWidth="4" strokeLinecap="round" />
      </>
    );
  return (
    <svg className={className ? `mt-hand ${className}` : "mt-hand"} viewBox="0 0 560 400" aria-hidden="true">
      <g transform={side === "R" ? "translate(560 0) scale(-1 1)" : undefined}>
        <path d="M-20 120 L250 130 C275 132 300 150 300 215 C300 280 275 298 250 300 L-20 310 Z" fill={sleeve} stroke={line} strokeWidth="5" />
        <path d="M220 128 C250 140 262 175 262 215 C262 255 250 290 220 302" fill="none" stroke="#E3C68C" strokeWidth="16" />
        <g fill="#FBF6F1">
          {[150, 190, 230, 270].map((y) => (
            <circle key={y} cx="120" cy={y} r="7" />
          ))}
          {[170, 210, 250].map((y) => (
            <circle key={`b${y}`} cx="60" cy={y} r="6" />
          ))}
        </g>
        {palm}
      </g>
    </svg>
  );
}
