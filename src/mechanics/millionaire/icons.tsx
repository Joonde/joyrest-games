// «Миллионер»: контурные значки подсказок (цвет — currentColor), одинаковые на экране, пульте и телефоне.
import { useId } from "react";
import type { LifelineId } from "./content";

export function LifelineIcon({ id, size = "1em" }: { id: LifelineId; size?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (id) {
    case "fifty":
      // Круг, рассечённый по диагонали: в каждой половине — «50».
      return (
        <svg {...common}>
          <circle cx="24" cy="24" r="19" />
          <path d="M11 37L37 11" strokeWidth="2.4" />
          <text x="17" y="23" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" stroke="none" fontFamily="Jost, sans-serif">
            50
          </text>
          <text x="31" y="35" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" stroke="none" fontFamily="Jost, sans-serif">
            50
          </text>
        </svg>
      );
    case "audience":
      return (
        <svg {...common}>
          <circle cx="16" cy="17" r="5" />
          <circle cx="32" cy="17" r="5" />
          <circle cx="24" cy="14" r="5.5" />
          <path d="M6 37c0-6 4.5-10 10-10M42 37c0-6-4.5-10-10-10M14 39c0-7 4.5-11 10-11s10 4 10 11" />
          <path d="M24 3v4M38 6l-2 3M10 6l2 3" strokeWidth="2.4" />
        </svg>
      );
    case "call":
      return (
        <svg {...common}>
          <path d="M14 7l6 9-4 4c2 5 6 9 11 11l4-4 9 6-4 7C22 40 8 26 7 11z" />
          <path d="M30 8a10 10 0 0 1 10 10M30 14a4 4 0 0 1 4 4" strokeWidth="2.4" />
        </svg>
      );
    case "mistake":
      return (
        <svg {...common}>
          <path d="M24 5l15 6v11c0 10-7 17-15 21C16 39 9 32 9 22V11z" />
          <path d="M17 24l5 5 9-10" />
        </svg>
      );
    case "swap":
      return (
        <svg {...common}>
          <path d="M9 19a15 15 0 0 1 27-6M39 29a15 15 0 0 1-27 6" />
          <path d="M37 5v8h-8M11 43v-8h8" />
        </svg>
      );
    case "host":
      return (
        <svg {...common}>
          <path d="M17 31c-3-3-5-6-5-11a12 12 0 0 1 24 0c0 5-2 8-5 11v4H17z" />
          <path d="M18 40h12M20 44h8" />
          <path d="M24 13v5M21 21l3 3 3-3" strokeWidth="2.4" />
        </svg>
      );
  }
}

/**
 * Своя эмблема игры для заставки экрана зала (не логотип телешоу): золотой медальон, по кругу 12 делений-ступеней
 * (несгораемые 4 и 8 — крупнее), в центре гранёный бриллиант со вспышками.
 */
export function MillionaireEmblem({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const gold = `mg${id}`;
  const gem = `mgem${id}`;
  const glow = `mglow${id}`;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = ((i * 30 - 90) * Math.PI) / 180;
    const big = i === 3 || i === 7 || i === 11;
    const r1 = big ? 80 : 84;
    return <line key={i} x1={100 + Math.cos(a) * r1} y1={100 + Math.sin(a) * r1} x2={100 + Math.cos(a) * 92} y2={100 + Math.sin(a) * 92} strokeWidth={big ? 5 : 3} />;
  });
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F3DFAE" />
          <stop offset="0.5" stopColor="#C9A15F" />
          <stop offset="1" stopColor="#F3DFAE" />
        </linearGradient>
        <linearGradient id={gem} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E9F2FF" />
          <stop offset="0.55" stopColor="#8FB4F2" />
          <stop offset="1" stopColor="#3B4FB8" />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset="0" stopColor="#8FB4F2" stopOpacity="0.55" />
          <stop offset="1" stopColor="#8FB4F2" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="98" fill={`url(#${glow})`} />
      <circle cx="100" cy="100" r="94" fill="none" stroke={`url(#${gold})`} strokeWidth="4" />
      <circle cx="100" cy="100" r="74" fill="#0b0d2e" fillOpacity="0.75" stroke={`url(#${gold})`} strokeWidth="2.5" />
      <g stroke={`url(#${gold})`} strokeLinecap="round">{ticks}</g>
      <g strokeLinejoin="round">
        <path d="M64 86 L80 66 H120 L136 86 L100 138 Z" fill={`url(#${gem})`} stroke="#F3DFAE" strokeWidth="2.5" />
        <path d="M64 86 H136 M80 66 L92 86 L100 66 L108 86 L120 66 M92 86 L100 138 L108 86" fill="none" stroke="#F3DFAE" strokeOpacity="0.85" strokeWidth="1.8" />
      </g>
      <g fill="#F3DFAE">
        <path d="M142 58 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" />
        <path d="M56 120 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" opacity="0.8" />
      </g>
    </svg>
  );
}
