import { useEffect, useId, useState } from "react";
import { Logo } from "../../components/Logo";
import { ROLES, type RoleId } from "./content";

// Персонажи «Мафии» — свои рисунки (SVG) в стиле нуар: портрет по пояс, свет со спины, тени на лице и
// живые детали у каждой роли. Анимации — только CSS (transform/opacity/stroke), при «уменьшить
// движение» всё стоит.

const SKIN = { light: "#f0cdb0", mid: "#d9a888", shade: "#a8745a" };

/** Лицо: овал с тенью, уши, брови, глаза, нос, рот. `mood` — выражение. */
function Face({ id, mood, shadow = 0 }: { id: (n: string) => string; mood: "sly" | "calm" | "sharp" | "kind" | "sleepy"; shadow?: number }) {
  const brow = mood === "sly" ? "M84 104 L96 107 M104 107 L116 104" : mood === "sharp" ? "M84 105 L96 103 M104 103 L116 105" : "M85 104 Q90 101 96 103 M104 103 Q110 101 115 104";
  return (
    <g>
      {/* уши */}
      <ellipse cx="72" cy="118" rx="5" ry="9" fill={SKIN.mid} />
      <ellipse cx="128" cy="118" rx="5" ry="9" fill={SKIN.mid} />
      {/* шея с тенью */}
      <path d="M88 140 h24 v22 c-8 4 -16 4 -24 0 Z" fill={SKIN.mid} />
      <path d="M88 142 h24 v8 c-8 6 -16 6 -24 0 Z" fill={SKIN.shade} opacity="0.7" />
      {/* лицо */}
      <path d="M72 108 C72 84 84 76 100 76 C116 76 128 84 128 108 C128 130 116 146 100 146 C84 146 72 130 72 108 Z" fill={`url(#${id("skin")})`} />
      {/* тень сбоку — свет слева */}
      <path d="M112 80 C124 86 128 98 128 108 C128 130 116 146 100 146 C112 138 118 124 116 106 C115 94 112 86 112 80 Z" fill={SKIN.shade} opacity="0.45" />
      {shadow > 0 && <path d="M70 96 C80 112 120 112 130 96 L130 88 L70 88 Z" fill="#000" opacity={shadow} />}
      {/* брови */}
      <path d={brow} stroke="#3a2418" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* глаза */}
      {mood === "sleepy" ? (
        <path d="M86 113 Q91 116 96 113 M104 113 Q109 116 114 113" stroke="#2b1a12" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      ) : (
        <g>
          <ellipse cx="91" cy="113" rx="4.6" ry={mood === "sly" ? 2.4 : 3.4} fill="#fff" />
          <ellipse cx="109" cy="113" rx="4.6" ry={mood === "sly" ? 2.4 : 3.4} fill="#fff" />
          <g className={mood === "sharp" ? "mf-art__look" : undefined}>
            <circle cx="92" cy="113" r="2.4" fill="#2b1a12" />
            <circle cx="110" cy="113" r="2.4" fill="#2b1a12" />
            <circle cx="92.8" cy="112.2" r="0.8" fill="#fff" />
            <circle cx="110.8" cy="112.2" r="0.8" fill="#fff" />
          </g>
          <g className="mf-art__blink">
            <ellipse cx="91" cy="113" rx="5.4" ry="4" fill={SKIN.mid} />
            <ellipse cx="109" cy="113" rx="5.4" ry="4" fill={SKIN.mid} />
          </g>
        </g>
      )}
      {/* нос */}
      <path d="M100 114 C98 122 96 126 99 128 C101 129 104 128 104 127" stroke={SKIN.shade} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {/* рот */}
      {mood === "sly" ? (
        <path d="M92 135 Q100 137 109 132" stroke="#7a3b30" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      ) : mood === "kind" ? (
        <path d="M91 133 Q100 140 109 133" stroke="#8a3e34" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      ) : mood === "sleepy" ? (
        <ellipse cx="100" cy="135" rx="3.5" ry="2.6" fill="#7a3b30" />
      ) : (
        <path d="M92 134 L108 134" stroke="#7a3b30" strokeWidth="2.6" strokeLinecap="round" />
      )}
      {/* румянец / щетина */}
      {mood === "kind" && (
        <g fill="#e88a7a" opacity="0.35">
          <ellipse cx="84" cy="125" rx="5" ry="3" />
          <ellipse cx="116" cy="125" rx="5" ry="3" />
        </g>
      )}
      {(mood === "sly" || mood === "sharp") && <path d="M80 128 C86 144 114 144 120 128 C116 140 84 140 80 128 Z" fill="#3a2a22" opacity="0.18" />}
    </g>
  );
}

/** Фетровая шляпа: поля с тенью, тулья, лента. */
function Fedora({ crown, band, tilt = 0 }: { crown: string; band: string; tilt?: number }) {
  return (
    <g transform={`rotate(${tilt} 100 90)`}>
      <ellipse cx="100" cy="92" rx="50" ry="10" fill="#000" opacity="0.35" />
      <path d="M50 90 C60 82 140 82 150 90 C146 98 54 98 50 90 Z" fill={crown} />
      <path d="M70 88 C68 64 82 54 100 54 C118 54 132 64 130 88 C120 84 80 84 70 88 Z" fill={crown} />
      <path d="M92 56 C98 64 102 64 108 56" stroke="#000" strokeOpacity="0.4" strokeWidth="3" fill="none" />
      <path d="M70 82 C80 78 120 78 130 82 L130 88 C120 84 80 84 70 88 Z" fill={band} />
      <path d="M74 66 C78 60 86 57 94 56" stroke="#fff" strokeOpacity="0.15" strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  );
}

export function RoleArt({ role }: { role: RoleId }) {
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `mf-${name}-${uid}`;
  return (
    <svg className={`mf-art mf-art--${role}`} viewBox="0 0 200 250" role="img" aria-label={ROLES[role].title}>
      <defs>
        <radialGradient id={id("halo")} cx="50%" cy="40%" r="58%">
          <stop offset="0" stopColor="var(--mf-glow)" stopOpacity="0.75" />
          <stop offset="1" stopColor="var(--mf-glow)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("suit")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--mf-suit-top)" />
          <stop offset="1" stopColor="var(--mf-suit-bottom)" />
        </linearGradient>
        <radialGradient id={id("skin")} cx="38%" cy="38%" r="70%">
          <stop offset="0" stopColor={SKIN.light} />
          <stop offset="1" stopColor={SKIN.mid} />
        </radialGradient>
        <linearGradient id={id("rim")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--mf-glow)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--mf-glow)" stopOpacity="0.7" />
        </linearGradient>
      </defs>

      {/* Сцена за спиной */}
      <circle className="mf-art__halo" cx="100" cy="100" r="96" fill={`url(#${id("halo")})`} />
      {role === "mafia" && (
        <g className="mf-art__rain" stroke="#c8d2ff" strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round">
          {Array.from({ length: 14 }, (_, i) => (
            <path key={i} d={`M${(i * 29) % 200} ${(i * 37) % 120} l-6 18`} style={{ animationDelay: `${-(i % 7) * 0.17}s` }} />
          ))}
        </g>
      )}
      {role === "mafia" && (
        <g>
          <path d="M168 250 V40" stroke="#1a1416" strokeWidth="5" />
          <path d="M156 40 h24 l-4 -10 h-16 Z" fill="#1a1416" />
          <ellipse className="mf-art__lamp" cx="168" cy="46" rx="22" ry="16" fill="#ffd27a" opacity="0.35" />
        </g>
      )}
      {role === "don" && (
        <g>
          <path d="M30 250 V90 C30 60 60 46 100 46 C140 46 170 60 170 90 V250 Z" fill="#3a0f14" />
          <path d="M42 250 V96 C42 70 66 58 100 58 C134 58 158 70 158 96 V250" fill="none" stroke="#e3c68c" strokeOpacity="0.4" strokeWidth="2" />
          <g className="mf-art__candle" transform="translate(22 150)">
            <rect x="-4" y="0" width="8" height="40" fill="#f1e3c4" />
            <path className="mf-art__flame" d="M0 0 c-5 -6 -3 -14 0 -18 c3 4 5 12 0 18 Z" fill="#ffb347" />
          </g>
        </g>
      )}
      {role === "commissar" && (
        <g>
          <g fill="#0a1430" opacity="0.6">
            {Array.from({ length: 6 }, (_, r) =>
              Array.from({ length: 5 }, (_, c) => <rect key={`${r}-${c}`} x={c * 44 - (r % 2) * 22} y={30 + r * 22} width="40" height="18" rx="2" />),
            )}
          </g>
          <path className="mf-art__beam" d="M150 150 L210 60 L210 170 Z" fill="var(--mf-glow)" opacity="0.4" />
          <g className="mf-art__qmark" fill="var(--mf-glow)" opacity="0.6" fontFamily="Georgia, serif" fontWeight="700">
            <text x="30" y="70" fontSize="22">?</text>
            <text x="160" y="40" fontSize="16">?</text>
          </g>
        </g>
      )}
      {role === "doctor" && (
        <g>
          <g className="mf-art__cross-float" fill="var(--mf-glow)">
            <path d="M36 80 h6 v-6 h6 v6 h6 v6 h-6 v6 h-6 v-6 h-6 Z" opacity="0.7" />
            <path d="M150 60 h4 v-4 h4 v4 h4 v4 h-4 v4 h-4 v-4 h-4 Z" opacity="0.6" style={{ animationDelay: "-1.4s" }} />
            <path d="M160 120 h5 v-5 h5 v5 h5 v5 h-5 v5 h-5 v-5 h-5 Z" opacity="0.5" style={{ animationDelay: "-2.6s" }} />
          </g>
        </g>
      )}
      {role === "civilian" && (
        <g>
          <circle cx="160" cy="44" r="16" fill="#f3ead0" opacity="0.85" />
          <circle cx="166" cy="40" r="14" fill="var(--mf-bg2)" />
          <g fill="#1e140a">
            <path d="M0 250 V170 h26 v-16 l14 -12 l14 12 v94 Z" />
            <path d="M150 250 V160 l22 -18 l22 18 V250 Z" />
          </g>
          <rect className="mf-art__window" x="12" y="186" width="9" height="11" fill="#ffd27a" />
          <rect className="mf-art__window mf-art__window--late" x="166" y="176" width="10" height="12" fill="#ffd27a" />
          <g className="mf-art__zzz" fill="#fbf6f1" fontFamily="Georgia, serif" fontWeight="700">
            <text x="128" y="78" fontSize="14">z</text>
            <text x="138" y="62" fontSize="18" style={{ animationDelay: "-0.8s" }}>z</text>
            <text x="150" y="44" fontSize="22" style={{ animationDelay: "-1.6s" }}>Z</text>
          </g>
        </g>
      )}

      {/* Фигура «дышит» */}
      <g className="mf-art__body">
        {/* Плечи: пиджак или плащ */}
        {role === "doctor" ? (
          <path d="M22 250 C26 186 60 160 100 158 C140 160 174 186 178 250 Z" fill={`url(#${id("suit")})`} />
        ) : role === "commissar" ? (
          <g>
            <path d="M18 250 C22 184 58 158 100 156 C142 158 178 184 182 250 Z" fill={`url(#${id("suit")})`} />
            {/* поднятый воротник плаща */}
            <path d="M66 150 L82 182 L100 162 L118 182 L134 150 C122 146 78 146 66 150 Z" fill="var(--mf-suit-top)" stroke="#000" strokeOpacity="0.3" />
            <path d="M40 210 h120" stroke="#000" strokeOpacity="0.25" strokeWidth="4" />
          </g>
        ) : (
          <path d="M22 250 C26 186 60 160 100 158 C140 160 174 186 178 250 Z" fill={`url(#${id("suit")})`} />
        )}
        {/* Контровой свет по краю */}
        <path d="M140 166 C160 178 174 200 178 250 L170 250 C166 206 154 184 138 172 Z" fill={`url(#${id("rim")})`} opacity="0.7" />

        {/* Рубашка, галстук, детали костюма */}
        {role === "doctor" && (
          <g>
            <path d="M74 162 L100 206 L126 162 C116 158 108 157 100 157 C92 157 84 158 74 162 Z" fill="#7fbfb4" />
            <path d="M74 162 L92 200 L82 250 M126 162 L108 200 L118 250" stroke="#9ec9c2" strokeWidth="2" fill="none" />
            {/* стетоскоп */}
            <path d="M80 164 C74 200 96 214 100 196 M120 164 C126 200 104 214 100 196" stroke="#22383d" strokeWidth="3.5" fill="none" strokeLinecap="round" />
            <circle cx="100" cy="222" r="9" fill="#cdd9db" stroke="#22383d" strokeWidth="3" />
            <path d="M100 196 V213" stroke="#22383d" strokeWidth="3.5" />
            <rect x="130" y="196" width="22" height="26" rx="3" fill="#e8f4f2" stroke="#9ec9c2" />
            <path d="M136 204 h10 M141 199 v10" stroke="#d64545" strokeWidth="3" />
          </g>
        )}
        {role === "civilian" && (
          <g>
            <path d="M76 162 L100 190 L124 162 C116 158 108 157 100 157 C92 157 84 158 76 162 Z" fill="#e9dcc3" />
            {/* вязаный шарф */}
            <path d="M70 160 C84 172 116 172 130 160 L132 172 C116 184 84 184 68 172 Z" fill="#b8473a" />
            <path d="M112 176 l6 40 l-14 0 l2 -38 Z" fill="#b8473a" />
            <path d="M74 166 h52 M76 172 h48" stroke="#8e3329" strokeWidth="2" />
          </g>
        )}
        {(role === "mafia" || role === "don") && (
          <g>
            <path d="M80 160 L100 200 L120 160 C113 157 107 156 100 156 C93 156 87 157 80 160 Z" fill={role === "don" ? "#f4efe6" : "#2a2224"} />
            <path d="M80 160 L96 214 L66 250 M120 160 L104 214 L134 250" stroke="#000" strokeOpacity="0.5" strokeWidth="2.5" fill="none" />
            {role === "don" ? (
              <g>
                <path d="M88 168 L100 174 L112 168 L112 180 L100 174 L88 180 Z" fill="#141010" />
                <g stroke="#e3c68c" strokeOpacity="0.25" strokeWidth="1.2">
                  <path d="M56 186 L48 250" />
                  <path d="M72 174 L66 250" />
                  <path d="M128 174 L134 250" />
                  <path d="M144 186 L152 250" />
                </g>
              </g>
            ) : (
              <g>
                <path d="M97 164 L103 164 L106 198 L100 206 L94 198 Z" fill="#9b1d2a" />
                {/* роза в петлице */}
                <g className="mf-art__rose" transform="translate(132 192)">
                  <path d="M0 4 L-2 16" stroke="#2d5a2e" strokeWidth="2" />
                  <circle cx="0" cy="0" r="6" fill="#c0182a" />
                  <path d="M-3 -1 a3 3 0 1 1 5 2" stroke="#7a0d18" strokeWidth="1.5" fill="none" />
                </g>
              </g>
            )}
          </g>
        )}
        {role === "commissar" && (
          <g>
            <path d="M88 160 L100 184 L112 160 Z" fill="#f4efe6" />
            <path d="M97 164 L103 164 L105 186 L100 192 L95 186 Z" fill="#2a3f6e" />
            <g className="mf-art__badge" transform="translate(62 204)">
              <path d="M0 -13 L3.8 -4 L13 -4 L5.4 1.6 L8.2 11 L0 5.4 L-8.2 11 L-5.4 1.6 L-13 -4 L-3.8 -4 Z" fill="var(--mf-accent)" stroke="#6b5414" strokeWidth="1.2" />
              <path className="mf-art__badge-shine" d="M-4 -8 L2 -2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            </g>
          </g>
        )}

        {/* Голова */}
        {role === "mafia" && <Face id={id} mood="sly" shadow={0.5} />}
        {role === "don" && <Face id={id} mood="sly" />}
        {role === "commissar" && <Face id={id} mood="sharp" shadow={0.2} />}
        {role === "doctor" && <Face id={id} mood="kind" />}
        {role === "civilian" && <Face id={id} mood="sleepy" />}

        {/* Волосы, шляпы, атрибуты */}
        {role === "mafia" && (
          <g>
            <ellipse className="mf-art__eyeglow" cx="91" cy="113" rx="7" ry="3" fill="var(--mf-accent)" opacity="0.5" />
            <ellipse className="mf-art__eyeglow" cx="109" cy="113" rx="7" ry="3" fill="var(--mf-accent)" opacity="0.5" />
            <Fedora crown="#151012" band="#9b1d2a" tilt={-6} />
            {/* сигарета и дым */}
            <path d="M106 134 l24 3" stroke="#f1e7d8" strokeWidth="4.5" strokeLinecap="round" />
            <path d="M126 136.5 l4 0.5" stroke="#d98a4a" strokeWidth="4.5" strokeLinecap="round" />
            <circle className="mf-art__ember" cx="131" cy="137" r="3" fill="#ff6a2a" />
            <g className="mf-art__smoke" fill="none" stroke="#e8e0d6" strokeWidth="3.5" strokeLinecap="round">
              <path d="M134 130 c8 -10 -6 -18 2 -28 c8 -10 -4 -18 4 -28" />
              <path className="mf-art__smoke--late" d="M137 128 c10 -8 -4 -20 6 -30 c8 -8 -2 -16 6 -24" />
            </g>
          </g>
        )}
        {role === "don" && (
          <g>
            {/* седые виски и зачёс */}
            <path d="M72 102 C70 80 84 70 100 70 C116 70 130 80 128 102 C124 88 112 82 100 82 C88 82 76 88 72 102 Z" fill="#2a2220" />
            <path d="M72 100 C72 94 74 90 76 88 L76 104 Z M128 100 C128 94 126 90 124 88 L124 104 Z" fill="#b9b2a8" />
            {/* сигара и кольца дыма */}
            <path d="M86 134 l-26 6" stroke="#5a3a22" strokeWidth="6" strokeLinecap="round" />
            <circle className="mf-art__ember" cx="58" cy="140.5" r="3" fill="#ff6a2a" />
            <g fill="none" stroke="#e8e0d6" strokeWidth="2.5">
              <ellipse className="mf-art__ring" cx="52" cy="122" rx="8" ry="5" />
              <ellipse className="mf-art__ring mf-art__ring--late" cx="52" cy="122" rx="8" ry="5" />
            </g>
            {/* перстень */}
            <g transform="translate(146 222)">
              <ellipse cx="0" cy="0" rx="14" ry="17" fill={`url(#${id("skin")})`} />
              <path d="M-12 -4 h24" stroke={SKIN.shade} strokeWidth="2" />
              <circle cx="2" cy="-7" r="6.5" fill="var(--mf-accent)" stroke="#5c4310" strokeWidth="1.5" />
              <circle cx="2" cy="-7" r="3" fill="#b31d2a" />
              <path className="mf-art__sparkle" d="M2 -22 l2.2 8 l8 2.2 l-8 2.2 l-2.2 8 l-2.2 -8 l-8 -2.2 l8 -2.2 Z" fill="#fff6d8" />
            </g>
          </g>
        )}
        {role === "commissar" && (
          <g>
            <Fedora crown="#4a3b2e" band="#2a1f17" tilt={5} />
            {/* фонарь с лучом */}
            <g transform="translate(148 156) rotate(-35)">
              <rect x="-6" y="-4" width="26" height="12" rx="3" fill="#2b2b33" />
              <rect x="18" y="-6" width="8" height="16" rx="2" fill="#5b5b66" />
              <ellipse cx="26" cy="2" rx="2" ry="7" fill="#fff6c8" />
            </g>
            {/* лупа */}
            <g transform="translate(46 168)">
              <path d="M6 10 L-8 30" stroke="#3b2f25" strokeWidth="7" strokeLinecap="round" />
              <circle cx="14" cy="-2" r="16" fill="#cfe6ff" fillOpacity="0.3" stroke="#c9a15f" strokeWidth="4" />
              <path className="mf-art__glint" d="M5 -9 a11 11 0 0 1 12 -4" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
            </g>
          </g>
        )}
        {role === "doctor" && (
          <g>
            {/* волосы и шапочка с крестом */}
            <path d="M72 104 C70 84 82 74 100 74 C118 74 130 84 128 104 C122 92 112 88 100 88 C88 88 78 92 72 104 Z" fill="#5a3a26" />
            <path d="M74 92 C74 70 86 62 100 62 C114 62 126 70 126 92 C116 86 84 86 74 92 Z" fill="#f2faf8" />
            <path d="M95 70 h10 v6 h6 v8 h-6 v6 h-10 v-6 h-6 v-8 h6 Z" transform="translate(0 -2) scale(0.9) translate(11 8)" fill="#d64545" />
            {/* зеркальце на лбу с бликом */}
            <circle cx="116" cy="94" r="7" fill="#dfe8ea" stroke="#9aa9ac" strokeWidth="2" />
            <circle className="mf-art__glint" cx="114" cy="92" r="2.4" fill="#fff" />
            {/* монитор с кардиограммой и сердцем */}
            <g transform="translate(24 232)">
              <rect x="0" y="-14" width="152" height="24" rx="8" fill="#062023" opacity="0.85" />
              <path className="mf-art__ecg" d="M6 -2 H52 l7 -10 l8 20 l8 -16 l5 6 H146" stroke="#7df2c8" strokeWidth="2.6" fill="none" strokeLinejoin="round" strokeLinecap="round" />
            </g>
            <path className="mf-art__heart" d="M154 182 c-6 -8 -18 -3 -13 7 c3 5 13 11 13 11 c0 0 10 -6 13 -11 c5 -10 -7 -15 -13 -7 Z" fill="#e2474f" />
          </g>
        )}
        {role === "civilian" && (
          <g>
            {/* ночной колпак */}
            <path d="M72 100 C70 78 84 70 100 70 C116 70 130 78 128 100 C120 92 80 92 72 100 Z" fill="#7a5a3a" />
            <path className="mf-art__cap" d="M70 98 C70 70 92 56 112 60 C130 64 150 80 158 104 C146 92 134 88 128 98 C112 90 86 90 70 98 Z" fill="#3e5a8a" />
            <path d="M70 98 C86 90 112 90 128 98" stroke="#e9dcc3" strokeWidth="6" fill="none" strokeLinecap="round" />
            <circle className="mf-art__pompom" cx="160" cy="106" r="7" fill="#e9dcc3" />
            {/* фонарь */}
            <g transform="translate(52 196)">
              <path d="M0 -30 V-18" stroke="#2b2118" strokeWidth="3" />
              <path d="M-8 -18 h16 l-2 -6 h-12 Z" fill="#2b2118" />
              <rect x="-11" y="-18" width="22" height="30" rx="4" fill="#2b2118" />
              <rect className="mf-art__glass" x="-7" y="-14" width="14" height="22" rx="2" fill="#ffd27a" opacity="0.4" />
              <path className="mf-art__flame" d="M0 6 c-6 -4 -4 -12 0 -16 c4 4 6 12 0 16 Z" fill="#ffb347" />
            </g>
          </g>
        )}
      </g>
    </svg>
  );
}

/** Рубашка карты: узор и монограмма JoyRest. */
export function CardBack({ city }: { city: string }) {
  return (
    <div className="mf-card__face mf-card__back" aria-hidden="true">
      <div className="mf-card__pattern" />
      <span className="mf-card__back-title">Мафия</span>
      <span className="mf-card__mono">
        <Logo kind="full" tone="gold" title="" />
      </span>
      <span className="mf-card__back-city">{city}</span>
    </div>
  );
}

export function RoleFace({ role, seat, family }: { role: RoleId; seat?: number; family?: Array<{ name: string; role: RoleId }> }) {
  const info = ROLES[role];
  return (
    <div className={`mf-card__face mf-card__front mf-role--${role}`}>
      <div className="mf-card__frame" aria-hidden="true" />
      <div className="mf-card__sheen" aria-hidden="true" />
      {seat ? <span className="mf-card__seat">№ {seat}</span> : null}
      <span className={info.side === "mafia" ? "mf-card__side is-mafia" : "mf-card__side"}>{info.side === "mafia" ? "Мафия" : "Город"}</span>
      <RoleArt role={role} />
      <h3 className="mf-card__title">{info.title}</h3>
      <p className="mf-card__power">{info.power}</p>
      {family && family.length > 0 && (
        <p className="mf-card__family">
          Ваша семья: {family.map((f) => `${f.name}${f.role === "don" ? " (Дон)" : ""}`).join(", ")}
        </p>
      )}
    </div>
  );
}

/**
 * Карта роли на телефоне: лежит рубашкой вверх, касание — переворот (через 6 с сама закрывается,
 * чтобы сосед не подсмотрел). `open` — показать сразу (экран итогов).
 */
export function RoleCardView({ role, seat, family, city, open = false }: { role: RoleId; seat?: number; family?: Array<{ name: string; role: RoleId }>; city: string; open?: boolean }) {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (!shown || open) return;
    const t = window.setTimeout(() => setShown(false), 6000);
    return () => window.clearTimeout(t);
  }, [shown, open]);
  return (
    <button
      type="button"
      className={shown ? "mf-card is-open" : "mf-card"}
      aria-pressed={shown}
      aria-label={shown ? `Ваша роль: ${ROLES[role].title}. Нажмите, чтобы закрыть` : "Нажмите, чтобы посмотреть свою роль"}
      onClick={() => !open && setShown((v) => !v)}
    >
      <span className="mf-card__inner">
        <CardBack city={city} />
        <RoleFace role={role} seat={seat} family={family} />
      </span>
    </button>
  );
}
