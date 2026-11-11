/**
 * Рисунки экрана зала «Бубликатора»: значки экипажей (линейные, как в макетах), корабль темы с шлейфом, гирлянда SOS,
 * снежный ком, маска диверсанта. Цвет экипажа — переменная `--bk-crew` (как у телефона), всё — SVG без фильтров.
 */
import type { CSSProperties } from "react";
import { Ship } from "../phone/art";
import type { Theme } from "../rules/types";

/** Значки экипажей (при 6+ экипажах): снежинка, звезда, пряник, сосулька, хлопушка, комета, кольцо, птица, луна. */
export const EMBLEMS = [
  "M12 3v18 M4.2 7.5l15.6 9 M4.2 16.5l15.6-9 M9.5 4.5L12 6.5l2.5-2 M9.5 19.5L12 17.5l2.5 2",
  "M12 3.5l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.8l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7z",
  "M12 4a8 8 0 1 0 0.01 0z M9 10h.01 M15 10h.01 M8.5 14.5c2 1.6 5 1.6 7 0",
  "M4.5 4h15 M7 4l2 8 1.2-4 1.8 12 1.8-12 1.2 4 2-8",
  "M4 20l5-12 7 7z M14 5l1-2 M18 9l2-1 M17 5.5l1.5-1.5 M7.5 15l2 2",
  "M19 9.5a4 4 0 1 1-8 0a4 4 0 1 1 8 0z M11.6 12.4L3.5 20.5 M11 8.5L4 11.5 M14.5 13L11.5 20",
  "M8 12a4 4 0 1 1 8 0a4 4 0 1 1-8 0z M2.5 14c1 2.6 18-1.6 19-5.4",
  "M3 9c3 0 6 3 9 3s6-3 9-3 M7.5 10.5L12 16l4.5-5.5",
  "M15 4a8 8 0 1 0 5 13a7 7 0 1 1-5-13z",
];

/** Цвет экипажа — цвета команд платформы (`--team-N`), текст на нём тёмный. */
export function crewVars(color: number): CSSProperties {
  return { "--bk-crew": `var(--team-${(color % 5) + 1}, #e3aa9c)` } as CSSProperties;
}

/** Кружок экипажа: цвет и значок (без значка — звезда). */
export function CrewBadge({ icon }: { icon: number | null }) {
  const d = icon === null ? EMBLEMS[1] : (EMBLEMS[icon % EMBLEMS.length] ?? EMBLEMS[1]);
  return (
    <svg className="bks-badge" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="var(--bk-crew)" />
      <g transform="translate(4.8 4.8) scale(0.6)">
        <path d={d} fill="none" stroke="#221e1b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** Корабль темы (тот же рисунок, что у телефона). Размер задаёт CSS. */
export function CrewShip({ theme, label }: { theme: Theme; label: string }) {
  return (
    <span className="bks-ship">
      <Ship theme={theme} label={label} />
    </span>
  );
}

/** Огонёк гирлянды SOS: четыре цвета, у каждого своя фигура (как у телефона). */
export const SOS_SHAPES = ["●", "▲", "■", "◆"];
export const SOS_NAMES = ["красный", "жёлтый", "зелёный", "синий"];

/** Маска диверсанта (раскрытие). */
export function Mask() {
  return (
    <svg viewBox="0 0 100 60" className="bks-mask" aria-hidden="true">
      <path d="M6 14 C 26 4 74 4 94 14 C 94 40 74 54 60 46 C 55 43 45 43 40 46 C 26 54 6 40 6 14 Z" fill="#221e1b" />
      <ellipse cx="31" cy="25" rx="10" ry="7" fill="#fbf6f1" />
      <ellipse cx="69" cy="25" rx="10" ry="7" fill="#fbf6f1" />
    </svg>
  );
}

/** Снежный ком / чёрная дыра / кракен… — что тянет назад в «Притяжении» (одна сердитая фигура на все темы). */
export function Puller() {
  return (
    <svg viewBox="0 0 200 200" className="bks-puller" aria-hidden="true">
      <circle cx="100" cy="100" r="96" fill="#e8eef7" />
      <circle cx="100" cy="100" r="96" fill="none" stroke="#c3cee0" strokeWidth="6" />
      <path d="M58 82 L 88 92" stroke="#221e1b" strokeWidth="8" strokeLinecap="round" />
      <path d="M142 82 L 112 92" stroke="#221e1b" strokeWidth="8" strokeLinecap="round" />
      <circle cx="74" cy="102" r="9" fill="#221e1b" />
      <circle cx="126" cy="102" r="9" fill="#221e1b" />
      <path d="M70 140 C 86 128 114 128 130 140" fill="none" stroke="#221e1b" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

/** Знак JoyRest для шапки экрана. */
export function Mono() {
  return (
    <span className="bks-mono" aria-hidden="true">
      J✦R
    </span>
  );
}

/** Цель перелёта у финишной черты: ёлка, станция-пончик, остров с сундуком, затонувший корабль, свадебный торт. */
export function Goal({ theme }: { theme: Theme }) {
  if (theme === "newyear") {
    return (
      <svg viewBox="0 0 120 150" className="bks-goal__art" aria-hidden="true">
        <path d="M60 22 L 100 74 H 84 L 110 112 H 10 L 36 74 H 20 Z" fill="#2f6b4f" />
        <path d="M28 70 C 50 80 72 80 94 68 M20 104 C 48 116 76 116 102 102" fill="none" stroke="#e3c68c" strokeWidth="3" />
        <circle cx="46" cy="90" r="5" fill="#e5776a" />
        <circle cx="74" cy="60" r="5" fill="#9cc3d5" />
        <circle cx="82" cy="96" r="5" fill="#f0cf5f" />
        <rect x="52" y="112" width="16" height="16" fill="#8a5c2a" />
        <path d="M60 4 l 5 11 12 1 -9 8 3 12 -11 -6 -11 6 3 -12 -9 -8 12 -1 z" fill="#f3dfae" />
      </svg>
    );
  }
  if (theme === "space") {
    return (
      <svg viewBox="0 0 120 120" className="bks-goal__art" aria-hidden="true">
        <circle cx="60" cy="60" r="50" fill="#e8b27a" />
        <path d="M14 52 C 22 20 98 18 106 52 C 100 70 92 60 84 66 C 76 72 70 62 60 68 C 50 74 44 62 34 68 C 24 72 18 64 14 52 Z" fill="#eba2c4" />
        <circle cx="60" cy="60" r="17" fill="#120e26" />
        <path d="M34 36 l 6 2 M50 28 l 3 5 M74 30 l -2 6 M88 42 l -6 2" stroke="#fbf6f1" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (theme === "pirates") {
    return (
      <svg viewBox="0 0 140 120" className="bks-goal__art" aria-hidden="true">
        <ellipse cx="70" cy="104" rx="64" ry="14" fill="#e3c68c" />
        <path d="M78 102 C 76 70 80 46 92 26" fill="none" stroke="#8a5c2a" strokeWidth="6" strokeLinecap="round" />
        <path d="M92 26 C 76 16 62 20 54 30 M92 26 C 104 14 120 16 128 28 M92 26 C 92 10 104 4 114 6 M92 26 C 82 30 74 42 74 52" fill="none" stroke="#3f8a5c" strokeWidth="7" strokeLinecap="round" />
        <rect x="30" y="74" width="40" height="26" rx="4" fill="#8a5c2a" />
        <path d="M30 82 H 70" stroke="#f0cf5f" strokeWidth="3" />
        <rect x="46" y="80" width="8" height="10" rx="1" fill="#f0cf5f" />
      </svg>
    );
  }
  if (theme === "submarine") {
    return (
      <svg viewBox="0 0 140 110" className="bks-goal__art" aria-hidden="true">
        <path d="M10 92 L 30 64 H 118 L 132 92 Z" fill="#4b6a6a" transform="rotate(-8 70 80)" />
        <path d="M70 66 L 66 14 M 66 22 L 98 40 L 66 46" fill="none" stroke="#7d9a8f" strokeWidth="5" strokeLinejoin="round" />
        <circle cx="52" cy="76" r="5" fill="#2c3f45" />
        <circle cx="74" cy="74" r="5" fill="#2c3f45" />
        <circle cx="96" cy="72" r="5" fill="#2c3f45" />
        <path d="M18 104 C 30 96 44 100 54 104 M86 104 C 100 98 116 98 128 104" stroke="#a3c2aa" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 130" className="bks-goal__art" aria-hidden="true">
      <rect x="14" y="88" width="92" height="30" rx="6" fill="#fbf6f1" />
      <rect x="26" y="58" width="68" height="30" rx="6" fill="#f6ece2" />
      <rect x="38" y="32" width="44" height="26" rx="6" fill="#fbf6f1" />
      <path d="M14 100 C 30 108 46 92 60 100 C 74 108 90 92 106 100 M26 70 C 40 76 50 64 60 70 C 70 76 82 64 94 70" fill="none" stroke="#eba2c4" strokeWidth="4" />
      <path d="M60 30 C 54 18 42 20 46 30 C 50 38 60 36 60 30 C 60 36 70 38 74 30 C 78 20 66 18 60 30 Z" fill="#e5776a" />
    </svg>
  );
}
