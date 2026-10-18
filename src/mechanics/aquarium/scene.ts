// 3D-сцены «Аквариума и Ёлки» для экрана зала (three.js r128). Перенесено из согласованного прототипа (18 октября 2026)
// без изменения вида и поведения: аквариум (песок, камни, водоросли, лучи, пузырьки, морские звёзды, ракушки, улитки,
// крабы, корм) и ёлка (ярусы с инеем, лапы, гирлянда, звезда, снег, лес и горы, куранты с отсчётом до Нового года,
// Дед Мороз на санях, медведь и заяц из леса). Плоский рисунок гостя «надувается» в объёмную фигуру — движок раскрасок
// по мотивам Paper Aquarium (автор MrMoT9I, MIT). Отдельный чанк: телефонам гостей он не нужен.
import * as THREE from "three";
import { AQUA_MAX, GARLAND_MODES, type SceneId } from "./content";
import { FISH, ORN, type FigureDef } from "./figures";
import { composeTexture, ctx2d, demoPaint, makeCanvas, maskOf, pathsOf } from "./paint";

export interface StageItem {
  id: string;
  fig: FigureDef;
  /** Раскраска гостя (холст или картинка размером листа). */
  paint: CanvasImageSource;
  /** Имя на боку (null — без имени). */
  name: string | null;
  /** Подпись над фигурой при появлении («Рыбка от: Аня»); null — без подписи. */
  label: string | null;
}

export interface AquaStage {
  setScene(scene: SceneId): void;
  /** Новая фигура гостя. `live` — появилась сейчас (подпись, ёлка поворачивается к игрушке). */
  add(scene: SceneId, item: StageItem, live: boolean): void;
  remove(scene: SceneId, id: string): void;
  has(scene: SceneId, id: string): boolean;
  /** Сколько гостевых и сколько всего на сцене. */
  count(scene: SceneId): { guests: number; total: number; max: number };
  feed(): void;
  setGarland(mode: number): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;

interface Geo extends THREE.BufferGeometry {
  userData: { height: number; T: number };
}
const geoCache = new WeakMap<FigureDef, Map<string, Geo>>();

/** Плоский силуэт → объёмная «подушка»: расстояние до края по маске, общий шов передней и задней половин. */
function inflate(def: FigureDef, idx?: number[], puff?: number): Geo {
  let map = geoCache.get(def);
  if (!map) geoCache.set(def, (map = new Map()));
  const gkey = (idx ? idx.join(",") : "") + "|" + (puff ?? "");
  const hit = map.get(gkey);
  if (hit) return hit;
  const all = pathsOf(def);
  const paths = idx ? idx.map((i) => all[i] as Path2D) : all;
  const gx = def.kind === "fish" ? 128 : 88;
  const gy = Math.round((gx * def.h) / def.w);
  const Wd = gx + 1;
  const Hd = gy + 1;
  const N = Wd * Hd;
  const c = makeCanvas(Wd, Hd);
  const x = ctx2d(c, true);
  x.translate(0.5, 0.5);
  x.scale(gx / def.w, gy / def.h);
  x.fillStyle = "#000";
  paths.forEach((p) => x.fill(p));
  const px = x.getImageData(0, 0, Wd, Hd).data;
  const d = new Float32Array(N);
  for (let k = 0; k < N; k++) d[k] = (px[k * 4 + 3] ?? 0) > 110 ? 1e6 : 0;
  const g = (i: number, j: number) => (i < 0 || j < 0 || i >= Wd || j >= Hd ? 0 : (d[j * Wd + i] ?? 0));
  for (let j = 0; j < Hd; j++)
    for (let i = 0; i < Wd; i++) {
      const k = j * Wd + i;
      if ((d[k] ?? 0) > 0) d[k] = Math.min(d[k] ?? 0, g(i - 1, j) + 1, g(i, j - 1) + 1, g(i - 1, j - 1) + 1.414, g(i + 1, j - 1) + 1.414);
    }
  for (let j = Hd - 1; j >= 0; j--)
    for (let i = Wd - 1; i >= 0; i--) {
      const k = j * Wd + i;
      if ((d[k] ?? 0) > 0) d[k] = Math.min(d[k] ?? 0, g(i + 1, j) + 1, g(i, j + 1) + 1, g(i + 1, j + 1) + 1.414, g(i - 1, j + 1) + 1.414);
    }
  let maxD = 1;
  for (let k = 0; k < N; k++) if ((d[k] ?? 0) > maxD) maxD = d[k] ?? 0;
  // Край: точки сетки сразу за фигурой притягиваются к самому контуру — общие для передней и задней половин.
  const hi = ctx2d(maskOf(def, idx), true).getImageData(0, 0, def.w, def.h).data;
  const HW = def.w;
  const HH = def.h;
  const sx = def.w / gx;
  const sy = def.h / gy;
  const rr = Math.ceil(Math.max(sx, sy) * 1.6);
  const kind = new Int8Array(N);
  const PX = new Float32Array(N);
  const PY = new Float32Array(N);
  for (let j = 0; j < Hd; j++)
    for (let i = 0; i < Wd; i++) {
      const k = j * Wd + i;
      const qx = i * sx;
      const qy = j * sy;
      if ((d[k] ?? 0) > 0) {
        kind[k] = 1;
        PX[k] = qx;
        PY[k] = qy;
        continue;
      }
      let nb = false;
      for (let b = -1; b <= 1 && !nb; b++)
        for (let a = -1; a <= 1; a++)
          if ((a || b) && g(i + a, j + b) > 0) {
            nb = true;
            break;
          }
      if (!nb) continue;
      let best = 1e9;
      let bx = 0;
      let by = 0;
      const cx = Math.round(qx);
      const cy = Math.round(qy);
      for (let yy = Math.max(0, cy - rr); yy <= Math.min(HH - 1, cy + rr); yy++)
        for (let xx = Math.max(0, cx - rr); xx <= Math.min(HW - 1, cx + rr); xx++) {
          if ((hi[(yy * HW + xx) * 4 + 3] ?? 0) > 127) {
            const dd = (xx + 0.5 - qx) * (xx + 0.5 - qx) + (yy + 0.5 - qy) * (yy + 0.5 - qy);
            if (dd < best) {
              best = dd;
              bx = xx + 0.5;
              by = yy + 0.5;
            }
          }
        }
      if (best < 1e9) {
        kind[k] = 2;
        PX[k] = bx;
        PY[k] = by;
      }
    }
  const R = maxD * 0.95;
  const T = (maxD / gx) * (puff || def.puff || (def.kind === "fish" ? 0.82 : 0.95));
  const asp = def.h / def.w;
  const pos = new Float32Array(N * 2 * 3);
  const uv = new Float32Array(N * 2 * 2);
  for (let s2 = 0; s2 < 2; s2++) {
    const sg = s2 ? -1 : 1;
    for (let k = 0; k < N; k++) {
      if (!kind[k]) continue;
      const v = s2 * N + k;
      const t = kind[k] === 1 ? Math.min(1, Math.max(0, ((d[k] ?? 0) - 0.35) / R)) : 0;
      const hh = T * Math.sqrt(1 - (1 - t) * (1 - t));
      pos[v * 3] = (PX[k] ?? 0) / def.w - 0.5;
      pos[v * 3 + 1] = (0.5 - (PY[k] ?? 0) / def.h) * asp;
      pos[v * 3 + 2] = sg * hh;
      uv[v * 2] = (PX[k] ?? 0) / def.w;
      uv[v * 2 + 1] = 1 - (PY[k] ?? 0) / def.h;
    }
  }
  const F = (k: number) => k;
  const B = (k: number) => (kind[k] === 2 ? k : N + k);
  const iF: number[] = [];
  const iB: number[] = [];
  for (let j = 0; j < gy; j++)
    for (let i = 0; i < gx; i++) {
      const a = j * Wd + i;
      const b = a + 1;
      const c2 = a + Wd;
      const e = c2 + 1;
      if (!kind[a] || !kind[b] || !kind[c2] || !kind[e]) continue;
      if (kind[a] !== 1 && kind[b] !== 1 && kind[c2] !== 1 && kind[e] !== 1) continue;
      iF.push(F(a), F(c2), F(b), F(b), F(c2), F(e));
      iB.push(B(a), B(b), B(c2), B(b), B(e), B(c2));
    }
  const geo = new THREE.BufferGeometry() as Geo;
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(iF.concat(iB));
  geo.addGroup(0, iF.length, 0);
  geo.addGroup(iF.length, iB.length, 1);
  geo.computeVertexNormals();
  geo.userData = { height: asp, T };
  map.set(gkey, geo);
  return geo;
}

function texFrom(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  return t;
}

function gradTex(w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = makeCanvas(w, h);
  draw(ctx2d(c), w, h);
  return new THREE.CanvasTexture(c);
}

function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const t = gradTex(w, h, draw);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  return t;
}

type Uniform = { value: number };

interface Fish {
  id: string | null;
  obj: THREE.Object3D;
  u: { uTime: Uniform; uAmp: Uniform };
  s: number;
  parts: Array<{ piv: THREE.Group; pt: NonNullable<FigureDef["parts"]>[number]; sd: number }>;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  speed: number;
  wave: number;
  yaw: number;
  pitch: number;
  dispose: () => void;
}

interface Slot {
  a: number;
  y: number;
  h: number;
  need: number;
  P: THREE.Vector3;
  tier: number;
  used?: boolean;
}

interface Ornament {
  id: string | null;
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  ph: number;
  drop: number;
  hgt: number;
  slot: Slot;
  dispose: () => void;
}

interface Tag {
  el: HTMLDivElement;
  obj: THREE.Object3D;
  lift: number;
  life: number;
  scene: SceneId;
}

function sledFrame(x: CanvasRenderingContext2D, f: number) {
  const W = 1024;
  const H = 320;
  x.clearRect(0, 0, W, H);
  x.lineCap = "round";
  x.lineJoin = "round";
  x.strokeStyle = "#e9c46a";
  x.lineWidth = 4;
  x.beginPath();
  x.moveTo(700, 175);
  x.quadraticCurveTo(520, 150, 330, 160);
  x.stroke();
  // Олени, у переднего — красный нос.
  [0, 1, 2, 3].forEach((k) => {
    const cx = 110 + k * 150;
    const cy = 170 + ((k + f) % 2 ? -8 : 6);
    const ph = (k + f) % 2;
    x.strokeStyle = "#5a3417";
    x.lineWidth = 9;
    const legs = ph
      ? [
          [-30, 40, -50],
          [-15, 45, -5],
          [25, 42, 10],
          [38, 40, 55],
        ]
      : [
          [-30, 42, -15],
          [-15, 44, -35],
          [25, 44, 45],
          [38, 40, 20],
        ];
    legs.forEach(([lx, ly, ex]) => {
      x.beginPath();
      x.moveTo(cx + (lx ?? 0), cy + 10);
      x.lineTo(cx + (ex ?? 0), cy + (ly ?? 0) + 12);
      x.stroke();
    });
    x.fillStyle = "#8b5a2b";
    x.beginPath();
    x.ellipse(cx, cy, 58, 26, -0.05, 0, TAU);
    x.fill();
    x.fillStyle = "#c79a6b";
    x.beginPath();
    x.ellipse(cx + 5, cy + 10, 36, 12, 0, 0, TAU);
    x.fill();
    x.fillStyle = "#8b5a2b";
    x.beginPath();
    x.moveTo(cx + 40, cy - 14);
    x.lineTo(cx + 62, cy - 46);
    x.lineTo(cx + 78, cy - 40);
    x.lineTo(cx + 56, cy - 4);
    x.fill();
    x.beginPath();
    x.ellipse(cx + 76, cy - 50, 22, 15, 0.25, 0, TAU);
    x.fill();
    x.strokeStyle = "#4a2a12";
    x.lineWidth = 5;
    [
      [0, -1],
      [12, 1],
    ].forEach(([o]) => {
      const oo = o ?? 0;
      x.beginPath();
      x.moveTo(cx + 66 + oo, cy - 62);
      x.lineTo(cx + 60 + oo, cy - 92);
      x.lineTo(cx + 48 + oo, cy - 104);
      x.moveTo(cx + 61 + oo, cy - 82);
      x.lineTo(cx + 74 + oo, cy - 96);
      x.stroke();
    });
    x.fillStyle = "#1a1420";
    x.beginPath();
    x.arc(cx + 80, cy - 55, 3.5, 0, TAU);
    x.fill();
    x.fillStyle = k === 3 ? "#ff2a2a" : "#2b1a10";
    x.beginPath();
    x.arc(cx + 97, cy - 46, k === 3 ? 8 : 5, 0, TAU);
    x.fill();
    if (k === 3) {
      const g = x.createRadialGradient(cx + 97, cy - 46, 0, cx + 97, cy - 46, 26);
      g.addColorStop(0, "rgba(255,60,60,.7)");
      g.addColorStop(1, "rgba(255,60,60,0)");
      x.fillStyle = g;
      x.beginPath();
      x.arc(cx + 97, cy - 46, 26, 0, TAU);
      x.fill();
    }
    x.fillStyle = "#e9c46a";
    x.fillRect(cx - 8, cy - 27, 10, 54);
  });
  // Мешок.
  x.fillStyle = "#8a5a32";
  x.beginPath();
  x.ellipse(915, 140, 70, 62, 0.2, 0, TAU);
  x.fill();
  x.fillStyle = "#e9c46a";
  x.fillRect(900, 72, 22, 14);
  // Дед Мороз.
  x.fillStyle = "#c8202f";
  x.beginPath();
  x.ellipse(820, 148, 52, 58, 0, 0, TAU);
  x.fill();
  x.fillStyle = "#fff7ee";
  x.fillRect(772, 188, 96, 16);
  // Машет рукой.
  x.strokeStyle = "#c8202f";
  x.lineWidth = 22;
  x.beginPath();
  x.moveTo(790, 128);
  x.lineTo(752, f ? 70 : 84);
  x.stroke();
  x.fillStyle = "#fff7ee";
  x.beginPath();
  x.arc(748, f ? 62 : 76, 13, 0, TAU);
  x.fill();
  x.fillStyle = "#f2c7a5";
  x.beginPath();
  x.arc(822, 86, 30, 0, TAU);
  x.fill();
  x.fillStyle = "#ffffff";
  x.beginPath();
  x.moveTo(792, 92);
  x.quadraticCurveTo(822, 180, 852, 92);
  x.quadraticCurveTo(822, 112, 792, 92);
  x.fill();
  x.beginPath();
  x.ellipse(822, 96, 22, 9, 0, 0, TAU);
  x.fill();
  x.fillStyle = "#1a1420";
  x.beginPath();
  x.arc(811, 80, 3.5, 0, TAU);
  x.arc(833, 80, 3.5, 0, TAU);
  x.fill();
  x.fillStyle = "#e8858a";
  x.beginPath();
  x.arc(822, 88, 5, 0, TAU);
  x.fill();
  x.fillStyle = "#c8202f";
  x.beginPath();
  x.moveTo(790, 64);
  x.quadraticCurveTo(820, 10, 862, 30);
  x.lineTo(852, 64);
  x.fill();
  x.fillStyle = "#fff7ee";
  x.fillRect(788, 58, 68, 14);
  x.beginPath();
  x.arc(866, 32, 11, 0, TAU);
  x.fill();
  // Сани с завитком полоза.
  x.fillStyle = "#b3122a";
  x.beginPath();
  x.moveTo(700, 150);
  x.lineTo(990, 150);
  x.quadraticCurveTo(1000, 225, 940, 236);
  x.lineTo(720, 236);
  x.quadraticCurveTo(690, 200, 700, 150);
  x.fill();
  x.strokeStyle = "#e9c46a";
  x.lineWidth = 7;
  x.beginPath();
  x.moveTo(705, 160);
  x.lineTo(985, 160);
  x.stroke();
  x.lineWidth = 9;
  x.beginPath();
  x.moveTo(700, 262);
  x.lineTo(990, 262);
  x.quadraticCurveTo(1020, 262, 1012, 235);
  x.moveTo(700, 262);
  x.quadraticCurveTo(650, 262, 664, 226);
  x.quadraticCurveTo(676, 206, 690, 222);
  x.stroke();
  x.lineWidth = 6;
  [740, 820, 900, 960].forEach((px) => {
    x.beginPath();
    x.moveTo(px, 236);
    x.lineTo(px, 262);
    x.stroke();
  });
}

function animalTex(kind: "bear" | "hare"): THREE.CanvasTexture {
  return canvasTex(512, 640, (x) => {
    x.lineCap = "round";
    if (kind === "bear") {
      x.fillStyle = "#6e4426";
      x.beginPath();
      x.ellipse(256, 440, 150, 170, 0, 0, TAU);
      x.fill();
      x.fillStyle = "#a9774a";
      x.beginPath();
      x.ellipse(256, 470, 90, 110, 0, 0, TAU);
      x.fill();
      x.fillStyle = "#6e4426";
      [
        [160, 606],
        [352, 606],
      ].forEach(([a, b]) => {
        x.beginPath();
        x.ellipse(a ?? 0, b ?? 0, 62, 32, 0, 0, TAU);
        x.fill();
      });
      x.beginPath();
      x.ellipse(132, 430, 40, 90, 0.35, 0, TAU);
      x.fill();
      x.beginPath();
      x.arc(256, 210, 120, 0, TAU);
      x.fill();
      [
        [160, 110],
        [352, 110],
      ].forEach(([a, b]) => {
        x.fillStyle = "#6e4426";
        x.beginPath();
        x.arc(a ?? 0, b ?? 0, 44, 0, TAU);
        x.fill();
        x.fillStyle = "#a9774a";
        x.beginPath();
        x.arc(a ?? 0, b ?? 0, 24, 0, TAU);
        x.fill();
      });
      x.fillStyle = "#c79a6b";
      x.beginPath();
      x.ellipse(256, 260, 60, 46, 0, 0, TAU);
      x.fill();
      x.fillStyle = "#1a1420";
      x.beginPath();
      x.ellipse(256, 238, 22, 15, 0, 0, TAU);
      x.fill();
      x.beginPath();
      x.arc(206, 190, 11, 0, TAU);
      x.arc(306, 190, 11, 0, TAU);
      x.fill();
      x.fillStyle = "#fff";
      x.beginPath();
      x.arc(210, 186, 4, 0, TAU);
      x.arc(310, 186, 4, 0, TAU);
      x.fill();
      x.strokeStyle = "#1a1420";
      x.lineWidth = 6;
      x.beginPath();
      x.moveTo(256, 252);
      x.lineTo(256, 272);
      x.moveTo(230, 282);
      x.quadraticCurveTo(256, 300, 282, 282);
      x.stroke();
      x.fillStyle = "rgba(255,140,150,.45)";
      x.beginPath();
      x.arc(176, 240, 18, 0, TAU);
      x.arc(336, 240, 18, 0, TAU);
      x.fill();
    } else {
      x.fillStyle = "#eceef3";
      x.beginPath();
      x.ellipse(256, 470, 120, 150, 0, 0, TAU);
      x.fill();
      x.fillStyle = "#ffffff";
      x.beginPath();
      x.ellipse(256, 500, 70, 95, 0, 0, TAU);
      x.fill();
      x.fillStyle = "#eceef3";
      [
        [180, 612],
        [332, 612],
      ].forEach(([a, b]) => {
        x.beginPath();
        x.ellipse(a ?? 0, b ?? 0, 70, 26, 0, 0, TAU);
        x.fill();
      });
      x.beginPath();
      x.ellipse(352, 450, 28, 80, -0.3, 0, TAU);
      x.fill();
      [
        [200, -0.15],
        [312, 0.15],
      ].forEach(([a, r]) => {
        x.save();
        x.translate(a ?? 0, 150);
        x.rotate(r ?? 0);
        x.fillStyle = "#e2e5ec";
        x.beginPath();
        x.ellipse(0, -70, 36, 110, 0, 0, TAU);
        x.fill();
        x.fillStyle = "#f6b9c6";
        x.beginPath();
        x.ellipse(0, -70, 18, 84, 0, 0, TAU);
        x.fill();
        x.restore();
      });
      x.fillStyle = "#eceef3";
      x.beginPath();
      x.arc(256, 270, 100, 0, TAU);
      x.fill();
      x.fillStyle = "#ffffff";
      x.beginPath();
      x.ellipse(222, 310, 42, 32, 0, 0, TAU);
      x.ellipse(290, 310, 42, 32, 0, 0, TAU);
      x.fill();
      x.fillStyle = "#1a1420";
      x.beginPath();
      x.arc(214, 252, 12, 0, TAU);
      x.arc(298, 252, 12, 0, TAU);
      x.fill();
      x.fillStyle = "#fff";
      x.beginPath();
      x.arc(218, 247, 4, 0, TAU);
      x.arc(302, 247, 4, 0, TAU);
      x.fill();
      x.fillStyle = "#f28fa5";
      x.beginPath();
      x.moveTo(244, 290);
      x.lineTo(268, 290);
      x.lineTo(256, 304);
      x.fill();
      x.fillStyle = "#fff";
      x.strokeStyle = "#cfd3dc";
      x.lineWidth = 2;
      x.fillRect(246, 318, 10, 18);
      x.strokeRect(246, 318, 10, 18);
      x.fillRect(256, 318, 10, 18);
      x.strokeRect(256, 318, 10, 18);
      x.strokeStyle = "#9aa0ad";
      x.lineWidth = 3;
      [-1, 1].forEach((sd) => {
        for (let k = -1; k <= 1; k++) {
          x.beginPath();
          x.moveTo(256 + sd * 30, 304 + k * 6);
          x.lineTo(256 + sd * 92, 296 + k * 14);
          x.stroke();
        }
      });
      x.fillStyle = "rgba(255,140,160,.4)";
      x.beginPath();
      x.arc(190, 296, 16, 0, TAU);
      x.arc(322, 296, 16, 0, TAU);
      x.fill();
    }
  });
}

function armTex(kind: "bear" | "hare"): THREE.CanvasTexture {
  return canvasTex(128, 256, (x) => {
    x.fillStyle = kind === "bear" ? "#6e4426" : "#eceef3";
    x.beginPath();
    x.ellipse(64, 140, 40, 105, 0, 0, TAU);
    x.fill();
    x.fillStyle = kind === "bear" ? "#c79a6b" : "#f6b9c6";
    x.beginPath();
    x.ellipse(64, 62, 22, 18, 0, 0, TAU);
    x.fill();
  });
}

function easeOutBounce(v: number): number {
  const n = 7.5625;
  const d = 2.75;
  let x = v;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + d * t;
}

function disposeMaterials(mats: THREE.Material[], textures: THREE.Texture[]) {
  new Set(mats).forEach((m) => m.dispose());
  new Set(textures).forEach((t) => t.dispose());
}

export interface StageOptions {
  /** Готовые рыбки и игрушки для начала, чтобы экран не был пустым. */
  starters: boolean;
  scene: SceneId;
}

/** Сцены на элементе экрана; null — 3D (WebGL) на этом устройстве не включился. */
export function createStage(container: HTMLElement, options: StageOptions): AquaStage | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "aq-gl";
  container.prepend(renderer.domElement);
  const tagsEl = document.createElement("div");
  tagsEl.className = "aq-tags";
  container.appendChild(tagsEl);

  const dotTex = gradTex(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, "rgba(255,255,255,.95)");
    g.addColorStop(0.35, "rgba(255,255,255,.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  });
  const bubbleTex = gradTex(64, 64, (x) => {
    x.strokeStyle = "rgba(255,255,255,.85)";
    x.lineWidth = 4;
    x.beginPath();
    x.arc(32, 32, 24, 0, TAU);
    x.stroke();
    x.fillStyle = "rgba(255,255,255,.18)";
    x.fill();
    x.fillStyle = "rgba(255,255,255,.9)";
    x.beginPath();
    x.arc(24, 22, 5, 0, TAU);
    x.fill();
  });

  /* =========================== АКВАРИУМ =========================== */
  const AQ = {
    scene: new THREE.Scene(),
    cam: new THREE.PerspectiveCamera(50, 1, 0.1, 60),
    fish: [] as Fish[],
    food: [] as Array<{ m: THREE.Mesh; vx: number; ph: number }>,
    floorY: -2.3,
    crabs: [] as Array<{
      g: THREE.Group;
      legs: Array<{ pv: THREE.Group; sd: number; k: number }>;
      claws: Array<{ lo: THREE.Mesh; sd: number }>;
      z: number;
      x0: number;
      range: number;
      speed: number;
      ph: number;
    }>,
    rays: [] as Array<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>,
    bub: { n: 110, sp: new Float32Array(110), ph: new Float32Array(110), pts: null as THREE.Points | null },
  };
  AQ.cam.position.set(0, 0.3, 7);
  AQ.cam.lookAt(0, -0.1, 0);
  AQ.scene.fog = new THREE.Fog(0x0b3d58, 7.5, 17);
  AQ.scene.add(new THREE.HemisphereLight(0xcff4ff, 0x0a2a3a, 1.05));
  {
    const dl = new THREE.DirectionalLight(0xffffff, 0.85);
    dl.position.set(2, 6, 5);
    AQ.scene.add(dl);
  }
  const sandY = (x: number, z: number) => AQ.floorY + Math.sin(x * 0.6) * 0.12 + Math.cos(-(z + 4) * 0.9) * 0.1;
  {
    // Песок.
    const st = gradTex(256, 256, (x) => {
      x.fillStyle = "#c9b183";
      x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) {
        x.fillStyle = Math.random() < 0.5 ? "rgba(255,240,210,.35)" : "rgba(120,96,60,.3)";
        x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      }
    });
    st.wrapS = st.wrapT = THREE.RepeatWrapping;
    st.repeat.set(8, 4);
    st.encoding = THREE.sRGBEncoding;
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(44, 22, 40, 10), new THREE.MeshStandardMaterial({ map: st, roughness: 1 }));
    const p = sand.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 0.6) * 0.12 + Math.cos(p.getY(i) * 0.9) * 0.1);
    sand.geometry.computeVertexNormals();
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, AQ.floorY, -4);
    AQ.scene.add(sand);
    for (let i = 0; i < 7; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.3, 0.75), 0), new THREE.MeshStandardMaterial({ color: pick([0x5d6b78, 0x4a5563, 0x6f6a62]), flatShading: true, roughness: 0.9 }));
      r.position.set(rand(-7, 7), AQ.floorY + 0.05, rand(-6, -1));
      r.scale.y = rand(0.5, 0.8);
      r.rotation.set(rand(0, 3), rand(0, 3), 0);
      AQ.scene.add(r);
    }
  }
  {
    // Морские звёзды.
    const star = new THREE.Shape();
    for (let k = 0; k <= 10; k++) {
      const r = k % 2 ? 0.07 : 0.2;
      const a = Math.PI / 2 + (k * Math.PI) / 5;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (k) star.lineTo(px, py);
      else star.moveTo(px, py);
    }
    const sg = new THREE.ExtrudeGeometry(star, { depth: 0.03, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3 });
    sg.rotateX(-Math.PI / 2);
    (
      [
        [-3.2, 0.6, 0xff7a3d],
        [2.6, 1.1, 0xe8455a],
        [-1.1, -0.6, 0xb36bd6],
        [4.1, -1.5, 0xffa94d],
        [0.9, 1.6, 0xff6f91],
        [-4.6, -2, 0xffc14d],
      ] as Array<[number, number, number]>
    ).forEach(([x, z, c]) => {
      const m = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
      const k = rand(0.9, 1.4);
      m.scale.set(k, k, k);
      m.position.set(x, sandY(x, z) + 0.02, z);
      m.rotation.y = rand(0, 6);
      AQ.scene.add(m);
    });
    // Ракушки-гребешки.
    const fan = new THREE.Shape();
    fan.moveTo(0, 0);
    for (let k = 0; k <= 24; k++) {
      const a = -1.25 + (k * 2.5) / 24;
      const r = 0.2 + (k % 2 ? 0 : 0.018);
      fan.lineTo(Math.sin(a) * r, Math.cos(a) * r);
    }
    fan.lineTo(0, 0);
    const fg = new THREE.ExtrudeGeometry(fan, { depth: 0.02, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.03, bevelSegments: 3 });
    (
      [
        [-2.2, 1.3, 0xfbe3d0],
        [3.4, 0.2, 0xf7c6cf],
        [-0.4, 1.9, 0xfff1dc],
        [1.8, -1.2, 0xf2d4b7],
        [-3.8, -0.8, 0xffd9e0],
        [4.6, 1.4, 0xf6e7c8],
      ] as Array<[number, number, number]>
    ).forEach(([x, z, c]) => {
      const m = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 }));
      const k = rand(0.8, 1.3);
      m.scale.set(k, k, k);
      m.position.set(x, sandY(x, z) + 0.03, z);
      m.rotation.set(-Math.PI / 2 + rand(0.1, 0.5), 0, rand(0, 6));
      AQ.scene.add(m);
    });
    // Улитки.
    (
      [
        [-1.8, 0.2],
        [2.2, 1.8],
        [0.3, -1.8],
      ] as Array<[number, number]>
    ).forEach(([x, z]) => {
      const g = new THREE.Group();
      const col = pick([0xe9b77f, 0xd9a6c9, 0xf0d7a8]);
      for (let k = 0; k < 5; k++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.11 - k * 0.018, 12, 10), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }));
        b.position.set(Math.cos(k * 1.3) * 0.035, 0.06 + k * 0.045, Math.sin(k * 1.3) * 0.035);
        g.add(b);
      }
      g.position.set(x, sandY(x, z), z);
      g.rotation.z = 1.2;
      g.rotation.y = rand(0, 6);
      AQ.scene.add(g);
    });
    // Крабы.
    const red = new THREE.MeshStandardMaterial({ color: 0xe2483b, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1420 });
    const legG = new THREE.CylinderGeometry(0.018, 0.012, 0.22, 6);
    legG.translate(0, -0.11, 0);
    for (let c = 0; c < 3; c++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), red);
      body.scale.set(1.25, 0.55, 0.9);
      body.position.y = 0.13;
      g.add(body);
      const legs: Array<{ pv: THREE.Group; sd: number; k: number }> = [];
      [-1, 1].forEach((sd) => {
        for (let k = 0; k < 3; k++) {
          const pv = new THREE.Group();
          pv.position.set((k - 1) * 0.11, 0.12, sd * 0.15);
          const l = new THREE.Mesh(legG, red);
          l.rotation.x = sd * 0.9;
          pv.add(l);
          g.add(pv);
          legs.push({ pv, sd, k });
        }
      });
      const claws: Array<{ lo: THREE.Mesh; sd: number }> = [];
      [-1, 1].forEach((sd) => {
        const arm = new THREE.Group();
        arm.position.set(sd * 0.24, 0.16, 0.12);
        const a1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), red);
        a1.rotation.z = sd * 1.1;
        a1.position.set(sd * 0.05, 0.03, 0.03);
        arm.add(a1);
        const pin = new THREE.Group();
        pin.position.set(sd * 0.12, 0.08, 0.06);
        const up = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), red);
        up.scale.set(1.3, 0.6, 0.8);
        up.position.y = 0.03;
        pin.add(up);
        const lo = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), red);
        lo.scale.set(1.2, 0.5, 0.7);
        lo.position.y = -0.02;
        pin.add(lo);
        arm.add(pin);
        g.add(arm);
        claws.push({ lo, sd });
      });
      [-1, 1].forEach((sd) => {
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5), red);
        stalk.position.set(sd * 0.06, 0.26, 0.13);
        g.add(stalk);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), dark);
        eye.position.set(sd * 0.06, 0.33, 0.13);
        g.add(eye);
      });
      const z = rand(-1.5, 1.3);
      const x = rand(-3, 3);
      g.scale.setScalar(rand(0.9, 1.2));
      g.position.set(x, sandY(x, z), z);
      AQ.scene.add(g);
      AQ.crabs.push({ g, legs, claws, z, x0: x, range: rand(1.2, 2.2), speed: rand(0.25, 0.45), ph: rand(0, 6) });
    }
  }
  const sharedTime: Uniform = { value: 0 };
  for (let i = 0; i < 11; i++) {
    const h = rand(1.6, 3.4);
    const geo = new THREE.PlaneGeometry(0.38, h, 1, 14);
    geo.translate(0, h / 2, 0);
    const m = new THREE.MeshStandardMaterial({ color: pick([0x2f9e6a, 0x3bb273, 0x1f7a55, 0x6cbf5a]), side: THREE.DoubleSide, roughness: 0.8 });
    const ph: Uniform = { value: rand(0, 6) };
    const hh: Uniform = { value: h };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uT = sharedTime;
      sh.uniforms.uP = ph;
      sh.uniforms.uH = hh;
      sh.vertexShader =
        "uniform float uT;\nuniform float uP;\nuniform float uH;\n" +
        sh.vertexShader.replace(
          "#include <begin_vertex>",
          "vec3 transformed=vec3(position);\nfloat k=position.y/uH;\ntransformed.x*= (1.0-k*0.75);\ntransformed.x+= sin(uT*1.2+uP+position.y*1.6)*0.22*pow(k,1.4);\ntransformed.z+= cos(uT*0.9+uP)*0.12*k;",
        );
    };
    const w = new THREE.Mesh(geo, m);
    w.position.set(rand(-7, 7), AQ.floorY, rand(-6, -0.5));
    w.rotation.y = rand(0, 3);
    AQ.scene.add(w);
  }
  {
    const rt = gradTex(64, 256, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = "destination-in";
      const v = x.createLinearGradient(0, 0, 0, h);
      v.addColorStop(0, "rgba(0,0,0,1)");
      v.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = v;
      x.fillRect(0, 0, w, h);
    });
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(
        new THREE.PlaneGeometry(rand(0.8, 1.8), 12),
        new THREE.MeshBasicMaterial({ map: rt, color: 0xbff0ff, transparent: true, opacity: rand(0.08, 0.16), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      r.position.set(rand(-6, 6), 2.5, rand(-6, -2));
      r.rotation.z = rand(-0.35, -0.15);
      r.userData.ph = rand(0, 6);
      AQ.rays.push(r);
      AQ.scene.add(r);
    }
  }
  {
    // Пузырьки.
    const n = AQ.bub.n;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = rand(-7, 7);
      p[i * 3 + 1] = rand(-2.3, 4);
      p[i * 3 + 2] = rand(-6, 1.5);
      AQ.bub.sp[i] = rand(0.25, 0.7);
      AQ.bub.ph[i] = rand(0, 6);
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    AQ.bub.pts = new THREE.Points(g, new THREE.PointsMaterial({ map: bubbleTex, size: 0.11, transparent: true, depthWrite: false, opacity: 0.75 }));
    AQ.scene.add(AQ.bub.pts);
  }
  function fishMaterial(tex: THREE.Texture, u: Fish["u"]): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.55, metalness: 0.04 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = u.uTime;
      sh.uniforms.uAmp = u.uAmp;
      sh.vertexShader =
        "uniform float uTime;\nuniform float uAmp;\n" +
        sh.vertexShader.replace(
          "#include <begin_vertex>",
          "vec3 transformed=vec3(position);\nfloat tf=clamp((0.3-position.x)/0.8,0.0,1.0);\ntf=tf*tf;\ntransformed.z+= sin(position.x*6.5-uTime)*uAmp*tf + sin(uTime)*uAmp*0.12;",
        );
    };
    return m;
  }
  const halfW = (z: number) => (AQ.cam.position.z - z) * Math.tan(THREE.MathUtils.degToRad(AQ.cam.fov / 2)) * AQ.cam.aspect * 0.85 - 0.55;
  const halfH = (z: number) => (AQ.cam.position.z - z) * Math.tan(THREE.MathUtils.degToRad(AQ.cam.fov / 2)) * 0.78;
  function randTarget(v: THREE.Vector3): THREE.Vector3 {
    const z = rand(-3.5, 1.6);
    const hw = Math.max(0.6, halfW(z));
    const hh = halfH(z);
    return v.set(rand(-hw, hw), rand(Math.max(-hh + 0.2, AQ.floorY + 0.6), hh - 0.35), z);
  }
  function addFish(id: string | null, def: FigureDef, texCanvas: HTMLCanvasElement, label: string | null, backCanvas: HTMLCanvasElement | null) {
    const u = { uTime: { value: rand(0, 10) }, uAmp: { value: 0.055 } };
    const tF = texFrom(texCanvas);
    const tB = backCanvas ? texFrom(backCanvas) : tF;
    const front = fishMaterial(tF, u);
    const mats: THREE.Material[] = [front, backCanvas ? fishMaterial(tB, u) : front];
    const holder = new THREE.Group();
    const body = new THREE.Mesh(inflate(def, def.body), mats);
    holder.add(body);
    const parts: Fish["parts"] = [];
    const asp = def.h / def.w;
    (def.parts ?? []).forEach((pt) => {
      const geo = inflate(def, pt.idx, 0.45);
      const T = (body.geometry as Geo).userData.T;
      const pm = [new THREE.MeshStandardMaterial({ map: tF, alphaTest: 0.5, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: tB, alphaTest: 0.5, roughness: 0.6 })];
      mats.push(...pm);
      const px = pt.pivot[0] / def.w - 0.5;
      const py = (0.5 - pt.pivot[1] / def.h) * asp;
      [1, -1].forEach((sd) => {
        const piv = new THREE.Group();
        piv.position.set(px, py, sd * T * 0.55);
        const m = new THREE.Mesh(geo, pm);
        m.position.set(-px, -py, 0);
        piv.add(m);
        holder.add(piv);
        parts.push({ piv, pt, sd });
      });
    });
    const wide = AQ.cam.aspect > 1.2 ? 1.45 : 1;
    const s = (def.size ?? 1) * wide * rand(0.85, 1.1);
    holder.scale.setScalar(s);
    const obj = new THREE.Object3D();
    obj.rotation.order = "YZX";
    obj.add(holder);
    const side = Math.random() < 0.5 ? -1 : 1;
    const z = label ? rand(0, 1.2) : rand(-2.5, 1);
    obj.position.set(side * (halfW(z) + (label ? 0.4 : 1.8)), rand(-0.6, 1), z);
    const f: Fish = {
      id,
      obj,
      u,
      s,
      parts,
      vel: new THREE.Vector3(-side * (label ? 1.6 : 0.6), 0, 0),
      target: new THREE.Vector3(),
      speed: rand(0.45, 0.85) * (def.speed ?? 1),
      wave: def.wave === undefined ? 1 : def.wave,
      yaw: side > 0 ? Math.PI : 0,
      pitch: 0,
      dispose: () => disposeMaterials(mats, [tF, tB]),
    };
    randTarget(f.target);
    f.target.set(-side * halfW(z) * 0.3, rand(-0.3, 0.8), z);
    AQ.scene.add(obj);
    AQ.fish.push(f);
    if (label) addTag("aqua", obj, label, 0.35 * s + 0.2);
    return f;
  }
  function removeFish(f: Fish) {
    AQ.scene.remove(f.obj);
    AQ.fish.splice(AQ.fish.indexOf(f), 1);
    dropTags(f.obj);
    f.dispose();
  }
  function feed() {
    const geo = new THREE.IcosahedronGeometry(0.035, 0);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: pick([0xff9a3c, 0xe4572e, 0xffc857]), roughness: 0.8 }));
      const z = rand(-2.5, 1.2);
      const hw = Math.max(0.6, halfW(z));
      m.position.set(rand(-hw, hw) * 0.8, halfH(z) + rand(0, 1.2), z);
      AQ.scene.add(m);
      AQ.food.push({ m, vx: rand(-0.05, 0.05), ph: rand(0, 6) });
    }
  }
  function eat(i: number) {
    const f = AQ.food[i];
    if (!f) return;
    AQ.scene.remove(f.m);
    (f.m.material as THREE.Material).dispose();
    AQ.food.splice(i, 1);
  }
  const tmpV = new THREE.Vector3();
  const tmpW = new THREE.Vector3();
  const headV = new THREE.Vector3();
  function updateAquarium(dt: number, t: number) {
    sharedTime.value = t;
    AQ.crabs.forEach((c) => {
      const walk = Math.sin(t * c.speed + c.ph);
      const x = c.x0 + walk * c.range;
      const moving = Math.abs(Math.cos(t * c.speed + c.ph)) > 0.25;
      c.g.position.x = x;
      c.g.position.y = sandY(x, c.z);
      c.g.rotation.y = Math.sin(t * 0.3 + c.ph) * 0.25;
      c.legs.forEach((l) => {
        l.pv.rotation.z = moving ? Math.sin(t * 14 + l.k * 2 + (l.sd > 0 ? Math.PI : 0)) * 0.35 : 0;
      });
      c.claws.forEach((cl) => {
        cl.lo.rotation.z = cl.sd * (Math.max(0, Math.sin(t * 3 + c.ph)) * 0.5);
      });
    });
    AQ.rays.forEach((r) => {
      r.rotation.z = -0.25 + Math.sin(t * 0.25 + (r.userData.ph as number)) * 0.08;
      r.material.opacity = 0.1 + Math.sin(t * 0.4 + (r.userData.ph as number)) * 0.04;
    });
    const pts = AQ.bub.pts;
    if (pts) {
      const bp = pts.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < AQ.bub.n; i++) {
        let y = bp.getY(i) + (AQ.bub.sp[i] ?? 0) * dt;
        if (y > 4.2) {
          y = AQ.floorY;
          bp.setZ(i, rand(-6, 1.5));
        }
        bp.setY(i, y);
        bp.setX(i, bp.getX(i) + Math.sin(t * 2 + (AQ.bub.ph[i] ?? 0)) * 0.003);
      }
      bp.needsUpdate = true;
    }
    for (let i = AQ.food.length - 1; i >= 0; i--) {
      const f = AQ.food[i];
      if (!f) continue;
      f.m.position.y -= dt * 0.28;
      f.m.position.x += Math.sin(t * 1.5 + f.ph) * 0.004 + f.vx * dt;
      f.m.rotation.x += dt;
      if (f.m.position.y < AQ.floorY + 0.05) eat(i);
    }
    AQ.fish.forEach((f, fi) => {
      const p = f.obj.position;
      let tgt = f.target;
      let hungry = false;
      if (AQ.food.length) {
        let best: THREE.Vector3 | null = null;
        let bd = 4;
        AQ.food.forEach((fd) => {
          const dd = fd.m.position.distanceTo(p);
          if (dd < bd) {
            bd = dd;
            best = fd.m.position;
          }
        });
        if (best) {
          tgt = best;
          hungry = true;
        }
      }
      tmpV.subVectors(tgt, p);
      const dist = tmpV.length();
      if (!hungry && dist < 0.5) randTarget(f.target);
      tmpV.normalize().multiplyScalar(f.speed * (hungry ? 1.8 : 1));
      AQ.fish.forEach((o, oi) => {
        if (oi === fi) return;
        tmpW.subVectors(p, o.obj.position);
        const dd = tmpW.length();
        if (dd < 0.7 && dd > 0.001) tmpV.addScaledVector(tmpW.normalize(), (0.7 - dd) * 1.2);
      });
      f.vel.lerp(tmpV, 1 - Math.exp(-dt * 1.3));
      p.addScaledVector(f.vel, dt);
      const hs = Math.hypot(f.vel.x, f.vel.z);
      if (hs > 0.05) f.yaw = lerpAngle(f.yaw, Math.atan2(-f.vel.z, f.vel.x), 1 - Math.exp(-dt * 3));
      f.pitch += (THREE.MathUtils.clamp(Math.atan2(f.vel.y, hs), -0.45, 0.45) - f.pitch) * (1 - Math.exp(-dt * 3));
      f.obj.rotation.set(0, f.yaw, f.pitch);
      const spd = f.vel.length();
      f.u.uTime.value += dt * (3 + spd * 8);
      f.parts.forEach((pp) => {
        const ph = f.u.uTime.value * 0.45 + pp.pt.ph;
        pp.piv.rotation.x = -pp.sd * (0.2 + Math.sin(ph) * pp.pt.flap);
        pp.piv.rotation.z = Math.cos(ph) * pp.pt.sweep;
      });
      if (!f.wave) f.obj.position.y += Math.sin(f.u.uTime.value * 0.45) * 0.0015;
      f.u.uAmp.value = (0.04 + Math.min(spd, 1.2) * 0.035) * f.wave;
      if (hungry) {
        headV.set(0.45 * f.s, 0, 0).applyQuaternion(f.obj.quaternion).add(p);
        for (let i = AQ.food.length - 1; i >= 0; i--) if ((AQ.food[i] as { m: THREE.Mesh }).m.position.distanceTo(headV) < 0.28) eat(i);
      }
    });
  }

  /* =========================== ЁЛКА =========================== */
  const TR = {
    scene: new THREE.Scene(),
    cam: new THREE.PerspectiveCamera(45, 1, 0.1, 80),
    root: new THREE.Group(),
    slots: [] as Slot[],
    orns: [] as Ornament[],
    lights: [] as Array<{ m: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; s: THREE.Sprite; base: THREE.Color; sbase: THREE.Color; ph: number; y: number }>,
    mode: 0,
    rot: 0,
    focus: 0,
    focusT: 0,
  };
  TR.scene.add(new THREE.HemisphereLight(0xd6dcff, 0x1c1226, 0.75));
  {
    const dl = new THREE.DirectionalLight(0xffe4b8, 1.0);
    dl.position.set(3, 6, 8);
    TR.scene.add(dl);
    const pl = new THREE.PointLight(0xffc96b, 1.1, 9);
    pl.position.set(0, 5.4, 1.5);
    TR.scene.add(pl);
  }
  TR.scene.add(TR.root);
  const TREE = { y0: -1.95, H: 7.29, R: 3.4 };
  const TIERS: Array<{ yb: number; h: number; r: number }> = [];
  for (let i = 0; i < 9; i++) TIERS.push({ yb: -1.65 + i * 0.68, h: 1.55, r: 3.35 * (1 - i / 9.6) + 0.2 });
  const treeR = (y: number) => {
    let m = 0;
    TIERS.forEach((t) => {
      if (y >= t.yb - 0.12 && y <= t.yb + t.h) m = Math.max(m, t.r * Math.min(1, 1 - (y - t.yb) / t.h));
    });
    return m;
  };
  {
    // Мягкие ярусы с волнистым свисающим краем.
    const c1 = new THREE.Color("#123d27");
    const c2 = new THREE.Color("#2b8350");
    const c3 = new THREE.Color("#5aa874");
    const frost = new THREE.Color("#dfe8f2");
    TIERS.forEach((t, i) => {
      const g = new THREE.ConeGeometry(t.r, t.h, 72, 6, true);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const cols: number[] = [];
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k);
        const y = pos.getY(k);
        const z = pos.getZ(k);
        const v = (t.h / 2 - y) / t.h;
        const a = Math.atan2(x, z);
        const wav = Math.sin(a * 16 + i * 1.7);
        const sc = 1 + (0.07 * wav + 0.03 * Math.sin(a * 37 + i * 2.3) + 0.02 * Math.sin(a * 71)) * v * v;
        const rr = Math.hypot(x, z) * sc;
        const droop = v > 0.99 ? -0.12 * (0.5 + 0.5 * wav) : 0;
        pos.setXYZ(k, Math.sin(a) * rr, y + droop, Math.cos(a) * rr);
        const col = c1.clone().lerp(c2, Math.min(1, v * 1.15));
        if (v > 0.85) col.lerp(c3, 0.3);
        if (v > 0.8 && Math.sin(a * 16 + i * 1.7) > 0.55 && Math.sin(a * 5 + i * 3) > 0.2) col.lerp(frost, (0.55 * (v - 0.8)) / 0.2);
        col.convertSRGBToLinear();
        cols.push(col.r, col.g, col.b);
      }
      g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      g.computeVertexNormals();
      {
        // Сшить нормали по шву конуса — без светлой полосы.
        const nr = g.attributes.normal as THREE.BufferAttribute;
        const map = new Map<string, number[]>();
        for (let k = 0; k < pos.count; k++) {
          const key = pos.getX(k).toFixed(3) + "," + pos.getY(k).toFixed(3) + "," + pos.getZ(k).toFixed(3);
          const list = map.get(key);
          if (list) list.push(k);
          else map.set(key, [k]);
        }
        map.forEach((ks) => {
          if (ks.length < 2) return;
          let ax = 0;
          let ay = 0;
          let az = 0;
          ks.forEach((k) => {
            ax += nr.getX(k);
            ay += nr.getY(k);
            az += nr.getZ(k);
          });
          const l = Math.hypot(ax, ay, az) || 1;
          ks.forEach((k) => nr.setXYZ(k, ax / l, ay / l, az / l));
        });
      }
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
      m.position.y = t.yb + t.h / 2;
      TR.root.add(m);
    });
    // Места для игрушек: под краем яруса, с отступом от яруса ниже.
    let tries = 0;
    while (TR.slots.length < 40 && tries < 5000) {
      tries++;
      const i = 1 + Math.min(6, Math.floor(Math.pow(Math.random(), 1.25) * 7));
      const t = TIERS[i] as { yb: number; h: number; r: number };
      const a = rand(0, TAU);
      const y = t.yb - 0.02;
      const h = 0.86 - 0.045 * i;
      let need = treeR(y + 0.05) * 1.0 + 0.02;
      for (let q = 0; q <= 8; q++) need = Math.max(need, treeR(y - (h * q) / 8) + 0.08);
      const P = new THREE.Vector3(Math.sin(a) * need, y, Math.cos(a) * need);
      if (TR.slots.some((o) => o.P.distanceTo(P) < (o.h + h) * 0.6)) continue;
      TR.slots.push({ a, y, h, need, P, tier: i });
    }
    // Мягкие лапы по краю, и по лапе к каждой игрушке.
    const geo = new THREE.ConeGeometry(0.5, 1, 7, 1);
    geo.translate(0, 0.5, 0);
    const list: Array<{ base: THREE.Vector3; tip: THREE.Vector3; w: number; col: string }> = [];
    const UP = new THREE.Vector3(0, 1, 0);
    const greens = ["#24703f", "#2b7d49", "#1f6338", "#33894f"];
    TIERS.forEach((t) => {
      const n = Math.round((TAU * t.r) / 0.4);
      const off = rand(0, TAU);
      for (let k = 0; k < n; k++) {
        const a = off + (k * TAU) / n + rand(-0.08, 0.08);
        list.push({
          base: new THREE.Vector3(Math.sin(a) * t.r * 0.72, t.yb + 0.2, Math.cos(a) * t.r * 0.72),
          tip: new THREE.Vector3(Math.sin(a) * t.r * 1.05, t.yb - 0.06, Math.cos(a) * t.r * 1.05),
          w: 0.46,
          col: pick(greens),
        });
      }
    });
    TR.slots.forEach((o) => {
      const t = TIERS[o.tier] as { yb: number; h: number; r: number };
      list.push({
        base: new THREE.Vector3(Math.sin(o.a) * t.r * 0.7, o.y + 0.2, Math.cos(o.a) * t.r * 0.7),
        tip: new THREE.Vector3(Math.sin(o.a) * (o.need + 0.04), o.y + 0.02, Math.cos(o.a) * (o.need + 0.04)),
        w: 0.42,
        col: pick(greens),
      });
    });
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), list.length);
    const M = new THREE.Matrix4();
    const X = new THREE.Vector3();
    const Y = new THREE.Vector3();
    const Z = new THREE.Vector3();
    const col = new THREE.Color();
    list.forEach((it, i) => {
      Y.subVectors(it.tip, it.base);
      const len = Y.length();
      Y.normalize();
      X.crossVectors(Y, UP);
      if (X.lengthSq() < 1e-4) X.set(1, 0, 0);
      X.normalize();
      Z.crossVectors(X, Y).normalize();
      M.makeBasis(X.multiplyScalar(it.w), Y.multiplyScalar(len), Z.multiplyScalar(it.w * 0.32));
      M.setPosition(it.base);
      im.setMatrixAt(i, M);
      im.setColorAt(i, col.set(it.col).convertSRGBToLinear());
    });
    TR.root.add(im);
  }
  {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x5b3a24, roughness: 0.9 }));
    trunk.position.y = -1.85;
    TR.root.add(trunk);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshStandardMaterial({ color: 0xb9c6dc, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.22;
    TR.scene.add(ground);
    (
      [
        [-3.7, 0.8, 1.3, 0xd64550, 0xffd166],
        [3.6, 0.65, 1.5, 0x3d7dd8, 0xffffff],
        [-2.5, 0.5, 3.1, 0xf0b429, 0xa83279],
        [2.4, 0.45, 3.2, 0x8e5cd9, 0xffe08a],
      ] as Array<[number, number, number, number, number]>
    ).forEach(([x, s, z, a, b]) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.85, s), new THREE.MeshStandardMaterial({ color: a, roughness: 0.6 })));
      const rm = new THREE.MeshStandardMaterial({ color: b, roughness: 0.4 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, s * 0.87, s * 0.16), rm), new THREE.Mesh(new THREE.BoxGeometry(s * 0.16, s * 0.87, s * 1.02), rm));
      g.position.set(x, -2.22 + s * 0.425, z);
      g.rotation.y = rand(-0.5, 0.5);
      TR.scene.add(g);
    });
  }
  // Звезда.
  const starShape = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 0.19 : 0.46;
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    if (k) starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  starShape.closePath();
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
  starGeo.center();
  const treeStar = new THREE.Mesh(starGeo, new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffb020, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.3 }));
  treeStar.position.y = TREE.y0 + TREE.H + 0.12;
  TR.root.add(treeStar);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xffd27a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(2.4);
  glow.position.y = TREE.y0 + TREE.H + 0.12;
  TR.scene.add(glow);
  {
    // Гирлянда: крупные лампочки с насыщенным свечением.
    const cols = [0xff2340, 0xffb000, 0x1f6bff, 0x18e070, 0xff2bd6, 0x00e5ff];
    const sgeo = new THREE.SphereGeometry(0.075, 10, 8);
    for (let i = 0; i < 230; i++) {
      const t = TIERS[Math.min(8, Math.floor(Math.pow(Math.random(), 1.3) * 9))] as { yb: number; h: number; r: number };
      const v = rand(0.25, 0.97);
      const a = rand(0, TAU);
      const y = t.yb + (1 - v) * t.h;
      const rr = t.r * v + 0.05;
      const p = new THREE.Vector3(Math.sin(a) * rr, y, Math.cos(a) * rr);
      const base = new THREE.Color(pick(cols));
      const lin = base.clone().convertSRGBToLinear();
      const m = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({ color: lin.clone() }));
      m.position.copy(p);
      TR.root.add(m);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: base, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.scale.setScalar(0.62);
      sp.position.copy(p);
      TR.root.add(sp);
      TR.lights.push({ m, s: sp, base: lin, sbase: base, ph: rand(0, TAU), y });
    }
  }
  const snow = { n: 480, sp: new Float32Array(480), ph: new Float32Array(480), pts: null as THREE.Points | null };
  {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(snow.n * 3);
    for (let i = 0; i < snow.n; i++) {
      p[i * 3] = rand(-9, 9);
      p[i * 3 + 1] = rand(-2.2, 8);
      p[i * 3 + 2] = rand(-6, 5);
      snow.sp[i] = rand(0.3, 0.8);
      snow.ph[i] = rand(0, 6);
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    snow.pts = new THREE.Points(g, new THREE.PointsMaterial({ map: dotTex, size: 0.12, transparent: true, depthWrite: false, opacity: 0.9, fog: false }));
    TR.scene.add(snow.pts);
  }
  {
    // Фон: снежная равнина, лес, две гряды гор.
    TR.scene.fog = new THREE.Fog(0x1b1533, 16, 46);
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(140, 70), new THREE.MeshStandardMaterial({ color: 0xaab8d2, roughness: 1 }));
    plain.rotation.x = -Math.PI / 2;
    plain.position.set(0, -2.24, -20);
    TR.scene.add(plain);
    const ridge = (cols: [string, string], seed: number, peaks: number, snowLine: number) =>
      gradTex(1024, 256, (x, w, h) => {
        let r = seed;
        const rnd = () => {
          r = (r * 9301 + 49297) % 233280;
          return r / 233280;
        };
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= peaks; i++) pts.push([(i / peaks) * w, h * (0.18 + rnd() * 0.45)]);
        x.beginPath();
        x.moveTo(0, h);
        pts.forEach(([px, py], i) => {
          if (i) {
            const [qx, qy] = pts[i - 1] as [number, number];
            x.lineTo((qx + px) / 2, Math.max(qy, py) + h * 0.12 * rnd());
          }
          x.lineTo(px, py);
        });
        x.lineTo(w, h);
        x.closePath();
        const gr = x.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, cols[0]);
        gr.addColorStop(1, cols[1]);
        x.fillStyle = gr;
        x.fill();
        x.save();
        x.clip();
        x.fillStyle = "rgba(235,240,255,.85)";
        pts.forEach(([px, py]) => {
          x.beginPath();
          x.moveTo(px - 60, py + h * snowLine);
          x.lineTo(px, py - 2);
          x.lineTo(px + 60, py + h * snowLine);
          x.lineTo(px + 30, py + h * snowLine * 0.7);
          x.lineTo(px, py + h * snowLine * 1.1);
          x.lineTo(px - 25, py + h * snowLine * 0.75);
          x.closePath();
          x.fill();
        });
        x.restore();
      });
    (
      [
        [["#5b5a8c", "#2a2348"], 7, 9, 0.22, -44, 13, 90],
        [["#3c3a6a", "#1c1735"], 31, 13, 0.16, -34, 8, 70],
      ] as Array<[[string, string], number, number, number, number, number, number]>
    ).forEach(([cols, seed, peaks, sl, z, hgt, wid]) => {
      const t = ridge(cols, seed, peaks, sl);
      t.encoding = THREE.sRGBEncoding;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, hgt), new THREE.MeshBasicMaterial({ map: t, transparent: true, fog: false, depthWrite: false }));
      m.position.set(0, -2.4 + hgt / 2, z);
      TR.scene.add(m);
    });
    const n = 170;
    const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(0.55, 1.9, 7), new THREE.MeshStandardMaterial({ color: 0x163d33, flatShading: true, roughness: 1 }), n);
    const caps = new THREE.InstancedMesh(new THREE.ConeGeometry(0.3, 0.6, 7), new THREE.MeshStandardMaterial({ color: 0xe6edf8, flatShading: true, roughness: 1 }), n);
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const S = new THREE.Vector3();
    const P = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      let x = 0;
      let z = 0;
      do {
        x = rand(-34, 34);
        z = rand(-28, -7);
      } while (Math.abs(x) < 7 && z > -11);
      const k = rand(0.7, 1.9);
      S.set(k, k * rand(0.9, 1.3), k);
      P.set(x, -2.24 + 0.95 * S.y, z);
      M.compose(P, Q, S);
      trees.setMatrixAt(i, M);
      P.set(x, -2.24 + 1.62 * S.y, z);
      M.compose(P, Q, S);
      caps.setMatrixAt(i, M);
    }
    TR.scene.add(trees, caps);
  }
  // Куранты: чёрный циферблат, золотой обод, стрелки-пики; над ними — табличка с отсчётом до Нового года.
  const SZ = 1024;
  const clockCanvas = makeCanvas(SZ, SZ);
  const cx2 = ctx2d(clockCanvas);
  const clockTex = new THREE.CanvasTexture(clockCanvas);
  clockTex.encoding = THREE.sRGBEncoding;
  clockTex.anisotropy = 8;
  const plaqueCanvas = makeCanvas(1024, 128);
  const px2 = ctx2d(plaqueCanvas);
  const plaqueTex = new THREE.CanvasTexture(plaqueCanvas);
  plaqueTex.encoding = THREE.sRGBEncoding;
  plaqueTex.anisotropy = 8;
  const ROM = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
  const C = SZ / 2;
  const gold = (cx: number, cy: number, r: number) => {
    const g = cx2.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, "#fff0b0");
    g.addColorStop(0.3, "#d6a640");
    g.addColorStop(0.55, "#8f6419");
    g.addColorStop(0.78, "#f2cf72");
    g.addColorStop(1, "#7d5516");
    return g;
  };
  const ring = (r: number, w: number, st: string) => {
    cx2.strokeStyle = st;
    cx2.lineWidth = w;
    cx2.beginPath();
    cx2.arc(C, C, r, 0, TAU);
    cx2.stroke();
  };
  const lance = (ang: number, len: number, wid: number, tail: number) => {
    const x = cx2;
    x.save();
    x.translate(C, C);
    x.rotate(ang);
    x.beginPath();
    x.moveTo(0, tail);
    x.lineTo(-wid * 0.5, tail * 0.4);
    x.lineTo(-wid * 0.42, -len * 0.72);
    x.lineTo(-wid * 1.15, -len * 0.78);
    x.lineTo(0, -len);
    x.lineTo(wid * 1.15, -len * 0.78);
    x.lineTo(wid * 0.42, -len * 0.72);
    x.lineTo(wid * 0.5, tail * 0.4);
    x.closePath();
    x.fillStyle = gold(0, -len / 2, len * 0.6);
    x.fill();
    x.strokeStyle = "rgba(60,38,8,.8)";
    x.lineWidth = 2;
    x.stroke();
    x.restore();
  };
  function drawClock() {
    const x = cx2;
    const now = new Date();
    x.clearRect(0, 0, SZ, SZ);
    x.fillStyle = gold(C, C, 500);
    x.beginPath();
    x.arc(C, C, 500, 0, TAU);
    x.fill();
    ring(496, 4, "#5a3c0b");
    ring(470, 10, "#b8862c");
    ring(452, 3, "#5a3c0b");
    for (let i = 0; i < 120; i++) {
      const a = (i * TAU) / 120;
      x.fillStyle = i % 2 ? "#f6dc8e" : "#a77a24";
      x.beginPath();
      x.arc(C + Math.cos(a) * 436, C + Math.sin(a) * 436, 6, 0, TAU);
      x.fill();
    }
    ring(420, 3, "#5a3c0b");
    const dg = x.createRadialGradient(C, C - 120, 30, C, C, 416);
    dg.addColorStop(0, "#22263a");
    dg.addColorStop(0.6, "#0e1019");
    dg.addColorStop(1, "#05060b");
    x.fillStyle = dg;
    x.beginPath();
    x.arc(C, C, 416, 0, TAU);
    x.fill();
    ring(404, 2, "#c9973a");
    ring(372, 2, "#c9973a");
    ring(250, 2, "rgba(201,151,58,.75)");
    for (let i = 0; i < 60; i++) {
      const a = (i * TAU) / 60 - Math.PI / 2;
      x.strokeStyle = "#e3b856";
      x.lineWidth = i % 5 ? 2.5 : 6;
      const r0 = i % 5 ? 380 : 374;
      x.beginPath();
      x.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
      x.lineTo(C + Math.cos(a) * 400, C + Math.sin(a) * 400);
      x.stroke();
    }
    x.textAlign = "center";
    x.textBaseline = "middle";
    ROM.forEach((t, i) => {
      const a = (i * TAU) / 12 - Math.PI / 2;
      x.save();
      x.translate(C + Math.cos(a) * 312, C + Math.sin(a) * 312);
      x.rotate(a + Math.PI / 2);
      x.font = '700 72px "Cormorant Garamond", Georgia, serif';
      x.fillStyle = gold(0, 0, 60);
      x.fillText(t, 0, 0);
      x.restore();
    });
    for (let i = 0; i < 24; i++) {
      const a = (i * TAU) / 24;
      x.strokeStyle = "rgba(201,151,58,.35)";
      x.lineWidth = 2;
      x.beginPath();
      x.arc(C + Math.cos(a) * 60, C + Math.sin(a) * 60, 60, 0, TAU);
      x.stroke();
    }
    const h = now.getHours() % 12;
    const m = now.getMinutes();
    const sec = now.getSeconds();
    x.shadowColor = "rgba(0,0,0,.6)";
    x.shadowBlur = 12;
    x.shadowOffsetY = 5;
    lance(((h + m / 60) * TAU) / 12, 215, 26, 46);
    lance(((m + sec / 60) * TAU) / 60, 335, 18, 56);
    x.save();
    x.translate(C, C);
    x.rotate((sec * TAU) / 60);
    x.fillStyle = "#d9a64a";
    x.fillRect(-2.5, -360, 5, 430);
    x.restore();
    x.shadowColor = "transparent";
    x.fillStyle = gold(C, C, 36);
    x.beginPath();
    x.arc(C, C, 34, 0, TAU);
    x.fill();
    x.fillStyle = "#3d2806";
    x.beginPath();
    x.arc(C, C, 8, 0, TAU);
    x.fill();
    clockTex.needsUpdate = true;
    // Табличка над курантами.
    const ny = new Date(now.getFullYear() + 1, 0, 1);
    const left = Math.max(0, ny.getTime() - now.getTime());
    const z2 = (v: number) => String(v).padStart(2, "0");
    const dd = Math.floor(left / 864e5);
    const hh = Math.floor(left / 36e5) % 24;
    const mm = Math.floor(left / 6e4) % 60;
    const ss = Math.floor(left / 1e3) % 60;
    const p = px2;
    p.clearRect(0, 0, 1024, 128);
    p.fillStyle = "rgba(8,6,18,.62)";
    p.beginPath();
    if (typeof p.roundRect === "function") p.roundRect(6, 10, 1012, 108, 54);
    else p.rect(6, 10, 1012, 108);
    p.fill();
    p.strokeStyle = "#d6a640";
    p.lineWidth = 4;
    p.stroke();
    p.textBaseline = "middle";
    p.textAlign = "right";
    p.fillStyle = "#e3b856";
    p.font = "600 42px Jost, system-ui, sans-serif";
    p.fillText("ДО НОВОГО ГОДА", 470, 66);
    p.textAlign = "left";
    p.fillStyle = "#fff3d0";
    p.font = "600 58px Jost, system-ui, sans-serif";
    p.fillText(`${dd} дн  ${z2(hh)}:${z2(mm)}:${z2(ss)}`, 505, 66);
    plaqueTex.needsUpdate = true;
  }
  drawClock();
  let clockSec = -1;
  {
    const g = new THREE.Group();
    g.position.set(0, 8.95, -7);
    g.scale.setScalar(1.12);
    const face = new THREE.Mesh(new THREE.CircleGeometry(1.3, 96), new THREE.MeshBasicMaterial({ map: clockTex, transparent: true, fog: false }));
    face.position.z = 0.12;
    g.add(face);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.3, 0.22, 64), new THREE.MeshStandardMaterial({ color: 0x7d5516, metalness: 0.55, roughness: 0.4, emissive: 0x2a1a04, fog: false }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 0.54), new THREE.MeshBasicMaterial({ map: plaqueTex, transparent: true, fog: false }));
    plaque.position.set(0, 1.68, 0.1);
    g.add(plaque);
    TR.scene.add(g);
  }
  // Гости неба и леса: Дед Мороз на санях, медведь и заяц выглядывают из-за ёлок.
  const sledFrames = [0, 1].map((f) => canvasTex(1024, 320, (x) => sledFrame(x, f)));
  const sledMat = new THREE.MeshBasicMaterial({ map: sledFrames[0] as THREE.Texture, transparent: true, depthWrite: false, fog: false });
  const sled = { g: new THREE.Group(), mesh: new THREE.Mesh(new THREE.PlaneGeometry(14, 4.4), sledMat), active: false, next: 6, fi: 0, t0: 0, dir: 1, tp: 0, trail: null as THREE.Points | null };
  sled.g.add(sled.mesh);
  sled.g.visible = false;
  TR.scene.add(sled.g);
  {
    const n = 90;
    const gp = new THREE.BufferGeometry();
    gp.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3).fill(-999), 3));
    sled.trail = new THREE.Points(gp, new THREE.PointsMaterial({ map: dotTex, color: 0xffe08a, size: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    TR.scene.add(sled.trail);
  }
  const animals: Array<{ g: THREE.Group; arm: THREE.Group; x0: number; side: number; t0: number }> = [];
  (
    [
      ["bear", -8.2, -9.5, 3.4, 1],
      ["hare", 8.6, -10.2, 2.7, -1],
    ] as Array<["bear" | "hare", number, number, number, number]>
  ).forEach(([kind, x0, z, h, side]) => {
    const hide = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.25, 4.4, 7), new THREE.MeshStandardMaterial({ color: 0x163d33, flatShading: true, roughness: 1 }));
    cone.position.y = 2.2;
    hide.add(cone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.3, 7), new THREE.MeshStandardMaterial({ color: 0xe6edf8, flatShading: true, roughness: 1 }));
    cap.position.y = 3.85;
    hide.add(cap);
    hide.position.set(x0, -2.24, z + 0.7);
    TR.scene.add(hide);
    const g = new THREE.Group();
    const w = h * 0.8;
    const body = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: animalTex(kind), transparent: true, alphaTest: 0.4, roughness: 1 }));
    body.position.y = h / 2;
    g.add(body);
    const arm = new THREE.Group();
    arm.position.set(w * 0.27 * side, h * 0.36, 0.02);
    const am = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.25, w * 0.5), new THREE.MeshStandardMaterial({ map: armTex(kind), transparent: true, alphaTest: 0.4, roughness: 1 }));
    am.position.y = w * 0.22;
    arm.add(am);
    g.add(arm);
    g.position.set(x0, -2.24, z);
    g.visible = false;
    TR.scene.add(g);
    animals.push({ g, arm, x0, side, t0: -1 });
  });
  let animalNext = 12;
  let animalTurn = 0;
  function updateVisitors(dt: number, t: number) {
    const S = sled;
    if (!S.active && t > S.next) {
      S.active = true;
      S.t0 = t;
      S.dir = Math.random() < 0.5 ? 1 : -1;
      S.g.visible = true;
      S.mesh.scale.x = S.dir;
    }
    const trail = S.trail;
    if (S.active) {
      const u = (t - S.t0) / 18;
      if (u >= 1) {
        S.active = false;
        S.g.visible = false;
        S.next = t + rand(26, 40);
      } else {
        const x = S.dir * (-32 + 64 * u);
        S.g.position.set(x, 7.2 + Math.sin(u * TAU * 1.5) * 0.5, -16);
        S.g.rotation.z = Math.cos(u * TAU * 1.5) * 0.06 * S.dir;
        const fi = Math.floor(t * 7) % 2;
        if (fi !== S.fi) {
          S.fi = fi;
          sledMat.map = sledFrames[fi] as THREE.Texture;
        }
        if (trail) {
          const pp = trail.geometry.attributes.position as THREE.BufferAttribute;
          const k = S.tp++ % pp.count;
          pp.setXYZ(k, x - S.dir * (5.6 + rand(0, 0.5)), S.g.position.y - 1.4 + rand(-0.3, 0.3), -16.05);
          pp.needsUpdate = true;
        }
      }
    }
    if (!S.active && trail) {
      const pp = trail.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pp.count; k++) pp.setY(k, pp.getY(k) - dt * 0.6);
      pp.needsUpdate = true;
    }
    if (t > animalNext) {
      const a = animals[animalTurn++ % animals.length];
      if (a) {
        a.t0 = t;
        a.g.visible = true;
      }
      animalNext = t + rand(16, 26);
    }
    animals.forEach((a) => {
      if (a.t0 < 0) return;
      const e = t - a.t0;
      if (e > 7.5) {
        a.t0 = -1;
        a.g.visible = false;
        return;
      }
      const out = e < 1.2 ? e / 1.2 : e > 6.3 ? Math.max(0, 1 - (e - 6.3) / 1.2) : 1;
      const ease = out * out * (3 - 2 * out);
      a.g.position.x = a.x0 + a.side * 2.3 * ease;
      a.g.position.y = -2.24 + Math.abs(Math.sin(e * 5)) * 0.08 * (out < 1 ? 1 : 0);
      a.arm.rotation.z = e > 1.2 && e < 6.3 ? a.side * (-0.45 + Math.sin(e * 9) * 0.4) : Math.PI;
    });
  }
  const WARM = new THREE.Color(0xffd9a0).convertSRGBToLinear();
  const WARM_S = new THREE.Color(0xffc46b);
  function addOrnament(id: string | null, def: FigureDef, texCanvas: HTMLCanvasElement, label: string | null, backCanvas: HTMLCanvasElement | null, live: boolean): Ornament | null {
    const free = TR.slots.filter((s) => !s.used);
    if (!free.length) return null;
    const slot = pick(free);
    slot.used = true;
    const geo = inflate(def);
    const tF = texFrom(texCanvas);
    const tB = backCanvas ? texFrom(backCanvas) : tF;
    const front = new THREE.MeshStandardMaterial({ map: tF, alphaTest: 0.5, roughness: 0.32, metalness: 0.1 });
    const mats = [front, backCanvas ? new THREE.MeshStandardMaterial({ map: tB, alphaTest: 0.5, roughness: 0.32, metalness: 0.1 }) : front];
    const mesh = new THREE.Mesh(geo, mats);
    const hgt = slot.h * rand(0.92, 1.04);
    mesh.scale.setScalar(hgt / geo.userData.height);
    mesh.position.set(0, -hgt / 2 + 0.02, 0);
    const pivot = new THREE.Group();
    pivot.position.copy(slot.P);
    pivot.rotation.y = slot.a;
    pivot.add(mesh);
    TR.root.add(pivot);
    const o: Ornament = { id, pivot, mesh, ph: rand(0, TAU), drop: live ? 1 : 0, hgt, slot, dispose: () => disposeMaterials(mats, [tF, tB]) };
    TR.orns.push(o);
    if (live) {
      TR.focus = -slot.a;
      TR.focusT = 5;
      if (label) addTag("tree", mesh, label, hgt * 0.6 + 0.1);
    }
    return o;
  }
  function removeOrnament(o: Ornament) {
    TR.root.remove(o.pivot);
    TR.orns.splice(TR.orns.indexOf(o), 1);
    o.slot.used = false;
    dropTags(o.mesh);
    o.dispose();
  }
  function updateTree(dt: number, t: number) {
    if (TR.focusT > 0) {
      TR.focusT -= dt;
      TR.rot = lerpAngle(TR.rot, TR.focus, 1 - Math.exp(-dt * 2.5));
    } else TR.rot += dt * 0.12;
    TR.root.rotation.y = TR.rot;
    updateVisitors(dt, t);
    const sec = Math.floor(Date.now() / 1000);
    if (sec !== clockSec) {
      clockSec = sec;
      drawClock();
    }
    treeStar.rotation.y = -TR.rot + Math.sin(t * 0.8) * 0.4;
    (glow.material as THREE.SpriteMaterial).opacity = 0.55 + Math.sin(t * 2) * 0.15;
    TR.lights.forEach((l) => {
      let k: number;
      if (TR.mode === 0) k = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.6 + l.ph));
      else if (TR.mode === 1) k = 0.3 + 0.7 * Math.max(0, Math.sin(t * 3 - l.y * 1.4));
      else k = 0.85;
      l.m.material.color.copy(TR.mode === 2 ? WARM : l.base).multiplyScalar(0.45 + k * 0.55);
      const sm = l.s.material as THREE.SpriteMaterial;
      sm.color.copy(TR.mode === 2 ? WARM_S : l.sbase);
      sm.opacity = k * 0.95;
      l.s.scale.setScalar(0.45 + k * 0.3);
    });
    TR.orns.forEach((o) => {
      o.pivot.rotation.z = Math.sin(t * 1.3 + o.ph) * 0.035;
      if (o.drop > 0) {
        o.drop = Math.max(0, o.drop - dt * 0.8);
        const e = easeOutBounce(1 - o.drop);
        o.mesh.position.y = -o.hgt / 2 + 0.02 + (1 - e) * 4;
      }
    });
    const pts = snow.pts;
    if (pts) {
      const sp = pts.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < snow.n; i++) {
        let y = sp.getY(i) - (snow.sp[i] ?? 0) * dt;
        if (y < -2.2) y = 8;
        sp.setY(i, y);
        sp.setX(i, sp.getX(i) + Math.sin(t + (snow.ph[i] ?? 0)) * 0.004);
      }
      sp.needsUpdate = true;
    }
  }

  /* =========================== подписи, размеры, кадр =========================== */
  let mode: SceneId = options.scene;
  const tags: Tag[] = [];
  function addTag(scene: SceneId, obj: THREE.Object3D, text: string, lift: number) {
    const el = document.createElement("div");
    el.className = "aq-tag";
    el.textContent = text;
    tagsEl.appendChild(el);
    tags.push({ el, obj, lift, life: 10, scene });
  }
  function dropTags(obj: THREE.Object3D) {
    for (let i = tags.length - 1; i >= 0; i--) {
      const tg = tags[i] as Tag;
      if (tg.obj === obj) {
        tg.el.remove();
        tags.splice(i, 1);
      }
    }
  }
  function updateTags(dt: number) {
    const cam = mode === "aqua" ? AQ.cam : TR.cam;
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (let i = tags.length - 1; i >= 0; i--) {
      const tg = tags[i] as Tag;
      tg.life -= dt;
      if (tg.life <= 0) {
        tg.el.remove();
        tags.splice(i, 1);
        continue;
      }
      if (tg.scene !== mode) {
        tg.el.style.opacity = "0";
        continue;
      }
      tg.obj.getWorldPosition(tmpV);
      tmpV.y += tg.lift;
      tmpV.project(cam);
      tg.el.style.transform = `translate(${(tmpV.x * 0.5 + 0.5) * w}px,${(-tmpV.y * 0.5 + 0.5) * h}px) translate(-50%,-100%)`;
      tg.el.style.opacity = String(Math.min(1, tg.life));
    }
  }
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    AQ.cam.aspect = w / h;
    AQ.cam.updateProjectionMatrix();
    TR.cam.aspect = w / h;
    const dist = Math.max(15.5, 9.8 / TR.cam.aspect);
    TR.cam.position.set(0, 2.3, dist);
    TR.cam.lookAt(0, 2.6, 0);
    TR.cam.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // Цвета без карт — из sRGB в линейные один раз (как в прототипе).
  {
    const done = new Set<THREE.Material>();
    [AQ.scene, TR.scene].forEach((sc) =>
      sc.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(m) ? m : m ? [m] : []).forEach((mm) => {
          const withColor = mm as THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null };
          if (!done.has(mm) && withColor.color && !withColor.map && !(mm instanceof THREE.MeshBasicMaterial) && !(mm instanceof THREE.SpriteMaterial) && !(mm instanceof THREE.PointsMaterial)) {
            done.add(mm);
            withColor.color.convertSRGBToLinear();
          }
        });
      }),
    );
  }

  // Стартовые рыбки и игрушки — как в прототипе: все виды рыбок и ещё две, 22 игрушки.
  const starters: { aqua: Fish[]; tree: Ornament[] } = { aqua: [], tree: [] };
  if (options.starters) {
    [...FISH, pick(FISH), pick(FISH)].forEach((d) => starters.aqua.push(addFish(null, d, composeTexture(d, demoPaint(d), null), null, null)));
    AQ.fish.forEach((f) => randTarget(f.obj.position));
    for (let i = 0; i < 22; i++) {
      const d = ORN[i % ORN.length] as FigureDef;
      const o = addOrnament(null, d, composeTexture(d, demoPaint(d), null), null, null, false);
      if (o) starters.tree.push(o);
    }
  }

  const clock = new THREE.Clock();
  let T = 0;
  let raf = 0;
  let alive = true;
  function frame() {
    if (!alive) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    T += dt;
    if (mode === "aqua") {
      updateAquarium(dt, T);
      renderer.render(AQ.scene, AQ.cam);
    } else {
      updateTree(dt, T);
      renderer.render(TR.scene, TR.cam);
    }
    updateTags(dt);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function textures(item: StageItem): { front: HTMLCanvasElement; back: HTMLCanvasElement | null } {
    return { front: composeTexture(item.fig, item.paint, item.name, false), back: item.name ? composeTexture(item.fig, item.paint, item.name, true) : null };
  }

  const has = (scene: SceneId, id: string) => (scene === "aqua" ? AQ.fish.some((f) => f.id === id) : TR.orns.some((o) => o.id === id));

  return {
    setScene(scene) {
      mode = scene;
    },
    add(scene, item, live) {
      if (has(scene, item.id)) return;
      const { front, back } = textures(item);
      if (scene === "aqua") {
        // Места нет — уплывает стартовая рыбка, потом самая старая.
        if (AQ.fish.length >= AQUA_MAX) {
          const out = starters.aqua.shift() ?? AQ.fish.find((f) => f.id !== null);
          if (out) removeFish(out);
        }
        addFish(item.id, item.fig, front, live ? item.label : null, back);
      } else {
        if (TR.slots.every((s) => s.used)) {
          const out = starters.tree.shift() ?? TR.orns.find((o) => o.id !== null);
          if (out) removeOrnament(out);
        }
        addOrnament(item.id, item.fig, front, item.label, back, live);
      }
    },
    remove(scene, id) {
      if (scene === "aqua") {
        const f = AQ.fish.find((x) => x.id === id);
        if (f) removeFish(f);
      } else {
        const o = TR.orns.find((x) => x.id === id);
        if (o) removeOrnament(o);
      }
    },
    has,
    count(scene) {
      return scene === "aqua"
        ? { guests: AQ.fish.filter((f) => f.id !== null).length, total: AQ.fish.length, max: AQUA_MAX }
        : { guests: TR.orns.filter((o) => o.id !== null).length, total: TR.orns.length, max: TR.slots.length };
    },
    feed() {
      feed();
    },
    setGarland(m) {
      TR.mode = ((Math.floor(m) % GARLAND_MODES.length) + GARLAND_MODES.length) % GARLAND_MODES.length;
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      [AQ.scene, TR.scene].forEach((sc) =>
        sc.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
          (Array.isArray(m) ? m : m ? [m] : []).forEach((mm) => {
            const withMap = mm as THREE.Material & { map?: THREE.Texture | null };
            withMap.map?.dispose();
            mm.dispose();
          });
        }),
      );
      [dotTex, bubbleTex, clockTex, plaqueTex, ...sledFrames].forEach((t) => t.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      tagsEl.remove();
    },
  };
}
