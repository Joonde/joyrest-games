// «Олимп» — два греческих d10 на алтаре, как в прототипе: мраморный с золотом (десятки) и чернофигурная
// терракота (единицы). Своя отрисовка на canvas 2D — без библиотек, работает на любом телефоне и ТВ.
// Кубики падают и ложатся гранью с числом вверх: число берётся с сервера (бросок уже решён).

type V = [number, number, number];
type Qt = [number, number, number, number];

const V3 = {
  add: (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V): V => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

const Q = {
  axis: (ax: V, ang: number): Qt => {
    const s = Math.sin(ang / 2);
    return [Math.cos(ang / 2), ax[0] * s, ax[1] * s, ax[2] * s];
  },
  mul: (a: Qt, b: Qt): Qt => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ],
  norm: (q: Qt): Qt => {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  slerp: (a: Qt, b0: Qt, t: number): Qt => {
    let b = b0;
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) {
      b = [-b[0], -b[1], -b[2], -b[3]];
      d = -d;
    }
    if (d > 0.9995) return Q.norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
    const th = Math.acos(d);
    const s = Math.sin(th);
    const w1 = Math.sin((1 - t) * th) / s;
    const w2 = Math.sin(t * th) / s;
    return [a[0] * w1 + b[0] * w2, a[1] * w1 + b[1] * w2, a[2] * w1 + b[2] * w2, a[3] * w1 + b[3] * w2];
  },
  rot: (q: Qt, v: V): V => {
    const [w, x, y, z] = q;
    const ix = w * v[0] + y * v[2] - z * v[1];
    const iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0];
    const iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  },
  fromMat: (m: number[][]): Qt => {
    const g = (i: number, j: number) => (m[i] as number[])[j] as number;
    const t = g(0, 0) + g(1, 1) + g(2, 2);
    let q: Qt;
    if (t > 0) {
      const s = Math.sqrt(t + 1) * 2;
      q = [0.25 * s, (g(2, 1) - g(1, 2)) / s, (g(0, 2) - g(2, 0)) / s, (g(1, 0) - g(0, 1)) / s];
    } else if (g(0, 0) > g(1, 1) && g(0, 0) > g(2, 2)) {
      const s = Math.sqrt(1 + g(0, 0) - g(1, 1) - g(2, 2)) * 2;
      q = [(g(2, 1) - g(1, 2)) / s, 0.25 * s, (g(0, 1) + g(1, 0)) / s, (g(0, 2) + g(2, 0)) / s];
    } else if (g(1, 1) > g(2, 2)) {
      const s = Math.sqrt(1 + g(1, 1) - g(0, 0) - g(2, 2)) * 2;
      q = [(g(0, 2) - g(2, 0)) / s, (g(0, 1) + g(1, 0)) / s, 0.25 * s, (g(1, 2) + g(2, 1)) / s];
    } else {
      const s = Math.sqrt(1 + g(2, 2) - g(0, 0) - g(1, 1)) * 2;
      q = [(g(1, 0) - g(0, 1)) / s, (g(0, 2) + g(2, 0)) / s, (g(1, 2) + g(2, 1)) / s, 0.25 * s];
    }
    return Q.norm(q);
  },
};

interface Face {
  tip: V;
  sl: V;
  far: V;
  sr: V;
  n: V;
  up: V;
  rest: number;
}

// Пятиугольный трапецоэдр: 10 граней-«змеев».
const D10: Face[] = (() => {
  const H = 1.05;
  const E = (H * (1 - Math.cos(Math.PI / 5))) / (1 + Math.cos(Math.PI / 5));
  const T: V = [0, H, 0];
  const B: V = [0, -H, 0];
  const U: V[] = [...Array(5)].map((_, i) => {
    const a = (i * 2 * Math.PI) / 5;
    return [Math.cos(a), E, Math.sin(a)];
  });
  const L: V[] = [...Array(5)].map((_, i) => {
    const a = (i * 2 * Math.PI) / 5 + Math.PI / 5;
    return [Math.cos(a), -E, Math.sin(a)];
  });
  const faces: Face[] = [];
  const mk = (tip: V, s1: V, far: V, s2: V) => {
    const c = V3.mul(V3.add(V3.add(tip, far), V3.add(s1, s2)), 0.25);
    let n = V3.norm(V3.cross(V3.sub(s1, tip), V3.sub(s2, tip)));
    if (V3.dot(n, c) < 0) n = V3.mul(n, -1);
    let up = V3.sub(tip, c);
    up = V3.norm(V3.sub(up, V3.mul(n, V3.dot(up, n))));
    const right = V3.cross(up, n);
    const [sl, sr] = V3.dot(V3.sub(s1, c), right) < 0 ? [s1, s2] : [s2, s1];
    faces.push({ tip, sl, far, sr, n, up, rest: V3.dot(n, tip) });
  };
  for (let i = 0; i < 5; i++) {
    mk(T, U[i] as V, L[i] as V, U[(i + 1) % 5] as V);
    mk(B, L[i] as V, U[(i + 1) % 5] as V, L[(i + 1) % 5] as V);
  }
  return faces;
})();

const TX = { tip: [128, 10], sl: [36, 204], sr: [220, 204], far: [128, 248] } as const;

function kitePath(c: CanvasRenderingContext2D, inset: number) {
  const k = 1 - inset / 120;
  const cx = 128;
  const cy = 150;
  const p = [TX.tip, TX.sr, TX.far, TX.sl].map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as const);
  c.beginPath();
  p.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
  c.closePath();
}

function marbleTex(label: string): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const c = cv.getContext("2d") as CanvasRenderingContext2D;
  const g = c.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, "#FBF7EE");
  g.addColorStop(0.6, "#EDE5D6");
  g.addColorStop(1, "#DCD1BE");
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7; i++) {
    c.strokeStyle = `rgba(120,110,100,${0.08 + Math.random() * 0.14})`;
    c.lineWidth = 0.6 + Math.random() * 1.8;
    c.beginPath();
    let x = Math.random() * 256;
    let y = Math.random() * 256;
    c.moveTo(x, y);
    for (let j = 0; j < 4; j++) {
      const nx = x + (Math.random() - 0.3) * 140;
      const ny = y + (Math.random() - 0.5) * 120;
      c.quadraticCurveTo((x + nx) / 2 + (Math.random() - 0.5) * 60, (y + ny) / 2 + (Math.random() - 0.5) * 60, nx, ny);
      x = nx;
      y = ny;
    }
    c.stroke();
  }
  c.lineJoin = "round";
  kitePath(c, 10);
  c.strokeStyle = "#B8893A";
  c.lineWidth = 5;
  c.stroke();
  kitePath(c, 20);
  c.strokeStyle = "rgba(184,137,58,.55)";
  c.lineWidth = 1.6;
  c.stroke();
  c.font = `700 ${label.length > 1 ? 86 : 104}px "Cormorant Garamond", Georgia, serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "rgba(60,40,15,.55)";
  c.fillText(label, 130, 158);
  const gg = c.createLinearGradient(0, 110, 0, 200);
  gg.addColorStop(0, "#F7E2A6");
  gg.addColorStop(0.5, "#C9973E");
  gg.addColorStop(1, "#8C6224");
  c.fillStyle = gg;
  c.fillText(label, 128, 155);
  if (label === "60" || label === "90") {
    c.fillStyle = "#B8893A";
    c.fillRect(100, 200, 56, 5);
  }
  return cv;
}

function meander(c: CanvasRenderingContext2D, y: number, w: number, color: string) {
  c.strokeStyle = color;
  c.lineWidth = 3;
  c.beginPath();
  const s = 12;
  for (let x = 128 - w / 2; x < 128 + w / 2 - s; x += s * 1.5) {
    c.moveTo(x, y + s);
    c.lineTo(x, y);
    c.lineTo(x + s, y);
    c.lineTo(x + s, y + s * 0.66);
    c.lineTo(x + s * 0.4, y + s * 0.66);
    c.lineTo(x + s * 0.4, y + s * 0.33);
  }
  c.stroke();
}

function terraTex(label: string): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const c = cv.getContext("2d") as CanvasRenderingContext2D;
  const g = c.createRadialGradient(128, 140, 20, 128, 140, 180);
  g.addColorStop(0, "#D27A45");
  g.addColorStop(1, "#9C4A24");
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 500; i++) {
    c.fillStyle = `rgba(60,20,5,${Math.random() * 0.12})`;
    c.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  c.lineJoin = "round";
  kitePath(c, 8);
  c.strokeStyle = "#1A1310";
  c.lineWidth = 7;
  c.stroke();
  kitePath(c, 19);
  c.strokeStyle = "rgba(26,19,16,.8)";
  c.lineWidth = 1.6;
  c.stroke();
  meander(c, 70, 70, "#1A1310");
  c.font = '700 108px "Cormorant Garamond", Georgia, serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "rgba(251,230,200,.35)";
  c.fillText(label, 129, 160);
  c.fillStyle = "#1A1310";
  c.fillText(label, 128, 158);
  if (label === "6" || label === "9") {
    c.fillStyle = "#1A1310";
    c.fillRect(104, 206, 48, 5);
  }
  return cv;
}

interface DieKind {
  kind: "marble" | "terra";
  labels: string[];
  edge: string;
  spec: number;
  tex: HTMLCanvasElement[];
}

const DICE: DieKind[] = [
  { kind: "marble", labels: ["00", "10", "20", "30", "40", "50", "60", "70", "80", "90"], edge: "#C9973E", spec: 0.55, tex: [] },
  { kind: "terra", labels: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"], edge: "#1A1310", spec: 0.18, tex: [] },
];

let ready: Promise<void> | null = null;

/** Текстуры граней (ждём шрифт Cormorant, но не дольше 1,5 с). */
export function prepDice(): Promise<void> {
  if (ready) return ready;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  const fontLoad = fonts?.load ? fonts.load('700 100px "Cormorant Garamond"').then(() => undefined, () => undefined) : Promise.resolve();
  ready = Promise.race([fontLoad, new Promise<void>((r) => window.setTimeout(r, 1500))]).then(() => {
    DICE.forEach((d) => {
      d.tex = d.labels.map((l) => (d.kind === "marble" ? marbleTex(l) : terraTex(l)));
    });
  });
  return ready;
}

const CAM = (() => {
  const Cp: V = [0, 6.2, 6.6];
  const f = V3.norm(V3.sub([0, -0.4, 0], Cp));
  const r = V3.norm(V3.cross(f, [0, 1, 0]));
  const u = V3.cross(r, f);
  return { C: Cp, f, r, u, fov: 36 };
})();
const LIGHT = V3.norm([2.5, 7, 4.5]);
const SIZE = 0.78;
const FLOOR = -0.5;

interface Die {
  idx: number;
  face: number;
  p: V;
  v: V;
  q: Qt;
  w: V;
  tq: Qt;
  restY: number;
  q0?: Qt;
  p0?: V;
}

function targetQ(face: number, yaw: number): Qt {
  const f = D10[face] as Face;
  const n = f.n;
  const u = f.up;
  const nu = V3.cross(n, u);
  const W = [
    [0, 1, 0],
    [0, 0, -1],
    [-1, 0, 0],
  ];
  const A = [n, u, nu];
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += ((W[k] as number[])[i] as number) * ((A[k] as V)[j] as number);
      (m[i] as number[])[j] = s;
    }
  return Q.mul(Q.axis([0, 1, 0], yaw), Q.fromMat(m));
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Подписи кубиков: десятки («00»…«90») и единицы. 100 — «00» и «0». */
export function diceLabels(roll: number): [string, string] {
  const tens = roll === 100 ? "00" : String(Math.floor((roll % 100) / 10) * 10).padStart(2, "0");
  return [tens, String(roll % 10)];
}

/** Бросок на холсте: кубики катятся и ложатся числом вверх; onDone — где они лежат (в % холста). */
export function throwDice(
  canvas: HTMLCanvasElement,
  roll: number,
  opts: { reduce: boolean; onKnock?: () => void },
  onDone: (pos: Array<{ x: number; y: number }>) => void,
): () => void {
  let cancelled = false;
  const [tens, units] = diceLabels(roll);
  const faces = [(DICE[0] as DieKind).labels.indexOf(tens), (DICE[1] as DieKind).labels.indexOf(units)];
  void prepDice().then(() => {
    if (cancelled) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = rect.width;
    const h = rect.height;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const c = canvas.getContext("2d");
    if (!c) return;
    const proj = (p: V): [number, number, number] => {
      const d = V3.sub(p, CAM.C);
      const z = V3.dot(d, CAM.f);
      const Fz = h / 2 / Math.tan((CAM.fov * Math.PI) / 360);
      return [w / 2 + (V3.dot(d, CAM.r) / z) * Fz, h / 2 - (V3.dot(d, CAM.u) / z) * Fz, z];
    };
    const draw = (dice: Die[]) => {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      dice.forEach((d) => {
        const hgt = Math.max(0, d.p[1] - d.restY);
        const s = proj([d.p[0], FLOOR - SIZE * 0.95, d.p[2]]);
        const e = proj([d.p[0] + SIZE, FLOOR - SIZE * 0.95, d.p[2]]);
        const rx = Math.abs(e[0] - s[0]) * (1.1 + hgt * 0.25);
        const g = c.createRadialGradient(s[0], s[1], 0, s[0], s[1], rx);
        g.addColorStop(0, `rgba(0,0,0,${0.55 / (1 + hgt * 1.4)})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(s[0], s[1], rx, rx * 0.42, 0, 0, 7);
        c.fill();
      });
      const list: Array<{ d: Die; i: number; n: V; z: number; pts: Record<"tip" | "sl" | "sr" | "far", [number, number, number]>; toCam: V }> = [];
      dice.forEach((d) =>
        D10.forEach((f, i) => {
          const n = Q.rot(d.q, f.n);
          const wpt = (p: V) => V3.add(d.p, V3.mul(Q.rot(d.q, p), SIZE));
          const ctr = wpt(V3.mul(V3.add(f.tip, f.far), 0.5));
          const toCam = V3.sub(CAM.C, ctr);
          if (V3.dot(n, toCam) <= 0) return;
          list.push({ d, i, n, z: V3.len(toCam), pts: { tip: proj(wpt(f.tip)), sl: proj(wpt(f.sl)), sr: proj(wpt(f.sr)), far: proj(wpt(f.far)) }, toCam: V3.norm(toCam) });
        }),
      );
      list.sort((a, b) => b.z - a.z);
      list.forEach((F) => {
        const P = F.pts;
        const D = DICE[F.d.idx] as DieKind;
        const tex = D.tex[F.i];
        if (!tex) return;
        c.save();
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.beginPath();
        c.moveTo(P.tip[0], P.tip[1]);
        c.lineTo(P.sr[0], P.sr[1]);
        c.lineTo(P.far[0], P.far[1]);
        c.lineTo(P.sl[0], P.sl[1]);
        c.closePath();
        c.fillStyle = D.kind === "marble" ? "#E9E0CF" : "#B5582C";
        c.fill();
        c.clip();
        const t0 = TX.tip;
        const t1 = TX.sl;
        const t2 = TX.sr;
        const s0 = P.tip;
        const s1 = P.sl;
        const s2 = P.sr;
        const a1 = t1[0] - t0[0];
        const b1 = t1[1] - t0[1];
        const a2 = t2[0] - t0[0];
        const b2 = t2[1] - t0[1];
        const det = a1 * b2 - a2 * b1;
        const x1 = s1[0] - s0[0];
        const y1 = s1[1] - s0[1];
        const x2 = s2[0] - s0[0];
        const y2 = s2[1] - s0[1];
        const ma = (x1 * b2 - x2 * b1) / det;
        const mc = (x2 * a1 - x1 * a2) / det;
        const mb = (y1 * b2 - y2 * b1) / det;
        const md = (y2 * a1 - y1 * a2) / det;
        const me = s0[0] - ma * t0[0] - mc * t0[1];
        const mf = s0[1] - mb * t0[0] - md * t0[1];
        c.setTransform(ma * dpr, mb * dpr, mc * dpr, md * dpr, me * dpr, mf * dpr);
        c.drawImage(tex, 0, 0);
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const diff = Math.max(0, V3.dot(F.n, LIGHT));
        const shade = 0.42 + 0.62 * diff;
        if (shade < 1) {
          c.fillStyle = `rgba(20,12,6,${(1 - shade) * 0.85})`;
          c.fill();
        }
        const hv = V3.norm(V3.add(LIGHT, F.toCam));
        const sp = Math.pow(Math.max(0, V3.dot(F.n, hv)), 24) * D.spec;
        if (sp > 0.01) {
          c.fillStyle = `rgba(255,246,225,${sp})`;
          c.fill();
        }
        c.restore();
        c.save();
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.beginPath();
        c.moveTo(P.tip[0], P.tip[1]);
        c.lineTo(P.sr[0], P.sr[1]);
        c.lineTo(P.far[0], P.far[1]);
        c.lineTo(P.sl[0], P.sl[1]);
        c.closePath();
        c.lineJoin = "round";
        c.strokeStyle = D.edge;
        c.globalAlpha = 0.9;
        c.lineWidth = Math.max(1.2, w / 700);
        c.stroke();
        c.restore();
      });
    };
    const onScreen = (d: Die) => {
      const s = proj([d.p[0], d.p[1] + 1.25, d.p[2]]);
      return { x: (s[0] / w) * 100, y: (s[1] / h) * 100 };
    };
    const dice: Die[] = faces.map((face, i) => {
      const s = i ? 1 : -1;
      const tq = targetQ(face, rnd(-0.25, 0.25));
      return {
        idx: i,
        face,
        p: [4.4 * s, 2.6, 1.9],
        v: [-s * rnd(4.8, 6), rnd(1.5, 3), -rnd(2.8, 3.8)],
        q: Q.norm([Math.random(), Math.random(), Math.random(), Math.random()]),
        w: [rnd(-14, 14), rnd(-14, 14), rnd(-14, 14)],
        tq,
        restY: FLOOR - SIZE + SIZE * (D10[face] as Face).rest,
      };
    });
    if (opts.reduce) {
      dice.forEach((d, i) => {
        d.p = [i ? 0.9 : -0.9, d.restY, 0];
        d.q = d.tq;
      });
      draw(dice);
      onDone(dice.map(onScreen));
      return;
    }
    const t0 = performance.now();
    const PH = 1350;
    const SET = 650;
    let last = t0;
    const step = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const el = now - t0;
      dice.forEach((d) => {
        if (el < PH) {
          d.v[1] -= 18 * dt;
          d.p = V3.add(d.p, V3.mul(d.v, dt));
          const low = FLOOR - SIZE + SIZE * 0.82;
          if (d.p[1] < low) {
            d.p[1] = low;
            if (d.v[1] < 0) d.v[1] *= -0.45;
            d.v[0] *= 0.8;
            d.v[2] *= 0.8;
            d.w = V3.mul(d.w, 0.75);
            if (Math.abs(d.v[1]) > 2) opts.onKnock?.();
          }
          if (Math.abs(d.p[0]) > 3.2) {
            d.p[0] = Math.sign(d.p[0]) * 3.2;
            d.v[0] *= -0.6;
          }
          if (Math.abs(d.p[2]) > 1.6) {
            d.p[2] = Math.sign(d.p[2]) * 1.6;
            d.v[2] *= -0.6;
          }
          const wl = V3.len(d.w);
          if (wl > 0.01) d.q = Q.norm(Q.mul(Q.axis(V3.mul(d.w, 1 / wl), wl * dt), d.q));
          d.w = V3.mul(d.w, 0.993);
        } else {
          if (!d.q0) {
            d.q0 = d.q;
            d.p0 = [d.p[0], d.p[1], d.p[2]];
          }
          const k = Math.min(1, (el - PH) / SET);
          const e = 1 - Math.pow(1 - k, 3);
          d.q = Q.slerp(d.q0, d.tq, e);
          const p0 = d.p0 as V;
          const gx = d.idx ? 1.25 : -1.25;
          const gz = Math.max(-0.5, Math.min(0.5, p0[2]));
          d.p = [p0[0] + (gx - p0[0]) * e, p0[1] + (d.restY - p0[1]) * e + Math.sin(k * Math.PI) * 0.22 * (1 - k), p0[2] + (gz - p0[2]) * e];
        }
      });
      const a = dice[0] as Die;
      const b = dice[1] as Die;
      const dx = b.p[0] - a.p[0];
      const dz = b.p[2] - a.p[2];
      const dist = Math.hypot(dx, dz);
      if (el < PH && dist < 1.55 && dist > 0) {
        const nx = dx / dist;
        const nz = dz / dist;
        const push = (1.55 - dist) / 2;
        a.p[0] -= nx * push;
        a.p[2] -= nz * push;
        b.p[0] += nx * push;
        b.p[2] += nz * push;
        const rv = (b.v[0] - a.v[0]) * nx + (b.v[2] - a.v[2]) * nz;
        if (rv < 0) {
          a.v[0] += rv * nx;
          a.v[2] += rv * nz;
          b.v[0] -= rv * nx;
          b.v[2] -= rv * nz;
          opts.onKnock?.();
        }
      }
      draw(dice);
      if (el >= PH + SET) {
        onDone(dice.map(onScreen));
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return () => {
    cancelled = true;
  };
}
