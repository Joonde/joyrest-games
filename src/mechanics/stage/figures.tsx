// Фигурки «кто выходит»: картинки танцоров в стиле тренеров танцевальных видеоигр (Figma AI, 12 октября 2026; листы и нарезка —
// public/stage/art, scripts/stage-art.py). Мужчина — голубой в жёлтой майке, женщина — розовая в бирюзовом платье с
// золотым хвостиком, «любой» — золотой в розовом худи. Свечение и покачивание — CSS (вайб, который понравился владельцу).
import type { CSSProperties } from "react";
import type { Fig } from "./who";

const FILE: Record<Fig, string> = { m: "man", w: "woman", a: "any" };
const GLOW: Record<Fig, string> = { m: "rgba(69,227,220,.75)", w: "rgba(255,95,168,.75)", a: "rgba(243,201,105,.75)" };

/** Позы — номера фигурок в листе. */
const POSES = { disco: 1, kick: 2, star: 3, sway: 4, sing: 5, pull: 6 } as const;
export type PoseName = keyof typeof POSES;

/** Куда смотрит фигурка «тянет канат» в листе: мужчина и «любой» — вправо, женщина — влево. */
const PULL_RIGHT: Record<Fig, boolean> = { m: true, w: false, a: true };

export function dancerSrc(kind: Fig, pose: PoseName): string {
  return `/stage/art/${FILE[kind]}-${POSES[pose]}.webp`;
}

/**
 * Одна фигурка. `mirror` — зеркально; для позы `pull` — сторона: false — тянет вправо (стоит слева), true — влево.
 * `mic` — поёт в микрофон (поза с микрофоном).
 */
export function Dancer({ kind, pose = "disco", mirror = false, mic = false, className }: { kind: Fig; pose?: PoseName; mirror?: boolean; mic?: boolean; className?: string }) {
  const p: PoseName = mic && pose !== "pull" ? "sing" : pose;
  const flip = p === "pull" ? mirror === PULL_RIGHT[kind] : mirror;
  return (
    <img
      className={className ? `stage-dancer ${className}` : "stage-dancer"}
      src={dancerSrc(kind, p)}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ "--glow": GLOW[kind], transform: flip ? "scaleX(-1)" : undefined } as CSSProperties}
    />
  );
}

const ROTATION: PoseName[] = ["disco", "kick", "star", "sway", "disco"];

/** Группа фигурок «кто выходит»: позы чередуются, каждая вторая — зеркально. */
export function Dancers({ figs, karaoke = false, className }: { figs: Fig[]; karaoke?: boolean; className?: string }) {
  return (
    <div className={className ? `stage-dancers ${className}` : "stage-dancers"} data-count={figs.length}>
      {figs.map((f, i) => (
        <span key={i} className="stage-dancers__one" style={{ animationDelay: `${(i * 0.23) % 1}s` }}>
          <Dancer kind={f} pose={karaoke ? "sing" : (ROTATION[(i + figs.length) % ROTATION.length] as PoseName)} mirror={i % 2 === 1} mic={karaoke} />
        </span>
      ))}
    </div>
  );
}
