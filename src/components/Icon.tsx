/**
 * Простые контурные значки пульта (24×24, цвет — currentColor). Рисуем сами: без внешних наборов
 * и шрифтов-иконок, чтобы пульт открывался быстро и одинаково везде.
 */
const PATHS = {
  gong: "M12 3v2M7 5h10M12 9a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 12.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM18 19l3 2",
  drum: "M4 9c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 9v7c0 1.7 3.6 3 8 3s8-1.3 8-3V9M8 3l3 5M16 3l-3 5",
  fanfare: "M3 10v4h4l6 4V6l-6 4H3zM16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10",
  applause: "M8 13l-2-4.5a1.3 1.3 0 0 1 2.3-1.2L11 12M11 12l-2.5-6a1.3 1.3 0 0 1 2.4-1L14 11M14 11l-1.6-4.2a1.3 1.3 0 0 1 2.4-.9L18 13c1.2 3-.3 6-3.3 7s-5.2-.3-6.5-2.5L6 14M19 3l1-1M21 6l1.5-.5M17 2l.2-1.2",
  wrong: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6",
  stop: "M7 7h10v10H7z",
  game: "M8 5v14l11-7z",
  sound: "M4 10v4h4l5 4V6l-5 4H4zM16.5 9a4 4 0 0 1 0 6",
  music: "M9 18V5l11-2v13M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
  slides: "M3 4h18v12H3zM8 20h8M12 16v4",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.5 3.5-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.3 3.3 0 0 1 0 6.3M17.5 14.7c2 .6 3.4 2.6 4 5.3",
  screen: "M3 4h18v12H3zM8 20h8M12 16v4",
  remote: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01",
  intro: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
  rules: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  round: "M5 21V4M5 4h11l-2 4 2 4H5",
  break: "M4 8h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V8zM17 9h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3",
  award: "M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9.5 17h5v4h-5z",
  thanks: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  custom: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={["icon", className].filter(Boolean).join(" ")} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
