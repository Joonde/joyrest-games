// Карты колод JoyRest: лицо и рубашка в одном из 10 стилей (классика, готика, Греция, Рим, киберпанк,
// old fashion, хохлома, K-pop, аниме, свадьба). Стиль — набор CSS-переменных `.dk-d--<стиль>`
// (src/styles.css, раздел «Дурак»), рисованные картинки — public/cards/art/web/.
import type { CSSProperties } from "react";
import type { DeckStyle } from "./content";
import { rankOf, suitOf } from "./engine";

/** Рисованные картинки колод (полные оригиналы — public/cards/art/*.png). */
export const DECK_ART: Partial<Record<DeckStyle, { back?: string; K?: string; Q?: string; J?: string }>> = {
  anime: { back: "/cards/art/web/anime-back.webp", K: "/cards/art/web/anime-king.webp", Q: "/cards/art/web/anime-queen.webp" },
  wedding: { back: "/cards/art/web/wedding-back.webp" },
};

export const CROUPIER_ART = "/cards/art/web/croupier.webp";

const GLYPH: Record<string, string> = { S: "♠︎", H: "♥︎", D: "♦︎", C: "♣︎" };
const SUIT_NAME: Record<string, string> = { S: "пик", H: "червей", D: "бубен", C: "треф" };
const RANK_NAME: Record<number, string> = { 11: "валет", 12: "дама", 13: "король", 14: "туз" };

export function rankLabel(card: string): string {
  const r = rankOf(card);
  return r === 10 ? "10" : r <= 9 ? String(r) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[r] ?? "?";
}

export function suitGlyph(card: string): string {
  return GLYPH[suitOf(card)] ?? "";
}

export function cardName(card: string): string {
  const r = rankOf(card);
  return `${RANK_NAME[r] ?? String(r)} ${SUIT_NAME[suitOf(card)] ?? ""}`;
}

function isRed(card: string): boolean {
  const s = suitOf(card);
  return s === "H" || s === "D";
}

function Crown() {
  return (
    <svg className="dk-face__icon" viewBox="0 0 34 20" aria-hidden="true">
      <path d="M2 18L5 4l7 7 5-10 5 10 7-7 3 14z" fill="currentColor" />
    </svg>
  );
}

function Tiara() {
  return (
    <svg className="dk-face__icon" viewBox="0 0 30 18" aria-hidden="true">
      <path d="M3 16l3-10 5 5 4-9 4 9 5-5 3 10z" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Star() {
  return (
    <svg className="dk-face__icon" viewBox="0 0 26 18" aria-hidden="true">
      <path d="M13 1l3 6 7 1-5 5 1 4-6-3-6 3 1-4-5-5 7-1z" fill="currentColor" />
    </svg>
  );
}

function meander(y: number): string {
  let d = "";
  for (let x = 0; x < 100; x += 12) d += `M${x} ${y + 10}V${y}h10v8h-6v-4h3`;
  return d;
}

/** Узор рубашки для стилей без рисованной картинки. */
function BackDeco({ deck }: { deck: DeckStyle }) {
  if (deck === "greece")
    return (
      <svg className="dk-deco" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
        <path d={meander(8) + meander(120)} fill="none" stroke="#1E1A16" strokeWidth="2.2" />
      </svg>
    );
  if (deck === "rome") {
    const leaves = [120, 140, 160, 180, 200, 220, 240].map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return { x: 50 + 33 * Math.cos(rad), y: 70 + 33 * Math.sin(rad), r: deg + 60 };
    });
    return (
      <svg className="dk-deco" viewBox="0 0 100 140" aria-hidden="true">
        {[1, -1].map((side) => (
          <g key={side} transform={side < 0 ? "translate(100 0) scale(-1 1)" : undefined} fill="#E9CF8A">
            <path d="M50 104C30 102 15 88 16 66" fill="none" stroke="#E9CF8A" strokeWidth="1.4" />
            {leaves.map((l) => (
              <ellipse key={l.r} cx={l.x} cy={l.y} rx="5.5" ry="2.3" transform={`rotate(${l.r} ${l.x} ${l.y})`} />
            ))}
          </g>
        ))}
      </svg>
    );
  }
  if (deck === "russia")
    return (
      <svg className="dk-deco" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
        <path d="M8 132C26 112 18 92 36 84S52 60 44 44M92 8C74 26 84 44 66 54S50 78 58 94" fill="none" stroke="#E7B54A" strokeWidth="1.6" />
        <g fill="#E7B54A">
          <ellipse cx="22" cy="110" rx="7" ry="3" transform="rotate(-50 22 110)" />
          <ellipse cx="30" cy="96" rx="7" ry="3" transform="rotate(20 30 96)" />
          <ellipse cx="78" cy="30" rx="7" ry="3" transform="rotate(-50 78 30)" />
          <ellipse cx="70" cy="44" rx="7" ry="3" transform="rotate(20 70 44)" />
        </g>
        <g fill="#C8241B">
          <circle cx="14" cy="122" r="4.5" />
          <circle cx="86" cy="18" r="4.5" />
          <circle cx="56" cy="104" r="4" />
          <circle cx="44" cy="36" r="4" />
        </g>
      </svg>
    );
  if (deck === "gothic")
    return (
      <svg className="dk-deco dk-deco--spin" viewBox="0 0 100 140" aria-hidden="true">
        <path d="M50 8L58 22H42Z M50 132L42 118H58Z" fill="#C9CBD6" opacity=".7" />
      </svg>
    );
  return null;
}

export interface CardArtProps {
  /** Карта ("QH") или null — рубашка. */
  card: string | null;
  deck: DeckStyle;
  /** Ширина: px или CSS-длина ("7cqh"); высота — ×1.4. */
  width: number | string;
  className?: string;
  style?: CSSProperties;
}

/** Одна карта: лицо или рубашка. */
export function CardArt({ card, deck, width, className, style }: CardArtProps) {
  const css = { ...style, ["--w" as string]: typeof width === "number" ? `${width}px` : width } as CSSProperties;
  const art = DECK_ART[deck];
  if (card === null) {
    return (
      <div className={`dk-card dk-back dk-d--${deck}${className ? ` ${className}` : ""}`} style={css} aria-hidden="true">
        {art?.back ? <img className="dk-art" src={art.back} alt="" draggable={false} /> : <BackDeco deck={deck} />}
        <span className="dk-medal">{deck === "wedding" ? "J✦R" : "J✦R"}</span>
      </div>
    );
  }
  const r = rankOf(card);
  const label = rankLabel(card);
  const glyph = suitGlyph(card);
  const faceArt = r === 13 ? art?.K : r === 12 ? art?.Q : r === 11 ? art?.J : undefined;
  const classes = `dk-card dk-d--${deck}${isRed(card) ? " is-red" : ""}${faceArt ? " is-full" : ""}${className ? ` ${className}` : ""}`;
  return (
    <div className={classes} style={css} role="img" aria-label={cardName(card)}>
      {faceArt && <img className="dk-art" src={faceArt} alt="" draggable={false} />}
      <span className="dk-idx">
        {label}
        <span>{glyph}</span>
      </span>
      {!faceArt && r >= 11 && r <= 13 ? (
        <span className="dk-face">
          {r === 13 ? <Crown /> : r === 12 ? <Tiara /> : <Star />}
          <b>{label}</b>
          <i>{glyph}</i>
        </span>
      ) : !faceArt ? (
        <span className={r === 14 ? "dk-pip dk-pip--ace" : "dk-pip"}>{glyph}</span>
      ) : null}
      {r === 14 && <span className="dk-brand">J✦R</span>}
      <span className="dk-idx dk-idx--b">
        {label}
        <span>{glyph}</span>
      </span>
    </div>
  );
}

/** Веер рубашек (сколько карт у игрока). */
export function BackFan({ count, deck, width = "26px" }: { count: number; deck: DeckStyle; width?: string }) {
  const n = Math.min(count, 6);
  return (
    <span className="dk-backfan" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <CardArt key={i} card={null} deck={deck} width={width} style={{ transform: `rotate(${(i - (n - 1) / 2) * 9}deg)`, marginLeft: i === 0 ? 0 : `calc(${width} * -0.62)` }} />
      ))}
    </span>
  );
}
