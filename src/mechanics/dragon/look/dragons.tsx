// Рисунки драконов нового экрана зала (решение владельца 15 октября 2026, макет «Бой с драконом — экран зала»):
// взрослый — тёмный змий анфас с горном в груди и третьим глазом на лбу (луч), детский — круглый «Дракоша» со
// звёздочкой на лбу. Цвета — переменные окраса (`--dg-*`) из dragon.css, анимации — только transform/opacity.
import { useId } from "react";

/** Точки рисунков в координатах viewBox 600×400: откуда бьёт луч и дыхание. */
export const MOUTH_Y = { adult: 180, kid: 212 } as const;
export const BROW_Y = 112;

export function AdultDragon() {
  const uid = useId().replace(/:/g, "");
  const chest = `dgChest${uid}`;
  const hide = `dgHide${uid}`;
  const memb = `dgMemb${uid}`;
  const glow = `dgGlow${uid}`;
  const hot = `dgHot${uid}`;
  return (
    <svg className="dg-svg" viewBox="0 0 600 400" aria-hidden="true">
      <defs>
        <radialGradient id={chest} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="var(--dg-core)" />
          <stop offset=".3" stopColor="var(--dg-hot)" />
          <stop offset=".7" stopColor="var(--dg-deep)" stopOpacity=".6" />
          <stop offset="1" stopColor="var(--dg-deep)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={hide} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--dg-hide1)" />
          <stop offset="1" stopColor="var(--dg-hide2)" />
        </linearGradient>
        <linearGradient id={memb} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--dg-memb)" />
          <stop offset=".6" stopColor="var(--dg-hide2)" />
          <stop offset="1" stopColor="#0b0604" />
        </linearGradient>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={hot} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g className="dg-breathe">
        <g className="dg-wing-l">
          <path d="M285 230 L70 30 L118 118 L18 92 L98 170 L8 178 L112 222 L42 262 L168 252 L120 300 L250 262 Z" fill={`url(#${memb})`} stroke="var(--dg-hot)" strokeOpacity=".55" strokeWidth="2" strokeLinejoin="round" />
          <path d="M285 230 L70 30 M285 230 L18 92 M285 230 L8 178 M285 230 L42 262 M285 230 L120 300" stroke="var(--dg-rib)" strokeWidth="3" fill="none" />
        </g>
        <g className="dg-wing-r">
          <path d="M315 230 L530 30 L482 118 L582 92 L502 170 L592 178 L488 222 L558 262 L432 252 L480 300 L350 262 Z" fill={`url(#${memb})`} stroke="var(--dg-hot)" strokeOpacity=".55" strokeWidth="2" strokeLinejoin="round" />
          <path d="M315 230 L530 30 M315 230 L582 92 M315 230 L592 178 M315 230 L558 262 M315 230 L480 300" stroke="var(--dg-rib)" strokeWidth="3" fill="none" />
        </g>
        <path d="M300 395 Q210 380 250 330 Q190 360 170 395 Z" fill="var(--dg-hide2)" />
        <path d="M232 238 Q300 205 368 238 L392 340 Q300 380 208 340 Z" fill={`url(#${hide})`} stroke="var(--dg-rib)" strokeWidth="2" />
        <ellipse className="dg-furnace" cx="300" cy="292" rx="70" ry="52" fill={`url(#${chest})`} filter={`url(#${glow})`} />
        <path d="M268 262 L300 252 L332 262 M262 284 L300 274 L338 284 M266 306 L300 298 L334 306" stroke="var(--dg-hide2)" strokeWidth="5" fill="none" strokeLinecap="round" opacity=".8" />
        <path d="M215 330 L196 372 L210 366 L214 380 L226 366 L238 376 L240 340 Z M385 330 L404 372 L390 366 L386 380 L374 366 L362 376 L360 340 Z" fill="var(--dg-hide2)" stroke="var(--dg-rib)" strokeWidth="1.5" />
        <path d="M282 168 L318 168 L338 240 L262 240 Z" fill={`url(#${hide})`} stroke="var(--dg-rib)" strokeWidth="2" />
        <path d="M262 122 L214 30 L250 72 L240 18 L282 104 Z" fill="var(--dg-hide2)" stroke="var(--dg-horn)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M338 122 L386 30 L350 72 L360 18 L318 104 Z" fill="var(--dg-hide2)" stroke="var(--dg-horn)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M300 186 L272 172 L252 132 L262 100 L300 88 L338 100 L348 132 L328 172 Z" fill={`url(#${hide})`} stroke="var(--dg-rib)" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M300 88 L300 140 M262 100 L278 126 M338 100 L322 126" stroke="var(--dg-hide2)" strokeWidth="3" />
        <path className="dg-eye" d="M266 128 L292 134 L282 142 Z" fill="var(--dg-eye)" filter={`url(#${glow})`} />
        <path className="dg-eye" d="M334 128 L308 134 L318 142 Z" fill="var(--dg-eye)" filter={`url(#${glow})`} />
        <path className="dg-furnace" d="M282 172 L300 190 L318 172" stroke="var(--dg-hot)" strokeWidth="2.5" fill="none" filter={`url(#${glow})`} />
        <circle className="dg-furnace" cx="292" cy="162" r="2.6" fill="var(--dg-hot)" />
        <circle className="dg-furnace" cx="308" cy="162" r="2.6" fill="var(--dg-hot)" />
        <g className="dg-eye3">
          <path d="M300 98 Q311 112 300 126 Q289 112 300 98 Z" fill="var(--dg-core)" filter={`url(#${hot})`} />
          <ellipse cx="300" cy="112" rx="2" ry="8" fill="var(--dg-deep)" />
        </g>
      </g>
    </svg>
  );
}

export function KidDragon() {
  return (
    <svg className="dg-svg" viewBox="0 0 600 400" aria-hidden="true">
      <g className="dg-bob">
        <path d="M370 320 Q470 330 460 260 Q455 230 480 225 Q500 240 485 270 Q480 360 360 345 Z" fill="var(--dk-body2)" />
        <path className="dg-kwing-l" d="M240 230 Q160 160 150 220 Q130 210 140 250 Q170 265 240 260 Z" fill="var(--dk-wing)" stroke="var(--dk-wing2)" strokeWidth="5" />
        <path className="dg-kwing-r" d="M360 230 Q440 160 450 220 Q470 210 460 250 Q430 265 360 260 Z" fill="var(--dk-wing)" stroke="var(--dk-wing2)" strokeWidth="5" />
        <ellipse cx="300" cy="285" rx="98" ry="88" fill="var(--dk-body)" />
        <ellipse cx="300" cy="300" rx="62" ry="64" fill="#fff3c2" />
        <path d="M262 270 Q300 262 338 270 M258 298 Q300 290 342 298 M264 326 Q300 318 336 326" stroke="#f3d98a" strokeWidth="5" fill="none" strokeLinecap="round" />
        <ellipse cx="240" cy="368" rx="30" ry="18" fill="var(--dk-body2)" />
        <ellipse cx="360" cy="368" rx="30" ry="18" fill="var(--dk-body2)" />
        <path d="M250 105 Q240 60 262 70 Q270 90 268 108 Z M350 105 Q360 60 338 70 Q330 90 332 108 Z" fill="#ffd23f" stroke="#f0a400" strokeWidth="4" />
        <circle cx="300" cy="165" r="80" fill="var(--dk-body)" />
        <ellipse cx="300" cy="200" rx="52" ry="34" fill="var(--dk-snout)" />
        <g className="dg-blink">
          <ellipse cx="268" cy="150" rx="20" ry="24" fill="#fff" />
          <circle cx="272" cy="154" r="12" fill="#3b2a63" />
          <circle cx="276" cy="149" r="4.5" fill="#fff" />
        </g>
        <g className="dg-blink">
          <ellipse cx="332" cy="150" rx="20" ry="24" fill="#fff" />
          <circle cx="328" cy="154" r="12" fill="#3b2a63" />
          <circle cx="332" cy="149" r="4.5" fill="#fff" />
        </g>
        <ellipse cx="238" cy="190" rx="14" ry="9" fill="#ff9cc6" opacity=".8" />
        <ellipse cx="362" cy="190" rx="14" ry="9" fill="#ff9cc6" opacity=".8" />
        <circle cx="288" cy="190" r="4" fill="var(--dk-nostril)" />
        <circle cx="312" cy="190" r="4" fill="var(--dk-nostril)" />
        <path d="M276 208 Q300 228 324 208" stroke="#3b2a63" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M292 214 L296 224 L300 215 Z" fill="#fff" />
        <circle className="dg-puff" cx="284" cy="176" r="10" fill="#fff" opacity=".9" />
        <circle className="dg-puff dg-puff--2" cx="316" cy="176" r="12" fill="#fff" opacity=".9" />
        <polygon className="dg-eye3 dg-star3" points="300,96 304.1,106.3 315.2,107.1 306.7,114.2 309.4,124.9 300,119 290.6,124.9 293.3,114.2 284.8,107.1 295.9,106.3" fill="#ffd23f" stroke="#f0a400" strokeWidth="3" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
