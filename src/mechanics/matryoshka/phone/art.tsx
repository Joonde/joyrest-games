/**
 * Рисунки телефона «Игр Матрёшки» (SVG в коде, по согласованным макетам 14 ноября 2026): сердечки, кольцо отсчёта, коробки и
 * пряник с фигурой из правил (`rules/shapes.ts` — те же точки, по которым считается обводка), стул, жесты, сугроб, монета и
 * маленькая матрёшка в росписи двора («Солнечный двор» — гжель, «Ночной двор» — хохлома). Цвета — палитры игры
 * (`PALETTE`), а не цвета «в коде» экранов: экраны берут переменные `--mt-*` из `phone.css`.
 */
import { Doll as FolkDoll } from "../art/Doll";
import { PIECES } from "../rules/constants";
import { shapeOf } from "../rules/shapes";
import type { Gesture, ShapeId, Style } from "../rules/types";

/** Палитры росписи (макет `folk.js`): гжель — кобальт по фарфору, хохлома — чёрный лак, золото, киноварь. */
export const PALETTE = {
  sunny: { line: "#132E6B", main: "#1B3F8B", mid: "#2E5AAC", soft: "#6E92D6", pale: "#B9CCEC", lace: "#FFFFFF", gold: "#C9A15F", goldL: "#E3C68C", face: "#FFF8F1", cheek: "#E7A6A0", heart: "#C96F62", heartLine: "#8A5148", emptyLine: "#3D4F7A" },
  night: { line: "#0C0806", main: "#C2281E", mid: "#E0453A", soft: "#F07A5A", pale: "#F3C9A0", lace: "#E9C46A", gold: "#D9A441", goldL: "#F3D27A", face: "#F6E7D4", cheek: "#E58A7E", heart: "#E0453A", heartLine: "#F3D27A", emptyLine: "#E2CBA6" },
} as const;

// ------------------------------------------------------------------ сердечки

export function Hearts({ n, total, size = 28, style }: { n: number; total: number; size?: number; style: Style }) {
  const p = PALETTE[style];
  const all = Math.max(total, n, 1);
  return (
    <span className="mtp-hearts" role="img" aria-label={`Сердечки: ${n} из ${all}`}>
      {Array.from({ length: all }, (_, i) => {
        const on = i < n;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={on ? "is-on" : "is-off"}>
            <path d="M20 35C8 26 3 19 3 12.5a8.5 8.5 0 0 1 17-2 8.5 8.5 0 0 1 17 2C37 19 32 26 20 35z" fill={on ? p.heart : "none"} stroke={p.heartLine} strokeWidth="3" />
            {!on && <path d="M14 14l12 12M26 14L14 26" stroke={p.emptyLine} strokeWidth="2.6" strokeLinecap="round" />}
          </svg>
        );
      })}
    </span>
  );
}

// ------------------------------------------------------------------ кольцо отсчёта

export function Ring({ left, total }: { left: number | null; total: number | null }) {
  if (left === null) return null;
  const r = 27;
  const c = 2 * Math.PI * r;
  const frac = total && total > 0 ? Math.max(0, Math.min(1, left / total)) : 1;
  const sec = Math.ceil(left / 1000);
  return (
    <span className="mtp-ring" role="timer" aria-label={`Осталось ${sec} с`}>
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" className="mtp-ring__track" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" className="mtp-ring__fill" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(c * frac).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 32 32)" />
      </svg>
      <b aria-hidden="true">{sec}</b>
    </span>
  );
}

// ------------------------------------------------------------------ матрёшка

/**
 * Матрёшка двора — утверждённая роспись из `art/` (лист персонажа 14 ноября 2026: гжель днём, хохлома ночью): глаза спокойные,
 * «смотрит» (ночью светятся янтарём) или закрыты (пауза). Ширину задаёт телефон, высота — по пропорции рисунка.
 */
export function Doll({ style, width = 120, eyes = "calm", className }: { style: Style; width?: number; eyes?: "calm" | "look" | "closed"; className?: string }) {
  return <FolkDoll folk={style === "night" ? "khokhloma" : "gzhel"} eyes={eyes === "calm" ? "open" : eyes} glow={style === "night"} className={`mtp-doll${className ? ` ${className}` : ""}`} style={{ width, height: "auto" }} />;
}

// ------------------------------------------------------------------ «Пряник»

const BOX_COLORS = ["#C96F62", "#4E7A5A", "#6A5FB0", "#9A7444"] as const;

/** Жестяная коробка «Пряника» (закрытая): номер на крышке. */
export function TinBox({ n }: { n: number }) {
  const pat = BOX_COLORS[(n - 1) % BOX_COLORS.length] ?? "#9A7444";
  return (
    <svg className="mtp-tin" viewBox="0 0 200 180" aria-hidden="true">
      <rect x="12" y="62" width="176" height="28" rx="9" fill={pat} stroke="#3A2A20" strokeWidth="3" />
      <rect x="18" y="86" width="164" height="84" rx="14" fill={pat} stroke="#3A2A20" strokeWidth="3" />
      <path d="M18 128 H182" stroke="#FBF6F1" strokeWidth="3" strokeDasharray="6 6" />
      <circle cx="100" cy="128" r="22" fill="#FBF6F1" stroke="#3A2A20" strokeWidth="3" />
      <text x="100" y="138" textAnchor="middle" fontFamily="Cormorant Garamond, serif" fontWeight="700" fontSize="28" fill="#2A1C14">
        {n}
      </text>
      <g fill="#FBF6F1" opacity="0.8">
        <circle cx="40" cy="152" r="4" />
        <circle cx="160" cy="152" r="4" />
        <circle cx="40" cy="104" r="4" />
        <circle cx="160" cy="104" r="4" />
      </g>
    </svg>
  );
}

/** Точки фигуры в координатах 0…100 (поле пряника — квадрат). */
export function shapePath(id: ShapeId): string {
  const pts = shapeOf(id).points;
  return `M${pts.map(([x, y]) => `${(x * 100).toFixed(2)} ${(y * 100).toFixed(2)}`).join(" L")} Z`;
}

/** Обведённые кусочки — отрезками подряд (кусочек i — от точки i до i + 1). */
export function coveredPath(id: ShapeId, covered: readonly boolean[]): string {
  const pts = shapeOf(id).points;
  let d = "";
  let open = false;
  for (let i = 0; i < PIECES; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) continue;
    if (covered[i]) {
      if (!open) d += `M${(a[0] * 100).toFixed(2)} ${(a[1] * 100).toFixed(2)}`;
      d += ` L${(b[0] * 100).toFixed(2)} ${(b[1] * 100).toFixed(2)}`;
      open = true;
    } else open = false;
  }
  return d;
}

/**
 * Пряник с фигурой: светлая полоса допуска (ширина — `band` с обеих сторон от контура, в долях поля), контур, обведённое
 * золотом, палец. Треснул — пряник разламывается (только transform/opacity).
 */
export function Cookie({ shape, band, covered, cracked, finger, className }: { shape: ShapeId; band: number; covered?: readonly boolean[]; cracked?: boolean; finger?: readonly [number, number] | null; className?: string }) {
  const d = shapePath(shape);
  const done = covered ? coveredPath(shape, covered) : "";
  return (
    <svg className={`mtp-cookie${cracked ? " is-cracked" : ""} ${className ?? ""}`} viewBox="0 0 100 100" aria-hidden="true">
      <g className="mtp-cookie__a">
        <rect x="1.5" y="1.5" width="97" height="97" rx="20" fill="#C8875A" stroke="#7A4A2A" strokeWidth="2.4" />
        <rect x="6" y="6" width="88" height="88" rx="16" fill="none" stroke="#FBF6F1" strokeWidth="1.2" strokeDasharray="2.4 4" opacity="0.75" />
      </g>
      {cracked && <path className="mtp-cookie__crack" d="M50 2 L46 22 L55 36 L44 52 L57 66 L48 82 L52 98" fill="none" stroke="#3A2414" strokeWidth="2.6" strokeLinejoin="round" />}
      {!cracked && <path d={d} fill="none" stroke="#FBF6F1" strokeOpacity="0.55" strokeWidth={band * 200} strokeLinejoin="round" strokeLinecap="round" />}
      <path d={d} fill="none" stroke="#5A3418" strokeWidth="1.4" strokeLinejoin="round" />
      {done && <path className="mtp-cookie__done" d={done} fill="none" strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round" />}
      {finger && !cracked && <circle className="mtp-cookie__finger" cx={finger[0] * 100} cy={finger[1] * 100} r="4.5" />}
    </svg>
  );
}

// ------------------------------------------------------------------ «Стулья», «Канат», финал

export function Stool({ size = 64, style }: { size?: number; style: Style }) {
  const seat = style === "night" ? "#E3C68C" : "#C9A15F";
  const leg = style === "night" ? "#FBF6F1" : "#5A3A2E";
  return (
    <svg width={size} height={size * 0.9} viewBox="0 0 40 36" aria-hidden="true">
      <rect x="4" y="6" width="32" height="7" rx="3.5" fill={seat} stroke={leg} strokeWidth="2" />
      <path d="M9 13 L6 34 M31 13 L34 34 M11 25 H29" stroke={leg} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export const GESTURE_TITLES: Record<Gesture, string> = { r: "Камень", s: "Ножницы", p: "Бумага" };

export function GestureArt({ g, size = 76 }: { g: Gesture; size?: number }) {
  const skin = "#F3D9C4";
  const line = "#5A3A2E";
  return (
    <svg width={size} height={size} viewBox="0 0 68 64" aria-hidden="true">
      {g === "r" && (
        <>
          <rect x="14" y="18" width="40" height="36" rx="15" fill={skin} stroke={line} strokeWidth="3" />
          <path d="M25 21v12M34 20v13M43 21v12" stroke={line} strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}
      {g === "p" && (
        <>
          <rect x="14" y="24" width="34" height="32" rx="11" fill={skin} stroke={line} strokeWidth="3" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={17 + i * 8} y="6" width="8" height="26" rx="4" fill={skin} stroke={line} strokeWidth="2.4" />
          ))}
          <rect x="44" y="30" width="20" height="8" rx="4" fill={skin} stroke={line} strokeWidth="2.4" transform="rotate(-30 44 34)" />
        </>
      )}
      {g === "s" && (
        <>
          <rect x="14" y="30" width="36" height="28" rx="12" fill={skin} stroke={line} strokeWidth="3" />
          <rect x="18" y="4" width="9" height="32" rx="4.5" fill={skin} stroke={line} strokeWidth="2.4" transform="rotate(-14 22 34)" />
          <rect x="32" y="4" width="9" height="32" rx="4.5" fill={skin} stroke={line} strokeWidth="2.4" transform="rotate(14 36 34)" />
        </>
      )}
    </svg>
  );
}

/** Узел каната — то, что жмут часто-часто. */
export function KnotArt({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 100 60" aria-hidden="true">
      <path d="M2 30 H34 M66 30 H98" stroke="#9A7444" strokeWidth="9" strokeLinecap="round" />
      <path d="M2 30 H34 M66 30 H98" stroke="#E3C68C" strokeWidth="4" strokeDasharray="5 5" strokeLinecap="round" />
      <ellipse cx="50" cy="30" rx="19" ry="17" fill="#C9A15F" stroke="#5A3A2E" strokeWidth="3" />
      <path d="M38 20 C48 34 52 26 62 40 M38 40 C48 26 52 34 62 20" stroke="#5A3A2E" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Drift({ width = 260, style }: { width?: number; style: Style }) {
  const night = style === "night";
  const fill = night ? "#3A3E44" : "#FBFDFF";
  const shade = night ? "#2A2D31" : "#DCE9F0";
  return (
    <svg className="mtp-drift" width={width} height={width * 0.42} viewBox="0 0 300 126" aria-hidden="true">
      <path d="M0 126 C10 70 50 52 84 62 C100 22 160 14 186 50 C214 30 262 40 272 78 C292 84 300 104 300 126 Z" fill={shade} />
      <path d="M8 126 C20 80 54 66 86 76 C104 40 156 32 182 64 C212 46 254 56 264 90 C282 96 292 110 294 126 Z" fill={fill} stroke="#9CC3D5" strokeWidth="2.5" />
      <g fill={fill} opacity="0.9">
        <circle cx="150" cy="30" r="14" />
        <circle cx="130" cy="22" r="9" />
        <circle cx="172" cy="20" r="10" />
      </g>
    </svg>
  );
}

export function Coin({ size = 26 }: { size?: number }) {
  return (
    <svg className="mtp-coin" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill="#E3C68C" stroke="#9A7444" strokeWidth="3" />
      <circle cx="20" cy="20" r="12.5" fill="none" stroke="#9A7444" strokeWidth="1.5" opacity="0.7" />
      <text x="20" y="25" textAnchor="middle" fontFamily="Cormorant Garamond, serif" fontWeight="700" fontSize="15" fill="#5A3A2E">
        JR
      </text>
    </svg>
  );
}

/** Клетка «Классиков»: лёд со стрелкой. */
export function IceArrow({ dir }: { dir: "L" | "R" }) {
  return (
    <svg width="56" height="40" viewBox="0 0 56 40" aria-hidden="true">
      <path d={dir === "L" ? "M50 20 H10 M24 6 L10 20 L24 34" : "M6 20 H46 M32 6 L46 20 L32 34"} stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
