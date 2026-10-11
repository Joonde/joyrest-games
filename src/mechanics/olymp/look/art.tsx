// «Олимп» — картинки из согласованного прототипа: эмблемы богов с переливом, значки стихий, храм,
// алтарь с меандром, шкала исходов, драхма (Олимп / Афина), «живой» босс, значки страниц телефона.
import type { CSSProperties, ReactNode } from "react";
import type { ElementId } from "../rules";
import { ELEMENT_NAMES } from "../rules";

// ------------------------------------------------------------------ эмблемы

const EMB_COLORS: Record<string, [string, string, string]> = {
  zeus: ["#C9A15F", "#F7E6B8", "#2A2010"],
  hades: ["#5B4F8C", "#C9C0F0", "#F4F1FF"],
  athena: ["#5F7F90", "#D7EAF3", "#14222B"],
  hestia: ["#B66E5D", "#F6CDBE", "#2B140F"],
  poseidon: ["#3F6E8C", "#BFE0F0", "#0E1E28"],
  hermes: ["#6E8F5A", "#DDEFC8", "#16200F"],
  artemis: ["#7C8FB0", "#E6ECF8", "#141B2B"],
  hephaestus: ["#8C5A3A", "#F0C9A8", "#24140A"],
  ares: ["#8C3A3A", "#F0B8B0", "#2A0E0E"],
  apollo: ["#B08A2E", "#F8E6A8", "#2A1E06"],
  demeter: ["#6E7A4A", "#E6E2A8", "#1B1F0E"],
  foe: ["#2b2540", "#9EC3D6", "#CFE8F5"],
};

const G = "var(--g)";

const GLYPHS: Record<string, ReactNode> = {
  bolt: <polygon points="28,3 11,27 21,27 17,45 37,19 26,19 31,3" fill={G} />,
  bident: (
    <g fill="none" stroke={G} strokeWidth="3.6" strokeLinecap="round">
      <path d="M24 45 V16" />
      <path d="M15 5 V15 Q15 22 24 22 Q33 22 33 15 V5" />
    </g>
  ),
  owl: (
    <g fill="none" stroke={G} strokeWidth="3" strokeLinecap="round">
      <circle cx="17" cy="22" r="6" />
      <circle cx="31" cy="22" r="6" />
      <circle cx="17" cy="22" r="1.6" fill={G} />
      <circle cx="31" cy="22" r="1.6" fill={G} />
      <path d="M11 12 L16 16 M37 12 L32 16 M22 29 L24 33 L26 29 M13 32 Q24 46 35 32" />
    </g>
  ),
  hearth: <path d="M24 45 C13 45 11 34 17 26 C17 32 21 33 21 28 C21 20 26 14 26 4 C35 13 39 25 35 35 C33 41 29 45 24 45Z" fill={G} />,
  trident: (
    <g fill="none" stroke={G} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M24 46 V12" />
      <path d="M12 6 V16 Q12 22 24 22 Q36 22 36 16 V6" />
      <path d="M24 4 L20 10 M24 4 L28 10 M12 6 L9 11 M36 6 L39 11" />
    </g>
  ),
  caduceus: (
    <g fill="none" stroke={G} strokeWidth="3" strokeLinecap="round">
      <path d="M24 46 V6" />
      <path d="M24 10 Q14 4 6 10 Q14 12 24 14 M24 10 Q34 4 42 10 Q34 12 24 14" />
      <path d="M17 18 Q31 22 24 28 Q17 34 31 38 M31 18 Q17 22 24 28 Q31 34 17 38" />
    </g>
  ),
  moon: (
    <g>
      <path d="M30 6 A18 18 0 1 0 30 42 A14 14 0 1 1 30 6Z" fill={G} />
      <path d="M38 14 L40 10 M42 20 L46 19" stroke={G} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  anvil: (
    <g fill={G}>
      <path d="M6 18 H38 Q40 24 32 26 L30 32 H36 V38 H12 V32 H18 L16 26 Q8 24 6 18Z" />
      <rect x="30" y="4" width="12" height="6" rx="1.5" transform="rotate(30 36 7)" />
      <path d="M27 12 L33 8" stroke={G} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  helm: (
    <g fill={G}>
      <path d="M24 4 C12 4 8 14 8 24 V42 H18 V30 H14 V24 H34 V30 H30 V42 H40 V24 C40 14 36 4 24 4Z" />
      <path d="M24 4 V0" stroke={G} strokeWidth="4" />
    </g>
  ),
  lyre: (
    <g fill="none" stroke={G} strokeWidth="3" strokeLinecap="round">
      <path d="M12 6 Q8 26 18 38 H30 Q40 26 36 6" />
      <path d="M14 12 H34" />
      <path d="M20 14 V36 M24 14 V36 M28 14 V36" strokeWidth="1.6" />
      <path d="M16 42 H32" />
    </g>
  ),
  wheat: (
    <g fill={G} stroke={G} strokeWidth="2.4" strokeLinecap="round">
      <path d="M24 45 V10" fill="none" />
      <ellipse cx="24" cy="8" rx="3" ry="5" />
      <ellipse cx="19" cy="15" rx="2.6" ry="4.4" transform="rotate(-30 19 15)" />
      <ellipse cx="29" cy="15" rx="2.6" ry="4.4" transform="rotate(30 29 15)" />
      <ellipse cx="19" cy="24" rx="2.6" ry="4.4" transform="rotate(-30 19 24)" />
      <ellipse cx="29" cy="24" rx="2.6" ry="4.4" transform="rotate(30 29 24)" />
    </g>
  ),
  foe: (
    <g>
      <ellipse cx="17" cy="22" rx="6" ry="3.4" fill={G} />
      <ellipse cx="31" cy="22" rx="6" ry="3.4" fill={G} />
      <path d="M14 33 Q24 39 34 33" stroke={G} strokeWidth="2.4" fill="none" />
    </g>
  ),
};

/** Эмблема с переливом и золотым кольцом. `god` — id бога (цвета), `glyph` — символ. */
export function Emb({ god, glyph, size, className = "", style, children }: { god: string; glyph: string; size?: string; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const [c1, c2, g] = EMB_COLORS[god] ?? EMB_COLORS.foe ?? ["#C9A15F", "#F3DFAE", "#221E1B"];
  // Перелив у всех эмблем не в такт: задержка от имени.
  const delay = -((god.length * 7 + glyph.length * 3) % 36) / 10;
  return (
    <span
      className={`olx-emb ${className}`}
      style={{ ["--c1" as string]: c1, ["--c2" as string]: c2, ["--g" as string]: g, ["--d" as string]: `${delay}s`, ...(size ? { ["--s" as string]: size } : {}), ...style }}
      aria-hidden="true"
    >
      <span className="olx-emb__core">
        <svg viewBox="0 0 48 48">{GLYPHS[glyph] ?? GLYPHS.foe}</svg>
      </span>
      {children}
    </span>
  );
}

/** Портреты богов, которые уже нарисованы (public/olymp/img). Остальные — эмблема. */
export const PORTRAITS = new Set(["zeus", "hades", "athena", "poseidon", "hestia", "hermes", "artemis", "hephaestus"]);
export const portraitOf = (god: string): string | null => (PORTRAITS.has(god) ? `/olymp/img/${god}.jpg` : null);

// ------------------------------------------------------------------ стихии

export const EL_COLORS: Record<ElementId, string> = {
  fire: "#E8875A",
  water: "#6FA8D6",
  ice: "#BFE3F2",
  bolt: "#F3D46B",
  earth: "#B99369",
  wind: "#A9D3B5",
  light: "#FFF0B8",
  dark: "#9C8FD6",
  poison: "#8FC46A",
  chaos: "#D98AB8",
};

const EL_ICONS: Record<ElementId, ReactNode> = {
  fire: <path d="M12 22c-4 0-6-3-5-6 0 2 2 2 2 0 0-3 2-5 2-9 3 3 6 7 5 11-1 3-2 4-4 4z" fill="currentColor" />,
  water: <path d="M12 3c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12z" fill="currentColor" />,
  ice: <path d="M12 2v20M3.5 7l17 10M3.5 17l17-10M9 4l3 2 3-2M9 20l3-2 3 2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />,
  bolt: <polygon points="13,2 5,14 11,14 10,22 19,9 13,9" fill="currentColor" />,
  earth: <path d="M2 20l7-12 4 6 3-4 6 10z" fill="currentColor" />,
  wind: <path d="M3 8h11a3 3 0 1 0-3-3M3 13h16a3 3 0 1 1-3 3M3 18h7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />,
  light: (
    <>
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  dark: <path d="M15 3a9 9 0 1 0 6 12A7 7 0 0 1 15 3z" fill="currentColor" />,
  poison: (
    <>
      <path d="M9 3h6M10 3v5l-4 7a4 4 0 0 0 4 6h4a4 4 0 0 0 4-6l-4-7V3" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <circle cx="12" cy="16" r="1.6" fill="currentColor" />
    </>
  ),
  chaos: <path d="M12 12m-1 0a1 1 0 1 1 2 0a3 3 0 1 1-6 0a5 5 0 1 1 10 0a7 7 0 1 1-14 0" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />,
};

export function ElIcon({ el, size = 16 }: { el: ElementId; size?: number | string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ color: EL_COLORS[el] }} aria-hidden="true">
      {EL_ICONS[el]}
    </svg>
  );
}

export function ElChip({ el }: { el: ElementId }) {
  return (
    <span className="olx-elchip" style={{ ["--ec" as string]: EL_COLORS[el] }}>
      <ElIcon el={el} size={14} />
      {ELEMENT_NAMES[el]}
    </span>
  );
}

// ------------------------------------------------------------------ храм и декорации мест

export function Temple({ className = "olx-temple" }: { className?: string }) {
  const cols = [100, 188, 276, 364, 452, 540];
  const dentils = [80, 124, 168, 212, 256, 300, 344, 388, 432, 476, 520, 560];
  const brazier = (x: number) => (
    <g transform={`translate(${x} 318)`}>
      <path d="M-14 -24 H14 L8 -12 H-8 Z" fill="#8C6224" />
      <path d="M-2 -12 L-10 2 M2 -12 L10 2 M0 -12 V2" stroke="#6B4A1C" strokeWidth="2.4" />
      <path className="olx-flame" d="M0 -60 C10 -44 14 -32 8 -24 H-8 C-14 -32 -8 -44 0 -60Z" fill="#F6B25A" />
      <path className="olx-flame olx-flame--2" d="M0 -48 C6 -38 8 -30 4 -24 H-4 C-8 -30 -5 -38 0 -48Z" fill="#FFE7A8" />
    </g>
  );
  return (
    <svg className={className} viewBox="0 0 640 360" aria-hidden="true">
      <defs>
        <linearGradient id="olx-warm" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD9A0" />
          <stop offset="1" stopColor="#B8642C" />
        </linearGradient>
        <linearGradient id="olx-marble" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6E7884" />
          <stop offset=".45" stopColor="#B9C0C8" />
          <stop offset=".7" stopColor="#9AA3AD" />
          <stop offset="1" stopColor="#58616C" />
        </linearGradient>
        <linearGradient id="olx-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8E98A3" />
          <stop offset="1" stopColor="#4E5660" />
        </linearGradient>
      </defs>
      <rect className="olx-win" x="70" y="104" width="500" height="184" fill="url(#olx-warm)" opacity=".8" />
      <rect x="70" y="104" width="500" height="184" fill="rgba(10,8,6,.45)" />
      <rect x="290" y="150" width="60" height="138" fill="#1b130c" opacity=".7" />
      {cols.map((x) => (
        <g key={x} transform={`translate(${x} 0)`}>
          <polygon points="-20,288 20,288 17,112 -17,112" fill="url(#olx-marble)" />
          <path d="M-11 286 L-9.5 114 M-3.5 286 L-3 114 M3.5 286 L3 114 M11 286 L9.5 114" stroke="rgba(30,36,44,.45)" strokeWidth="1.6" />
          <path d="M-23 112 Q-24 102 -27 100 L27 100 Q24 102 23 112 Z" fill="#A9B1BA" />
          <rect x="-29" y="92" width="58" height="8" fill="#C3CAD1" />
        </g>
      ))}
      <rect x="64" y="72" width="512" height="20" fill="url(#olx-stone)" />
      <rect x="64" y="50" width="512" height="22" fill="#7C8691" />
      <g fill="#3E454E">
        {dentils.map((x) => (
          <rect key={x} x={x} y="52" width="14" height="18" />
        ))}
      </g>
      <rect x="56" y="44" width="528" height="7" fill="#C3CAD1" />
      <polygon points="56,44 320,2 584,44" fill="#A9B1BA" />
      <polygon points="80,40 320,10 560,40" fill="#59616B" />
      <circle cx="320" cy="28" r="8" fill="none" stroke="#C9A15F" strokeWidth="2.4" opacity=".9" />
      <path d="M312 8 Q320 -8 328 8" fill="#C9A15F" />
      <path d="M50 44 Q56 30 62 44" fill="#C9A15F" />
      <path d="M578 44 Q584 30 590 44" fill="#C9A15F" />
      <rect x="56" y="288" width="528" height="14" fill="#9AA3AD" />
      <rect x="42" y="302" width="556" height="16" fill="#838C96" />
      <rect x="28" y="318" width="584" height="20" fill="#6C7580" />
      <g fill="#EEF3F7" opacity=".9">
        <path d="M56 44 L320 2 L584 44 L584 47 L320 6 L56 47 Z" />
        <path d="M56 286 Q200 282 320 287 T584 286 L584 290 L56 290 Z" />
        <path d="M42 300 Q200 296 330 301 T598 300 L598 304 L42 304 Z" />
        <path d="M28 316 Q180 312 320 317 T612 316 L612 320 L28 320 Z" />
      </g>
      {brazier(40)}
      {brazier(600)}
    </svg>
  );
}

/** Декорация места: храм, лес, река, ледяные врата, море, лабиринт, луг. */
export type Decor = "temple" | "forest" | "river" | "gates" | "sea" | "maze" | "meadow";

const DECOR_OF: Record<string, Decor> = {
  olympus: "temple",
  eleusis: "temple",
  palace: "temple",
  hearth: "temple",
  lemnos: "temple",
  delphi: "temple",
  arcadia: "forest",
  acheron: "river",
  asphodel: "river",
  gates: "gates",
  sea: "sea",
  labyrinth: "maze",
  spring: "meadow",
  dawn: "meadow",
};

export const decorOf = (place: string | undefined): Decor => DECOR_OF[place ?? ""] ?? "temple";

export function PlaceArt({ decor }: { decor: Decor }) {
  if (decor === "temple") return <Temple />;
  return (
    <svg className={`olx-decor olx-decor--${decor}`} viewBox="0 0 640 360" aria-hidden="true">
      {decor === "forest" && (
        <g>
          {[40, 110, 170, 250, 330, 410, 470, 540, 600].map((x, i) => (
            <g key={x} transform={`translate(${x} ${300 - (i % 3) * 18})`} fill={i % 2 ? "#1f2d24" : "#26382c"}>
              <ellipse cx="0" cy="-80" rx={16 + (i % 3) * 4} ry={70 + (i % 2) * 20} />
              <rect x="-3" y="-14" width="6" height="40" fill="#1a1510" />
            </g>
          ))}
          <path d="M0 330 Q160 310 320 326 T640 322 V360 H0Z" fill="#dfe8ee" opacity=".55" />
        </g>
      )}
      {(decor === "river" || decor === "sea") && (
        <g>
          {decor === "river" && <path d="M0 250 Q120 236 220 248 L260 300 L0 300Z" fill="#14161b" />}
          {decor === "river" && <path d="M640 240 Q520 230 430 246 L400 300 L640 300Z" fill="#14161b" />}
          {[0, 1, 2, 3].map((i) => (
            <path key={i} className="olx-wave" style={{ animationDelay: `${-i * 1.7}s` }} d={`M-40 ${280 + i * 20} Q60 ${270 + i * 20} 160 ${280 + i * 20} T360 ${280 + i * 20} T560 ${280 + i * 20} T760 ${280 + i * 20}`} fill="none" stroke={decor === "sea" ? "#5f8fa8" : "#4a5a66"} strokeWidth="3" opacity={0.7 - i * 0.12} />
          ))}
          {decor === "river" && (
            <g transform="translate(330 268)" className="olx-boat">
              <path d="M-60 0 H60 L44 16 H-44Z" fill="#1d1915" stroke="#6b6158" strokeWidth="2" />
              <path d="M10 0 V-62" stroke="#6b6158" strokeWidth="3" />
              <circle cx="-20" cy="-14" r="7" fill="#2a2724" />
              <path d="M-26 -6 Q-20 -22 -14 -6Z" fill="#2a2724" />
              <circle cx="40" cy="-30" r="5" fill="#F6B25A" className="olx-lantern" />
            </g>
          )}
          {decor === "sea" && <path d="M440 250 L520 170 L600 250Z" fill="#2a2420" stroke="#6b6158" strokeWidth="2" />}
        </g>
      )}
      {decor === "gates" && (
        <g>
          <path d="M150 340 V140 Q320 20 490 140 V340 H420 V170 Q320 90 220 170 V340Z" fill="#9EC3D6" opacity=".35" stroke="#CFE3EE" strokeWidth="3" />
          {[180, 240, 300, 360, 420, 470].map((x, i) => (
            <path key={x} d={`M${x} ${110 + (i % 2) * 20} l8 30 l-16 0z`} fill="#E6F2F8" opacity=".7" />
          ))}
          <ellipse cx="320" cy="250" rx="70" ry="90" fill="#08090b" opacity=".8" />
        </g>
      )}
      {decor === "maze" && (
        <g fill="none" stroke="#8a7a62" strokeWidth="10" opacity=".55">
          <path d="M80 340 V120 H560 V340 M140 340 V180 H500 V300 H200 V240 H440" />
        </g>
      )}
      {decor === "meadow" && (
        <g>
          <circle cx="520" cy="80" r="46" fill="#FFE7A8" opacity=".75" className="olx-sun" />
          <path d="M0 290 Q160 260 320 286 T640 280 V360 H0Z" fill="#4c6b3e" opacity=".8" />
          {[60, 130, 210, 300, 380, 450, 530, 600].map((x, i) => (
            <circle key={x} cx={x} cy={300 + (i % 3) * 14} r="6" fill={["#E3AA9C", "#F3DFAE", "#D2A0AC"][i % 3]} />
          ))}
        </g>
      )}
    </svg>
  );
}

// ------------------------------------------------------------------ алтарь и шкала исходов

export function Altar() {
  return (
    <svg className="olx-altar" viewBox="-320 -320 640 640" aria-hidden="true">
      <defs>
        <radialGradient id="olx-alt" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#5a4a36" />
          <stop offset=".75" stopColor="#2c241b" />
          <stop offset="1" stopColor="#1a1510" />
        </radialGradient>
      </defs>
      <circle r="318" fill="url(#olx-alt)" />
      <circle r="306" fill="none" stroke="#C9A15F" strokeWidth="3" opacity=".8" />
      <circle r="268" fill="none" stroke="#C9A15F" strokeWidth="2" opacity=".6" />
      {Array.from({ length: 44 }, (_, i) => (
        <g key={i} transform={`rotate(${(i * 360) / 44})`}>
          <path d="M-14 -300 V-276 H10 V-294 H-6 V-284 H2" fill="none" stroke="#C9A15F" strokeWidth="3.2" />
        </g>
      ))}
      <circle r="250" fill="none" stroke="rgba(243,223,174,.08)" strokeWidth="40" />
    </svg>
  );
}

/** Полукруглая шкала: крит. неудача · плохо · средне · хорошо · крит. удача (пороги бросающего). */
export function Meter({ threshold, needle }: { threshold: number; needle: number | null }) {
  const R = 84;
  const pt = (v: number): [number, number] => {
    const a = Math.PI * (1 - v / 100);
    return [100 + R * Math.cos(a), 100 - R * Math.sin(a)];
  };
  const seg = (a: number, b: number, c: string) => {
    if (b <= a) return null;
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return <path key={`${a}-${c}`} d={`M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`} stroke={c} strokeWidth="13" fill="none" />;
  };
  const tick = (v: number) => {
    const a = Math.PI * (1 - v / 100);
    return (
      <text key={`t${v}`} x={(100 + (R + 15) * Math.cos(a)).toFixed(1)} y={(100 - (R + 15) * Math.sin(a) + 3).toFixed(1)} textAnchor="middle" fontSize="7" fill="#B5ABA2" fontFamily="Jost,system-ui,sans-serif">
        {v}
      </text>
    );
  };
  const t = Math.max(6, Math.min(95, threshold));
  const g = Math.min(95, t + 20);
  return (
    <svg viewBox="0 0 200 118" aria-hidden="true">
      <path d="M16 100 A84 84 0 0 1 184 100" stroke="rgba(251,246,241,.08)" strokeWidth="19" fill="none" />
      {seg(0, 5, "#8E4A3E")}
      {seg(5.6, t - 0.6, "#B9786A")}
      {seg(t, g - 0.6, "#6F8FA0")}
      {seg(g, 95.4, "#6E9277")}
      {seg(96, 100, "#E3C68C")}
      {tick(t)}
      {g < 96 && tick(g)}
      {tick(96)}
      <g className="olx-needle" style={{ transform: `rotate(${needle === null ? 0 : needle * 1.8}deg)` }}>
        <line x1="100" y1="100" x2="48" y2="100" stroke="#FBF6F1" strokeWidth="3" strokeLinecap="round" />
        <circle cx="100" cy="100" r="4.5" fill="#FBF6F1" />
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------ драхма

/** Золотая драхма: медленно вращается (Олимп / Афина), касание — подбросить. */
export function Coin({ size = 70, onToss }: { size?: number; onToss?: (side: "olymp" | "athena") => void }) {
  return (
    <button
      type="button"
      className="olx-coin"
      style={{ ["--d" as string]: `${size}px` }}
      aria-label="Подбросить драхму"
      onClick={(e) => {
        const el = e.currentTarget;
        if (el.classList.contains("is-toss")) return;
        const athena = Math.random() < 0.5;
        el.classList.toggle("is-athena", athena);
        el.classList.add("is-toss");
        window.setTimeout(() => onToss?.(athena ? "athena" : "olymp"), 1600);
        window.setTimeout(() => el.classList.remove("is-toss", "is-athena"), 3400);
      }}
    >
      <span className="olx-coin__spin">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} className="olx-coin__rim" style={{ transform: `translateZ(calc(var(--d) * ${((i - 4) * 0.009).toFixed(3)}))` }} />
        ))}
        <span className="olx-coin__face olx-coin__face--front">
          <img src="/olymp/img/coin-olymp.webp" alt="" draggable={false} />
        </span>
        <span className="olx-coin__face olx-coin__face--back">
          <img src="/olymp/img/coin-athena.webp" alt="" draggable={false} />
        </span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ «живой» противник

/** Босс с картинкой: дыхание, глаза, метка, пар, туман; `hit` и `roar` — попадание и рёв. */
export function LiveBoss({ image, name, mode, dmg, style }: { image: string; name: string; mode: "hit" | "roar" | null; dmg: string; style?: CSSProperties }) {
  return (
    <div className={`olx-lb${mode ? ` is-${mode}` : ""}`} style={style}>
      <div className="olx-lb__aura" />
      <div className="olx-lb__body">
        <img src={image} alt={name} />
        <div className="olx-lb__eye olx-lb__eye--l" />
        <div className="olx-lb__eye olx-lb__eye--r" />
        <div className="olx-lb__mark" />
        <div className="olx-lb__breath">
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
        <div className="olx-lb__flash" />
      </div>
      <div className="olx-lb__mist" />
      <div className="olx-lb__wave" />
      <span className="olx-lb__dmg">{dmg}</span>
    </div>
  );
}

/** Противник без картинки: медальон с символом, то же дыхание, удар и рёв. */
export function FoeMedal({ glyphColor, name, mode, dmg, style }: { glyphColor: string; name: string; mode: "hit" | "roar" | null; dmg: string; style?: CSSProperties }) {
  return (
    <div className={`olx-lb olx-lb--medal${mode ? ` is-${mode}` : ""}`} style={style} role="img" aria-label={name}>
      <div className="olx-lb__aura" style={{ ["--glow" as string]: glyphColor }} />
      <div className="olx-lb__body">
        <Emb god="foe" glyph="foe" size="100%" className="olx-emb--foe" />
        <div className="olx-lb__flash" />
      </div>
      <div className="olx-lb__mist" />
      <div className="olx-lb__wave" />
      <span className="olx-lb__dmg">{dmg}</span>
    </div>
  );
}

// ------------------------------------------------------------------ значки

const ICONS: Record<string, ReactNode> = {
  god: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </g>
  ),
  powers: <polygon points="13,2 5,14 11,14 10,22 19,9 13,9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  lore: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <path d="M5 17a3 3 0 0 1 3-3h11" />
    </g>
  ),
  bag: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M6 8h12l-1 13H7z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </g>
  ),
  wear: <path d="M8 3l4 3 4-3 5 4-3 4-2-1v11H8V10l-2 1-3-4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  log: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M6 3h10l3 3v15H6z" />
      <path d="M9 9h7M9 13h7M9 17h4" />
    </g>
  ),
  game: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <polygon points="12,2 21,8 18,20 6,20 3,8" />
      <path d="M12 2v9M3 8l9 3 9-3M6 20l6-9 6 9" />
    </g>
  ),
  gear: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M10.3 3h3.4l.5 2.4 1.9.8 2-1.4 2.4 2.4-1.4 2 .8 1.9 2.4.5v3.4l-2.4.5-.8 1.9 1.4 2-2.4 2.4-2-1.4-1.9.8-.5 2.4h-3.4l-.5-2.4-1.9-.8-2 1.4-2.4-2.4 1.4-2-.8-1.9L3 13.7v-3.4l2.4-.5.8-1.9-1.4-2 2.4-2.4 2 1.4 1.9-.8z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  strike: <path d="M4 20L18 6M14 4h6v6" fill="none" stroke="currentColor" strokeWidth="2" />,
  blast: (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="10.5" strokeDasharray="2 3" />
    </g>
  ),
  heal: <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" />,
  shield: <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" fill="none" stroke="currentColor" strokeWidth="2" />,
  armor: <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" fill="none" stroke="currentColor" strokeWidth="2" />,
  bless: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  curse: <path d="M12 4v14M6 12l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />,
  curseAll: (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="9" r="3" />
      <circle cx="16" cy="9" r="3" />
      <path d="M3 20c1-4 9-4 10 0M11 20c1-4 9-4 10 0" />
    </g>
  ),
  ult: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M6 14a4 4 0 0 1 1-8 5 5 0 0 1 9 1 3.5 3.5 0 0 1 1 7z" />
      <path d="M11 15l-2 4h3l-1 3" />
    </g>
  ),
  lock: (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </g>
  ),
  info: (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </g>
  ),
  hand: <path d="M9 11V5a1.5 1.5 0 0 1 3 0v5M12 10V4a1.5 1.5 0 0 1 3 0v6M15 10V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.6L9 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  art: <path d="M12 2l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 9l6-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  head: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 16c-2-5 1-10 5-11M19 16c2-5-1-10-5-11" />
      <path d="M6 10l-2-1M6 13h-2M18 10l2-1M18 13h2" />
    </g>
  ),
  body: <path d="M8 3l4 3 4-3 3 3-2 3v12H7V9L5 6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  cloak: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M8 3h8l1 3-2 15H9L7 6z" />
      <path d="M8 3c1 3 7 3 8 0" />
    </g>
  ),
  feet: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 18h12a4 4 0 0 0 4-4v-1H9L6 9" />
      <path d="M15 9l4-3M17 11l4-2" />
    </g>
  ),
  acc: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="5" r="2" />
    </g>
  ),
  cons: <path d="M9 3h6M10 3v5l-4 7a4 4 0 0 0 4 6h4a4 4 0 0 0 4-6l-4-7V3" fill="none" stroke="currentColor" strokeWidth="1.8" />,
};

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {ICONS[name] ?? ICONS.info}
    </svg>
  );
}

/** Меандр рамкой (греческий узор по краю). */
export function MeanderFrame() {
  return <div className="olx-meander" aria-hidden="true" />;
}
