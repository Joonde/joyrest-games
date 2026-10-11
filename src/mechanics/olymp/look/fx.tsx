// «Олимп» — частицы экрана зала (как в прототипе): снег, золотая пыль, пыль карты и вспышки-искры.
// Один холст поверх сцены; при «уменьшить движение» — только вспышки не рисуются, частицы стоят.
import { useEffect, useRef } from "react";

export type FxMode = "snow" | "motes" | "dust" | "embers" | "mist" | "none";

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  l: number;
  m: number;
  c: string;
}

let burstFn: ((px: number, py: number, colors: string[], n: number) => void) | null = null;

/** Вспышка искр в точке (доли ширины и высоты сцены). */
export function burst(px: number, py: number, colors: string[], n: number): void {
  burstFn?.(px, py, colors, n);
}

export const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export function Fx({ mode }: { mode: FxMode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduce = reduceMotion();
    let w = 0;
    let h = 0;
    const size = () => {
      const r = cv.getBoundingClientRect();
      const d = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      cv.width = Math.max(1, Math.round(r.width * d));
      cv.height = Math.max(1, Math.round(r.height * d));
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    const flakes = Array.from({ length: 110 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.9 + 0.5, s: Math.random() * 0.5 + 0.25, p: Math.random() * 6.28 }));
    let sparks: Spark[] = [];
    burstFn = (px, py, colors, n) => {
      if (reduce) return;
      const k = w / 900;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28;
        const s = (Math.random() * 5 + 1.5) * k;
        sparks.push({ x: px * w, y: py * h, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2.2 * k, r: (Math.random() * 2.2 + 0.8) * k, l: 50 + Math.random() * 50, m: 100, c: colors[i % colors.length] ?? "#F3DFAE" });
      }
    };
    let raf = 0;
    const tick = (t: number) => {
      const k = w / 900;
      ctx.clearRect(0, 0, w, h);
      const m = modeRef.current;
      flakes.forEach((f, i) => {
        if (m === "snow") {
          if (!reduce) {
            f.y += f.s * 0.0017;
            f.x += Math.sin(t / 1700 + f.p) * 0.0004 + 0.0002;
            if (f.y > 1.02) {
              f.y = -0.02;
              f.x = Math.random();
            }
            if (f.x > 1.02) f.x = -0.02;
          }
          ctx.fillStyle = `rgba(236,243,248,${0.3 + f.r / 5})`;
          ctx.beginPath();
          ctx.arc(f.x * w, f.y * h, f.r * k, 0, 7);
          ctx.fill();
        } else if (m === "motes" || m === "embers" || (m === "dust" && i % 3 === 0) || (m === "mist" && i % 4 === 0)) {
          if (!reduce) {
            f.y -= f.s * (m === "dust" || m === "mist" ? 0.0004 : m === "embers" ? 0.0014 : 0.0009);
            f.x += Math.sin(t / 2200 + f.p) * 0.0003;
            if (f.y < -0.02) {
              f.y = 1.02;
              f.x = Math.random();
            }
          }
          const a = 0.2 + 0.25 * Math.sin(t / 500 + f.p);
          ctx.fillStyle = m === "embers" ? `rgba(255,170,90,${a + 0.15})` : m === "mist" ? `rgba(207,227,238,${a * 0.8})` : `rgba(243,223,174,${a})`;
          ctx.beginPath();
          ctx.arc(f.x * w, f.y * h, f.r * (m === "embers" ? 0.7 : 0.8) * k, 0, 7);
          ctx.fill();
        }
      });
      sparks = sparks.filter((p) => p.l > 0);
      sparks.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05 * k;
        p.vx *= 0.985;
        p.l--;
        ctx.globalAlpha = Math.max(0, p.l / p.m);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 7);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      burstFn = null;
    };
  }, []);
  return <canvas ref={ref} className="olx-fx" aria-hidden="true" />;
}
