/**
 * Фигуры «Пряника» (docs/matryoshka.md, «Пряник»; L10): 7 замкнутых ломаных в долях поля 0…1, у всех **одинаковая длина
 * контура** (`SHAPE_LENGTH` ширин поля), каждая целиком в поле с отступом. Контур делится на 200 кусочков равной длины.
 * Обводка (для телефона, 3b): касание засчитывает **ближайший** к пальцу кусочек, если до него не дальше полосы допуска, —
 * поэтому во внутренних углах звезды и ёлочки полосы соседних рёбер не засчитывают кусочки без обводки. Палец вне полосы
 * дольше 0,2 с — трещина. Сервер обводку не считает: телефон шлёт число кусочков (мягкая защита, L12).
 */
import { CRACK_OUT_MS, PIECES, SHAPE_LENGTH } from "./constants";
import type { ShapeId } from "./types";

export type Point = readonly [number, number];

export interface Shape {
  id: ShapeId;
  title: string;
  /** Сложность 1–4 (для подписи коробки и экрана). */
  difficulty: number;
  /** Точки контура: 200 точек через равные расстояния; кусочек i — отрезок от точки i к точке i + 1 (по кругу). */
  points: Point[];
}

export const SHAPE_TITLES: Record<ShapeId, string> = {
  circle: "Круг",
  star: "Звезда",
  tree: "Ёлочка",
  matryoshka: "Матрёшка",
  umbrella: "Зонтик",
  heart: "Сердце",
  house: "Домик",
};

export const SHAPE_DIFFICULTY: Record<ShapeId, number> = { circle: 1, star: 2, tree: 3, matryoshka: 4, umbrella: 3, heart: 2, house: 2 };

// ------------------------------------------------------------ сырые контуры (любой масштаб, y — вниз)

function arc(cx: number, cy: number, r: number, from: number, to: number, steps: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function circleRaw(): Point[] {
  return arc(0, 0, 1, 0, 2 * Math.PI, 360).slice(0, -1);
}

function starRaw(): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 1 : 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

function treeRaw(): Point[] {
  const right: Point[] = [
    [0, -1],
    [0.35, -0.55],
    [0.17, -0.55],
    [0.6, -0.1],
    [0.3, -0.1],
    [0.85, 0.45],
    [0.15, 0.45],
    [0.15, 0.8],
  ];
  const left = right
    .slice(1)
    .reverse()
    .map(([x, y]) => [-x, y] as Point);
  return [...right, ...left];
}

/** Луч из точки p под углом a до границы круга (центр c, радиус r); p — внутри. */
function rayCircle(p: Point, a: number, c: Point, r: number): number {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const ox = p[0] - c[0];
  const oy = p[1] - c[1];
  const b = ox * dx + oy * dy;
  const cc = ox * ox + oy * oy - r * r;
  return -b + Math.sqrt(Math.max(0, b * b - cc));
}

function rayEllipse(p: Point, a: number, c: Point, rx: number, ry: number): number {
  const dx = Math.cos(a) / rx;
  const dy = Math.sin(a) / ry;
  const ox = (p[0] - c[0]) / rx;
  const oy = (p[1] - c[1]) / ry;
  const A = dx * dx + dy * dy;
  const B = 2 * (ox * dx + oy * dy);
  const C = ox * ox + oy * oy - 1;
  return (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
}

/** Матрёшка: объединение головы (круг) и тела (эллипс) — звёздная область относительно «шеи», луч берёт дальнюю границу. */
function matryoshkaRaw(): Point[] {
  const p: Point = [0, -0.25];
  const out: Point[] = [];
  for (let i = 0; i < 360; i += 1) {
    const a = (i * 2 * Math.PI) / 360;
    const r = Math.max(rayCircle(p, a, [0, -0.55], 0.35), rayEllipse(p, a, [0, 0.25], 0.55, 0.7));
    out.push([p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)]);
  }
  return out;
}

/** Фестоны низа купола от x0 к x1 (провисают вверх). */
function scallop(x0: number, x1: number, depth: number, steps: number): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    out.push([x0 + (x1 - x0) * t, -depth * Math.sin(Math.PI * t)]);
  }
  return out;
}

/** Зонтик: купол, четыре фестона, ручка с крючком (узкий контур шириной 0,08). */
function umbrellaRaw(): Point[] {
  const w = 0.04;
  const top = arc(0, 0, 1, Math.PI, 2 * Math.PI, 90);
  const right = [...scallop(1, 0.5, 0.12, 12), ...scallop(0.5, w, 0.12, 12)];
  const shaftDown: Point[] = [[w, 0.85]];
  const hookOuter = arc(-0.16, 0.85, 0.2, 0, Math.PI, 30).slice(1);
  const hookInner = arc(-0.16, 0.85, 0.12, Math.PI, 0, 20);
  const shaftUp: Point[] = [[-w, 0]];
  const left = [...scallop(-w, -0.5, 0.12, 12), ...scallop(-0.5, -1, 0.12, 12)].slice(0, -1);
  return [...top, ...right.slice(0, -1), [w, 0], ...shaftDown, ...hookOuter, ...hookInner, ...shaftUp, ...left];
}

function heartRaw(): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 360; i += 1) {
    const t = (i * 2 * Math.PI) / 360;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push([x / 16, -y / 16]);
  }
  return out;
}

function houseRaw(): Point[] {
  return [
    [0, -1],
    [1, -0.15],
    [0.7, -0.15],
    [0.7, 0.9],
    [0.2, 0.9],
    [0.2, 0.45],
    [-0.2, 0.45],
    [-0.2, 0.9],
    [-0.7, 0.9],
    [-0.7, -0.15],
    [-1, -0.15],
  ];
}

const RAW: Record<ShapeId, () => Point[]> = {
  circle: circleRaw,
  star: starRaw,
  tree: treeRaw,
  matryoshka: matryoshkaRaw,
  umbrella: umbrellaRaw,
  heart: heartRaw,
  house: houseRaw,
};

// ------------------------------------------------------------ длина, нормировка, кусочки

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Длина замкнутой ломаной. */
export function contourLength(points: readonly Point[]): number {
  let len = 0;
  for (let i = 0; i < points.length; i += 1) len += dist(points[i] as Point, points[(i + 1) % points.length] as Point);
  return len;
}

/** `n` точек через равные расстояния по замкнутой ломаной. */
export function resample(points: readonly Point[], n: number): Point[] {
  const total = contourLength(points);
  const step = total / n;
  const out: Point[] = [];
  let seg = 0;
  let segStart = 0;
  for (let k = 0; k < n; k += 1) {
    const want = k * step;
    for (;;) {
      const a = points[seg % points.length] as Point;
      const b = points[(seg + 1) % points.length] as Point;
      const len = dist(a, b);
      if (want <= segStart + len || seg >= points.length - 1) {
        const t = len === 0 ? 0 : Math.min(1, Math.max(0, (want - segStart) / len));
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        break;
      }
      segStart += len;
      seg += 1;
    }
  }
  return out;
}

/** Контур в поле 0…1: длина ровно `length`, рамка — по центру поля. */
export function normalize(points: readonly Point[], length: number): Point[] {
  const k = length / contourLength(points);
  const xs = points.map((p) => p[0] * k);
  const ys = points.map((p) => p[1] * k);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map((p) => [p[0] * k - cx + 0.5, p[1] * k - cy + 0.5] as Point);
}

const cache = new Map<ShapeId, Shape>();

export function shapeOf(id: ShapeId): Shape {
  const known = cache.get(id);
  if (known) return known;
  // Сначала 200 точек через равные расстояния, потом масштаб: длина контура из кусочков — ровно `SHAPE_LENGTH` (хорды
  // срезают острые углы ёлочки и домика, поэтому масштаб — после).
  const shape: Shape = { id, title: SHAPE_TITLES[id], difficulty: SHAPE_DIFFICULTY[id], points: normalize(resample(RAW[id](), PIECES), SHAPE_LENGTH) };
  cache.set(id, shape);
  return shape;
}

/** Расстояние от точки до отрезка. */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ближайший к точке кусочек и расстояние до него. */
export function nearestPiece(shape: Shape, p: Point): { piece: number; distance: number } {
  let best = 0;
  let bestD = Infinity;
  const pts = shape.points;
  for (let i = 0; i < pts.length; i += 1) {
    const d = segmentDistance(p, pts[i] as Point, pts[(i + 1) % pts.length] as Point);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { piece: best, distance: bestD };
}

// ------------------------------------------------------------ обводка (телефон)

export interface Trace {
  covered: boolean[];
  count: number;
  /** С какого момента палец вне полосы (null — внутри или палец поднят). */
  outSince: number | null;
  cracked: boolean;
  crackedAt: number | null;
  doneAt: number | null;
  /** Где был палец (для промежуточных точек при быстром движении). */
  last: Point | null;
}

export function newTrace(): Trace {
  return { covered: Array.from({ length: PIECES }, () => false), count: 0, outSince: null, cracked: false, crackedAt: null, doneAt: null, last: null };
}

function touchPoint(shape: Shape, st: Trace, p: Point, t: number, band: number): void {
  const { piece, distance } = nearestPiece(shape, p);
  if (distance <= band) {
    st.outSince = null;
    if (!st.covered[piece]) {
      st.covered[piece] = true;
      st.count += 1;
      if (st.count === PIECES) st.doneAt = t;
    }
    return;
  }
  st.outSince ??= t;
  if (t - st.outSince > CRACK_OUT_MS) {
    st.cracked = true;
    st.crackedAt = t;
  }
}

/**
 * Палец в точке `p` (доли поля) в момент `t` (мс телефона). Быстрое движение — промежуточные точки через полкусочка, чтобы
 * кусочки не проскакивали. Трещина и целый пряник — конец обводки (дальше касания не меняют ничего).
 */
export function traceTouch(shape: Shape, st: Trace, p: Point, t: number, band: number): Trace {
  if (st.cracked || st.doneAt !== null) return st;
  const from = st.last;
  if (from) {
    // Шаг — полкусочка (и не больше полполосы): быстрый палец не перепрыгивает кусочки.
    const step = Math.min(band / 2, SHAPE_LENGTH / PIECES / 2);
    const steps = Math.min(400, Math.ceil(dist(from, p) / step));
    for (let i = 1; i < steps && !st.cracked && st.doneAt === null; i += 1) {
      touchPoint(shape, st, [from[0] + ((p[0] - from[0]) * i) / steps, from[1] + ((p[1] - from[1]) * i) / steps], t, band);
    }
  }
  if (!st.cracked && st.doneAt === null) touchPoint(shape, st, p, t, band);
  st.last = p;
  return st;
}

/** Палец поднят: отрывать можно — время вне полосы не копится, следующая точка без промежуточных. */
export function traceLift(st: Trace): Trace {
  st.outSince = null;
  st.last = null;
  return st;
}
