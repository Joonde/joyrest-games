/**
 * Картинки телефона «Бубликатора» — только SVG и градиенты, без фильтров и растровых файлов (лёгкие для старых телефонов,
 * как в согласованных макетах `ph-*`). Цвет экипажа — переменная `--bk-crew`.
 */
import type { Theme } from "../rules/types";

/** Корабль темы: сани, ракета, парусник, субмарина, воздушный шар. */
export function Ship({ theme, size = 150, label }: { theme: Theme; size?: number; label: string }) {
  const h = Math.round(size * 0.58);
  const common = { width: size, height: h, viewBox: "0 0 200 116", role: "img", "aria-label": label, className: "bkp-ship" } as const;
  if (theme === "newyear") {
    return (
      <svg {...common}>
        <ellipse cx="100" cy="106" rx="86" ry="7" fill="var(--bk-shadow)" />
        <rect x="62" y="12" width="34" height="30" rx="4" fill="var(--bk-lav)" />
        <rect x="76" y="12" width="6" height="30" fill="var(--bk-gold2)" />
        <rect x="100" y="20" width="30" height="22" rx="4" fill="var(--bk-sage)" />
        <rect x="100" y="28" width="30" height="5" fill="var(--bk-gold2)" />
        <rect x="44" y="24" width="20" height="18" rx="3" fill="var(--bk-coral)" />
        <path d="M24 98 H 170 C 192 98 198 78 186 68 C 180 63 172 66 174 72" fill="none" stroke="var(--bk-gold)" strokeWidth="6" strokeLinecap="round" />
        <path d="M54 80 L 50 98 M 92 80 L 92 98 M 136 80 L 140 98" stroke="var(--bk-gold)" strokeWidth="5" strokeLinecap="round" />
        <path d="M28 70 C 26 48 42 38 64 38 L 160 38 C 176 38 180 54 170 64 L 158 82 L 36 82 C 31 82 28 77 28 70 Z" fill="var(--bk-crew)" />
        <path d="M30 60 C 60 56 130 56 172 58" fill="none" stroke="var(--bk-gold2)" strokeOpacity="0.85" strokeWidth="2.5" />
        <circle cx="170" cy="40" r="5" fill="var(--bk-gold2)" />
      </svg>
    );
  }
  if (theme === "pirates") {
    return (
      <svg {...common}>
        <ellipse cx="100" cy="106" rx="86" ry="7" fill="var(--bk-shadow)" />
        <path d="M98 10 L 98 76" stroke="var(--bk-gold)" strokeWidth="5" />
        <path d="M102 14 C 140 24 150 50 146 70 L 102 70 Z" fill="var(--bk-ink)" fillOpacity="0.9" />
        <path d="M94 22 C 70 34 62 54 64 70 L 94 70 Z" fill="var(--bk-ink)" fillOpacity="0.7" />
        <path d="M98 10 L 120 4 L 98 0 Z" fill="var(--bk-coral)" />
        <path d="M24 74 H 180 L 160 100 C 120 108 80 108 44 100 Z" fill="var(--bk-crew)" />
        <path d="M34 82 H 170" stroke="var(--bk-gold2)" strokeOpacity="0.85" strokeWidth="2.5" />
      </svg>
    );
  }
  if (theme === "submarine") {
    return (
      <svg {...common}>
        <ellipse cx="100" cy="106" rx="86" ry="7" fill="var(--bk-shadow)" />
        <rect x="92" y="20" width="34" height="26" rx="8" fill="var(--bk-crew)" />
        <path d="M108 20 V 6 H 120" fill="none" stroke="var(--bk-gold)" strokeWidth="4" strokeLinecap="round" />
        <path d="M20 66 C 20 44 50 38 100 38 C 156 38 186 46 186 66 C 186 86 156 94 100 94 C 50 94 20 88 20 66 Z" fill="var(--bk-crew)" />
        <circle cx="80" cy="64" r="9" fill="var(--bk-gold2)" />
        <circle cx="112" cy="64" r="9" fill="var(--bk-gold2)" />
        <circle cx="144" cy="64" r="9" fill="var(--bk-gold2)" />
        <path d="M14 56 L 4 46 L 4 86 L 14 76 Z" fill="var(--bk-gold)" />
      </svg>
    );
  }
  if (theme === "wedding") {
    return (
      <svg {...common} viewBox="0 0 200 116">
        <ellipse cx="100" cy="110" rx="60" ry="5" fill="var(--bk-shadow)" />
        <path d="M100 4 C 136 4 150 30 146 52 C 142 70 116 80 108 86 L 92 86 C 84 80 58 70 54 52 C 50 30 64 4 100 4 Z" fill="var(--bk-crew)" />
        <path d="M100 4 C 114 18 116 60 108 86 M100 4 C 86 18 84 60 92 86" fill="none" stroke="var(--bk-gold2)" strokeOpacity="0.8" strokeWidth="2.5" />
        <path d="M92 86 L 88 96 M108 86 L 112 96" stroke="var(--bk-gold)" strokeWidth="3" />
        <rect x="84" y="94" width="32" height="14" rx="3" fill="var(--bk-gold)" />
      </svg>
    );
  }
  return (
    <svg {...common} viewBox="0 0 120 66">
      <path d="M30 33 L -6 20 Q 6 33 -6 46 Z" fill="var(--bk-coral)" fillOpacity="0.85" />
      <path d="M40 18 L 26 4 L 50 14 Z M40 48 L 26 62 L 50 52 Z" fill="var(--bk-crew)" />
      <path d="M28 33 C 28 18 56 10 86 14 C 104 17 116 26 118 33 C 116 40 104 49 86 52 C 56 56 28 48 28 33 Z" fill="var(--bk-crew)" />
      <path d="M96 16 C 108 20 116 27 118 33 C 116 39 108 46 96 50 C 100 40 100 26 96 16 Z" fill="var(--bk-ink)" fillOpacity="0.85" />
      <circle cx="72" cy="31" r="10" fill="var(--bk-gold2)" />
      <circle cx="72" cy="31" r="7" fill="var(--bk-glass)" />
    </svg>
  );
}

/** Значок экипажа в шапке (кружок цвета экипажа со звёздочкой). */
export function CrewMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="bkp-mark">
      <circle cx="11" cy="11" r="10" fill="var(--bk-crew)" />
      <path d="M11 5 L 12.8 9.2 L 17.2 9.4 L 13.8 12.2 L 15 16.6 L 11 14.1 L 7 16.6 L 8.2 12.2 L 4.8 9.4 L 9.2 9.2 Z" fill="var(--bk-on-crew)" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r="36" fill="var(--bk-gold)" />
      <rect x="26" y="22" width="8" height="32" rx="3" fill="var(--bk-on-gold)" />
      <rect x="42" y="22" width="8" height="32" rx="3" fill="var(--bk-on-gold)" />
    </svg>
  );
}

export function ShakePhone() {
  return (
    <svg width="150" height="130" viewBox="0 0 150 130" aria-hidden="true" className="bkp-shake-art">
      <path d="M26 40 C 16 56 16 74 26 90 M14 32 C 0 54 0 76 14 98" fill="none" stroke="var(--bk-ice)" strokeWidth="4" strokeLinecap="round" />
      <path d="M124 40 C 134 56 134 74 124 90 M136 32 C 150 54 150 76 136 98" fill="none" stroke="var(--bk-ice)" strokeWidth="4" strokeLinecap="round" />
      <rect x="48" y="12" width="54" height="106" rx="12" fill="none" stroke="var(--bk-gold)" strokeWidth="5" />
      <circle cx="75" cy="65" r="16" fill="none" stroke="var(--bk-ice)" strokeWidth="4" />
    </svg>
  );
}

export function Wrench() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <path d="M30 6 a 9 9 0 0 0 -8 12 L 6 34 l 4 4 L 26 22 a 9 9 0 0 0 12 -8 l -5 5 -5 -1 -1 -5 Z" fill="var(--bk-ink-dark)" />
    </svg>
  );
}

/** Значок тайной роли: маска диверсанта или звезда честного. */
export function RoleBadge({ saboteur }: { saboteur: boolean }) {
  if (saboteur) {
    return (
      <svg width="70" height="40" viewBox="0 0 70 40" aria-hidden="true">
        <path d="M4 8 C 18 2 52 2 66 8 C 66 26 52 36 42 30 C 38 28 32 28 28 30 C 18 36 4 26 4 8 Z" fill="var(--bk-coral)" />
        <ellipse cx="22" cy="16" rx="7" ry="5" fill="var(--bk-bg)" />
        <ellipse cx="48" cy="16" rx="7" ry="5" fill="var(--bk-bg)" />
      </svg>
    );
  }
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <path d="M22 2 L 27.6 15.4 L 42 16.4 L 31 25.6 L 34.6 40 L 22 32.2 L 9.4 40 L 13 25.6 L 2 16.4 L 16.4 15.4 Z" fill="var(--bk-coral)" />
    </svg>
  );
}

export function ShieldCheck() {
  return (
    <svg width="70" height="80" viewBox="0 0 70 80" aria-hidden="true">
      <path d="M35 4 L 64 14 V 38 C 64 58 50 70 35 76 C 20 70 6 58 6 38 V 14 Z" fill="var(--bk-sage)" />
      <path d="M22 40 L 31 49 L 50 30" fill="none" stroke="var(--bk-bg)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Детские предметы — картинки 20 предметов ТЗ (смайлики на круге цвета предмета). */
export const KIDS_ART: Record<string, string> = {
  frog: "🐸",
  banana: "🍌",
  rocket: "🚀",
  sun: "☀️",
  ball: "⚽",
  fish: "🐟",
  star: "⭐",
  car: "🚗",
  balloon: "🎈",
  cube: "🧊",
  hedgehog: "🦔",
  cake: "🎂",
  umbrella: "☂️",
  apple: "🍎",
  bell: "🔔",
  butterfly: "🦋",
  whale: "🐋",
  elephant: "🐘",
  mushroom: "🍄",
  moon: "🌙",
};

/** Цветов детских предметов (`tint`, по `KIDS_TINTS`): цвета — переменные `--bk-tint-N` в phone.css. */
export const KIDS_TINTS_COUNT = 8;

export function KidsArt({ icon, tint, size = 44 }: { icon: string | null; tint: number | null; size?: number }) {
  const bg = tint === null ? "var(--bk-kid-bg)" : `var(--bk-tint-${tint % KIDS_TINTS_COUNT})`;
  return (
    <span className="bkp-kid" style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.6) }} aria-hidden="true">
      {(icon && KIDS_ART[icon]) || "★"}
    </span>
  );
}
