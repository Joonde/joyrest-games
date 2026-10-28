// 3D-барабан музыкального лото для экрана зала (three.js r128; решение владельца 27 октября 2026, согласованный
// ролик «Музлото — 3D барабан v3 табло»). Золотая клетка на деревянной стойке, бочонки с номерами — только ещё не
// сыгранные; барабан разгоняется, крутится, тормозит, выбранный бочонок вылетает к залу, поворачивается номером,
// крышка со звездой JoyRest отлетает с искрами. Номер крупно, отсчёт и табло рисует React поверх (`DrumStage`).
// Физика бочонков — 2D в сечении барабана, детерминированная (seed): два экрана зала видят одно и то же.
// Отдельный чанк: телефонам гостей он не нужен.
import * as THREE from "three";

export type DrumSpeed = "full" | "quick";

/** Моменты анимации, секунды от начала: разгон, полная скорость до slow, остановка, вылет, поворот, крышка, номер, конец показа номера. */
export interface DrumTimeline {
  spinUp: number;
  full: number;
  slow: number;
  stop: number;
  fly: number;
  twist: number;
  pop: number;
  big: number;
  end: number;
}

/** Полный — 12,9 с (как в ролике), быстрый — 7,2 с. Конец совпадает с `DRUM_MS` в content.ts. */
export const DRUM_TIMELINES: Record<DrumSpeed, DrumTimeline> = {
  full: { spinUp: 0.6, full: 1.4, slow: 5.6, stop: 6.8, fly: 8.1, twist: 8.9, pop: 9.4, big: 9.9, end: 12.9 },
  quick: { spinUp: 0.2, full: 0.5, slow: 1.6, stop: 2.3, fly: 3.0, twist: 3.4, pop: 3.7, big: 4.2, end: 7.2 },
};

export interface DrumSceneOptions {
  /** Основной холст: барабан, стойка, бочонки. */
  main: HTMLCanvasElement;
  /** Верхний холст (над затемнением): выбранный бочонок, крышка, искры. */
  top: HTMLCanvasElement;
  /** Номера бочонков в барабане (вместе с выбранным). */
  numbers: number[];
  pick: number;
  speed: DrumSpeed;
  /** На какую долю ширины сдвинуть барабан влево (справа — табло). */
  offset: number;
  seed: string;
}

export interface DrumScene {
  /** Нарисовать кадр на секунде `t` анимации. */
  frame(t: number): void;
  /** Холсты поменяли размер. */
  resize(): void;
  dispose(): void;
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let s = h | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Комната для отражений золота (как RoomEnvironment из примеров three.js / model-viewer, MIT): серые стены, коробки и
 * светящиеся панели. Свет в физических единицах — как у рендера барабана.
 */
function roomEnvironment(): THREE.Scene {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  geometry.deleteAttribute("uv");
  const main = new THREE.PointLight(0xffffff, 900, 28, 2);
  main.position.set(0.418, 16.199, 0.3);
  scene.add(main);
  const room = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.BackSide }));
  room.position.set(-0.757, 13.219, 0.717);
  room.scale.set(31.713, 28.305, 28.591);
  scene.add(room);
  const boxMaterial = new THREE.MeshStandardMaterial();
  for (const [px, py, pz, ry, sx, sy, sz] of [
    [-10.906, 2.009, 1.846, -0.195, 2.328, 7.905, 4.651],
    [-5.607, -0.754, -0.758, 0.994, 1.97, 1.534, 3.955],
    [6.167, 0.857, 7.803, 0.561, 3.927, 6.285, 3.687],
    [-2.017, 0.018, 6.124, 0.333, 2.002, 4.566, 2.064],
    [2.291, -0.756, -2.621, -0.286, 1.546, 1.552, 1.496],
    [-2.193, -0.369, -5.547, 0.516, 3.875, 3.487, 2.986],
  ] as const) {
    const box = new THREE.Mesh(geometry, boxMaterial);
    box.position.set(px, py, pz);
    box.rotation.set(0, ry, 0);
    box.scale.set(sx, sy, sz);
    scene.add(box);
  }
  for (const [power, px, py, pz, sx, sy, sz] of [
    [50, -16.116, 14.37, 8.208, 0.1, 2.428, 2.739],
    [50, -16.109, 18.021, -8.207, 0.1, 2.425, 2.751],
    [17, 14.904, 12.198, -1.832, 0.15, 4.265, 6.331],
    [43, -0.462, 8.89, 14.52, 4.38, 5.441, 0.088],
    [20, 3.235, 11.486, -12.541, 2.5, 2.0, 0.1],
    [100, 0, 20, 0, 1, 0.1, 1],
  ] as const) {
    const material = new THREE.MeshBasicMaterial();
    material.color.setScalar(power);
    const light = new THREE.Mesh(geometry, material);
    light.position.set(px, py, pz);
    light.scale.set(sx, sy, sz);
    scene.add(light);
  }
  return scene;
}

/** Убрать комнату после того, как из неё сделали карту отражений. */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      (o.geometry as THREE.BufferGeometry).dispose();
      const m = o.material as THREE.Material | THREE.Material[];
      for (const one of Array.isArray(m) ? m : [m]) one.dispose();
    }
  });
}

/** Цвет из sRGB-hex в линейный (r128 считает цвета материалов линейными). */
const col = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();

interface Barrel {
  n: number;
  m: THREE.Group;
  x: number;
  p: THREE.Vector2;
  v: THREE.Vector2;
  q: THREE.Quaternion;
  w: THREE.Vector3;
  ws: number;
}

export function createDrumScene(opts: DrumSceneOptions): DrumScene {
  const T = DRUM_TIMELINES[opts.speed];
  const rnd = rng(`${opts.seed}|${opts.pick}|${opts.numbers.length}`);
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <D extends { dispose(): void }>(d: D): D => {
    disposables.push(d);
    return d;
  };

  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const makeRenderer = (canvas: HTMLCanvasElement, exposure: number) => {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    r.setPixelRatio(ratio);
    r.physicallyCorrectLights = true;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = exposure;
    r.outputEncoding = THREE.sRGBEncoding;
    r.setClearColor(0x000000, 0);
    return r;
  };
  const renderer = makeRenderer(opts.main, 0.9);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const renderer2 = makeRenderer(opts.top, 0.95);

  const scene = new THREE.Scene();
  const scene2 = new THREE.Scene();
  const envOf = (r: THREE.WebGLRenderer) => {
    const pmrem = new THREE.PMREMGenerator(r);
    const room = roomEnvironment();
    const map = keep(pmrem.fromScene(room, 0.04).texture);
    pmrem.dispose();
    disposeScene(room);
    return map;
  };
  scene.environment = envOf(renderer);
  scene2.environment = envOf(renderer2);

  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);

  // Свет: тёплый софит сверху справа, розовый контровой слева сзади, мягкая заливка спереди.
  const addLights = (s: THREE.Scene, shadows: boolean) => {
    s.add(new THREE.HemisphereLight(col(0xffe8cc), col(0x1a120c), 0.35));
    const key = new THREE.SpotLight(col(0xffd6a0), 260, 0, 0.55, 0.7, 2);
    key.position.set(3.5, 7.5, 5);
    key.target.position.set(0, 1.6, 0);
    if (shadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.bias = -0.0004;
      key.shadow.radius = 6;
    }
    s.add(key, key.target);
    const rim = new THREE.DirectionalLight(col(0xd9a69e), 2.2);
    rim.position.set(-4, 3.5, -5);
    s.add(rim);
    const fill = new THREE.PointLight(col(0xffe2b8), shadows ? 8 : 10, 0, 2);
    fill.position.set(shadows ? -2.5 : -1.5, shadows ? 2.2 : 2.6, shadows ? 4.5 : 6.5);
    s.add(fill);
  };
  addLights(scene, true);
  addLights(scene2, false);

  // Бархатный стол: круг с мягким краем.
  const floorCanvas = document.createElement("canvas");
  floorCanvas.width = floorCanvas.height = 512;
  const fx = floorCanvas.getContext("2d");
  if (fx) {
    const fg = fx.createRadialGradient(256, 256, 0, 256, 256, 256);
    fg.addColorStop(0, "rgba(255,255,255,1)");
    fg.addColorStop(0.6, "rgba(255,255,255,.85)");
    fg.addColorStop(1, "rgba(255,255,255,0)");
    fx.fillStyle = fg;
    fx.fillRect(0, 0, 512, 512);
  }
  const floor = new THREE.Mesh(
    keep(new THREE.CircleGeometry(6, 64)),
    keep(new THREE.MeshStandardMaterial({ color: col(0x2a1416), roughness: 0.95, metalness: 0, alphaMap: keep(new THREE.CanvasTexture(floorCanvas)), transparent: true })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const gold = keep(new THREE.MeshStandardMaterial({ color: col(0xe0bc72), metalness: 1, roughness: 0.24, envMapIntensity: 1.25 }));
  const goldDark = keep(new THREE.MeshStandardMaterial({ color: col(0xb08840), metalness: 1, roughness: 0.35, envMapIntensity: 1.0 }));
  const wood = keep(new THREE.MeshStandardMaterial({ color: col(0x5b3420), roughness: 0.42, metalness: 0, envMapIntensity: 0.7 }));

  // Барабан: два кольца со спицами, прутья по кругу, ось и ручка.
  const R = 1.55;
  const L = 2.5;
  const AXY = 2.05;
  const drum = new THREE.Group();
  drum.position.y = AXY;
  scene.add(drum);
  const cage = new THREE.Group();
  drum.add(cage);
  const cast = <M extends THREE.Mesh>(m: M): M => {
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const rodX = (len: number, r: number, mat: THREE.Material) => {
    const g = keep(new THREE.CylinderGeometry(r, r, len, 20));
    g.rotateZ(Math.PI / 2);
    return cast(new THREE.Mesh(g, mat));
  };
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const m = rodX(L, 0.022, gold);
    m.position.set(0, Math.cos(a) * R, Math.sin(a) * R);
    cage.add(m);
  }
  for (const x of [-L / 2, L / 2]) {
    const tg = keep(new THREE.TorusGeometry(R, 0.075, 24, 140));
    tg.rotateY(Math.PI / 2);
    const t = cast(new THREE.Mesh(tg, gold));
    t.position.x = x;
    cage.add(t);
    const tg2 = keep(new THREE.TorusGeometry(R * 0.55, 0.03, 16, 90));
    tg2.rotateY(Math.PI / 2);
    const t2 = cast(new THREE.Mesh(tg2, goldDark));
    t2.position.x = x;
    cage.add(t2);
    const spoke = keep(new THREE.CylinderGeometry(0.028, 0.028, R * 2, 12));
    for (let k = 0; k < 8; k++) {
      const s = cast(new THREE.Mesh(spoke, gold));
      s.position.x = x;
      s.rotation.x = (k / 8) * Math.PI;
      cage.add(s);
    }
    const hub = cast(new THREE.Mesh(keep(new THREE.SphereGeometry(0.17, 32, 24)), gold));
    hub.position.x = x;
    cage.add(hub);
  }
  for (const x of [-L / 6, L / 6]) {
    const tg = keep(new THREE.TorusGeometry(R, 0.035, 16, 140));
    tg.rotateY(Math.PI / 2);
    const t = cast(new THREE.Mesh(tg, goldDark));
    t.position.x = x;
    cage.add(t);
  }
  cage.add(rodX(L + 1.0, 0.06, goldDark));
  const crank = new THREE.Group();
  crank.position.x = L / 2 + 0.5;
  cage.add(crank);
  const arm = cast(new THREE.Mesh(keep(new THREE.BoxGeometry(0.07, 0.62, 0.1)), gold));
  arm.position.y = -0.28;
  crank.add(arm);
  const knobG = keep(new THREE.CylinderGeometry(0.07, 0.08, 0.32, 24));
  knobG.rotateZ(Math.PI / 2);
  const knob = cast(new THREE.Mesh(knobG, wood));
  knob.position.set(0.18, -0.56, 0);
  crank.add(knob);

  // Стойка: две пары ножек, подставки, перекладина.
  const beam = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = cast(new THREE.Mesh(keep(new THREE.CylinderGeometry(r, r * 1.15, d.length(), 20)), mat));
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  };
  for (const x of [-(L / 2 + 0.3), L / 2 + 0.3]) {
    const top = new THREE.Vector3(x, AXY, 0);
    scene.add(beam(new THREE.Vector3(x, 0.08, 1.05), top, 0.07, wood));
    scene.add(beam(new THREE.Vector3(x, 0.08, -1.05), top, 0.07, wood));
    const cap = cast(new THREE.Mesh(keep(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 28)), gold));
    cap.rotation.z = Math.PI / 2;
    cap.position.copy(top);
    scene.add(cap);
    const foot = cast(new THREE.Mesh(keep(new THREE.BoxGeometry(0.24, 0.1, 2.4)), wood));
    foot.position.set(x, 0.05, 0);
    scene.add(foot);
    for (const z of [-1.15, 1.15]) {
      const f = cast(new THREE.Mesh(keep(new THREE.SphereGeometry(0.07, 16, 12)), gold));
      f.position.set(x, 0.06, z);
      scene.add(f);
    }
  }
  const plank = cast(new THREE.Mesh(keep(new THREE.BoxGeometry(L + 0.84, 0.08, 0.22)), wood));
  plank.position.set(0, 0.14, 0);
  scene.add(plank);

  // Текстуры бочонка: дерево с винными и золотыми полосами, крышки с номером и со звездой JoyRest.
  const texture = (canvas: HTMLCanvasElement) => {
    const t = keep(new THREE.CanvasTexture(canvas));
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  };
  const sideCanvas = document.createElement("canvas");
  sideCanvas.width = 1024;
  sideCanvas.height = 512;
  const sx = sideCanvas.getContext("2d");
  if (sx) {
    const g = sx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#D9BF94");
    g.addColorStop(0.5, "#EEDDBD");
    g.addColorStop(1, "#D9BF94");
    sx.fillStyle = g;
    sx.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 160; i++) {
      const px = rnd() * 1024;
      sx.strokeStyle = `rgba(150,105,60,${0.04 + rnd() * 0.09})`;
      sx.lineWidth = 0.6 + rnd() * 2.2;
      sx.beginPath();
      sx.moveTo(px, 0);
      sx.bezierCurveTo(px + rnd() * 14 - 7, 170, px + rnd() * 14 - 7, 340, px + rnd() * 10 - 5, 512);
      sx.stroke();
    }
    for (const y of [64, 448 - 36]) {
      sx.fillStyle = "#8E3A3C";
      sx.fillRect(0, y, 1024, 36);
      sx.fillStyle = "rgba(255,255,255,.18)";
      sx.fillRect(0, y, 1024, 4);
      sx.fillStyle = "#C9A15F";
      sx.fillRect(0, y - 8, 1024, 4);
      sx.fillRect(0, y + 40, 1024, 4);
    }
  }
  const SIDE = texture(sideCanvas);
  const caps = new Map<string, THREE.CanvasTexture>();
  const capTexture = (n: number | "star", glow = false): THREE.CanvasTexture => {
    const key = `${n}${glow ? "g" : ""}`;
    const known = caps.get(key);
    if (known) return known;
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d");
    if (x) {
      x.scale(0.5, 0.5);
      const g = x.createRadialGradient(256, 230, 20, 256, 256, 256);
      g.addColorStop(0, glow ? "#FFF8E6" : "#F8EEDC");
      g.addColorStop(1, glow ? "#F0D9A8" : "#E2CDA8");
      x.fillStyle = g;
      x.beginPath();
      x.arc(256, 256, 256, 0, 7);
      x.fill();
      x.strokeStyle = "#8E3A3C";
      x.lineWidth = 18;
      x.beginPath();
      x.arc(256, 256, 226, 0, 7);
      x.stroke();
      x.strokeStyle = "#C9A15F";
      x.lineWidth = 5;
      x.beginPath();
      x.arc(256, 256, 204, 0, 7);
      x.stroke();
      if (n === "star") {
        x.fillStyle = "#C9A15F";
        x.translate(256, 256);
        x.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const r = i % 2 ? 40 : 130;
          x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        x.closePath();
        x.fill();
        x.translate(-256, -256);
        x.font = '600 34px "Jost", sans-serif';
        x.fillStyle = "#6B4A22";
        x.textAlign = "center";
        x.fillText("JOYREST", 256, 430);
      } else {
        x.fillStyle = "#2A1D16";
        x.textAlign = "center";
        x.textBaseline = "middle";
        const digits = String(n).length;
        x.font = `700 ${digits > 2 ? 190 : digits > 1 ? 250 : 290}px "Cormorant Garamond", serif`;
        x.fillText(String(n), 256, 270);
        if (n === 6 || n === 9 || n === 66 || n === 99 || n === 69 || n === 96) x.fillRect(196, 400, 120, 12);
      }
    }
    const t = texture(c);
    caps.set(key, t);
    return t;
  };

  // Бочонок: точёный корпус, две крышки, золотые ободки. Много бочонков — меньше (иначе не поместятся).
  const count = opts.numbers.length;
  const S = clamp(Math.sqrt(36 / Math.max(1, count)), 0.62, 1);
  const BH = 0.46 * S;
  const BR0 = 0.165 * S;
  const BR1 = 0.215 * S;
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const y = -BH / 2 + (BH * i) / 24;
    const u = y / (BH / 2);
    prof.push(new THREE.Vector2(BR0 + (BR1 - BR0) * Math.cos((u * Math.PI) / 2), y));
  }
  const latheG = keep(new THREE.LatheGeometry(prof, 32));
  const capG = keep(new THREE.CircleGeometry(BR0 * 0.985, 40));
  const rimG = keep(new THREE.TorusGeometry(BR0 * 0.99, 0.014 * S, 8, 40));
  const sideMat = keep(new THREE.MeshStandardMaterial({ map: SIDE, roughness: 0.32, metalness: 0, envMapIntensity: 0.9 }));
  const makeBarrel = (n: number) => {
    const b = new THREE.Group();
    b.add(cast(new THREE.Mesh(latheG, sideMat)));
    const capMat = keep(new THREE.MeshStandardMaterial({ map: capTexture(n), roughness: 0.3, envMapIntensity: 0.9 }));
    for (const s of [1, -1]) {
      const cap = cast(new THREE.Mesh(capG, s > 0 ? keep(capMat.clone()) : capMat));
      if (s > 0) b.userData.top = cap;
      cap.position.y = (s * BH) / 2 + s * 0.001;
      cap.rotation.x = (-s * Math.PI) / 2;
      if (s < 0) cap.rotation.z = Math.PI;
      b.add(cap);
      const rim = cast(new THREE.Mesh(rimG, gold));
      rim.position.y = (s * BH) / 2;
      rim.rotation.x = Math.PI / 2;
      b.add(rim);
    }
    return b;
  };

  // Бочонки и 2D-физика в сечении барабана (локальные y, z; x — дорожка вдоль оси).
  const RIN = R - 0.1;
  const RC = 0.22 * S;
  const bars: Barrel[] = [];
  for (const n of opts.numbers) {
    const m = makeBarrel(n);
    drum.add(m);
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.9;
    bars.push({
      n,
      m,
      x: (rnd() - 0.5) * (L - 0.6),
      p: new THREE.Vector2(Math.cos(a) * r, -RIN + RC + rnd() * 0.9),
      v: new THREE.Vector2(),
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)),
      w: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
      ws: 0,
    });
  }
  const chosen = bars.find((b) => b.n === opts.pick) ?? null;
  const G = -9.8;
  const lane = 0.5 * S + 0.1;
  const physics = (omega: number, dt: number, skip: Barrel | null) => {
    for (const b of bars) {
      if (b === skip) continue;
      b.v.y += G * dt;
      b.p.addScaledVector(b.v, dt);
      const d = b.p.length();
      const lim = RIN - RC;
      if (d > lim) {
        const nx = b.p.x / d;
        const ny = b.p.y / d;
        b.p.set(nx * lim, ny * lim);
        const vn = b.v.x * nx + b.v.y * ny;
        if (vn > 0) {
          b.v.x -= 1.35 * vn * nx;
          b.v.y -= 1.35 * vn * ny;
        }
        // Стенка барабана тянет бочонок по касательной.
        const wx = -omega * ny * RIN;
        const wy = omega * nx * RIN;
        const tx = -ny;
        const ty = nx;
        const vt = b.v.x * tx + b.v.y * ty;
        const wt = wx * tx + wy * ty;
        const dv = (wt - vt) * 0.35;
        b.v.x += dv * tx;
        b.v.y += dv * ty;
        b.ws += Math.abs(wt - vt) * 2.2;
      }
    }
    for (let i = 0; i < bars.length; i++) {
      const a = bars[i] as Barrel;
      if (a === skip) continue;
      for (let j = i + 1; j < bars.length; j++) {
        const c = bars[j] as Barrel;
        if (c === skip || Math.abs(a.x - c.x) > lane) continue;
        const dx = c.p.x - a.p.x;
        const dy = c.p.y - a.p.y;
        const d = Math.hypot(dx, dy);
        const md = RC * 1.9;
        if (d > 0 && d < md) {
          const nx = dx / d;
          const ny = dy / d;
          const o = (md - d) / 2;
          a.p.x -= nx * o;
          a.p.y -= ny * o;
          c.p.x += nx * o;
          c.p.y += ny * o;
          const rv = (c.v.x - a.v.x) * nx + (c.v.y - a.v.y) * ny;
          if (rv < 0) {
            const imp = (-1.25 * rv) / 2;
            a.v.x -= imp * nx;
            a.v.y -= imp * ny;
            c.v.x += imp * nx;
            c.v.y += imp * ny;
            a.ws += -rv;
            c.ws += -rv;
          }
        }
      }
    }
    for (const b of bars) {
      if (b === skip) continue;
      b.v.multiplyScalar(0.9985);
      b.ws = Math.min(b.ws * 0.985, 14);
    }
  };
  const dq = new THREE.Quaternion();
  const placeBarrels = (dt: number, skip: Barrel | null) => {
    for (const b of bars) {
      if (b === skip) continue;
      dq.setFromAxisAngle(b.w, (b.ws + 0.2) * dt);
      b.q.premultiply(dq);
      b.m.position.set(b.x, b.p.y, b.p.x);
      b.m.quaternion.copy(b.q);
    }
  };
  for (let i = 0; i < 400; i++) physics(0, 1 / 240, null);

  // Эффекты: ореол, искры, крышка.
  const spriteTex = (stops: Array<[number, string]>) => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    if (x) {
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      for (const [at, color] of stops) g.addColorStop(at, color);
      x.fillStyle = g;
      x.fillRect(0, 0, 128, 128);
    }
    return texture(c);
  };
  const haloMat = keep(
    new THREE.SpriteMaterial({
      map: spriteTex([
        [0, "rgba(255,236,190,1)"],
        [0.35, "rgba(240,200,130,.45)"],
        [1, "rgba(240,200,130,0)"],
      ]),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }),
  );
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(3.2, 3.2, 1);
  scene2.add(halo);
  const PN = 220;
  const pg = keep(new THREE.BufferGeometry());
  const ppos = new Float32Array(PN * 3);
  pg.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
  const pvel: THREE.Vector3[] = [];
  for (let i = 0; i < PN; i++) {
    const th = rnd() * Math.PI * 2;
    const ph = (rnd() - 0.2) * Math.PI * 0.9;
    const s = 1.5 + rnd() * 3.5;
    pvel.push(new THREE.Vector3(Math.cos(th) * Math.cos(ph) * s, Math.sin(ph) * s + 1, Math.sin(th) * Math.cos(ph) * s * 0.6 + 1.2));
  }
  const partMat = keep(
    new THREE.PointsMaterial({
      size: 0.07,
      map: spriteTex([
        [0, "rgba(255,245,215,1)"],
        [0.4, "rgba(240,200,120,.8)"],
        [1, "rgba(240,200,120,0)"],
      ]),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
      color: col(0xffe2a8),
    }),
  );
  const parts = new THREE.Points(pg, partMat);
  parts.visible = false;
  scene2.add(parts);
  const lid = new THREE.Group();
  lid.visible = false;
  scene2.add(lid);
  {
    const lidCap = new THREE.Mesh(capG, keep(new THREE.MeshStandardMaterial({ map: capTexture("star"), roughness: 0.3 })));
    lidCap.position.y = 0.012;
    lidCap.rotation.x = -Math.PI / 2;
    lid.add(lidCap);
    const lidBack = new THREE.Mesh(capG, keep(new THREE.MeshStandardMaterial({ color: col(0xe9d6b4), roughness: 0.5 })));
    lidBack.rotation.x = Math.PI / 2;
    lid.add(lidBack);
    lid.add(new THREE.Mesh(keep(new THREE.CylinderGeometry(BR0, BR0, 0.024, 40, 1, true)), gold));
  }
  // У выбранного бочонка до вылета — крышка со звездой (номер скрыт), после хлопка — светящийся номер.
  const starMat = keep(new THREE.MeshStandardMaterial({ map: capTexture("star"), roughness: 0.3, envMapIntensity: 0.9 }));
  const glowMat = keep(new THREE.MeshStandardMaterial({ map: capTexture(opts.pick, true), emissive: col(0xffd9a0), emissiveIntensity: 0.35, emissiveMap: capTexture(opts.pick, true), roughness: 0.3 }));

  const omegaAt = (t: number) => {
    if (t < T.spinUp) return 0.45;
    if (t < T.full) return 0.45 + (7.5 - 0.45) * ease(seg(t, T.spinUp, T.full));
    if (t < T.slow) return 7.5;
    if (t < T.stop) return 7.5 * (1 - ease(seg(t, T.slow, T.stop)));
    return 0;
  };
  const camBase = new THREE.Vector3(1.9, 3.0, 8.3);
  const look = new THREE.Vector3(0, 1.75, 0);
  const camPos = (t: number) => {
    const tc = Math.min(t, T.stop);
    const cs = ease(seg(tc, 0.3, T.stop - 0.2));
    return new THREE.Vector3(camBase.x + Math.sin(tc * 0.25) * 0.35 - cs * 0.5, camBase.y - cs * 0.2, camBase.z - cs * 0.6);
  };

  let simT = 0;
  let angle = 0;
  let popped = false;
  let flying: { p: THREE.Vector3; q: THREE.Quaternion; target: THREE.Vector3; qSide: THREE.Quaternion; qFace: THREE.Quaternion } | null = null;
  const DT = 1 / 30;
  placeBarrels(0, null);

  const startFlight = () => {
    if (!chosen) return;
    const p = chosen.m.getWorldPosition(new THREE.Vector3());
    const q = chosen.m.getWorldQuaternion(new THREE.Quaternion());
    drum.remove(chosen.m);
    scene2.add(chosen.m);
    chosen.m.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry === capG) o.material = starMat;
    });
    const camEnd = camPos(T.fly);
    const dir = new THREE.Vector3().subVectors(look, camEnd).normalize();
    const target = camEnd.clone().addScaledVector(dir, 2.25);
    target.y -= 0.02;
    const toCam = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const camUp = new THREE.Vector3(0, 1, 0).addScaledVector(toCam, -toCam.y).normalize();
    const zw = camUp.clone().negate();
    const xw = new THREE.Vector3().crossVectors(toCam, zw);
    const qFace = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xw, toCam, zw));
    const qSide = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), right.negate());
    flying = { p, q, target, qSide, qFace };
  };

  const resize = () => {
    for (const [r, c] of [
      [renderer, opts.main],
      [renderer2, opts.top],
    ] as const) {
      const w = Math.max(1, c.clientWidth);
      const h = Math.max(1, c.clientHeight);
      r.setSize(w, h, false);
    }
    const w = Math.max(1, opts.main.clientWidth);
    const h = Math.max(1, opts.main.clientHeight);
    camera.aspect = w / h;
    camera.setViewOffset(w, h, w * opts.offset, 0, w, h);
    camera.updateProjectionMatrix();
  };
  resize();

  const frame = (t: number) => {
    // Физика — до нужной секунды шагами по 1/30 с (по 4 подшага): один и тот же ход на любом экране.
    while (simT < t - 1e-6 && simT < T.stop + 0.5) {
      const om = omegaAt(simT);
      for (let k = 0; k < 4; k++) physics(om, DT / 4, flying ? chosen : null);
      angle += om * DT;
      simT += DT;
      placeBarrels(DT, flying ? chosen : null);
    }
    cage.rotation.x = angle;
    camera.position.copy(camPos(t));
    camera.lookAt(look);

    if (t >= T.stop && !flying) startFlight();
    if (flying && chosen) {
      const b = chosen.m;
      const u = seg(t, T.stop, T.fly);
      const e = easeOut(u);
      const p0 = flying.p;
      const p1 = new THREE.Vector3(p0.x * 0.5, AXY + R + 1.1, 0.4);
      const p2 = new THREE.Vector3(flying.target.x * 0.6, AXY + 1.5, flying.target.z * 0.6);
      const p3 = flying.target;
      const a = 1 - e;
      const pos = new THREE.Vector3()
        .addScaledVector(p0, a * a * a)
        .addScaledVector(p1, 3 * a * a * e)
        .addScaledVector(p2, 3 * a * e * e)
        .addScaledVector(p3, e * e * e);
      pos.y += Math.sin((t - T.fly) * 2.6) * 0.035 * (t > T.fly ? 1 : 0);
      b.position.copy(pos);
      const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (1 - e) * 9);
      let q = flying.q.clone().slerp(flying.qSide, e).multiply(spin);
      if (t > T.fly) q = flying.qSide.clone().slerp(flying.qFace, ease(seg(t, T.fly, T.twist)));
      b.quaternion.copy(q);
      // Бочонки в барабане меньше (S), выбранный к залу вырастает до полного размера и чуть больше.
      const sc = 1 + e * (1.15 / S - 1);
      haloMat.opacity = clamp(seg(t, T.stop + 0.6, T.fly)) * (0.55 + Math.sin(t * 4) * 0.1) * (1 - seg(t, T.big, T.big + 0.4));
      halo.position.copy(pos).add(new THREE.Vector3(0, 0, -0.4));
      const capWorld = () => b.localToWorld(new THREE.Vector3(0, BH / 2, 0));
      if (t >= T.pop && !popped) {
        popped = true;
        lid.visible = true;
        parts.visible = true;
        const top = b.userData.top as THREE.Mesh | undefined;
        if (top) top.material = glowMat;
      }
      if (popped) {
        const lu = t - T.pop;
        const o = capWorld();
        lid.position.set(o.x + lu * 1.6, o.y + lu * 2.4 - lu * lu * 2.2, o.z + lu * 1.2);
        lid.scale.setScalar(sc);
        lid.quaternion.copy(flying.qFace).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(lu * 7, lu * 4, lu * 2)));
        lid.visible = lu < 1.2;
        const pu = clamp(lu / 1.6);
        for (let k = 0; k < PN; k++) {
          const v = pvel[k] as THREE.Vector3;
          ppos[k * 3] = o.x + v.x * lu * (1 - pu * 0.4);
          ppos[k * 3 + 1] = o.y + v.y * lu - 1.8 * lu * lu;
          ppos[k * 3 + 2] = o.z + v.z * lu * 0.7;
        }
        pg.getAttribute("position").needsUpdate = true;
        partMat.opacity = (1 - pu) * 1.1;
      }
      b.visible = t < T.big + 0.45;
      b.scale.setScalar(sc * (1 + seg(t, T.big - 0.1, T.big + 0.45) * 0.6));
    }
    renderer.render(scene, camera);
    renderer2.render(scene2, camera);
  };

  return {
    frame,
    resize,
    dispose() {
      for (const d of disposables) d.dispose();
      for (const t of caps.values()) t.dispose();
      renderer.dispose();
      renderer2.dispose();
      renderer.forceContextLoss();
      renderer2.forceContextLoss();
    },
  };
}
