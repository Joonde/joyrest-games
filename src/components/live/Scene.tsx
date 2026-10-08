import type { CSSProperties, ReactNode } from "react";
import { getTheme } from "../../themes/registry";

/** Псевдослучайное число 0–1 по номеру: одинаковая картинка при каждом показе. */
function rnd(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

type Vars = Record<string, string>;

/** Частицы с одинаковым набором переменных: место, размер, скорость, задержка, снос. */
function particles(count: number, salt: number, extra?: (i: number) => Vars): ReactNode {
  return Array.from({ length: count }, (_, i) => (
    <span
      key={i}
      style={
        {
          "--x": `${rnd(i, salt) * 100}%`,
          "--y": `${rnd(i, salt + 5) * 100}%`,
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

const hue = (i: number): Vars => ({ "--hue": `var(--team-${(i % 5) + 1})` });

/** Мерцающие звёздочки по краям экрана (середину оставляем тексту). */
function stars(count: number, salt: number, area: "top" | "edges" = "edges"): ReactNode {
  return (
    <div className={`scene__layer scene__stars scene__stars--${area}`}>
      {particles(count, salt, (i) => ({ "--x": `${rnd(i, salt) < 0.5 ? rnd(i, salt + 7) * 22 : 78 + rnd(i, salt + 7) * 22}%` }))}
    </div>
  );
}

/**
 * Живой фон темы-концепции на экране зала и в предпросмотре (CLAUDE.md, раздел 8). Украшения живут
 * у краёв и под текстом, середину экрана не закрывают. Только CSS (transform и opacity), ничего не
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
      {scene === "snow" && (
        <>
          <div className="scene__aurora" />
          {stars(14, 11, "top")}
          <div className="scene__layer scene__flakes scene__flakes--far">{particles(36, 1)}</div>
          <div className="scene__layer scene__flakes scene__flakes--near">{particles(16, 2)}</div>
          <div className="scene__drift" />
        </>
      )}

      {scene === "petals" && (
        <>
          <div className="scene__rays" />
          <div className="scene__layer scene__bokeh">{particles(10, 3)}</div>
          <div className="scene__layer scene__petals">{particles(26, 4)}</div>
          {stars(10, 12)}
        </>
      )}

      {scene === "spotlights" && (
        <>
          <div className="scene__layer scene__beams">{particles(4, 5)}</div>
          {themeId !== "studio" && <div className="scene__carpet" />}
          <div className="scene__layer scene__flashes">{particles(9, 6)}</div>
          {stars(12, 13)}
        </>
      )}

      {scene === "disco" && (
        <>
          <div className="scene__layer scene__lasers">{particles(4, 7, hue)}</div>
          <div className="scene__layer scene__lights">{particles(7, 8, hue)}</div>
          <div className="scene__layer scene__spots">{particles(18, 9, hue)}</div>
          <div className="scene__floor" />
          <div className="scene__ball">
            <span className="scene__string" />
            <span className="scene__globe" />
          </div>
          {stars(10, 14, "top")}
        </>
      )}

      {scene === "deco" && (
        <>
          <div className="scene__frame" />
          <div className="scene__fan scene__fan--left" />
          <div className="scene__fan scene__fan--right" />
          <div className="scene__fan scene__fan--top-left" />
          <div className="scene__fan scene__fan--top-right" />
          <div className="scene__layer scene__rise">{particles(24, 10)}</div>
          {stars(12, 15)}
        </>
      )}

      {scene === "sun" && (
        <>
          <div className="scene__sun" />
          <div className="scene__layer scene__bokeh">{particles(9, 16)}</div>
          <div className="scene__waves" />
          {stars(8, 17)}
        </>
      )}

      {scene === "leaves" && (
        <>
          <div className="scene__layer scene__bokeh">{particles(7, 18)}</div>
          <div className="scene__layer scene__leaves">{particles(22, 19, (i) => ({ "--leaf": ["#E8A25A", "#D9663F", "#F3C25E", "#B5793A"][i % 4] ?? "#E8A25A" }))}</div>
        </>
      )}

      {scene === "checker" && (
        <>
          <div className="scene__checker scene__checker--bl" />
          <div className="scene__checker scene__checker--tr" />
          <div className="scene__layer scene__rise">{particles(14, 20)}</div>
        </>
      )}

      {scene === "map" && (
        <>
          <div className="scene__trail scene__trail--left" />
          <div className="scene__trail scene__trail--right" />
          <div className="scene__compass" />
          {stars(12, 21)}
        </>
      )}

      {garland && (
        <div className="scene__garland">
          {Array.from({ length: 22 }, (_, i) => (
            <span key={i} style={{ ...hue(i), "--delay": `${(i % 3) * 0.6}s` } as CSSProperties} />
          ))}
        </div>
      )}
    </div>
  );
}
