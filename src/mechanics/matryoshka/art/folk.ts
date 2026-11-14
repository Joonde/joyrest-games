/**
 * Матрёшка в народных росписях (решение владельца 14 ноября 2026, утверждённый лист персонажа): гжель («Солнечный двор»,
 * кобальт по белому фарфору) и хохлома («Ночной двор», чёрный лак, золото и киноварь). Перенос генератора макетов
 * (`matryoshka-mockups/src/folk.js`) один в один: те же кривые, мазки, узоры и цвета — разметка SVG строкой (рисунок не зависит
 * от данных игры, только от вида), React-обёртки — `Doll.tsx`. viewBox 0 0 400 600, ось x = 200, симметрия — зеркалом правой
 * половины; повороты головы — проекция росписи на тело вращения (`mapPt`), поэтому узоры у четырёх видов совпадают.
 */

export type Folk = "gzhel" | "khokhloma";
export type DollView = "face" | "tq" | "profile" | "back";
export type EyeState = "open" | "look" | "closed";
export type NestKind = "freeze" | "ginger" | "chairs" | "rope" | "hopscotch" | "final";
type Motif = "tulip" | "bell" | "daisy" | "berry" | "bird" | "strawberry" | "rowan" | "cherry" | "kudrina" | "travka" | "rose";
type ScarfKind = "florets" | "dots" | "grid" | "scales" | "waves" | "stars";

export interface Nest {
  title: string;
  icon: NestKind;
  motif: Motif;
  scarf: ScarfKind;
  motifName: string;
}

type Pt = [number, number];
type Seg = [number, number, number, number, number, number];

const CX = 200;
const f = (n: number): string => (Math.round(n * 10) / 10).toString();
const P = (p: Pt): string => `${f(p[0])} ${f(p[1])}`;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ темы
interface Theme {
  p: "gz" | "kh";
  name: string;
  line: string;
  ink: string;
  deep: string;
  main: string;
  mid: string;
  soft: string;
  pale: string;
  lace: string;
  laceLine: string;
  laceDot: string;
  gold: string;
  goldL: string;
  shadeInk: string;
  rim: string;
  rimLine: string;
  hairLine: string;
  lidInk: string;
  strokeInk: string;
}

export const THEMES: Record<Folk, Theme> = {
  gzhel: {
    p: "gz",
    name: "Гжель",
    line: "#132E6B",
    ink: "#0F2457",
    deep: "#142F6E",
    main: "#1B3F8B",
    mid: "#2E5AAC",
    soft: "#6E92D6",
    pale: "#B9CCEC",
    lace: "#FFFFFF",
    laceLine: "#1B3F8B",
    laceDot: "#1B3F8B",
    gold: "#C9A15F",
    goldL: "#E3C68C",
    shadeInk: "#0B1F4D",
    rim: "#9FD0FF",
    rimLine: "#D6ECFF",
    hairLine: "#5E86CF",
    lidInk: "#10224F",
    strokeInk: "#142F6E",
  },
  khokhloma: {
    p: "kh",
    name: "Хохлома",
    line: "#0C0806",
    ink: "#0C0806",
    deep: "#6E0D08",
    main: "#C2281E",
    mid: "#E0453A",
    soft: "#F07A5A",
    pale: "#F3C9A0",
    lace: "#E9C46A",
    laceLine: "#7A4A12",
    laceDot: "#B3261E",
    gold: "#D9A441",
    goldL: "#F3D27A",
    shadeInk: "#000000",
    rim: "#FFB347",
    rimLine: "#FFE3A0",
    hairLine: "#8A4A2A",
    lidInk: "#1A0C08",
    strokeInk: "#3A1A0C",
  },
};

let T: Theme = THEMES.gzhel;
const url = (name: string): string => `url(#${T.p}${name})`;
const kh = (): boolean => T.p === "kh";

// ------------------------------------------------------------------ кривые
function bez(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
  ];
}
function sample(start: Pt, segs: Seg[], n = 32): Pt[] {
  const pts: Pt[] = [start];
  let p = start;
  for (const s of segs) {
    const c1: Pt = [s[0], s[1]];
    const c2: Pt = [s[2], s[3]];
    const e: Pt = [s[4], s[5]];
    for (let i = 1; i <= n; i++) pts.push(bez(p, c1, c2, e, i / n));
    p = e;
  }
  return pts;
}
const segD = (start: Pt, segs: Seg[]): string => `M${P(start)} ` + segs.map((s) => `C${f(s[0])} ${f(s[1])} ${f(s[2])} ${f(s[3])} ${f(s[4])} ${f(s[5])}`).join(" ");
function mirror(start: Pt, segs: Seg[]): Seg[] {
  const ends: Pt[] = [start, ...segs.map((s): Pt => [s[4], s[5]])];
  const left: Seg[] = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    const p0 = ends[i];
    if (!s || !p0) continue;
    left.push([2 * CX - s[2], s[3], 2 * CX - s[0], s[1], 2 * CX - p0[0], p0[1]]);
  }
  return segs.concat(left);
}
const poly = (pts: Pt[], close = true): string => "M" + pts.map(P).join(" L") + (close ? " Z" : "");
function resample(pts: Pt[], step: number, closed: boolean): Pt[] {
  const first = pts[0];
  if (!first) return [];
  const arr = closed ? pts.concat([first]) : pts;
  const out: Pt[] = [first];
  let acc = 0;
  for (let i = 1; i < arr.length; i++) {
    let a = arr[i - 1] as Pt;
    const b = arr[i] as Pt;
    let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(q);
      a = q;
      d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      acc = 0;
    }
    acc += d;
  }
  return out;
}
function normals(pts: Pt[], ref: Pt | null): Pt[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)] as Pt;
    const b = pts[Math.min(pts.length - 1, i + 1)] as Pt;
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    if (ref && (p[0] - ref[0]) * nx + (p[1] - ref[1]) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    return [nx, ny];
  });
}
function ellPts(cx: number, cy: number, rx: number, ry: number, n = 160): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}
/** Мазок переменной толщины вдоль кубической кривой. */
function taper(p0: Pt, c1: Pt, c2: Pt, p3: Pt, wf: (t: number) => number): string {
  const L: Pt[] = [];
  const R: Pt[] = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = bez(p0, c1, c2, p3, t);
    const q = bez(p0, c1, c2, p3, Math.min(1, t + 0.01));
    const r = bez(p0, c1, c2, p3, Math.max(0, t - 0.01));
    let nx = r[1] - q[1];
    let ny = q[0] - r[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const w = wf(t) / 2;
    L.push([p[0] + nx * w, p[1] + ny * w]);
    R.unshift([p[0] - nx * w, p[1] - ny * w]);
  }
  return `M${L.map(P).join(" L")} L${R.map(P).join(" L")}Z`;
}

// ------------------------------------------------------------------ силуэт
const BODY_START: Pt = [200, 14];
const BODY_R: Seg[] = [
  [270, 14, 324, 60, 327, 136],
  [330, 198, 285, 222, 285, 256],
  [285, 288, 384, 316, 386, 420],
  [388, 502, 374, 572, 318, 582],
  [280, 585, 240, 585, 200, 585],
];
const BODY = mirror(BODY_START, BODY_R);
/** Контур тела матрёшки (viewBox 0 0 400 600). */
export const BODY_D = segD(BODY_START, BODY) + " Z";
const HALF = sample(BODY_START, BODY_R, 80);
/** Полуширина тела на высоте y. */
export function W(y: number): number {
  const h0 = HALF[0] as Pt;
  if (y <= h0[1]) return 0;
  for (let i = 1; i < HALF.length; i++) {
    const a = HALF[i - 1] as Pt;
    const b = HALF[i] as Pt;
    if (y >= a[1] && y <= b[1]) {
      const t = (y - a[1]) / (b[1] - a[1] || 1);
      return a[0] + (b[0] - a[0]) * t - CX;
    }
  }
  return 0;
}
function mapPt(p: Pt, phi: number): Pt {
  if (!phi) return p;
  const w = W(p[1]);
  if (w < 2) return p;
  const a = clamp(Math.asin(clamp((p[0] - CX) / w, -1, 1)) + phi, -Math.PI / 2, Math.PI / 2);
  return [CX + w * Math.sin(a), p[1]];
}
const mapAll = (pts: Pt[], phi: number): Pt[] => (phi ? pts.map((p) => mapPt(p, phi)) : pts);
function feat(fx: number, fy: number, phi: number, inner: string): string {
  if (!phi) return inner;
  const w = Math.max(W(fy), 20);
  const th = Math.asin(clamp((fx - CX) / w, -0.999, 0.999));
  const a = th + phi;
  if (a >= Math.PI / 2 - 0.06) return "";
  const X = CX + w * Math.sin(a);
  const sx = Math.cos(a) / Math.cos(th);
  return `<g transform="translate(${f(X)} ${f(fy)}) scale(${sx.toFixed(3)} 1) translate(${f(-fx)} ${f(-fy)})">${inner}</g>`;
}

let UID = 0;

// ------------------------------------------------------------------ определения (оба стиля)
/**
 * Общие определения SVG (градиенты, узоры, фильтры) — один раз на страницу (`<FolkDefs />`). Ещё — свечение мела и глянец банки,
 * лёд «Классиков» (прежние определения макетов `lib.js`, с приставкой `mt`).
 */
export function folkDefsInner(): string {
  return gzDefsInner() + khDefsInner() + sharedDefs();
}
function sharedDefs(): string {
  return `
  <radialGradient id="fkSkin" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#FFFDFB"/><stop offset=".7" stop-color="#FCF2EA"/><stop offset="1" stop-color="#F1DDD0"/></radialGradient>
  <radialGradient id="fkHi" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".95"/><stop offset=".6" stop-color="#FFFFFF" stop-opacity=".35"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
  <linearGradient id="fkSclera" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D6DBE6"/><stop offset=".45" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F4F5F8"/></linearGradient>
  <radialGradient id="fkBlush" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#EE8F86" stop-opacity=".62"/><stop offset="1" stop-color="#EE8F86" stop-opacity="0"/></radialGradient>
  <linearGradient id="fkLips" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E4675B"/><stop offset="1" stop-color="#B9392F"/></linearGradient>
  <linearGradient id="fkGoldLine" x1="0" x2="1"><stop offset="0" stop-color="#B8893F"/><stop offset=".5" stop-color="#F3DFAE"/><stop offset="1" stop-color="#B8893F"/></linearGradient>
  <radialGradient id="fkDoorLight" cx=".5" cy=".7" r=".7"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".5" stop-color="#FFF4C8"/><stop offset="1" stop-color="#F3D27A"/></radialGradient>
  <filter id="fkBlur3" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="fkBlur8" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="8"/></filter>
  <filter id="fkRim" filterUnits="userSpaceOnUse" x="-200" y="-200" width="800" height="1000"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="fkNeon" filterUnits="userSpaceOnUse" x="-3000" y="-3000" width="8000" height="8000"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="mtNeon" filterUnits="userSpaceOnUse" x="-3000" y="-3000" width="8000" height="8000"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <linearGradient id="mtGlass" x1="0" x2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".35" stop-color="#ffffff" stop-opacity=".12"/><stop offset="1" stop-color="#ffffff" stop-opacity=".3"/></linearGradient>
  <linearGradient id="mtIce" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E6F3F8"/><stop offset=".55" stop-color="#B9DCE8"/><stop offset="1" stop-color="#9CC3D5"/></linearGradient>
  <linearGradient id="mtIceN" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2D4B58"/><stop offset=".6" stop-color="#1F3640"/><stop offset="1" stop-color="#16262E"/></linearGradient>`;
}
function gzDefsInner(): string {
  const t = THEMES.gzhel;
  return `
  <radialGradient id="gzBodyFill" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#F6F8FD"/><stop offset="1" stop-color="#DCE4F2"/></radialGradient>
  <radialGradient id="gzApron" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".7" stop-color="#F7F9FD"/><stop offset="1" stop-color="#E2E9F5"/></radialGradient>
  <linearGradient id="gzSarafan" x1="0" x2="1"><stop offset="0" stop-color="${t.ink}"/><stop offset=".22" stop-color="${t.main}"/><stop offset=".5" stop-color="${t.mid}"/><stop offset=".78" stop-color="${t.main}"/><stop offset="1" stop-color="${t.ink}"/></linearGradient>
  <radialGradient id="gzScarf" cx=".4" cy=".22" r=".9"><stop offset="0" stop-color="#3B68BC"/><stop offset=".45" stop-color="${t.main}"/><stop offset="1" stop-color="${t.ink}"/></radialGradient>
  <radialGradient id="gzShade" cx=".4" cy=".34" r=".78"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".62" stop-color="#0B1F4D" stop-opacity="0"/><stop offset="1" stop-color="#0B1F4D" stop-opacity=".34"/></radialGradient>
  <radialGradient id="gzPetal" cx=".5" cy="1" r="1.05"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".42" stop-color="#D3E0F5"/><stop offset=".74" stop-color="#4A74C2"/><stop offset=".92" stop-color="${t.main}"/><stop offset="1" stop-color="${t.deep}"/></radialGradient>
  <radialGradient id="gzPetal2" cx=".5" cy="1" r="1.05"><stop offset="0" stop-color="#F4F7FD"/><stop offset=".32" stop-color="#B4C8EC"/><stop offset=".68" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.deep}"/></radialGradient>
  <linearGradient id="gzLeaf" x1="0" x2="1"><stop offset="0" stop-color="${t.ink}"/><stop offset=".42" stop-color="${t.mid}"/><stop offset=".78" stop-color="#9DB6E3"/><stop offset="1" stop-color="#E9F0FA"/></linearGradient>
  <linearGradient id="gzLeaf2" x1="0" x2="1"><stop offset="0" stop-color="${t.ink}"/><stop offset=".42" stop-color="${t.mid}"/><stop offset=".78" stop-color="#9DB6E3"/><stop offset="1" stop-color="#E9F0FA"/></linearGradient>
  <radialGradient id="gzCore" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#5E86CF"/><stop offset=".55" stop-color="${t.main}"/><stop offset="1" stop-color="${t.ink}"/></radialGradient>
  <radialGradient id="gzBerry" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#E9F0FA"/><stop offset=".3" stop-color="#6E92D6"/><stop offset=".75" stop-color="${t.main}"/><stop offset="1" stop-color="${t.ink}"/></radialGradient>
  <radialGradient id="gzIris" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#9DBBF0"/><stop offset=".38" stop-color="#4F7BCB"/><stop offset=".78" stop-color="${t.main}"/><stop offset="1" stop-color="#0B1A44"/></radialGradient>
  <radialGradient id="gzIrisGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".3" stop-color="#E8F7FF"/><stop offset=".6" stop-color="#8FD3FF"/><stop offset=".86" stop-color="#3D8BE0"/><stop offset="1" stop-color="#1D4C9E"/></radialGradient>
  <linearGradient id="gzHair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B1A44"/><stop offset="1" stop-color="#1E3F86"/></linearGradient>
  <radialGradient id="gzHollow" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#0B1A44"/><stop offset="1" stop-color="${t.main}"/></radialGradient>
  <radialGradient id="gzMedal" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EEF3FB"/></radialGradient>
  ${scarfPatterns("gz", "#FFFFFF", "#6E92D6")}
  <pattern id="gzGrid" patternUnits="userSpaceOnUse" width="24" height="24" patternTransform="rotate(45)"><path d="M0 0H24M0 0V24" stroke="#FFFFFF" stroke-opacity=".28" stroke-width="1.2"/><circle cx="12" cy="12" r="1.9" fill="#FFFFFF" fill-opacity=".6"/><circle cx="0" cy="0" r="2.6" fill="#FFFFFF" fill-opacity=".75"/></pattern>`;
}
function khDefsInner(): string {
  const travkaPat = (x: number, y: number, k: number, r: number, fl: number): string => {
    const keep = T;
    T = THEMES.khokhloma;
    const out = travka(x, y, k, r, fl, "#C9962F");
    T = keep;
    return out;
  };
  return `
  <radialGradient id="khBodyFill" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#3A2A24"/><stop offset=".55" stop-color="#1A1210"/><stop offset="1" stop-color="#0A0605"/></radialGradient>
  <radialGradient id="khApron" cx=".42" cy=".3" r=".9"><stop offset="0" stop-color="#2E211C"/><stop offset=".6" stop-color="#140D0B"/><stop offset="1" stop-color="#080504"/></radialGradient>
  <linearGradient id="khSarafan" x1="0" x2="1"><stop offset="0" stop-color="#050302"/><stop offset=".3" stop-color="#1A110E"/><stop offset=".5" stop-color="#24180F"/><stop offset=".7" stop-color="#1A110E"/><stop offset="1" stop-color="#050302"/></linearGradient>
  <radialGradient id="khScarf" cx=".4" cy=".22" r=".9"><stop offset="0" stop-color="#E5483A"/><stop offset=".45" stop-color="#B3261E"/><stop offset="1" stop-color="#5E0B06"/></radialGradient>
  <radialGradient id="khShade" cx=".4" cy=".34" r=".78"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".4"/></radialGradient>
  <radialGradient id="khPetal" cx=".5" cy="1" r="1.05"><stop offset="0" stop-color="#FFF4C8"/><stop offset=".35" stop-color="#F3D27A"/><stop offset=".72" stop-color="#D9A441"/><stop offset="1" stop-color="#8A5716"/></radialGradient>
  <radialGradient id="khPetal2" cx=".5" cy="1" r="1.05"><stop offset="0" stop-color="#FFB49A"/><stop offset=".4" stop-color="#E0453A"/><stop offset=".8" stop-color="#B3261E"/><stop offset="1" stop-color="#5E0B06"/></radialGradient>
  <linearGradient id="khLeaf" x1="0" x2="1"><stop offset="0" stop-color="#7A4A10"/><stop offset=".4" stop-color="#D9A441"/><stop offset=".8" stop-color="#F3D27A"/><stop offset="1" stop-color="#FFF4C8"/></linearGradient>
  <linearGradient id="khLeaf2" x1="0" x2="1"><stop offset="0" stop-color="#5E0B06"/><stop offset=".45" stop-color="#B3261E"/><stop offset=".85" stop-color="#E5483A"/><stop offset="1" stop-color="#FF9A7A"/></linearGradient>
  <radialGradient id="khCore" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#FFF4C8"/><stop offset=".5" stop-color="#E9B949"/><stop offset="1" stop-color="#8A5716"/></radialGradient>
  <radialGradient id="khBerry" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#FFD2C2"/><stop offset=".25" stop-color="#FF5A3E"/><stop offset=".7" stop-color="#C2281E"/><stop offset="1" stop-color="#5E0B06"/></radialGradient>
  <radialGradient id="khIris" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#C98A4E"/><stop offset=".4" stop-color="#8A4E22"/><stop offset=".8" stop-color="#4A2410"/><stop offset="1" stop-color="#1E0D05"/></radialGradient>
  <radialGradient id="khIrisGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".28" stop-color="#FFF4C8"/><stop offset=".6" stop-color="#FFC24A"/><stop offset=".86" stop-color="#E07A1E"/><stop offset="1" stop-color="#8A3A0C"/></radialGradient>
  <linearGradient id="khHair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140906"/><stop offset="1" stop-color="#3A1A0E"/></linearGradient>
  <radialGradient id="khHollow" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#3A1206"/><stop offset="1" stop-color="#B3261E"/></radialGradient>
  <radialGradient id="khMedal" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#2E211C"/><stop offset="1" stop-color="#0C0806"/></radialGradient>
  ${scarfPatterns("kh", "#F3D27A", "#7A1410")}
  <pattern id="khGrid" patternUnits="userSpaceOnUse" width="64" height="64">${travkaPat(14, 58, 0.42, 20, 1)}${travkaPat(50, 26, 0.36, -24, -1)}<circle cx="44" cy="52" r="3" fill="#D23A2C"/><circle cx="49" cy="55" r="2.6" fill="#D23A2C"/><circle cx="18" cy="16" r="2.4" fill="#D23A2C"/></pattern>`;
}
function scarfPatterns(p: string, c: string, c2: string): string {
  const floret = (x: number, y: number, r: number): string =>
    [0, 1, 2, 3, 4]
      .map((i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        return `<circle cx="${f(x + Math.cos(a) * r)}" cy="${f(y + Math.sin(a) * r)}" r="${f(r * 0.62)}"/>`;
      })
      .join("") + `<circle cx="${x}" cy="${y}" r="${f(r * 0.42)}" fill="${c2}"/>`;
  return `
  <pattern id="${p}Sc-florets" patternUnits="userSpaceOnUse" width="26" height="26"><g fill="${c}" fill-opacity=".92">${floret(6.5, 6.5, 3.2)}${floret(19.5, 19.5, 3.2)}<circle cx="19.5" cy="6.5" r="1.1"/><circle cx="6.5" cy="19.5" r="1.1"/></g></pattern>
  <pattern id="${p}Sc-dots" patternUnits="userSpaceOnUse" width="18" height="18"><g fill="${c}"><circle cx="4.5" cy="4.5" r="2.6"/><circle cx="13.5" cy="13.5" r="2.6"/></g><g fill="${c2}"><circle cx="13.5" cy="4.5" r="1"/><circle cx="4.5" cy="13.5" r="1"/></g></pattern>
  <pattern id="${p}Sc-grid" patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(45)"><path d="M0 0H16M0 0V16" stroke="${c}" stroke-width="1.1" stroke-opacity=".8"/><circle cx="8" cy="8" r="1.7" fill="${c}"/></pattern>
  <pattern id="${p}Sc-scales" patternUnits="userSpaceOnUse" width="20" height="12"><path d="M0 12 A10 10 0 0 1 20 12 M-10 6 A10 10 0 0 1 10 6 M10 6 A10 10 0 0 1 30 6" fill="none" stroke="${c}" stroke-width="1.3" stroke-opacity=".85"/><circle cx="10" cy="8" r="1.2" fill="${c}"/></pattern>
  <pattern id="${p}Sc-waves" patternUnits="userSpaceOnUse" width="28" height="14"><path d="M0 7 C 7 0, 7 14, 14 7 S 21 0, 28 7" fill="none" stroke="${c}" stroke-width="1.4" stroke-opacity=".85"/><circle cx="7" cy="12" r="1.1" fill="${c}"/><circle cx="21" cy="2" r="1.1" fill="${c}"/></pattern>
  <pattern id="${p}Sc-stars" patternUnits="userSpaceOnUse" width="24" height="24"><g fill="${c}"><path d="M6 1.5 L7.2 4.8 10.5 6 7.2 7.2 6 10.5 4.8 7.2 1.5 6 4.8 4.8Z"/><path d="M18 13.5 L19.2 16.8 22.5 18 19.2 19.2 18 22.5 16.8 19.2 13.5 18 16.8 16.8Z"/><circle cx="18" cy="6" r="1.1"/><circle cx="6" cy="18" r="1.1"/></g></pattern>`;
}

// ------------------------------------------------------------------ мазки
const petalD = (len: number, wid: number): string => `M0 0 C${f(-wid)} ${f(-len * 0.28)} ${f(-wid * 0.82)} ${f(-len)} 0 ${f(-len)} C${f(wid * 0.82)} ${f(-len)} ${f(wid)} ${f(-len * 0.28)} 0 0Z`;
function petal(len: number, wid: number, rot: number, o: { alt?: boolean } = {}): string {
  return (
    `<g transform="rotate(${f(rot)})"><path d="${petalD(len, wid)}" fill="${url(o.alt ? "Petal2" : "Petal")}" stroke="${T.strokeInk}" stroke-opacity=".55" stroke-width="${f(Math.max(0.5, len / 60))}"/>` +
    `<path d="M0 ${f(-len * 0.12)} Q ${f(wid * 0.18)} ${f(-len * 0.5)} 0 ${f(-len * 0.8)}" fill="none" stroke="#FFFFFF" stroke-opacity=".55" stroke-width="${f(Math.max(0.5, len / 45))}" stroke-linecap="round"/></g>`
  );
}
function leaf(len: number, wid: number, rot: number, x = 0, y = 0, o: { alt?: boolean } = {}): string {
  return (
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})"><path d="M0 0 C${f(wid)} ${f(-len * 0.3)} ${f(wid * 0.72)} ${f(-len * 0.82)} 0 ${f(-len)} C${f(-wid * 0.42)} ${f(-len * 0.74)} ${f(-wid * 0.78)} ${f(-len * 0.32)} 0 0Z" fill="${url(o.alt ? "Leaf2" : "Leaf")}" stroke="${T.strokeInk}" stroke-opacity=".5" stroke-width=".8"/>` +
    `<path d="M0 -2 Q ${f(wid * 0.2)} ${f(-len * 0.5)} 0 ${f(-len * 0.92)}" fill="none" stroke="${kh() ? "#3A1A0C" : "#FFFFFF"}" stroke-opacity="${kh() ? 0.55 : 0.7}" stroke-width="1" stroke-linecap="round"/></g>`
  );
}
function curl(s: number, rot: number, x: number, y: number, flip = 1, color?: string): string {
  const c = color || (kh() ? "#E9B949" : T.main);
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${flip} 1)"><path d="${taper([0, 0], [s * 0.15, -s * 0.62], [s * 0.92, -s * 0.74], [s * 0.86, -s * 0.3], (t) => Math.max(0.5, (s / 9) * (1 - t * 0.75)))}" fill="${c}"/><path d="M${f(s * 0.86)} ${f(-s * 0.3)} C${f(s * 0.82)} ${f(-s * 0.06)} ${f(s * 0.5)} ${f(-s * 0.08)} ${f(s * 0.54)} ${f(-s * 0.28)}" fill="none" stroke="${c}" stroke-width="${f(Math.max(0.8, s / 22))}" stroke-linecap="round"/><circle r="${f(Math.max(1.2, s / 11))}" fill="${c}"/></g>`;
}
function drops(x: number, y: number, rot: number, s = 1, color?: string | null): string {
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${s})" fill="${color || (kh() ? "#E9B949" : T.main)}"><circle cx="0" cy="0" r="3.4"/><circle cx="0" cy="-8.5" r="2.6"/><circle cx="0" cy="-15" r="1.9"/><circle cx="0" cy="-20" r="1.3"/></g>`;
}
function berries(x: number, y: number, s = 1, n = 7): string {
  const pts: Pt[] = (
    [
      [0, 0],
      [-7, -5],
      [7, -5],
      [0, -10],
      [-6, 6],
      [6, 6],
      [0, 11],
      [-12, 2],
      [12, 2],
      [-11, -10],
      [11, -10],
    ] as Pt[]
  ).slice(0, n);
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})">${pts
    .map(([a, b]) => `<circle cx="${a}" cy="${b}" r="5.2" fill="${url("Berry")}" stroke="${T.ink}" stroke-width=".6"/><circle cx="${a - 1.6}" cy="${b - 1.8}" r="1.2" fill="#FFFFFF" opacity=".85"/>${kh() ? `<circle cx="${a + 1.4}" cy="${b + 1.6}" r=".9" fill="#1A0C08"/>` : ""}`)
    .join("")}</g>`;
}
function rose(x: number, y: number, r: number): string {
  let s = `<g transform="translate(${f(x)} ${f(y)})">`;
  for (let i = 0; i < 10; i++) s += petal(r, r * 0.5, i * 36 + 8);
  for (let i = 0; i < 7; i++) s += petal(r * 0.7, r * 0.38, i * (360 / 7) + 25, { alt: kh() });
  for (let i = 0; i < 5; i++) s += petal(r * 0.46, r * 0.3, i * 72 + 4);
  s += `<circle r="${f(r * 0.24)}" fill="${url("Core")}" stroke="${T.ink}" stroke-width=".8"/>`;
  s += `<path d="M${f(-r * 0.12)} ${f(-r * 0.02)} a ${f(r * 0.12)} ${f(r * 0.12)} 0 1 1 ${f(r * 0.16)} ${f(r * 0.1)}" fill="none" stroke="#FFFFFF" stroke-opacity=".55" stroke-width="${f(Math.max(0.6, r / 40))}" stroke-linecap="round"/>`;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    s += `<circle cx="${f(Math.cos(a) * r * 0.33)}" cy="${f(Math.sin(a) * r * 0.33)}" r="${f(Math.max(0.7, r * 0.035))}" fill="#FFFFFF"/>`;
  }
  return s + `</g>`;
}
function bud(x: number, y: number, len: number, rot: number): string {
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})">${leaf(len * 0.7, len * 0.22, -40)}${leaf(len * 0.7, len * 0.22, 40)}${petal(len, len * 0.36, -22)}${petal(len, len * 0.36, 22)}${petal(len * 1.08, len * 0.34, 0, { alt: kh() })}</g>`;
}
function tulip(x: number, y: number, s: number): string {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})"><path d="M0 0 C 2 10 -2 22 0 34" stroke="${kh() ? "#E9B949" : T.main}" stroke-width="2.2" fill="none" stroke-linecap="round"/>${leaf(30, 8, -38, 0, 30)}${leaf(26, 7, 42, 0, 34)}${petal(30, 10, -26)}${petal(30, 10, 26)}${petal(34, 11, 0, { alt: kh() })}</g>`;
}
function bell(x: number, y: number, s: number, rot = 0): string {
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${rot}) scale(${s})"><path d="M0 -26 C 6 -34 16 -32 18 -26" fill="none" stroke="${T.main}" stroke-width="2" stroke-linecap="round"/><g transform="rotate(180 0 -12)"><path d="M-12 2 C -13 -14 -6 -24 0 -26 C 6 -24 13 -14 12 2 C 8 -1 4 4 0 1 C -4 4 -8 -1 -12 2Z" fill="${url("Petal")}" stroke="${T.strokeInk}" stroke-width=".8"/><path d="M-4 -20 Q -6 -10 -5 -2" stroke="#FFFFFF" stroke-opacity=".6" stroke-width="1.2" fill="none"/></g>${leaf(18, 6, -60, -4, -22)}</g>`;
}
function daisy(x: number, y: number, r: number): string {
  let s = `<g transform="translate(${f(x)} ${f(y)})">`;
  for (let i = 0; i < 12; i++) s += petal(r, r * 0.2, i * 30);
  s += `<circle r="${f(r * 0.3)}" fill="${url("Core")}"/>`;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    s += `<circle cx="${f(Math.cos(a) * r * 0.15)}" cy="${f(Math.sin(a) * r * 0.15)}" r="${f(r * 0.05)}" fill="#FFFFFF"/>`;
  }
  return s + `</g>`;
}
function bird(x: number, y: number, s: number, flip = 1): string {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s * flip)} ${f(s)})">
    ${petal(30, 6, -64, { alt: true })}${petal(34, 6.5, -78)}${petal(28, 6, -92, { alt: true })}
    <path d="M-6 6 C -8 -10 6 -20 18 -18 C 26 -17 30 -10 28 -4 C 24 8 6 14 -6 6Z" fill="${url("Petal")}" stroke="${T.strokeInk}" stroke-width=".8" transform="rotate(8)"/>
    <circle cx="22" cy="-13" r="7" fill="${url("Core")}" stroke="${T.ink}" stroke-width=".7"/><circle cx="24" cy="-14" r="1.6" fill="#FFFFFF"/>
    <path d="M28.5 -14 L35 -11.5 L28.5 -9.5Z" fill="${T.main}"/>
    ${petal(20, 7, 120, { alt: true })}${petal(18, 6, 140)}
  </g>`;
}
// хохлома: ягода земляники, рябина, вишня, травка-кудрина
function strawberry(x: number, y: number, s: number, rot = 0): string {
  let seeds = "";
  for (const [a, b] of [
    [-5, -4],
    [0, -6],
    [5, -4],
    [-6, 2],
    [0, 0],
    [6, 2],
    [-3, 7],
    [3, 7],
    [0, 12],
  ] as Pt[])
    seeds += `<path d="M${a} ${b} l1 1.8 l-1 .6 l-1 -.6z" fill="#F3D27A"/>`;
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${rot}) scale(${s})">
    <path d="M0 18 C -14 10 -16 -6 -10 -11 C -6 -14 -2 -13 0 -11 C 2 -13 6 -14 10 -11 C 16 -6 14 10 0 18Z" fill="url(#khBerry)" stroke="#3A0804" stroke-width=".9"/>
    <ellipse cx="-5" cy="-5" rx="3" ry="5" fill="#FFFFFF" opacity=".45" transform="rotate(25 -5 -5)"/>${seeds}
    <g transform="translate(0 -12)">${[-50, -18, 18, 50].map((a) => `<g transform="rotate(${a})"><path d="${petalD(9, 3.2)}" fill="url(#khLeaf)"/></g>`).join("")}<path d="M0 0 C 1 -5 4 -8 7 -9" stroke="#E9B949" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>
  </g>`;
}
function rowan(x: number, y: number, s: number): string {
  const pts: Pt[] = [
    [0, 0],
    [-8, -3],
    [8, -3],
    [-4, -11],
    [4, -11],
    [-14, 5],
    [14, 5],
    [-6, 8],
    [6, 8],
    [0, 15],
    [-12, -10],
    [12, -10],
  ];
  let g = `<g transform="translate(${f(x)} ${f(y)}) scale(${s})">`;
  g += `<path d="M0 -26 C -2 -18 -6 -14 -10 -10 M0 -26 C 2 -18 6 -14 10 -10 M0 -26 V -8" stroke="#E9B949" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  for (const [a, b] of pts) g += `<circle cx="${a}" cy="${b}" r="4.6" fill="url(#khBerry)" stroke="#3A0804" stroke-width=".6"/><circle cx="${a - 1.4}" cy="${b - 1.6}" r="1.1" fill="#FFFFFF" opacity=".8"/><path d="M${a + 1.2} ${b + 1.6} l.9 .9 M${a + 2.1} ${b + 1.6} l-.9 .9" stroke="#1A0C08" stroke-width=".7"/>`;
  return g + `</g>`;
}
function cherries(x: number, y: number, s: number): string {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})"><path d="M-8 6 C -6 -8 0 -16 6 -22 M8 8 C 8 -6 6 -14 6 -22" stroke="#E9B949" stroke-width="1.8" fill="none" stroke-linecap="round"/>${leaf(18, 6, 40, 6, -22)}
    <circle cx="-9" cy="10" r="8" fill="url(#khBerry)" stroke="#3A0804" stroke-width=".8"/><circle cx="9" cy="12" r="8" fill="url(#khBerry)" stroke="#3A0804" stroke-width=".8"/>
    <ellipse cx="-12" cy="7" rx="2" ry="3" fill="#FFFFFF" opacity=".7" transform="rotate(30 -12 7)"/><ellipse cx="6" cy="9" rx="2" ry="3" fill="#FFFFFF" opacity=".7" transform="rotate(30 6 9)"/></g>`;
}
/** Травка-кудрина: стебель-мазок с осочками и завитком на конце. */
function travka(x: number, y: number, s: number, rot = 0, flip = 1, color = "#E9B949"): string {
  const P0: Pt = [0, 0];
  const P1: Pt = [12, -16];
  const P2: Pt = [10, -38];
  const P3: Pt = [-4, -50];
  let g = `<g transform="translate(${f(x)} ${f(y)}) rotate(${rot}) scale(${f(s * flip)} ${f(s)})"><path d="${taper(P0, P1, P2, P3, (t) => 5.2 * (1 - t) + 0.9)}" fill="${color}"/>`;
  for (const [t, side, k] of [
    [0.16, 1, 1],
    [0.3, -1, 0.95],
    [0.46, 1, 0.85],
    [0.6, -1, 0.75],
    [0.74, 1, 0.6],
  ] as Array<[number, number, number]>) {
    const p = bez(P0, P1, P2, P3, t);
    const L = 17 * k;
    g += `<path d="${taper(p, [p[0] + side * L * 0.7, p[1] + L * 0.05], [p[0] + side * L * 1.05, p[1] - L * 0.65], [p[0] + side * L * 0.5, p[1] - L * 0.9], (q) => 3.4 * k * (1 - q) + 0.5)}" fill="${color}"/>`;
    g += `<circle cx="${f(p[0] + side * L * 0.5)}" cy="${f(p[1] - L * 0.9)}" r="${f(1.1 * k + 0.4)}" fill="${color}"/>`;
  }
  g += `<path d="${taper(P3, [-14, -56], [-16, -70], [-6, -72], (t) => 2.4 * (1 - t) + 0.6)}" fill="${color}"/>`;
  g += `<path d="M-6 -72 C2 -73 3 -63 -4 -63 C-8 -63 -8 -67 -5 -68" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`;
  return g + `</g>`;
}
function kudrina(x: number, y: number, r: number): string {
  let s = `<g transform="translate(${f(x)} ${f(y)})">`;
  for (let i = 0; i < 9; i++) s += `<g transform="rotate(${i * 40})"><path d="${petalD(r, r * 0.42)}" fill="url(#khPetal)" stroke="#5A3410" stroke-width=".6"/><path d="M0 ${f(-r * 0.2)} Q ${f(r * 0.08)} ${f(-r * 0.55)} 0 ${f(-r * 0.85)}" stroke="#7A4A12" stroke-width="${f(Math.max(0.6, r / 22))}" fill="none" stroke-linecap="round"/></g>`;
  s += `<circle r="${f(r * 0.34)}" fill="url(#khBerry)" stroke="#3A0804" stroke-width=".8"/><circle cx="${f(-r * 0.1)}" cy="${f(-r * 0.12)}" r="${f(r * 0.08)}" fill="#FFFFFF" opacity=".8"/>`;
  return s + `</g>`;
}
function motif(kind: Motif, x: number, y: number, s: number): string {
  switch (kind) {
    case "tulip":
      return tulip(x, y, s * 0.9);
    case "bell":
      return bell(x, y, s);
    case "daisy":
      return daisy(x, y, 13 * s);
    case "berry":
      return berries(x, y, s * 0.8);
    case "bird":
      return bird(x, y, s * 0.8);
    case "strawberry":
      return strawberry(x, y, s * 0.95);
    case "rowan":
      return rowan(x, y, s * 0.8);
    case "cherry":
      return cherries(x, y, s * 0.8);
    case "kudrina":
      return kudrina(x, y, 14 * s);
    case "travka":
      return travka(x, y + 18 * s, s * 0.7, 0, 1);
    default:
      return rose(x, y, 14 * s);
  }
}

// ------------------------------------------------------------------ глаза
const ALMOND = "M-18 2 C-12 -11.5 9 -14 19.2 -3.2 C12 9 -8 11.5 -18 2Z";
/** Глаз (поле около 40×30 вокруг 0,0): спокойный, «смотрит» (светится: гжель — холодная синь, хохлома — тёплый янтарь), закрыт. */
function eye(state: EyeState): string {
  if (state === "closed") {
    let s = `<path d="M-15 -6 C-6 -12 8 -13 17 -7" fill="none" stroke="#D7B3A3" stroke-opacity=".7" stroke-width="1.2" stroke-linecap="round"/>`;
    s += `<path d="${taper([-18, 1], [-10, 8.5], [10, 9], [19, -1], (t) => 0.8 + 2.4 * Math.pow(t, 1.3))}" fill="${T.lidInk}"/>`;
    for (const [t, a, l] of [
      [0.55, 96, 4.4],
      [0.68, 104, 5.4],
      [0.8, 114, 6.2],
      [0.92, 126, 6.6],
      [1, 138, 5.6],
    ] as Array<[number, number, number]>) {
      const p = bez([-18, 1], [-10, 8.5], [10, 9], [19, -1], t);
      s += lash(p[0], p[1] + 0.6, a, l);
    }
    return s;
  }
  const look = state === "look";
  const cid = "eyeC" + UID++;
  const glowA = kh() ? "#FFB347" : "#4FA8FF";
  const glowB = kh() ? "#FFE7A8" : "#BFE7FF";
  let s = `<clipPath id="${cid}"><path d="${ALMOND}"/></clipPath>`;
  if (look) s += `<ellipse cx="1" cy="-1.5" rx="27" ry="20" fill="${glowA}" opacity=".32" filter="url(#fkBlur8)"/><circle cx="1" cy="-1.5" r="26" fill="${glowA}" opacity=".45" filter="url(#fkBlur8)" style="mix-blend-mode:screen"/>`;
  s += `<path d="${ALMOND}" fill="${look ? (kh() ? "#FFF7E6" : "#EAF6FF") : "url(#fkSclera)"}"/>`;
  s += `<g clip-path="url(#${cid})">`;
  s += `<circle cx="1" cy="-1" r="10.4" fill="${url(look ? "IrisGlow" : "Iris")}"/>`;
  if (!look)
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      s += `<path d="M${f(1 + Math.cos(a) * 5)} ${f(-1 + Math.sin(a) * 5)} L${f(1 + Math.cos(a) * 9.2)} ${f(-1 + Math.sin(a) * 9.2)}" stroke="#FFFFFF" stroke-opacity=".22" stroke-width=".6"/>`;
    }
  s += `<circle cx="1" cy="-1" r="10.4" fill="none" stroke="${look ? (kh() ? "#C2621A" : "#2C6CC4") : "#0B0A14"}" stroke-width="1.1"/>`;
  s += `<circle cx="1" cy="-1" r="${look ? 2.6 : 4.4}" fill="${look ? (kh() ? "#7A3A0C" : "#1B3F8B") : "#07060C"}"/>`;
  s += `<path d="M-20 -16 H22 V-4 C11 -12.5 -9 -11.5 -20 4Z" fill="#1A1020" opacity="${look ? 0.1 : 0.22}"/>`;
  s += `<circle cx="5.3" cy="-5.4" r="2.9" fill="#FFFFFF"/><circle cx="-3.4" cy="3.2" r="1.3" fill="#FFFFFF" opacity=".9"/>`;
  s += `</g>`;
  if (look) s += `<circle cx="1" cy="-1" r="7" fill="${glowB}" opacity=".6" filter="url(#fkBlur3)" style="mix-blend-mode:screen"/>`;
  s += `<path d="M-15 -6.5 C-7 -14.5 8 -16.5 17.5 -8.5" fill="none" stroke="#D7B3A3" stroke-opacity=".75" stroke-width="1.2" stroke-linecap="round"/>`;
  s += `<path d="M-15.5 4.6 C-7 10.6 8 10.4 16.5 1.2" fill="none" stroke="#B98E80" stroke-opacity=".55" stroke-width="1" stroke-linecap="round"/>`;
  const p0: Pt = [-18, 2];
  const c1: Pt = [-12, -11.5];
  const c2: Pt = [9, -14];
  const p3: Pt = [19.2, -3.2];
  s += `<path d="${taper([-18.6, 2.2], [-12.4, -12.4], [9, -15.2], [19.8, -3.6], (t) => 0.9 + 3.1 * Math.pow(t, 1.4))}" fill="${T.lidInk}"/>`;
  for (const [t, a, l] of [
    [0.6, -62, 4.6],
    [0.72, -48, 5.6],
    [0.83, -34, 6.6],
    [0.93, -20, 7.2],
    [1, -8, 6.4],
  ] as Array<[number, number, number]>) {
    const p = bez(p0, c1, c2, p3, t);
    s += lash(p[0], p[1] - 1.2, a, l);
  }
  return s;
}
function lash(x: number, y: number, deg: number, len: number): string {
  const a = (deg * Math.PI) / 180;
  const nx = Math.cos(a);
  const ny = Math.sin(a);
  const tx = x + nx * len;
  const ty = y + ny * len;
  const px = -ny * 0.9;
  const py = nx * 0.9;
  const cx = x + nx * len * 0.55 + px * 1.6;
  const cy = y + ny * len * 0.55 + py * 1.6;
  return `<path d="M${f(x - px)} ${f(y - py)} Q${f(cx)} ${f(cy)} ${f(tx)} ${f(ty)} Q${f(cx + px * 0.4)} ${f(cy + py * 0.4)} ${f(x + px)} ${f(y + py)}Z" fill="${T.lidInk}"/>`;
}
function brow(): string {
  return `<path d="${taper([-16, -21], [-8, -28.5], [8, -30], [18, -24.5], (t) => 0.4 + 2.0 * Math.sin(Math.PI * Math.pow(t, 0.8)))}" fill="${kh() ? "#3A1A0E" : T.main}"/>`;
}

// ------------------------------------------------------------------ узоры по контуру
function along(pts: Pt[], ref: Pt | null, step: number, r: number, o: { closed?: boolean; off?: number; kind?: "dot" } = {}): string {
  const q = resample(pts, step, o.closed !== false);
  const nn = normals(q, ref);
  let s = "";
  q.forEach((p, i) => {
    const [nx, ny] = nn[i] as Pt;
    const x = p[0] + nx * (o.off || 0);
    const y = p[1] + ny * (o.off || 0);
    if (o.kind === "dot") s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`;
    else {
      const a = (Math.atan2(ny, nx) * 180) / Math.PI;
      s += `<path transform="translate(${f(x)} ${f(y)}) rotate(${f(a - 90)})" d="M${f(-r)} 0 A${f(r)} ${f(r)} 0 0 0 ${f(r)} 0"/>`;
    }
  });
  return s;
}

// ------------------------------------------------------------------ матрёшка
export interface DollOptions {
  folk?: Folk;
  view?: DollView;
  eyes?: EyeState;
  /** Вложенная матрёшка: свой мотив, узор платка и значок испытания в медальоне. */
  nest?: Nest | null;
  /** Свечение по контуру (ночь). */
  glow?: boolean;
  /** Дверца «Второго шанса» в фартуке. */
  door?: boolean;
  /** Дуги движения у головы («ЗАМРИ!»). */
  motion?: boolean;
}

const PHI: Record<DollView, number> = { face: 0, tq: (32 * Math.PI) / 180, profile: (62 * Math.PI) / 180, back: 0 };

/** Внутренность SVG матрёшки (viewBox 0 0 400 600): тело, роспись, лицо, блики, контур. */
export function folkDollInner(o: DollOptions = {}): string {
  T = THEMES[o.folk ?? "gzhel"];
  const view = o.view ?? "face";
  const phi = PHI[view];
  const uid = T.p + "d" + UID++;
  const scarfFill = `url(#${T.p}Sc-${o.nest?.scarf ?? "florets"})`;
  let g = `<ellipse cx="200" cy="588" rx="150" ry="10" fill="#000" opacity="${o.glow ? 0.5 : 0.16}" filter="url(#fkBlur3)"/>`;
  if (o.glow) g += `<path d="${BODY_D}" fill="none" stroke="${T.rim}" stroke-width="10" opacity=".5" filter="url(#fkRim)"/>`;
  g += `<clipPath id="${uid}b"><path d="${BODY_D}"/></clipPath>`;
  g += `<path d="${BODY_D}" fill="${url("BodyFill")}"/>`;
  g += `<g clip-path="url(#${uid}b)">`;
  g += view === "back" ? backPaint(scarfFill) : frontPaint(uid, phi, scarfFill, o);
  g += `<path d="${BODY_D}" fill="${url("Shade")}"/>`;
  // глазурь или лак: блики
  const k = kh() ? 1 : 0.85;
  g += `<ellipse cx="132" cy="74" rx="40" ry="15" transform="rotate(-38 132 74)" fill="url(#fkHi)" opacity="${k}"/>`;
  g += `<circle cx="112" cy="104" r="4.5" fill="#FFFFFF" opacity=".85"/>`;
  g += `<ellipse cx="58" cy="430" rx="11" ry="74" transform="rotate(6 58 430)" fill="url(#fkHi)" opacity="${kh() ? 0.7 : 0.6}"/>`;
  g += `<ellipse cx="350" cy="360" rx="5" ry="40" transform="rotate(-14 350 360)" fill="url(#fkHi)" opacity="${kh() ? 0.45 : 0.35}"/>`;
  if (kh()) g += `<ellipse cx="88" cy="300" rx="4" ry="22" transform="rotate(30 88 300)" fill="url(#fkHi)" opacity=".55"/><ellipse cx="300" cy="96" rx="5" ry="18" transform="rotate(35 300 96)" fill="url(#fkHi)" opacity=".4"/>`;
  g += `</g>`;
  g += `<path d="${BODY_D}" fill="none" stroke="${T.line}" stroke-width="3.2"/>`;
  if (kh()) g += `<path d="${BODY_D}" fill="none" stroke="url(#fkGoldLine)" stroke-width="1.1" opacity=".75"/>`;
  if (o.glow) g += `<path d="${BODY_D}" fill="none" stroke="${T.rimLine}" stroke-width="1.2" opacity=".7"/>`;
  if (o.motion) g += motionArcs();
  return g;
}

/** Дуги движения у головы (поворот «ЗАМРИ!»). Отдельно — экран показывает их только на повороте. */
export function motionArcs(folk?: Folk): string {
  if (folk) T = THEMES[folk];
  return `<g fill="none" stroke="${kh() ? "#F3D27A" : T.main}" stroke-width="7" stroke-linecap="round" opacity=".85"${kh() ? ' filter="url(#fkNeon)"' : ""}><path d="M44 70 q -26 60 0 120"/><path d="M18 50 q -34 80 0 160"/><path d="M356 70 q 26 60 0 120"/><path d="M382 50 q 34 80 0 160"/></g>`;
}

function laceColors(): { fill: string; line: string; dot: string } {
  return { fill: T.lace, line: T.laceLine, dot: T.laceDot };
}

function frontPaint(uid: string, phi: number, scarfFill: string, o: DollOptions): string {
  const L = laceColors();
  let g = `<path d="${BODY_D}" fill="${url("Sarafan")}"/><path d="${BODY_D}" fill="${url("Grid")}"/>`;
  g += hem(phi);
  // фартук
  const apSegs = mirror(
    [200, 314],
    [
      [262, 314, 318, 352, 320, 432],
      [322, 500, 286, 544, 200, 547],
    ],
  );
  const apPts = sample([200, 314], apSegs, 40);
  const apM = mapAll(apPts, phi);
  const apRef = mapPt([200, 432], phi);
  const apIn = mapAll(
    apPts.map(([x, y]): Pt => [200 + (x - 200) * 0.94, 432 + (y - 432) * 0.955]),
    phi,
  );
  g += `<g fill="${kh() ? "#D9A441" : T.main}">${along(apM, apRef, 11, 4.6)}</g>`;
  g += `<path d="${phi ? poly(apM) : segD([200, 314], apSegs) + "Z"}" fill="${url("Apron")}" stroke="${kh() ? "#D9A441" : T.main}" stroke-width="2.4"/>`;
  g += `<path d="${poly(apIn)}" fill="none" stroke="url(#fkGoldLine)" stroke-width="1.6"/>`;
  g += `<g fill="${kh() ? "#D23A2C" : T.main}">${along(apIn, apRef, 13, 1.5, { kind: "dot", off: -5 })}</g>`;
  g += `<clipPath id="${uid}a"><path d="${poly(apIn)}"/></clipPath><g clip-path="url(#${uid}a)">${kh() ? bouquetKh(phi, o) : bouquetGz(phi, o)}</g>`;
  // воротничок-кружево
  const colSegs = mirror(
    [200, 248],
    [
      [236, 248, 266, 258, 270, 272],
      [274, 292, 244, 310, 200, 310],
    ],
  );
  const colPts = mapAll(sample([200, 248], colSegs, 30), phi);
  const colRef = mapPt([200, 270], phi);
  g += `<g fill="${L.fill}" stroke="${L.line}" stroke-width="1.2">${along(
    colPts.filter((p) => p[1] > 268),
    colRef,
    9,
    4.8,
    { closed: false },
  )}</g>`;
  g += `<path d="${poly(colPts)}" fill="${kh() ? "url(#khApron)" : "url(#gzApron)"}" stroke="${L.line}" stroke-width="1.6"/>`;
  g += `<g fill="${kh() ? "#E9B949" : T.mid}">${along(
    colPts.filter((p) => p[1] > 274),
    colRef,
    9,
    1.4,
    { kind: "dot", off: -6, closed: false },
  )}</g>`;
  g += feat(200, 284, phi, `<path d="M178 282 q22 14 44 0" fill="none" stroke="${kh() ? "#E9B949" : T.mid}" stroke-width="1.2"/>${drops(200, 300, 180, 0.55, kh() ? "#D23A2C" : null)}`);
  // платок
  const edgeR: Seg[] = [
    [238, 262, 282, 276, 314, 302],
    [344, 326, 374, 352, 430, 384],
  ];
  const right = sample([200, 262], edgeR, 30);
  const left = right
    .slice(1)
    .map(([x, y]): Pt => [400 - x, y])
    .reverse();
  const edge = mapAll(left.concat(right), phi);
  const scarfPoly: Pt[] = [[-40, -40], ...edge, [440, -40]];
  g += `<path d="${poly(scarfPoly)}" fill="${url("Scarf")}"/><path d="${poly(scarfPoly)}" fill="${scarfFill}"/>`;
  const edgeIn = edge.filter((p) => p[0] > -10 && p[0] < 410);
  const below: Pt = [CX, 600];
  g += `<g fill="${L.fill}" stroke="${L.line}" stroke-width="1">${along(edgeIn, below, 10, 4.6, { closed: false, off: 3 })}</g>`;
  g += `<path d="${poly(edgeIn, false)}" fill="none" stroke="${L.fill}" stroke-width="7"/>`;
  g += `<path d="${poly(edgeIn, false)}" fill="none" stroke="${kh() ? "#0C0806" : "url(#fkGoldLine)"}" stroke-width="1.3" transform="translate(0 -4.6)"/>`;
  g += `<g fill="${L.dot}">${along(edgeIn, below, 8, 1.25, { kind: "dot", closed: false })}</g>`;
  g += feat(200, 44, phi, kh() ? kudrina(200, 44, 15) : daisyWhite(200, 44, 13));
  // лицо
  const face = mapAll(ellPts(200, 160, 71, 83), phi);
  const lace = mapAll(ellPts(200, 160, 77.5, 89.5), phi);
  const lace2 = mapAll(ellPts(200, 160, 84.5, 96.5), phi);
  const fRef = mapPt([200, 160], phi);
  g += `<g fill="${L.fill}" stroke="${L.line}" stroke-width="1">${along(lace2, fRef, 9.4, 4.2)}</g>`;
  g += `<path d="${poly(lace)}" fill="none" stroke="${L.fill}" stroke-width="14.5"/>`;
  g += `<g fill="${L.dot}">${along(lace, fRef, 9.4, 1.6, { kind: "dot" })}</g>`;
  g += `<clipPath id="${uid}f"><path d="${poly(face)}"/></clipPath>`;
  g += `<path d="${poly(face)}" fill="url(#fkSkin)" stroke="${kh() ? "#7A4A12" : T.main}" stroke-width="1.5"/>`;
  g += `<g clip-path="url(#${uid}f)">${hair(phi)}</g>`;
  g += `<path d="${poly(face)}" fill="none" stroke="url(#fkGoldLine)" stroke-width="1.2" opacity=".9"/>`;
  const eyes = o.eyes ?? "open";
  g += feat(158, 192, phi, `<ellipse cx="158" cy="192" rx="19" ry="11" fill="url(#fkBlush)"/>`);
  g += feat(242, 192, phi, `<ellipse cx="242" cy="192" rx="19" ry="11" fill="url(#fkBlush)"/>`);
  g += feat(171, 160, phi, `<g transform="translate(171 160) scale(-1.2 1.2)">${brow()}${eye(eyes)}</g>`);
  g += feat(229, 160, phi, `<g transform="translate(229 160) scale(1.2)">${brow()}${eye(eyes)}</g>`);
  g += feat(200, 182, phi, `<path d="M197 178.5 q2.6 5.2 6 1.4" fill="none" stroke="#C99886" stroke-width="1.4" stroke-linecap="round"/>`);
  g += feat(
    200,
    208,
    phi,
    `<path d="M188 207 C192 202 196.5 201.8 200 205 C203.5 201.8 208 202 212 207 C207.5 214 192.5 214 188 207Z" fill="url(#fkLips)"/><path d="M189.5 207.2 Q200 209.6 210.5 207.2" fill="none" stroke="#8E2A24" stroke-width=".9" stroke-linecap="round"/><ellipse cx="203" cy="210.4" rx="3" ry="1.2" fill="#FFFFFF" opacity=".45"/>`,
  );
  g += feat(200, 252, phi, knot());
  if (o.door) g += feat(200, 470, phi, door());
  return g;
}

function door(): string {
  const leafC = kh() ? "#0C0806" : T.main;
  return `<g><path d="M200 470 l-70 70 M200 470 l70 70 M200 470 v80 M200 470 l-36 80 M200 470 l36 80" stroke="#FFE7A8" stroke-width="5" opacity=".45" filter="url(#fkBlur3)"/>
    <path d="M168 528 V468 C168 432 232 432 232 468 V528Z" fill="url(#fkDoorLight)" stroke="${kh() ? "#D9A441" : T.main}" stroke-width="3"/>
    <path d="M168 528 V468 C168 444 160 438 146 444 V522Z" fill="${leafC}" stroke="${kh() ? "#D9A441" : T.ink}" stroke-width="2"/>
    <circle cx="152" cy="488" r="3" fill="${kh() ? "#F3D27A" : "#FFFFFF"}"/>
    <path d="M168 528 H232" stroke="${kh() ? "#D9A441" : T.main}" stroke-width="4" stroke-linecap="round"/></g>`;
}

function daisyWhite(x: number, y: number, r: number): string {
  let s = `<g transform="translate(${x} ${y})">`;
  for (let i = 0; i < 10; i++) s += `<g transform="rotate(${i * 36})"><path d="${petalD(r, r * 0.3)}" fill="#FFFFFF" stroke="${T.pale}" stroke-width=".6"/></g>`;
  return s + `<circle r="${f(r * 0.28)}" fill="${T.goldL}" stroke="${T.gold}" stroke-width=".8"/></g>`;
}

function hair(phi: number): string {
  const segs = mirror(
    [200, 56],
    [
      [264, 56, 296, 72, 296, 136],
      [278, 114, 244, 98, 214, 101],
      [206, 102, 202.5, 109, 200, 109],
    ],
  );
  const pts = mapAll(sample([200, 56], segs, 24), phi);
  let s = `<path d="${poly(pts)}" fill="${url("Hair")}"/>` + feat(200, 84, phi, `<path d="M200 106 C199.4 92 199.6 74 200 58" fill="none" stroke="#F3DCCD" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>`);
  const strands: Array<[Pt, Seg[]]> = [
    [[206, 104], [[230, 98, 260, 106, 282, 126]]],
    [[204, 96], [[232, 88, 264, 94, 288, 114]]],
    [[203, 84], [[232, 74, 266, 80, 292, 100]]],
  ];
  for (const [st, sg] of strands)
    for (const m of [1, -1]) {
      const sp = sample(m > 0 ? st : [400 - st[0], st[1]], m > 0 ? sg : sg.map((q): Seg => [400 - q[0], q[1], 400 - q[2], q[3], 400 - q[4], q[5]]), 16);
      s += `<path d="${poly(mapAll(sp, phi), false)}" fill="none" stroke="${T.hairLine}" stroke-opacity=".55" stroke-width="1.1" stroke-linecap="round"/>`;
    }
  return s;
}

function knot(): string {
  const loop = (r: number): string =>
    `<g transform="rotate(${r})"><path d="M0 0 C-12 -6 -12 -24 0 -26 C12 -24 12 -6 0 0Z" fill="${url("Scarf")}" stroke="${T.ink}" stroke-width="1.1"/><circle cx="0" cy="-15" r="2" fill="${T.lace}"/><circle cx="-4" cy="-9" r="1.2" fill="${T.lace}"/><circle cx="4" cy="-9" r="1.2" fill="${T.lace}"/></g>`;
  return `<g transform="translate(200 252)">
    <g transform="rotate(158)"><path d="${petalD(34, 7)}" fill="${url("Scarf")}" stroke="${T.ink}" stroke-width="1"/></g>
    <g transform="rotate(-158)"><path d="${petalD(34, 7)}" fill="${url("Scarf")}" stroke="${T.ink}" stroke-width="1"/></g>
    ${loop(-108)}${loop(108)}
    <ellipse rx="7" ry="6" fill="${url("Core")}" stroke="${T.ink}" stroke-width="1"/><circle cx="-2" cy="-2" r="1.6" fill="#FFFFFF" opacity=".8"/>
  </g>`;
}

function hem(phi: number): string {
  const k = kh();
  let s = `<rect x="0" y="551" width="400" height="60" fill="${k ? "url(#khPetal)" : "url(#gzApron)"}"/>`;
  s += `<path d="M0 551 H400" stroke="${k ? "#0C0806" : T.main}" stroke-width="2.4"/><path d="M0 556 H400" stroke="${k ? "#B3261E" : "url(#fkGoldLine)"}" stroke-width="1.2"/>`;
  for (let x = 2; x <= 398; x += 16) {
    s += feat(x, 562, phi, `<path d="M${x - 7} 558 A7 7 0 0 0 ${x + 7} 558Z" fill="${k ? "#0C0806" : T.main}"/><circle cx="${x}" cy="572" r="1.8" fill="${k ? "#B3261E" : T.main}"/>`);
  }
  return s;
}

function medallion(phi: number, n: Nest): string {
  const k = kh();
  return feat(
    200,
    418,
    phi,
    `<circle cx="200" cy="418" r="44" fill="${url("Medal")}" stroke="${k ? "#D9A441" : T.main}" stroke-width="4"/><circle cx="200" cy="418" r="37.5" fill="none" stroke="${k ? "#B3261E" : "url(#fkGoldLine)"}" stroke-width="1.6"/><circle cx="200" cy="418" r="35" fill="none" stroke="${k ? "#7A4A12" : T.pale}" stroke-width="1"/>` +
      `<g transform="translate(167 385) scale(1.65)">${icon(n.icon, k ? "#F3D27A" : T.main)}</g>`,
  );
}

function bouquetGz(phi: number, o: DollOptions): string {
  const n = o.nest;
  const at = (x: number, y: number, inner: string): string => feat(x, y, phi, inner);
  let s = "";
  if (n) {
    s += at(140, 404, curl(26, -24, 144, 412, -1)) + at(260, 404, curl(26, 24, 256, 412, 1));
    s += at(150, 452, leaf(40, 13, -120, 162, 446)) + at(250, 452, leaf(40, 13, 120, 238, 446));
    s += at(150, 386, leaf(34, 11, -62, 166, 396)) + at(250, 386, leaf(34, 11, 62, 234, 396));
    s += at(200, 500, motif(n.motif, 200, 502, 1.45));
    s += at(122, 448, motif(n.motif, 120, 446, 1.05)) + at(278, 448, motif(n.motif, 280, 446, 1.05));
    s += at(200, 352, drops(200, 360, 0, 0.9));
    return s + medallion(phi, n);
  }
  // венок листьев вокруг розы: мазок с тенью, плотно
  const leaves: Array<[number, number, number]> = [
    [-150, 62, 18],
    [-118, 66, 19],
    [-82, 58, 16],
    [-42, 50, 14],
    [150, 62, 18],
    [118, 66, 19],
    [82, 58, 16],
    [42, 50, 14],
    [-176, 44, 13],
    [176, 44, 13],
  ];
  for (const [a, len, wid] of leaves) {
    const r = ((a - 90) * Math.PI) / 180;
    const bx = 200 + Math.cos(r) * 34;
    const by = 430 + Math.sin(r) * 34;
    s += at(bx, by, leaf(len, wid, a, bx, by));
  }
  s += at(200, 352, bud(200, 360, 30, 0));
  s += at(122, 396, bud(126, 404, 22, -64)) + at(278, 396, bud(274, 404, 22, 64));
  s += at(132, 360, curl(26, -40, 140, 368, -1)) + at(268, 360, curl(26, 40, 260, 368, 1));
  s += at(102, 450, curl(22, -160, 106, 456, 1)) + at(298, 450, curl(22, 160, 294, 456, -1));
  s += at(160, 510, berries(158, 512, 0.85)) + at(240, 510, berries(242, 512, 0.85));
  s += at(200, 520, drops(200, 534, 180, 0.75));
  s += at(116, 494, drops(116, 498, -140, 0.55)) + at(284, 494, drops(284, 498, 140, 0.55));
  s += at(200, 430, rose(200, 430, 52));
  return s;
}

function bouquetKh(phi: number, o: DollOptions): string {
  const n = o.nest;
  const at = (x: number, y: number, inner: string): string => feat(x, y, phi, inner);
  let s = "";
  if (n) {
    s += at(140, 430, travka(156, 470, 1.05, -34, -1)) + at(260, 430, travka(244, 470, 1.05, 34, 1));
    s += at(150, 380, travka(166, 396, 0.8, -70, -1)) + at(250, 380, travka(234, 396, 0.8, 70, 1));
    s += at(150, 452, leaf(40, 13, -120, 162, 446, { alt: true })) + at(250, 452, leaf(40, 13, 120, 238, 446, { alt: true }));
    s += at(200, 500, motif(n.motif, 200, 502, 1.4));
    s += at(122, 448, motif(n.motif, 120, 446, 1.0)) + at(278, 448, motif(n.motif, 280, 446, 1.0));
    s += at(200, 352, drops(200, 360, 0, 0.9, "#D23A2C"));
    return s + medallion(phi, n);
  }
  // кудрина: травка венком от середины, золотые и красные листья, рябина и земляника
  for (let i = 0; i < 10; i++) {
    const a = -180 + i * 40 + 20;
    const r = ((a - 90) * Math.PI) / 180;
    const bx = 200 + Math.cos(r) * 26;
    const by = 432 + Math.sin(r) * 26;
    s += at(bx, by, travka(bx, by, 1.15, a, i % 2 ? 1 : -1));
  }
  const leaves: Array<[number, number, number, boolean]> = [
    [-130, 64, 20, true],
    [130, 64, 20, true],
    [-60, 56, 17, false],
    [60, 56, 17, false],
    [-170, 46, 14, false],
    [170, 46, 14, false],
    [-96, 50, 15, true],
    [96, 50, 15, true],
  ];
  for (const [a, len, wid, red] of leaves) {
    const r = ((a - 90) * Math.PI) / 180;
    const bx = 200 + Math.cos(r) * 30;
    const by = 432 + Math.sin(r) * 30;
    s += at(bx, by, leaf(len, wid, a, bx, by, { alt: red }));
  }
  s += at(124, 380, strawberry(124, 380, 1.15, -28)) + at(276, 380, strawberry(276, 380, 1.15, 28));
  s += at(112, 486, rowan(114, 488, 0.75)) + at(288, 486, rowan(286, 488, 0.75));
  s += at(200, 352, travka(200, 372, 0.8, 0, 1));
  s += at(200, 520, drops(200, 534, 180, 0.7, "#E9B949"));
  s += at(200, 432, rowan(200, 440, 1.25));
  return s;
}

/** Значок испытания (поле 40×40, контур цветом `color`). */
export function icon(kind: NestKind, color: string): string {
  const s = `fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
  switch (kind) {
    case "freeze":
      return `<g ${s}><path d="M20 4v32M6 12l28 16M6 28l28-16"/><path d="M15 6l5 4 5-4M15 34l5-4 5 4M5 18l6 2-1 6M35 22l-6-2 1-6"/></g>`;
    case "ginger":
      return `<g ${s}><circle cx="20" cy="20" r="15"/><path d="M20 11l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/></g>`;
    case "chairs":
      return `<g ${s}><rect x="8" y="12" width="24" height="6" rx="3"/><path d="M11 18l-3 16M29 18l3 16M14 27h12"/></g>`;
    case "rope":
      return `<g ${s}><path d="M2 22c4-4 8 4 12 0M26 22c4-4 8 4 12 0"/><circle cx="20" cy="21" r="6"/></g>`;
    case "hopscotch":
      return `<g ${s}><rect x="14" y="4" width="12" height="9"/><rect x="8" y="13" width="12" height="10"/><rect x="20" y="13" width="12" height="10"/><rect x="14" y="23" width="12" height="11"/></g>`;
    case "final":
      return `<g ${s}><circle cx="11" cy="29" r="5"/><circle cx="29" cy="29" r="5"/><path d="M14 25L30 5M26 25L10 5"/></g>`;
    default:
      return "";
  }
}

function backPaint(scarfFill: string): string {
  const L = laceColors();
  const k = kh();
  let g = `<path d="${BODY_D}" fill="${url("Sarafan")}"/><path d="${BODY_D}" fill="${url("Grid")}"/>` + hem(0);
  const edgeR: Seg[] = [
    [236, 412, 296, 344, 330, 300],
    [352, 270, 384, 250, 440, 236],
  ];
  const right = sample([200, 446], edgeR, 30);
  const left = right
    .slice(1)
    .map(([x, y]): Pt => [400 - x, y])
    .reverse();
  const edge = left.concat(right);
  const sc: Pt[] = [[-40, -40], ...edge, [440, -40]];
  const edgeIn = edge.filter((p) => p[0] > -10 && p[0] < 410);
  g += `<g fill="${L.fill}" stroke="${L.line}" stroke-width="1">${along(edgeIn, [200, 600], 10, 4.6, { closed: false, off: 3 })}</g>`;
  g += `<path d="${poly(sc)}" fill="${url("Scarf")}"/><path d="${poly(sc)}" fill="${scarfFill}"/>`;
  g += `<path d="${poly(edgeIn, false)}" fill="none" stroke="${L.fill}" stroke-width="7"/>`;
  g += `<path d="${poly(edgeIn, false)}" fill="none" stroke="${k ? "#0C0806" : "url(#fkGoldLine)"}" stroke-width="1.3" transform="translate(0 -4.6)"/>`;
  g += `<g fill="${L.dot}">${along(edgeIn, [200, 600], 8, 1.25, { kind: "dot", closed: false })}</g>`;
  g += `<g transform="translate(200 452)"><path d="M0 0 v10" stroke="${k ? "#D9A441" : T.main}" stroke-width="2"/><path d="M-6 10 h12 l-2 22 h-8z" fill="${url("Scarf")}" stroke="${T.ink}" stroke-width="1"/><circle cy="10" r="4" fill="${url("Core")}"/></g>`;
  const cart = ellPts(200, 352, 52, 46, 120);
  g += `<g fill="${L.fill}" stroke="${L.line}" stroke-width="1">${along(ellPts(200, 352, 57, 51, 120), [200, 352], 9.5, 4.2)}</g>`;
  g += `<path d="${poly(cart)}" fill="${url("Apron")}" stroke="${k ? "#D9A441" : T.main}" stroke-width="1.8"/><path d="${poly(ellPts(200, 352, 46, 40, 120))}" fill="none" stroke="url(#fkGoldLine)" stroke-width="1.2"/>`;
  if (k) {
    g += travka(178, 380, 0.7, -40, -1) + travka(222, 380, 0.7, 40, 1) + leaf(28, 9, -60, 186, 366, { alt: true }) + leaf(28, 9, 60, 214, 366, { alt: true });
    g += kudrina(200, 346, 20) + rowan(200, 354, 0.7);
    g += kudrina(200, 96, 18) + kudrina(140, 170, 11) + kudrina(260, 170, 11);
  } else {
    g += leaf(30, 10, -60, 188, 360) + leaf(30, 10, 60, 212, 360) + leaf(26, 8, -140, 192, 368) + leaf(26, 8, 140, 208, 368);
    g += curl(16, -40, 164, 346, -1) + curl(16, 40, 236, 346, 1) + rose(200, 348, 26);
    g += daisyWhite(200, 96, 16) + daisyWhite(140, 170, 10) + daisyWhite(260, 170, 10);
  }
  return g;
}

// ------------------------------------------------------------------ раскрытие: верх и низ
export interface OpenOptions {
  folk?: Folk;
  /** Вложенная матрёшка внутри. */
  inner: Nest;
  innerEyes?: EyeState;
  glow?: boolean;
  sparks?: boolean;
}
/** Высота разреза тела (верх снимается по ней). */
export const OPEN_CUT = 362;
/** viewBox раскрытой матрёшки: верх отлетает влево-вверх, внутри — вложенная. */
export const OPEN_VIEWBOX = "-150 -450 640 1060";

/**
 * Раскрытая матрёшка (viewBox `OPEN_VIEWBOX`): `top` — снятый верх (группа с поворотом — экран анимирует её отдельно), `bottom`
 * — нижняя половина с вложенной матрёшкой. Обе части — одна и та же роспись лица (`face`), поэтому края совпадают.
 */
export function folkOpenParts(o: OpenOptions): { top: string; bottom: string; sparks: string } {
  const folk = o.folk ?? "gzhel";
  const cut = OPEN_CUT;
  const rx = W(cut);
  const ry = 15;
  const gid = "go" + UID++;
  const full = folkDollInner({ folk, view: "face", glow: o.glow });
  const inner = folkDollInner({ folk, nest: o.inner, eyes: o.innerEyes ?? "open", glow: false });
  T = THEMES[folk];
  const rimC = kh() ? "#E9C46A" : "#FFFFFF";
  const top = `<clipPath id="${gid}t"><rect x="-60" y="-60" width="520" height="${cut + 60}"/></clipPath>
      <g clip-path="url(#${gid}t)">${full}</g>
      <ellipse cx="200" cy="${cut}" rx="${f(rx)}" ry="${ry}" fill="${url("Hollow")}" stroke="${T.line}" stroke-width="3"/>
      <ellipse cx="200" cy="${cut}" rx="${f(rx - 6)}" ry="${ry - 3}" fill="none" stroke="${rimC}" stroke-width="2.5" opacity=".9"/>`;
  const bottom = `<clipPath id="${gid}d"><rect x="-60" y="${cut}" width="520" height="300"/></clipPath>
    <clipPath id="${gid}i"><rect x="-60" y="-400" width="520" height="${cut + 400}"/><ellipse cx="200" cy="${cut}" rx="${f(rx - 7)}" ry="${ry - 2}"/></clipPath>
    <g clip-path="url(#${gid}d)">${full}</g>
    <ellipse cx="200" cy="${cut}" rx="${f(rx)}" ry="${ry}" fill="${url("Hollow")}" stroke="${T.line}" stroke-width="3"/>
    <g clip-path="url(#${gid}i)"><g transform="translate(200 ${cut + 8}) scale(.7) translate(-200 -585)">${inner}</g></g>
    <path d="M${f(200 - rx)} ${cut} A${f(rx)} ${ry} 0 0 0 ${f(200 + rx)} ${cut}" fill="none" stroke="${T.line}" stroke-width="3"/>
    <path d="M${f(200 - rx + 6)} ${cut + 1} A${f(rx - 6)} ${ry - 3} 0 0 0 ${f(200 + rx - 6)} ${cut + 1}" fill="none" stroke="${rimC}" stroke-width="2.5" opacity=".9"/>`;
  return { top, bottom, sparks: o.sparks ? folkSparks(folk) : "" };
}
export function folkSparks(folk: Folk): string {
  const k = folk === "khokhloma";
  const col = k ? "#FFD27A" : "#C9A15F";
  let s = `<g fill="${col}"${k ? ' filter="url(#fkNeon)"' : ""}>`;
  const pts: Array<[number, number, number]> = [
    [-30, -40, 1.4],
    [440, -10, 1.2],
    [-10, 120, 1],
    [430, 150, 1.3],
    [60, -240, 1.1],
    [360, -230, 1.4],
    [210, -300, 0.9],
    [-40, -180, 1],
    [460, -150, 1],
  ];
  for (const [x, y, k2] of pts) s += `<path transform="translate(${x} ${y}) scale(${k2 * 1.8})" d="M0 -9 C1 -3 3 -1 9 0 C3 1 1 3 0 9 C-1 3 -3 1 -9 0 C-3 -1 -1 -3 0 -9Z"/>`;
  return s + "</g>";
}

/** Вложенные матрёшки: у каждой свой мотив, узор платка и значок испытания. */
export const NEST: Record<Folk, Record<NestKind, Nest>> = {
  gzhel: {
    freeze: { title: "Замри!", icon: "freeze", motif: "daisy", scarf: "stars", motifName: "ромашка · звёздочки" },
    ginger: { title: "Пряник", icon: "ginger", motif: "berry", scarf: "dots", motifName: "ягоды · горошек" },
    chairs: { title: "Стулья", icon: "chairs", motif: "tulip", scarf: "grid", motifName: "тюльпан · сетка" },
    rope: { title: "Канат", icon: "rope", motif: "bell", scarf: "waves", motifName: "колокольчик · волны" },
    hopscotch: { title: "Классики", icon: "hopscotch", motif: "bird", scarf: "scales", motifName: "птица · чешуйка" },
    final: { title: "Финал", icon: "final", motif: "rose", scarf: "florets", motifName: "роза · цветочки" },
  },
  khokhloma: {
    freeze: { title: "Замри!", icon: "freeze", motif: "kudrina", scarf: "stars", motifName: "кудрина · звёздочки" },
    ginger: { title: "Пряник", icon: "ginger", motif: "strawberry", scarf: "dots", motifName: "земляника · горошек" },
    chairs: { title: "Стулья", icon: "chairs", motif: "cherry", scarf: "grid", motifName: "вишня · сетка" },
    rope: { title: "Канат", icon: "rope", motif: "travka", scarf: "waves", motifName: "травка · волны" },
    hopscotch: { title: "Классики", icon: "hopscotch", motif: "bird", scarf: "scales", motifName: "жар-птица · чешуйка" },
    final: { title: "Финал", icon: "final", motif: "rowan", scarf: "florets", motifName: "рябина · цветочки" },
  },
};

/** Роспись по стилю игры: «Солнечный двор» — гжель, «Ночной двор» — хохлома. */
export function folkOf(style: "sunny" | "night"): Folk {
  return style === "night" ? "khokhloma" : "gzhel";
}
