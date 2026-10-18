// Раскраска «Аквариума и Ёлки» на холсте (только браузер): маска фигуры, контур, «раскрасить за меня», готовая текстура
// с именем на боку. Перенесено из согласованного прототипа (18 октября 2026) без изменения вида.
import type { FigureDef } from "./figures";

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;

interface Cache {
  paths: Path2D[];
  dpaths: Path2D[];
  masks: Map<string, HTMLCanvasElement>;
  lines: Map<string, HTMLCanvasElement>;
  spot?: [number, number, number, number];
}
const caches = new WeakMap<FigureDef, Cache>();

function cacheOf(def: FigureDef): Cache {
  let c = caches.get(def);
  if (!c) {
    c = { paths: def.shapes.map((s) => new Path2D(s)), dpaths: def.details.map((s) => new Path2D(s)), masks: new Map(), lines: new Map() };
    caches.set(def, c);
  }
  return c;
}

export function pathsOf(def: FigureDef): Path2D[] {
  return cacheOf(def).paths;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement, willRead = false): CanvasRenderingContext2D {
  const x = c.getContext("2d", willRead ? { willReadFrequently: true } : undefined);
  if (!x) throw new Error("canvas");
  return x;
}

/** Силуэт фигуры (или её частей `idx`) чёрным на прозрачном. */
export function maskOf(def: FigureDef, idx?: number[]): HTMLCanvasElement {
  const cache = cacheOf(def);
  const key = idx ? idx.join(",") : "";
  const hit = cache.masks.get(key);
  if (hit) return hit;
  const c = makeCanvas(def.w, def.h);
  const x = ctx2d(c);
  x.fillStyle = "#000";
  (idx ? idx.map((i) => cache.paths[i] as Path2D) : cache.paths).forEach((p) => x.fill(p));
  cache.masks.set(key, c);
  return c;
}

/** Где писать имя: самая широкая часть тела. */
function labelSpot(def: FigureDef): [number, number, number, number] {
  const cache = cacheOf(def);
  if (cache.spot) return cache.spot;
  const q = 4;
  const W = Math.ceil(def.w / q);
  const H = Math.ceil(def.h / q);
  let best: { n: number; a: Uint8ClampedArray; cx: number; cy: number } | null = null;
  (def.body ?? cache.paths.map((_, i) => i)).forEach((i) => {
    const c = makeCanvas(W, H);
    const x = ctx2d(c, true);
    x.scale(1 / q, 1 / q);
    x.fill(cache.paths[i] as Path2D);
    const a = x.getImageData(0, 0, W, H).data;
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < W * H; k++)
      if ((a[k * 4 + 3] ?? 0) > 127) {
        n++;
        sx += k % W;
        sy += Math.floor(k / W);
      }
    if (n && (!best || n > best.n)) best = { n, a, cx: Math.round(sx / n), cy: Math.round(sy / n) };
  });
  if (!best) return (cache.spot = [def.w / 2, def.h / 2, def.w / 2, def.h / 4]);
  const { a, cx, cy } = best as { a: Uint8ClampedArray; cx: number; cy: number };
  const ins = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (a[(y * W + x) * 4 + 3] ?? 0) > 127;
  let l = cx;
  let r = cx;
  let t = cy;
  let b = cy;
  while (ins(l - 1, cy)) l--;
  while (ins(r + 1, cy)) r++;
  while (ins(cx, t - 1)) t--;
  while (ins(cx, b + 1)) b++;
  cache.spot = [((l + r + 1) / 2) * q, ((t + b + 1) / 2) * q, (r - l) * q * 0.78, (b - t) * q * 0.62];
  return cache.spot;
}

function drawName(x: CanvasRenderingContext2D, def: FigureDef, name: string, mirror: boolean) {
  const [cx, cy, w, h] = labelSpot(def);
  let fs = Math.min(h * 0.62, (w * 1.75) / Math.max(3, [...name].length));
  x.save();
  x.translate(cx, cy);
  if (mirror) x.scale(-1, 1);
  x.font = `600 ${fs}px Jost, system-ui, sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  while (x.measureText(name).width > w && fs > 10) {
    fs *= 0.9;
    x.font = `600 ${fs}px Jost, system-ui, sans-serif`;
  }
  x.lineJoin = "round";
  x.lineWidth = fs * 0.24;
  x.strokeStyle = "#2b2230";
  x.strokeText(name, 0, 0);
  x.fillStyle = "#ffffff";
  x.fillText(name, 0, 0);
  x.restore();
}

/** Контур и детали фигуры линиями. */
export function linesOf(def: FigureDef, color: string): HTMLCanvasElement {
  const cache = cacheOf(def);
  const hit = cache.lines.get(color);
  if (hit) return hit;
  const c = makeCanvas(def.w, def.h);
  const x = ctx2d(c);
  x.strokeStyle = color;
  x.lineJoin = "round";
  x.lineCap = "round";
  x.lineWidth = 3.5;
  cache.dpaths.forEach((p) => x.stroke(p));
  x.globalCompositeOperation = "destination-in";
  x.drawImage(maskOf(def), 0, 0);
  x.globalCompositeOperation = "source-over";
  x.lineWidth = 5;
  cache.paths.forEach((p) => x.stroke(p));
  cache.lines.set(color, c);
  return c;
}

const PALS: Array<[string, string, string]> = [
  ["#ff8a3d", "#ffffff", "#262033"],
  ["#3fb6ff", "#ffe066", "#1b3a5c"],
  ["#ff5c8a", "#ffd3e0", "#6b1f45"],
  ["#6fd67a", "#ffe9a8", "#1f6b48"],
  ["#b28dff", "#ffd166", "#3d2a6d"],
  ["#ffd23f", "#ff6b35", "#14897d"],
  ["#18c2a8", "#ff9f1c", "#ffffff"],
  ["#e63946", "#f1faee", "#1d3557"],
  ["#f78fb3", "#7ed6df", "#4834d4"],
];

/** «Раскрасить за меня»: случайный узор, как цветными карандашами. */
export function autoPaint(def: FigureDef, x: CanvasRenderingContext2D) {
  const cache = cacheOf(def);
  const W = def.w;
  const H = def.h;
  const [a, b, c] = def.pal ?? pick(PALS);
  x.save();
  x.fillStyle = a;
  x.fillRect(0, 0, W, H);
  const style = def.style ?? (def.kind === "fish" ? pick(["stripes", "spots", "grad", "scales"]) : pick(["bands", "dots", "zig", "grad", "scales"]));
  if (style === "stripes") {
    for (let px = W * 0.3; px < W * 0.86; px += rand(70, 105)) {
      x.fillStyle = c;
      x.fillRect(px - 5, 0, 40, H);
      x.fillStyle = b;
      x.fillRect(px, 0, 30, H);
    }
  }
  if (style === "spots" || style === "dots") {
    for (let i = 0; i < 34; i++) {
      x.fillStyle = Math.random() < 0.6 ? b : c;
      x.beginPath();
      x.arc(rand(0, W), rand(0, H), rand(6, def.kind === "fish" ? 22 : 16), 0, TAU);
      x.fill();
    }
  }
  if (style === "grad") {
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    for (let i = 0; i < 10; i++) {
      x.fillStyle = c;
      x.globalAlpha = 0.8;
      x.beginPath();
      x.arc(rand(0, W), rand(0, H), rand(4, 10), 0, TAU);
      x.fill();
    }
    x.globalAlpha = 1;
  }
  if (style === "scales") {
    x.strokeStyle = c;
    x.globalAlpha = 0.45;
    x.lineWidth = 3;
    for (let yy = 20, r = 0; yy < H; yy += 22, r++) {
      for (let xx = (r % 2) * 15; xx < W; xx += 30) {
        x.beginPath();
        x.arc(xx, yy, 14, 0, Math.PI);
        x.stroke();
      }
    }
    x.globalAlpha = 1;
  }
  if (style === "bands") {
    for (let yy = 70, i = 0; yy < H; yy += rand(40, 60), i++) {
      x.fillStyle = i % 2 ? b : c;
      x.fillRect(0, yy, W, 18);
    }
  }
  if (style === "zig") {
    [b, c, b].forEach((col, i) => {
      x.strokeStyle = col;
      x.lineWidth = 16;
      x.lineJoin = "round";
      x.beginPath();
      const yy = 130 + i * 55;
      for (let xx = -10, k = 0; xx < W + 20; xx += 26, k++) x.lineTo(xx, yy + (k % 2 ? 14 : -14));
      x.stroke();
    });
  }
  if (style === "cane") {
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, W, H);
    x.lineWidth = 24;
    x.strokeStyle = a === "#ffffff" ? "#e63946" : a;
    for (let k = -400; k < 600; k += 60) {
      x.beginPath();
      x.moveTo(k, 0);
      x.lineTo(k + 320, H);
      x.stroke();
    }
  }
  if (style === "snow") {
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, W, H);
    const g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "rgba(140,180,230,.35)");
    g.addColorStop(0.5, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  }
  (def.accent ?? []).forEach((i) => {
    x.fillStyle = def.style === "snow" ? a : def.style === "plain" ? b : style === "stripes" ? c : pick([b, c]);
    x.globalAlpha = 0.92;
    x.fill(cache.paths[i] as Path2D);
    x.globalAlpha = 1;
  });
  (def.metal ?? []).forEach((i) => {
    const g = x.createLinearGradient(90, 0, 170, 0);
    g.addColorStop(0, "#a8832e");
    g.addColorStop(0.5, "#ffe08a");
    g.addColorStop(1, "#a8832e");
    x.fillStyle = g;
    x.fill(cache.paths[i] as Path2D);
  });
  // Штрихи карандаша: похоже на раскрашенный от руки лист.
  for (let i = 0; i < 320; i++) {
    x.strokeStyle = pick([a, b, c, "#ffffff"]);
    x.globalAlpha = 0.1;
    x.lineWidth = rand(2, 4);
    const sx = rand(0, W);
    const sy = rand(0, H);
    const L = rand(10, 30);
    const an = 0.7 + rand(-0.2, 0.2);
    x.beginPath();
    x.moveTo(sx, sy);
    x.lineTo(sx + Math.cos(an) * L, sy + Math.sin(an) * L);
    x.stroke();
  }
  x.globalAlpha = 1;
  (def.fills ?? []).forEach(([p, col]) => {
    x.fillStyle = col;
    x.fill(new Path2D(p));
  });
  paintEyes(def, x);
  x.globalCompositeOperation = "destination-in";
  x.drawImage(maskOf(def), 0, 0);
  x.restore();
}

/** Глаза и точки-пуговицы (поверх раскраски, чтобы рыбка всегда «смотрела»). */
export function paintEyes(def: FigureDef, x: CanvasRenderingContext2D) {
  (def.eyes ?? []).forEach(([ex, ey, r]) => {
    x.fillStyle = "#fff";
    x.beginPath();
    x.arc(ex, ey, r, 0, TAU);
    x.fill();
    x.fillStyle = "#1a1420";
    x.beginPath();
    x.arc(ex + r * 0.25, ey, r * 0.58, 0, TAU);
    x.fill();
    x.fillStyle = "#fff";
    x.beginPath();
    x.arc(ex + r * 0.45, ey - r * 0.3, r * 0.2, 0, TAU);
    x.fill();
  });
  (def.dots ?? []).forEach(([ex, ey, r]) => {
    x.fillStyle = "#1a1420";
    x.beginPath();
    x.arc(ex, ey, r, 0, TAU);
    x.fill();
  });
}

/** Текстура для сцены: раскраска + контур + имя на боку; тёмная полоса за контуром — без светлой каймы на срезе. */
export function composeTexture(def: FigureDef, paint: CanvasImageSource, name: string | null, mirror = false): HTMLCanvasElement {
  const cache = cacheOf(def);
  const c = makeCanvas(def.w, def.h);
  const x = ctx2d(c);
  x.drawImage(paint, 0, 0, def.w, def.h);
  x.globalAlpha = 0.9;
  x.drawImage(linesOf(def, "#2b2230"), 0, 0);
  x.globalAlpha = 1;
  if (name) drawName(x, def, name, mirror);
  x.globalCompositeOperation = "destination-in";
  x.drawImage(maskOf(def), 0, 0);
  x.globalCompositeOperation = "destination-over";
  x.strokeStyle = "#2b2230";
  x.lineJoin = "round";
  x.lineWidth = 10;
  cache.paths.forEach((p) => x.stroke(p));
  return c;
}

/** Готовая раскраска (стартовые рыбки, предпросмотр, рисунок без файла). */
export function demoPaint(def: FigureDef): HTMLCanvasElement {
  const p = makeCanvas(def.w, def.h);
  autoPaint(def, ctx2d(p));
  return p;
}

/** Пустой лист: фигура белая. */
export function clearPaint(def: FigureDef, x: CanvasRenderingContext2D) {
  x.globalCompositeOperation = "source-over";
  x.clearRect(0, 0, def.w, def.h);
  x.fillStyle = "#ffffff";
  cacheOf(def).paths.forEach((p) => x.fill(p));
}

/** Миниатюра фигуры для выбора (белый силуэт с контуром). */
export function drawThumb(def: FigureDef, c: HTMLCanvasElement) {
  const x = ctx2d(c);
  const sc = Math.min((c.width - 8) / def.w, (c.height - 8) / def.h);
  x.clearRect(0, 0, c.width, c.height);
  x.save();
  x.translate((c.width - def.w * sc) / 2, (c.height - def.h * sc) / 2);
  x.scale(sc, sc);
  x.fillStyle = "#f5ecef";
  cacheOf(def).paths.forEach((p) => x.fill(p));
  x.strokeStyle = "#3b3142";
  x.lineWidth = 6;
  cacheOf(def).paths.forEach((p) => x.stroke(p));
  x.restore();
}
