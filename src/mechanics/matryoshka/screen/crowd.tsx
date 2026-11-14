/**
 * Толпа фишек на холсте (docs/matryoshka.md: «толпа на холсте»): больше 60 фишек на поле «Замри!» рисуются одним `<canvas>` —
 * каждая фишка один раз растрируется в спрайт (кружок цвета, смайлик, кольцо пойманного), дальше на кадр — только `drawImage`
 * со сдвигом. Позиции плавно доезжают до новых за время между сводками (≤ 5 раз в секунду). До 60 фишек — DOM (`trials.tsx`).
 */
import { useEffect, useRef } from "react";
import { chipColor } from "./model";

export interface CrowdItem {
  num: number;
  mark: string;
  /** Центр фишки в долях поля 0…1. */
  x: number;
  y: number;
  caught: boolean;
  done: boolean;
  hold: boolean;
  offline: boolean;
}

interface Pos {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t0: number;
}

const MOVE_MS = 240;

/** Спрайт фишки (кэш по виду и размеру в пикселях устройства). */
const sprites = new Map<string, HTMLCanvasElement>();
function sprite(it: CrowdItem, size: number, night: boolean): HTMLCanvasElement {
  const state = it.caught ? "c" : it.done ? "d" : it.offline ? "o" : "n";
  const key = `${it.num}|${it.mark}|${size}|${state}|${night ? 1 : 0}`;
  const known = sprites.get(key);
  if (known) return known;
  const pad = Math.ceil(size * 0.3);
  const c = document.createElement("canvas");
  c.width = size + pad * 2;
  c.height = size + pad * 2;
  const g = c.getContext("2d");
  if (g) {
    const r = size / 2;
    const cx = c.width / 2;
    const cy = c.height / 2;
    if (it.caught) {
      g.beginPath();
      g.arc(cx, cy, r + size * 0.16, 0, Math.PI * 2);
      g.fillStyle = night ? "rgba(242,167,156,.45)" : "rgba(166,68,58,.28)";
      g.fill();
      g.beginPath();
      g.arc(cx, cy, r + size * 0.08, 0, Math.PI * 2);
      g.fillStyle = night ? "#F2A79C" : "#A6443A";
      g.fill();
    } else if (night) {
      g.shadowColor = chipColor(it.num);
      g.shadowBlur = size * 0.3;
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = night ? "#221E1B" : "#FBF6F1";
    g.fill();
    g.shadowBlur = 0;
    g.beginPath();
    g.arc(cx, cy, r - size * 0.065, 0, Math.PI * 2);
    g.fillStyle = chipColor(it.num);
    g.fill();
    g.globalAlpha = it.offline ? 0.5 : 1;
    g.font = `${Math.round(size * 0.56)}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#221E1B";
    g.fillText(it.mark, cx, cy + size * 0.04);
    g.globalAlpha = 1;
  }
  if (sprites.size > 2000) sprites.clear();
  sprites.set(key, c);
  return c;
}

/** Холст толпы: `items` — новые места фишек; размер фишки — `chip` (доля ширины поля). */
export function Crowd({ items, chip, night, still }: { items: readonly CrowdItem[]; chip: number; night: boolean; still: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const pos = useRef(new Map<number, Pos>());
  const latest = useRef(items);
  latest.current = items;
  const raf = useRef(0);

  // Новые места: каждая фишка поедет от того места, где она сейчас на экране.
  useEffect(() => {
    const t = performance.now();
    const map = pos.current;
    for (const it of items) {
      const p = map.get(it.num);
      if (!p) map.set(it.num, { x0: it.x, y0: it.y, x1: it.x, y1: it.y, t0: t });
      else {
        const k = still ? 1 : Math.min(1, (t - p.t0) / MOVE_MS);
        map.set(it.num, { x0: p.x0 + (p.x1 - p.x0) * k, y0: p.y0 + (p.y1 - p.y0) * k, x1: it.x, y1: it.y, t0: t });
      }
    }
    for (const n of [...map.keys()]) if (!items.some((it) => it.num === n)) map.delete(n);
    cancelAnimationFrame(raf.current);
    const draw = () => {
      const c = ref.current;
      const g = c?.getContext("2d");
      if (!c || !g) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(c.clientWidth * dpr);
      const h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      g.clearRect(0, 0, w, h);
      const size = Math.max(8, Math.round(chip * w));
      const now = performance.now();
      let moving = false;
      for (const it of latest.current) {
        const p = pos.current.get(it.num);
        if (!p) continue;
        const k = still ? 1 : Math.min(1, (now - p.t0) / MOVE_MS);
        if (k < 1) moving = true;
        const x = (p.x0 + (p.x1 - p.x0) * k) * w;
        const y = (p.y0 + (p.y1 - p.y0) * k) * h;
        const s = sprite(it, size, night);
        g.drawImage(s, Math.round(x - s.width / 2), Math.round(y - s.height / 2));
      }
      if (moving) raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [items, chip, night, still]);

  return <canvas ref={ref} className="mts-crowd" aria-hidden="true" />;
}
