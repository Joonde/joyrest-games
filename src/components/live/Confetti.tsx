import { useMemo } from "react";

const COLORS = ["var(--color-highlight)", "var(--color-primary)", "#A3C2AA", "#E3AA9C", "#D2A0AC", "#B3AADD", "#F3DFAE"];

/**
 * Конфетти на экране зала (верный ответ, финиш гонки). Только CSS: падение и вращение; при
 * «уменьшить движение» — нет. `burst` меняется — конфетти летит заново.
 */
export function Confetti({ burst, count = 70 }: { burst: string; count?: number }) {
  const pieces = useMemo(() => {
    let seed = 0;
    for (const ch of burst) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed >>> 8) / 16777216;
    };
    return Array.from({ length: count }, (_, i) => ({
      left: rnd() * 100,
      delay: rnd() * 0.9,
      duration: 2.6 + rnd() * 2,
      drift: (rnd() - 0.5) * 30,
      spin: 360 + rnd() * 720,
      w: 0.5 + rnd() * 0.6,
      h: 0.25 + rnd() * 0.7,
      color: COLORS[i % COLORS.length],
    }));
  }, [burst, count]);

  return (
    <div className="confetti" aria-hidden="true" key={burst}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti__piece"
          style={{
            left: `${p.left}%`,
            width: `${p.w}cqw`,
            height: `${p.h}cqw`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ["--drift" as string]: `${p.drift}cqw`,
            ["--spin" as string]: `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}
