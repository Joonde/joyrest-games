import type { QuestionKind } from "./content";

/** Контурная картинка формата вопроса для плиток конструктора (цвет — от плитки). */
export function KindIcon({ kind, music = false, picture = false }: { kind: QuestionKind; music?: boolean; picture?: boolean }) {
  const common = { viewBox: "0 0 32 32", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false };
  if (picture) {
    return (
      <svg {...common}>
        <rect x="5" y="7" width="22" height="18" rx="3" />
        <path d="M5 21l6-6 5 5 4-3 7 6" />
      </svg>
    );
  }
  if (kind === "pictures") {
    return (
      <svg {...common}>
        <rect x="5" y="5" width="10" height="10" rx="2" />
        <rect x="17" y="5" width="10" height="10" rx="2" />
        <rect x="5" y="17" width="10" height="10" rx="2" />
        <rect x="17" y="17" width="10" height="10" rx="2" />
      </svg>
    );
  }
  if (kind === "super") {
    // Сундук с ступенями-уровнями.
    return (
      <svg {...common}>
        <path d="M5 14h22v12H5z" />
        <path d="M5 14c0-5 4-8 11-8s11 3 11 8" />
        <path d="M14 18h4v4h-4z" />
        <path d="M5 20h9M18 20h9" />
      </svg>
    );
  }
  if (kind === "auction") {
    // Молоток аукциониста над подставкой.
    return (
      <svg {...common}>
        <path d="M13 7l7 7M10 10l7 7M11.5 8.5l7 7" />
        <path d="M15 13l9 9" />
        <path d="M5 26h12" />
      </svg>
    );
  }
    if (kind === "buzz") {
    return (
      <svg {...common}>
        <circle cx="16" cy="18" r="9" />
        <circle cx="16" cy="18" r="4.5" fill="currentColor" opacity=".35" />
        <path d="M16 9V5M12 5h8" />
      </svg>
    );
  }
  if (music && kind === "open") {
    return (
      <svg {...common}>
        <path d="M5 10h13M5 16h9M5 22h7" />
        <path d="M22 24V12l6-2" />
        <circle cx="20" cy="24" r="2.5" />
      </svg>
    );
  }
  if (music) {
    return (
      <svg {...common}>
        <path d="M12 23V8l14-3v15" />
        <circle cx="9" cy="23" r="3" />
        <circle cx="23" cy="20" r="3" />
      </svg>
    );
  }
  if (kind === "open") {
    return (
      <svg {...common}>
        <path d="M6 24h20M9 20l12-12 3 3-12 12H9z" />
      </svg>
    );
  }
  if (kind === "order") {
    // Карточки с номерами по порядку.
    return (
      <svg {...common}>
        <rect x="11" y="5" width="16" height="6" rx="2" />
        <rect x="11" y="13" width="16" height="6" rx="2" />
        <rect x="11" y="21" width="16" height="6" rx="2" />
        <path d="M6 6v4M5 14h2.5l-2.5 4h2.5M5 22h2.5l-1.5 2 1.5 2H5" />
      </svg>
    );
  }
  if (kind === "number") {
    // Шкала с отметкой.
    return (
      <svg {...common}>
        <path d="M4 20h24M8 17v6M16 17v6M24 17v6" />
        <path d="M19 6v10M16 9l3-3 3 3" />
      </svg>
    );
  }
  if (kind === "speed") {
    return (
      <svg {...common}>
        <circle cx="16" cy="18" r="9" />
        <path d="M16 18l4-4M13 5h6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="5" y="6" width="22" height="6" rx="3" />
      <rect x="5" y="16" width="22" height="6" rx="3" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
    </svg>
  );
}
