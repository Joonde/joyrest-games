// Фигурки «кто выходит»: неоновые силуэты в стиле тренеров Just Dance (макет одобрен владельцем 12 октября 2026).
// Мужчина — голубой с жёлтой майкой и тёмной стрижкой, женщина — розовая с бирюзовым платьем и золотым хвостиком,
// «любой» — золотой. Белая обводка и свечение, позы танцевальные, микрофон — в караоке.
import { useId } from "react";
import type { Fig } from "./who";

type Point = [number, number];
interface Pose {
  hd: Point;
  nk: Point;
  hp: Point;
  el: Point;
  hl: Point;
  er: Point;
  hr: Point;
  kl: Point;
  fl: Point;
  kr: Point;
  fr: Point;
}

const POSES: Record<string, Pose> = {
  disco: { hd: [100, 46], nk: [100, 74], hp: [100, 160], el: [64, 52], hl: [74, 10], er: [140, 112], hr: [166, 136], kl: [80, 218], fl: [66, 280], kr: [126, 210], fr: [150, 268] },
  kick: { hd: [96, 48], nk: [98, 76], hp: [100, 160], el: [62, 112], hl: [82, 148], er: [148, 58], hr: [170, 22], kl: [86, 222], fl: [82, 284], kr: [144, 192], fr: [186, 210] },
  star: { hd: [100, 44], nk: [100, 72], hp: [100, 158], el: [56, 64], hl: [16, 40], er: [144, 64], hr: [184, 40], kl: [72, 214], fl: [50, 280], kr: [128, 214], fr: [150, 280] },
  pull: { hd: [70, 56], nk: [78, 82], hp: [104, 164], el: [118, 124], hl: [154, 138], er: [126, 114], hr: [160, 130], kl: [84, 222], fl: [52, 282], kr: [128, 218], fr: [150, 284] },
  sing: { hd: [100, 46], nk: [100, 74], hp: [100, 160], el: [134, 108], hl: [128, 74], er: [150, 92], hr: [178, 50], kl: [86, 222], fl: [80, 282], kr: [116, 220], fr: [128, 282] },
};

const PALETTE: Record<Fig, { c1: string; c2: string; a1: string; a2: string; hair: string; glow: string }> = {
  m: { c1: "#7FF0EA", c2: "#2A7BFF", a1: "#FFE066", a2: "#FF8A3D", hair: "#1B1340", glow: "rgba(69,227,220,.75)" },
  w: { c1: "#FF9FCB", c2: "#A24BFF", a1: "#7FF0EA", a2: "#2A9BFF", hair: "#FFD34D", glow: "rgba(255,95,168,.75)" },
  a: { c1: "#FFE3A1", c2: "#FF8A3D", a1: "#FF9FCB", a2: "#C2367A", hair: "#2B1640", glow: "rgba(243,201,105,.75)" },
};

export type PoseName = keyof typeof POSES;

function shape(kind: Fig, pose: PoseName, mirror: boolean) {
  const p = POSES[pose] ?? (POSES.disco as Pose);
  const X = (x: number) => (mirror ? 200 - x : x);
  const q = (k: keyof Pose, dx = 0, dy = 0) => `${X(p[k][0] + dx)} ${p[k][1] + dy}`;
  const woman = kind === "w";
  const sh = woman ? 17 : 25;
  const hw = woman ? 12 : 14;
  const dir = mirror ? -1 : 1;
  const [h0, hy] = p.hd;
  const torso = woman
    ? `M${q("nk", -sh, 8)} Q${q("nk", 0, 2)} ${q("nk", sh, 8)} Q${q("hp", 8, -60)} ${q("hp", 9, -28)} L${q("hp", -9, -28)} Q${q("hp", -8, -60)} ${q("nk", -sh, 8)}Z`
    : `M${q("nk", -sh, 6)} Q${q("nk", 0, 0)} ${q("nk", sh, 6)} L${q("hp", hw, -4)} Q${q("hp", 0, 4)} ${q("hp", -hw, -4)}Z`;
  const hair = woman
    ? `M${X(h0 - 22)} ${hy - 4} Q${X(h0 - 20)} ${hy - 30} ${X(h0 + 4)} ${hy - 28} C${X(h0 + 46)} ${hy - 32} ${X(h0 + 52)} ${hy + 26} ${X(h0 + 30)} ${hy + 48} C${X(h0 + 34)} ${hy + 22} ${X(h0 + 26)} ${hy + 2} ${X(h0 + 12)} ${hy - 8} Q${X(h0 - 4)} ${hy - 12} ${X(h0 - 22)} ${hy - 4}Z`
    : `M${X(h0 - 24)} ${hy - 2} Q${X(h0 - 24)} ${hy - 30} ${X(h0 + 2)} ${hy - 30} Q${X(h0 + 28)} ${hy - 30} ${X(h0 + 26)} ${hy - 4} Q${X(h0 + 8)} ${hy - 16} ${X(h0 - 24)} ${hy - 2}Z`;
  const foot = (k: "fl" | "fr", s: number) => `M${q(k, -6 * s * dir, 0)} l${18 * s * dir} 2`;
  return {
    uarms: `M${q("nk", -sh + 2, 10)} L${q("el")} M${q("nk", sh - 2, 10)} L${q("er")}`,
    farms: `M${q("el")} L${q("hl")} M${q("er")} L${q("hr")}`,
    thighs: `M${q("hp", -hw * 0.6, -2)} L${q("kl")} M${q("hp", hw * 0.6, -2)} L${q("kr")}`,
    shins: `M${q("kl")} L${q("fl")} M${q("kr")} L${q("fr")}`,
    feet: `${foot("fl", -1)} ${foot("fr", 1)}`,
    neck: `M${X(h0)} ${hy + 10} L${q("nk", 0, 6)}`,
    torso,
    skirt: woman ? `M${q("hp", -12, -30)} L${q("hp", 12, -30)} Q${q("hp", 30, 0)} ${q("hp", 44, 34)} Q${q("hp", 0, 50)} ${q("hp", -44, 34)} Q${q("hp", -30, 0)} ${q("hp", -12, -30)}Z` : null,
    hair,
    hands: [[X(p.hl[0]), p.hl[1]], [X(p.hr[0]), p.hr[1]]] as Point[],
    mic: `M${q("hl")} L${q("hd", 18, 16)}`,
    micAt: [X(h0 + 18), hy + 16] as Point,
    head: [X(h0), hy] as Point,
    r: woman ? 21 : 23,
  };
}

export function Dancer({ kind, pose = "disco", mirror = false, mic = false, className }: { kind: Fig; pose?: PoseName; mirror?: boolean; mic?: boolean; className?: string }) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const s = shape(kind, pose, mirror);
  const c = PALETTE[kind];
  const body = `url(#sb${uid})`;
  const accent = `url(#sa${uid})`;
  const layer = (outline: boolean) => {
    const st = outline ? "#FBF6F1" : body;
    const ac = outline ? "#FBF6F1" : accent;
    const w = (n: number) => n + (outline ? 8 : 0);
    return (
      <g fill="none" stroke={st} strokeLinecap="round" strokeLinejoin="round">
        <path d={s.thighs} strokeWidth={w(30)} />
        <path d={s.shins} strokeWidth={w(22)} />
        <path d={s.feet} stroke={ac} strokeWidth={w(14)} />
        <path d={s.neck} strokeWidth={w(14)} />
        <path d={s.torso} fill={ac} stroke={ac} strokeWidth={w(8)} />
        {s.skirt && <path d={s.skirt} fill={ac} stroke={ac} strokeWidth={w(2)} />}
        <path d={s.uarms} strokeWidth={w(22)} />
        <path d={s.farms} strokeWidth={w(16)} />
        {s.hands.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={outline ? 14 : 10} fill={st} stroke="none" />
        ))}
        <circle cx={s.head[0]} cy={s.head[1]} r={s.r + (outline ? 4 : 0)} fill={st} stroke="none" />
        <path d={s.hair} fill={outline ? "#FBF6F1" : c.hair} stroke={outline ? "#FBF6F1" : "none"} strokeWidth={outline ? 8 : 0} />
        {mic && (
          <>
            <path d={s.mic} stroke={outline ? "#FBF6F1" : "#2B2235"} strokeWidth={outline ? 16 : 8} />
            <circle cx={s.micAt[0]} cy={s.micAt[1]} r={outline ? 12 : 8} fill={outline ? "#FBF6F1" : "#2B2235"} stroke="none" />
          </>
        )}
      </g>
    );
  };
  return (
    <svg className={className ? `stage-dancer ${className}` : "stage-dancer"} viewBox="0 0 200 300" aria-hidden="true" style={{ filter: `drop-shadow(0 0 1.6cqh ${c.glow})` }}>
      <defs>
        <linearGradient id={`sb${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="300">
          <stop offset="0" stopColor={c.c1} />
          <stop offset="1" stopColor={c.c2} />
        </linearGradient>
        <linearGradient id={`sa${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1="60" x2="0" y2="220">
          <stop offset="0" stopColor={c.a1} />
          <stop offset="1" stopColor={c.a2} />
        </linearGradient>
      </defs>
      {layer(true)}
      {layer(false)}
    </svg>
  );
}

const ROTATION: PoseName[] = ["disco", "kick", "star", "disco", "kick"];

/** Группа фигурок «кто выходит»: позы чередуются, каждая вторая — зеркально. */
export function Dancers({ figs, karaoke = false, className }: { figs: Fig[]; karaoke?: boolean; className?: string }) {
  return (
    <div className={className ? `stage-dancers ${className}` : "stage-dancers"} data-count={figs.length}>
      {figs.map((f, i) => (
        <span key={i} className="stage-dancers__one" style={{ animationDelay: `${(i * 0.23) % 1}s` }}>
          <Dancer kind={f} pose={karaoke ? "sing" : (ROTATION[i % ROTATION.length] as PoseName)} mirror={i % 2 === 1} mic={karaoke} />
        </span>
      ))}
    </div>
  );
}
