// Эффекты нового экрана «Боя с драконом»: частицы на canvas (угли или пузырьки фоном, искры, всасывание,
// струя пламени) и разовые анимации удара и атаки (катана, самолётик, воздушный змей, луч, дыхание, бабочки).
// Анимации — элементы в отдельном слое кадра, который React не трогает; только transform/opacity, Web Animations.
// Координаты — пиксели внутри кадра, `u` — 1% ширины кадра.

export interface Point {
  x: number;
  y: number;
}

export interface Target extends Point {
  id: string;
}

type Kind = "back" | "in" | "sp" | "fl";

interface P {
  t: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  dec: number;
  h: number;
  tx: number;
  ty: number;
}

const KID_HUES = [330, 200, 45, 150, 270];
const kidHue = () => KID_HUES[Math.floor(Math.random() * KID_HUES.length)] ?? 330;

/** Частицы кадра: нижний canvas — фон (угли или пузырьки), верхний — искры, всасывание, пламя. */
export class Particles {
  private back: CanvasRenderingContext2D | null;
  private top: CanvasRenderingContext2D | null;
  private list: P[] = [];
  private w = 0;
  private h = 0;
  private raf = 0;
  private alive = true;

  constructor(
    private backCanvas: HTMLCanvasElement,
    private topCanvas: HTMLCanvasElement,
    private kids: boolean,
    private hue: number,
    private still: boolean,
  ) {
    this.back = backCanvas.getContext("2d");
    this.top = topCanvas.getContext("2d");
    this.resize();
    this.raf = requestAnimationFrame(this.tick);
  }

  setLook(kids: boolean, hue: number): void {
    if (kids === this.kids && hue === this.hue) return;
    this.kids = kids;
    this.hue = hue;
    this.list = this.list.filter((p) => p.t !== "back");
    this.fill();
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.backCanvas.clientWidth;
    this.h = this.backCanvas.clientHeight;
    for (const [c, g] of [
      [this.backCanvas, this.back],
      [this.topCanvas, this.top],
    ] as const) {
      c.width = Math.max(1, Math.round(this.w * dpr));
      c.height = Math.max(1, Math.round(this.h * dpr));
      g?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.list = this.list.filter((p) => p.t !== "back");
    this.fill(true);
  }

  stop(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
  }

  private base(): number {
    return this.still ? 0 : this.kids ? 26 : 80;
  }

  private ambient(anywhere: boolean): P {
    const k = this.kids;
    const s = this.w / 1000;
    return {
      t: "back",
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : this.h + 8,
      vx: (Math.random() - 0.5) * (k ? 0.2 : 0.4),
      vy: -(k ? 0.2 + Math.random() * 0.4 : 0.4 + Math.random() * 1.3) * Math.max(0.6, s),
      r: k ? 2 + Math.random() * (this.w / 180) : 0.8 + Math.random() * (this.w / 600),
      life: 1,
      dec: k ? 0.0016 : 0.003 + Math.random() * 0.004,
      h: k ? kidHue() : this.hue - 10 + Math.random() * 30,
      tx: 0,
      ty: 0,
    };
  }

  private fill(anywhere = false): void {
    let n = this.list.filter((p) => p.t === "back").length;
    while (n++ < this.base()) this.list.push(this.ambient(anywhere));
  }

  private hueOf(): number {
    return this.kids ? kidHue() : this.hue - 10 + Math.random() * 30;
  }

  /** Искры или блёстки разлетаются из точки. */
  spark(x: number, y: number, n: number): void {
    const s = Math.max(1, this.w / 1000);
    for (let i = 0; i < n; i++) {
      this.list.push({ t: "sp", x, y, vx: (Math.random() - 0.5) * 9 * s, vy: -(2 + Math.random() * 6) * s, r: (1 + Math.random() * 2) * s, life: 1, dec: 0.025 + Math.random() * 0.025, h: this.hueOf(), tx: 0, ty: 0 });
    }
  }

  /** Частицы со всего кадра стягиваются в точку (дракон набирает силу). */
  suck(x: number, y: number): void {
    const s = this.w / 1000;
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (70 + Math.random() * 150) * s;
      this.list.push({ t: "in", x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, tx: x, ty: y, vx: 0, vy: 0, r: (1 + Math.random() * 2) * Math.max(1, s), life: 1, dec: 0.02, h: this.hueOf() });
    }
  }

  /** Струя пламени из точки под углом `a` (радианы). */
  flame(x: number, y: number, a: number, n: number): void {
    const s = this.w / 100;
    for (let i = 0; i < n; i++) {
      const aa = a + (Math.random() - 0.5) * 0.4;
      const v = (1.25 + Math.random() * 0.6) * s;
      this.list.push({ t: "fl", x: x + (Math.random() - 0.5) * s, y, vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, r: (0.28 + Math.random() * 0.3) * s, life: 1, dec: 0.016 + Math.random() * 0.01, h: this.hue, tx: 0, ty: 0 });
    }
  }

  /** Праздничный выброс со стороны дракона (победа). */
  burst(n: number): void {
    for (let i = 0; i < n; i++) this.spark(this.w * (0.4 + Math.random() * 0.2), this.h * 0.4, 1);
  }

  private tick = (): void => {
    if (!this.alive) return;
    const b = this.back;
    const t = this.top;
    b?.clearRect(0, 0, this.w, this.h);
    t?.clearRect(0, 0, this.w, this.h);
    const k = this.kids;
    for (const p of this.list) {
      if (p.t === "fl") {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.vy -= 0.03;
        p.r *= 1.035;
        p.life -= p.dec;
        if (p.life <= 0 || !t) continue;
        const L = p.life;
        t.shadowBlur = 0;
        t.beginPath();
        t.arc(p.x, p.y, p.r, 0, 7);
        if (L > 0.25) {
          t.globalCompositeOperation = "lighter";
          t.fillStyle = `hsla(${p.h - 8 + 38 * L * L},100%,${38 + 50 * L * L * L}%,${0.18 + 0.5 * L})`;
        } else {
          t.globalCompositeOperation = "source-over";
          t.fillStyle = `rgba(50,32,26,${L * 1.4})`;
        }
        t.fill();
        t.globalCompositeOperation = "source-over";
        continue;
      }
      if (p.t === "in") {
        p.x += (p.tx - p.x) * 0.12;
        p.y += (p.ty - p.y) * 0.12;
        if (Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) < 3) p.life = 0;
      } else if (p.t === "sp") {
        p.vy += 0.25;
        p.x += p.vx;
        p.y += p.vy;
      } else {
        p.x += p.vx + (k ? 0 : Math.sin(p.y * 0.02) * 0.3);
        p.y += p.vy;
      }
      p.life -= p.dec;
      if (p.life <= 0 || p.y < -20 || p.y > this.h + 20) continue;
      const g = p.t === "back" ? b : t;
      if (!g) continue;
      const a = Math.max(0, p.life) * (k ? (p.t === "back" ? 0.55 : 0.9) : 0.6 + Math.random() * 0.4);
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, 7);
      g.fillStyle = k ? `hsla(${p.h},90%,${p.t === "back" ? 75 : 62}%,${a})` : `hsla(${p.h},100%,${55 + Math.random() * 15}%,${a})`;
      if (!k) {
        g.shadowBlur = 8;
        g.shadowColor = `hsla(${this.hue},100%,55%,.9)`;
      } else g.shadowBlur = 0;
      g.fill();
    }
    this.list = this.list.filter((p) => p.life > 0 && p.y > -20 && p.y < this.h + 20);
    this.fill();
    this.raf = requestAnimationFrame(this.tick);
  };
}

export interface FxCtx {
  layer: HTMLElement;
  svg: SVGSVGElement;
  /** 1% ширины кадра в пикселях. */
  u: number;
  particles: Particles | null;
  kids: boolean;
}

const NS = "http://www.w3.org/2000/svg";
export const wait = (ms: number) => new Promise<void>((res) => window.setTimeout(res, ms));

function svgEl(ctx: FxCtx, tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  ctx.svg.appendChild(e);
  return e;
}

function div(ctx: FxCtx, cls: string, html = ""): HTMLDivElement {
  const e = document.createElement("div");
  e.className = cls;
  if (html) e.innerHTML = html;
  ctx.layer.appendChild(e);
  return e;
}

function anim(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): void {
  if (typeof el.animate === "function") el.animate(frames, opts);
}

function later(el: Element, ms: number): void {
  window.setTimeout(() => el.remove(), ms);
}

function place(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

/** Всплывающая надпись (урон, «Щит!»). */
export function floatText(ctx: FxCtx, x: number, y: number, html: string, cls = ""): void {
  const f = div(ctx, `dg-float ${cls}`, html);
  place(f, x, y);
  later(f, 1500);
}

/** Звёздочки (детский удар). */
export function stars(ctx: FxCtx, x: number, y: number): void {
  const cols = ["#ffd23f", "#ff6fae", "#3fb4ff", "#3fd39b"];
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = (5 + Math.random() * 9) * ctx.u;
    const s = div(ctx, "dg-star");
    place(s, x, y);
    s.style.background = cols[i % cols.length] ?? "#ffd23f";
    anim(s, [{ transform: "translate(0,0) scale(.2) rotate(0)" }, { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r}px) scale(1) rotate(180deg)`, opacity: 0 }], { duration: 900, easing: "ease-out", fill: "forwards" });
    later(s, 950);
  }
}

const KATANA = `<svg viewBox="0 0 300 24" preserveAspectRatio="none"><defs><linearGradient id="dgSteel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d96a1"/><stop offset=".45" stop-color="#f4f7fa"/><stop offset=".62" stop-color="#c9d1d9"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
<rect x="0" y="8" width="62" height="8" rx="3" fill="#1b1310"/>
${[0, 1, 2, 3, 4, 5].map((i) => `<polygon points="${6 + i * 9},12 ${10 + i * 9},8.6 ${14 + i * 9},12 ${10 + i * 9},15.4" fill="#c9873e"/>`).join("")}
<ellipse cx="65" cy="12" rx="4" ry="11" fill="#d9a35b" stroke="#5a3a14" stroke-width="1"/>
<rect x="69" y="8.5" width="7" height="7" fill="#e6b86a"/>
<path d="M76 8.5 Q190 4.5 300 3 Q293 8 288 9.5 Q190 15 76 15.5 Z" fill="url(#dgSteel)"/>
<path d="M92 13.2 Q118 11.4 140 13 Q162 14.6 184 12.4 Q206 10.6 228 12 Q256 12.6 284 9" stroke="#ffffff" stroke-width="1.1" fill="none" opacity=".85"/></svg>`;

/**
 * Удар катаной (взрослый вид): со стороны команды — замах, взмах с огненной дугой, мгновенная пауза и вспышка
 * разреза по дракону; крит — второй разрез крестом. Промис — в момент разреза (точка, куда вылетает урон).
 */
export function katana(ctx: FxCtx, left: boolean, dragon: { x: number; y: number; w: number; h: number }, crit: boolean): Promise<Point> {
  const u = ctx.u;
  const px = dragon.x + (left ? -7 : 7) * u;
  const py = dragon.y + 17 * u;
  const R = 31 * u;
  const a0 = left ? -168 : -12;
  const a1 = left ? -12 : -168;
  const dir = left ? 1 : -1;
  const k = div(ctx, "dg-katana", KATANA);
  place(k, px, py);
  k.style.width = `${R}px`;
  k.style.height = `${(R * 24) / 300}px`;
  k.style.marginTop = `${(-R * 12) / 300}px`;
  if (!left && k.firstElementChild instanceof SVGElement) k.firstElementChild.style.transform = "scaleY(-1)";
  anim(
    k,
    [
      { transform: `rotate(${a0}deg)`, opacity: 0 },
      { transform: `rotate(${a0 - 7 * dir}deg)`, opacity: 1, offset: 0.3, easing: "cubic-bezier(.85,0,.15,1)" },
      { transform: `rotate(${a1}deg)`, opacity: 1, offset: 0.62 },
      { transform: `rotate(${a1 + 5 * dir}deg)`, opacity: 1, offset: 0.8 },
      { transform: `rotate(${a1 + 5 * dir}deg)`, opacity: 0 },
    ],
    { duration: 820, fill: "forwards" },
  );
  later(k, 860);
  window.setTimeout(() => {
    const r = R * 0.92;
    const rad = (a: number) => (a * Math.PI) / 180;
    const s = a0 + 10 * dir;
    const e = a1 - 10 * dir;
    const p = svgEl(ctx, "path", {
      d: `M${px + r * Math.cos(rad(s))} ${py + r * Math.sin(rad(s))} A ${r} ${r} 0 0 ${left ? 1 : 0} ${px + r * Math.cos(rad(e))} ${py + r * Math.sin(rad(e))}`,
      fill: "none",
      stroke: "url(#dgTrail)",
      "stroke-width": (crit ? 3.2 : 2.2) * u,
      "stroke-linecap": "round",
      class: "dg-trail",
    });
    const len = p instanceof SVGPathElement && typeof p.getTotalLength === "function" ? p.getTotalLength() : 1000;
    p.style.strokeDasharray = String(len);
    anim(p, [{ strokeDashoffset: len, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.55 }, { strokeDashoffset: 0, opacity: 0 }], { duration: 560, easing: "ease-out", fill: "forwards" });
    later(p, 600);
  }, 240);
  const cut = (flip: boolean, delay: number) =>
    window.setTimeout(() => {
      const sgn = (flip ? -1 : 1) * dir;
      const l = svgEl(ctx, "line", { x1: dragon.x - dragon.w * 0.26, y1: dragon.y - dragon.h * 0.22 * sgn, x2: dragon.x + dragon.w * 0.26, y2: dragon.y + dragon.h * 0.22 * sgn, stroke: "#fff", "stroke-linecap": "round", class: "dg-cut" });
      anim(l, [{ strokeWidth: 0, opacity: 1 }, { strokeWidth: 1.3 * u, opacity: 1, offset: 0.25 }, { strokeWidth: 0.2 * u, opacity: 0 }], { duration: 520, fill: "forwards" });
      later(l, 540);
      ctx.particles?.spark(dragon.x, dragon.y, 30);
    }, delay);
  cut(false, 640);
  if (crit) cut(true, 820);
  return wait(660).then(() => ({ x: dragon.x, y: dragon.y - dragon.h * 0.2 }));
}

const PLANE = (c: string) =>
  `<svg viewBox="0 0 60 40"><path d="M2 18 L58 4 L22 26 Z" fill="#fff" stroke="${c}" stroke-width="2" stroke-linejoin="round"/><path d="M22 26 L58 4 L30 38 Z" fill="${c}" stroke="${c}" stroke-width="2" stroke-linejoin="round"/><path d="M22 26 L30 38" stroke="#fff" stroke-width="1.5"/></svg>`;
const KITE = (c: string) => `<svg viewBox="0 0 60 92"><path class="dg-tail" d="M30 58 Q22 66 30 72 Q38 78 30 84 Q24 88 30 91" stroke="#fff" stroke-width="2.4" fill="none"/>
<path class="dg-tail" d="M24 66 L30 70 L24 74 Z M36 76 L30 80 L36 84 Z" fill="${c}"/>
<path d="M30 2 L52 28 L30 58 L8 28 Z" fill="${c}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M30 2 L30 58 M8 28 L52 28" stroke="#fff" stroke-width="2" opacity=".85"/><circle cx="30" cy="28" r="4" fill="#fff"/></svg>`;

/** Самолётик (пунктир следа) или воздушный змей (на ниточке, виляет хвостом) — детский удар. */
export function fly(ctx: FxCtx, kind: "plane" | "kite", from: Point, to: Point, color: string, frameH: number): Promise<Point> {
  const u = ctx.u;
  const c = { x: kind === "plane" ? (from.x + to.x) / 2 : from.x + (to.x - from.x) * 0.2, y: Math.max(frameH * 0.1, Math.min(from.y, to.y) - (kind === "plane" ? 0.2 : 0.36) * frameH) };
  const el = div(ctx, `dg-proj dg-proj--${kind}`, kind === "plane" ? PLANE(color) : KITE(color));
  const str = kind === "kite" ? svgEl(ctx, "line", { x1: from.x, y1: from.y, x2: from.x, y2: from.y, stroke: "#fff", "stroke-width": 0.18 * u, opacity: 0.9 }) : null;
  const T = kind === "plane" ? 1050 : 1600;
  const t0 = performance.now();
  let n = 0;
  return new Promise((resolve) => {
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / T);
      const t = kind === "plane" ? k * k * (3 - 2 * k) : Math.pow(k, 1.7);
      const m = 1 - t;
      let x = m * m * from.x + 2 * m * t * c.x + t * t * to.x;
      let y = m * m * from.y + 2 * m * t * c.y + t * t * to.y;
      const dx = 2 * m * (c.x - from.x) + 2 * t * (to.x - c.x);
      const dy = 2 * m * (c.y - from.y) + 2 * t * (to.y - c.y);
      if (kind === "plane") {
        el.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(dy, dx)}rad)`;
        if (n++ % 2 === 0) {
          const dot = svgEl(ctx, "circle", { cx: x, cy: y, r: 0.32 * u, fill: "#fff" });
          anim(dot, [{ opacity: 0.95 }, { opacity: 0 }], { duration: 700, fill: "forwards" });
          later(dot, 720);
        }
      } else {
        const len = Math.hypot(dx, dy) || 1;
        const w = Math.sin(k * Math.PI * 7) * 1.4 * u * (1 - k);
        x += (-dy / len) * w;
        y += (dx / len) * w;
        el.style.transform = `translate(-50%,-50%) rotate(${Math.sin(k * Math.PI * 5) * 14 * (1 - k) + (k > 0.75 ? (to.x < from.x ? -30 : 30) * (k - 0.75) * 4 : 0)}deg)`;
        str?.setAttribute("x2", String(x));
        str?.setAttribute("y2", String(y + 2.4 * u));
      }
      place(el, x, y);
      if (k < 1) requestAnimationFrame(step);
      else {
        anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" });
        later(el, 260);
        if (str) {
          anim(str, [{ opacity: 0.9 }, { opacity: 0 }], { duration: 400, fill: "forwards" });
          later(str, 420);
        }
        resolve(to);
      }
    };
    requestAnimationFrame(step);
  });
}

/** Заряд атаки: кольца вокруг головы, вспышка, частицы стягиваются к точке. */
export function charge(ctx: FxCtx, at: Point, ms: number): { fire: () => void; done: () => void } {
  const r1 = div(ctx, "dg-ring");
  const r2 = div(ctx, "dg-ring dg-ring--2");
  const fl = div(ctx, "dg-flare");
  for (const e of [r1, r2, fl]) place(e, at.x, at.y);
  const suck = window.setInterval(() => ctx.particles?.suck(at.x, at.y), 40);
  window.setTimeout(() => window.clearInterval(suck), ms);
  return {
    fire: () => {
      r1.classList.add("is-fire");
      r2.classList.add("is-fire");
      fl.classList.add("is-fire");
    },
    done: () => {
      window.clearInterval(suck);
      for (const e of [r1, r2, fl]) {
        anim(e, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
        later(e, 320);
      }
    },
  };
}

/** Проводит атакой слева направо по целям; `onHit` — когда атака задела цель. */
function sweep(origin: Point, targets: Target[], groundY: number, T: number, frame: (a: number, ix: number, k: number) => void, onHit: (id: string) => void): Promise<void> {
  const angles = targets.map((t) => ({ ...t, a: Math.atan2(t.y - origin.y, t.x - origin.x), hit: false }));
  const a0 = Math.max(...angles.map((t) => t.a)) + 0.14;
  const a1 = Math.min(...angles.map((t) => t.a)) - 0.14;
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / T);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * k);
      const a = a0 + (a1 - a0) * e;
      const L = (groundY - origin.y) / Math.max(0.2, Math.sin(a));
      frame(a, origin.x + Math.cos(a) * L, k);
      for (const t of angles) {
        if (!t.hit && a <= t.a) {
          t.hit = true;
          onHit(t.id);
        }
      }
      if (k < 1) requestAnimationFrame(step);
      else {
        for (const t of angles) if (!t.hit) onHit(t.id);
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

/** Луч из лба (взрослый — огненный, детский — радужный). */
export async function beam(ctx: FxCtx, origin: Point, targets: Target[], groundY: number, onHit: (id: string) => void): Promise<void> {
  const b = div(ctx, "dg-beam", '<div class="dg-beam__core"></div>');
  const imp = div(ctx, "dg-impact");
  place(b, origin.x, origin.y);
  const L0 = groundY - origin.y;
  await sweep(
    origin,
    targets,
    groundY,
    1800,
    (a, ix) => {
      const L = (groundY - origin.y) / Math.max(0.2, Math.sin(a));
      b.style.width = `${Math.max(L0, L)}px`;
      b.style.transform = `rotate(${a}rad)`;
      place(imp, ix, groundY);
      ctx.particles?.spark(ix, groundY, 3);
    },
    onHit,
  );
  for (const e of [b, imp]) {
    anim(e, [{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: "forwards" });
    later(e, 370);
  }
}

/** Огненное дыхание из пасти (взрослый). */
export async function breath(ctx: FxCtx, origin: Point, targets: Target[], groundY: number, onHit: (id: string) => void): Promise<void> {
  await sweep(
    origin,
    targets,
    groundY,
    2100,
    (a, ix, k) => {
      if (k < 0.97) ctx.particles?.flame(origin.x, origin.y, a, 22);
      if (Math.random() < 0.6) ctx.particles?.spark(ix, groundY, 3);
    },
    (id) => window.setTimeout(() => onHit(id), 260),
  );
  await wait(400);
}

const BFLY = (c: string) =>
  `<svg viewBox="0 0 40 30"><g class="dg-wing"><path d="M20 15 Q6 -2 2 8 Q0 16 20 15 Z M20 15 Q8 30 4 24 Q2 18 20 15 Z" fill="${c}" stroke="#fff" stroke-width="1.5"/></g><g class="dg-wing"><path d="M20 15 Q34 -2 38 8 Q40 16 20 15 Z M20 15 Q32 30 36 24 Q38 18 20 15 Z" fill="${c}" stroke="#fff" stroke-width="1.5"/></g><path d="M20 7 L20 24" stroke="#3b2a63" stroke-width="2.4" stroke-linecap="round"/></svg>`;

/** Облако бабочек из пасти (детский): к каждой цели по стайке. */
export function butterflies(ctx: FxCtx, origin: Point, targets: Target[], onHit: (id: string) => void): Promise<void> {
  const cols = ["#ff6fae", "#ffd23f", "#3fb4ff", "#b48bff", "#3fd39b", "#ff9f43"];
  const u = ctx.u;
  const per = targets.length > 6 ? 3 : 5;
  let left = targets.length * per;
  if (left === 0) return Promise.resolve();
  return new Promise((resolve) => {
    targets.forEach((tg, ti) => {
      let hit = false;
      for (let j = 0; j < per; j++) {
        window.setTimeout(
          () => {
            const el = div(ctx, "dg-bfly", BFLY(cols[(ti * per + j) % cols.length] ?? "#ff6fae"));
            const to = { x: tg.x + (Math.random() - 0.5) * 8 * u, y: tg.y + (Math.random() - 0.5) * 3 * u };
            const cp = { x: origin.x + (tg.x - origin.x) * (0.3 + Math.random() * 0.5) + (Math.random() - 0.5) * 20 * u, y: origin.y - (4 + Math.random() * 10) * u };
            const T = 1200 + Math.random() * 500;
            const t0 = performance.now();
            const step = (now: number) => {
              const k = Math.min(1, (now - t0) / T);
              const t = k * k * (3 - 2 * k);
              const m = 1 - t;
              const x = m * m * origin.x + 2 * m * t * cp.x + t * t * to.x + Math.sin(k * Math.PI * 6 + j) * u * (1 - k);
              const y = m * m * origin.y + 2 * m * t * cp.y + t * t * to.y;
              const dx = 2 * m * (cp.x - origin.x) + 2 * t * (to.x - cp.x);
              const dy = 2 * m * (cp.y - origin.y) + 2 * t * (to.y - cp.y);
              place(el, x, y);
              el.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(dy, dx) + Math.PI / 2}rad) scale(${0.6 + 0.5 * k})`;
              if (k < 1) requestAnimationFrame(step);
              else {
                if (!hit) {
                  hit = true;
                  onHit(tg.id);
                }
                anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: "forwards" });
                later(el, 620);
                if (--left === 0) window.setTimeout(resolve, 300);
              }
            };
            requestAnimationFrame(step);
          },
          ti * 160 + j * 90,
        );
      }
    });
  });
}

/** Баннер посреди кадра («Луч Горгарота», «Облако бабочек!»). */
export function banner(ctx: FxCtx, text: string): void {
  const b = div(ctx, "dg-banner");
  const inner = document.createElement("div");
  inner.textContent = text;
  b.appendChild(inner);
  later(b, 1900);
}
