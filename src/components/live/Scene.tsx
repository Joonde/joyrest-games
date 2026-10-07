import type { CSSProperties } from "react";
import { getTheme } from "../../themes/registry";

/** Псевдослучайное число 0–1 по номеру: одинаковая картинка при каждом показе. */
function rnd(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const COUNTS = { snow: 42, petals: 22, disco: 7, spotlights: 3, flashes: 5, bulbs: 18 } as const;

function particles(count: number, salt: number, extra?: (i: number) => CSSProperties) {
  return Array.from({ length: count }, (_, i) => (
    <span
      key={i}
      style={
        {
          "--x": `${rnd(i, salt) * 100}%`,
          "--size": `${0.4 + rnd(i, salt + 1) * 0.9}`,
          "--dur": `${8 + rnd(i, salt + 2) * 10}s`,
          "--delay": `${-rnd(i, salt + 3) * 18}s`,
          "--drift": `${(rnd(i, salt + 4) - 0.5) * 16}cqw`,
          ...extra?.(i),
        } as CSSProperties
      }
    />
  ));
}

/**
 * Живой фон темы-концепции на экране зала и в предпросмотре (CLAUDE.md, раздел 8): снег, лепестки,
 * прожекторы, огни диско, ар-деко, гирлянда. Только CSS (transform и opacity), ничего не
 * перехватывает; при «уменьшить движение» анимаций нет. Телефонам гостей фон не нужен.
 */
export function Scene({ themeId }: { themeId: string }) {
  const effects = getTheme(themeId).effects;
  if (!effects || (effects.scene === "none" && !effects.garland)) return null;
  const { scene, garland } = effects;
  return (
    <div
      className={`scene scene--${scene}`}
      aria-hidden="true"
      style={{ "--scene-particle": effects.particle, "--scene-glow": effects.glow } as CSSProperties}
    >
      {scene === "snow" && <div className="scene__layer scene__flakes">{particles(COUNTS.snow, 1)}</div>}
      {scene === "petals" && <div className="scene__layer scene__petals">{particles(COUNTS.petals, 2)}</div>}
      {scene === "spotlights" && (
        <>
          <div className="scene__layer scene__beams">{particles(COUNTS.spotlights, 3)}</div>
          <div className="scene__layer scene__flashes">{particles(COUNTS.flashes, 4)}</div>
        </>
      )}
      {scene === "disco" && (
        <>
          <div className="scene__layer scene__lights">
            {particles(COUNTS.disco, 5, (i) => ({ "--hue": `var(--team-${(i % 5) + 1})` }) as CSSProperties)}
          </div>
          <div className="scene__ball" />
        </>
      )}
      {scene === "deco" && (
        <>
          <div className="scene__fan scene__fan--left" />
          <div className="scene__fan scene__fan--right" />
          <div className="scene__sweep" />
        </>
      )}
      {garland && (
        <div className="scene__garland">
          {Array.from({ length: COUNTS.bulbs }, (_, i) => (
            <span key={i} style={{ "--hue": `var(--team-${(i % 5) + 1})`, "--delay": `${(i % 3) * 0.6}s` } as CSSProperties} />
          ))}
        </div>
      )}
    </div>
  );
}
