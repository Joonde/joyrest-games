import { useEffect, useId, useState } from "react";
import { ROLES, type RoleId } from "./content";

// Персонажи «Мафии» — свои рисунки (SVG) с живыми деталями: дым сигареты, блик перстня Дона, луч
// фонаря Комиссара, кардиограмма Доктора, огонёк фонаря мирного жителя. Анимации — только CSS
// (transform/opacity/stroke), при «уменьшить движение» они стоят.

export function RoleArt({ role }: { role: RoleId }) {
  const uid = useId().replace(/:/g, "");
  const g = (name: string) => `mf-${name}-${uid}`;
  return (
    <svg className={`mf-art mf-art--${role}`} viewBox="0 0 200 240" role="img" aria-label={ROLES[role].title}>
      <defs>
        <radialGradient id={g("halo")} cx="50%" cy="38%" r="60%">
          <stop offset="0" stopColor="var(--mf-glow)" stopOpacity="0.85" />
          <stop offset="1" stopColor="var(--mf-glow)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g("suit")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--mf-suit-top)" />
          <stop offset="1" stopColor="var(--mf-suit-bottom)" />
        </linearGradient>
        <linearGradient id={g("skin")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2d2b4" />
          <stop offset="1" stopColor="#c99a78" />
        </linearGradient>
      </defs>
      <circle className="mf-art__halo" cx="100" cy="92" r="92" fill={`url(#${g("halo")})`} />
      {role === "commissar" && <path className="mf-art__beam" d="M132 128 L200 40 L200 140 Z" fill="var(--mf-glow)" opacity="0.35" />}
      {role === "civilian" && (
        <g className="mf-art__town" fill="var(--mf-suit-bottom)" opacity="0.55">
          <path d="M0 200 V150 h22 v-18 h18 v18 h14 V200 Z" />
          <path d="M150 200 V140 l16 -14 l16 14 V200 Z" />
          <rect className="mf-art__window" x="160" y="150" width="8" height="10" fill="#ffd27a" />
          <rect className="mf-art__window mf-art__window--late" x="8" y="160" width="7" height="9" fill="#ffd27a" />
        </g>
      )}

      {/* Плечи и костюм */}
      <path d="M28 240 C30 180 62 158 100 156 C138 158 170 180 172 240 Z" fill={`url(#${g("suit")})`} />
      {role === "don" && (
        <g stroke="var(--mf-accent)" strokeOpacity="0.35" strokeWidth="1.5">
          <path d="M60 175 L52 240" />
          <path d="M76 166 L72 240" />
          <path d="M124 166 L128 240" />
          <path d="M140 175 L148 240" />
        </g>
      )}
      {/* Рубашка и галстук / бабочка */}
      {role === "doctor" ? (
        <g>
          <path d="M70 162 L100 200 L130 162 C120 158 110 157 100 157 C90 157 80 158 70 162 Z" fill="#e8f4f2" />
          <path d="M84 160 C84 190 116 190 116 160" fill="none" stroke="#2c4d55" strokeWidth="3" />
          <circle cx="116" cy="188" r="6" fill="none" stroke="#2c4d55" strokeWidth="3" />
        </g>
      ) : role === "civilian" ? (
        <path d="M76 162 L100 186 L124 162 C116 158 108 157 100 157 C92 157 84 158 76 162 Z" fill="#e9dcc3" />
      ) : (
        <g>
          <path d="M80 160 L100 196 L120 160 C113 157 107 156 100 156 C93 156 87 157 80 160 Z" fill="#f4efe6" />
          {role === "don" ? (
            <path d="M88 166 L100 172 L112 166 L112 178 L100 172 L88 178 Z" fill="#141010" />
          ) : (
            <path d="M97 164 L103 164 L106 196 L100 204 L94 196 Z" fill={role === "commissar" ? "#2a3f6e" : "#8f1f2a"} />
          )}
        </g>
      )}
      {/* Голова */}
      <path d="M86 140 h28 v20 h-28 Z" fill={`url(#${g("skin")})`} />
      <ellipse cx="100" cy="112" rx="30" ry="36" fill={`url(#${g("skin")})`} />
      {/* Лицо: у мафии — тень полей шляпы и светящиеся глаза */}
      {role === "mafia" || role === "don" ? (
        <g>
          <path d="M68 104 C80 118 120 118 132 104 L132 96 L68 96 Z" fill="#000" opacity="0.55" />
          <ellipse className="mf-art__eye" cx="88" cy="108" rx="5" ry="2.4" fill="var(--mf-accent)" />
          <ellipse className="mf-art__eye" cx="112" cy="108" rx="5" ry="2.4" fill="var(--mf-accent)" />
          <path d="M90 130 Q100 134 110 130" stroke="#5a3a2a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>
      ) : (
        <g>
          <circle cx="89" cy="110" r="3.2" fill="#2b211c" />
          <circle cx="111" cy="110" r="3.2" fill="#2b211c" />
          <circle className="mf-art__blink" cx="89" cy="110" r="3.6" fill={`url(#${g("skin")})`} />
          <circle className="mf-art__blink" cx="111" cy="110" r="3.6" fill={`url(#${g("skin")})`} />
          <path d="M91 128 Q100 134 109 128" stroke="#7a4a3a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>
      )}

      {/* Шляпы и атрибуты */}
      {role === "mafia" && (
        <g>
          <path d="M56 92 C62 86 138 86 144 92 C140 98 60 98 56 92 Z" fill="#141010" />
          <path d="M72 90 C70 66 82 60 100 60 C118 60 130 66 128 90 Z" fill="#1d1717" />
          <path d="M72 84 h56 v6 h-56 Z" fill="var(--mf-accent)" opacity="0.9" />
          {/* Сигарета и дым */}
          <path d="M108 128 l22 4" stroke="#f1e7d8" strokeWidth="4" strokeLinecap="round" />
          <circle className="mf-art__ember" cx="131" cy="132" r="2.6" fill="#ff7a3a" />
          <g className="mf-art__smoke" fill="none" stroke="#e8e0d6" strokeWidth="3" strokeLinecap="round">
            <path d="M133 126 c6 -10 -6 -16 0 -26 c6 -10 -4 -16 2 -26" />
            <path className="mf-art__smoke--late" d="M136 124 c8 -8 -4 -18 4 -28 c6 -8 -2 -14 4 -22" />
          </g>
        </g>
      )}
      {role === "don" && (
        <g>
          <path d="M50 92 C58 84 142 84 150 92 C144 100 56 100 50 92 Z" fill="#0d0b0b" />
          <path d="M68 90 C66 62 80 54 100 54 C120 54 134 62 132 90 Z" fill="#161212" />
          <path d="M68 82 h64 v8 h-64 Z" fill="var(--mf-accent)" />
          {/* Перстень с бликом */}
          <g transform="translate(140 212)">
            <ellipse cx="0" cy="0" rx="13" ry="16" fill={`url(#${g("skin")})`} />
            <circle cx="2" cy="-6" r="6" fill="var(--mf-accent)" stroke="#5c4310" strokeWidth="1.5" />
            <path className="mf-art__sparkle" d="M2 -20 l2 8 l8 2 l-8 2 l-2 8 l-2 -8 l-8 -2 l8 -2 Z" fill="#fff6d8" />
          </g>
        </g>
      )}
      {role === "commissar" && (
        <g>
          <path d="M58 92 C64 86 136 86 142 92 C138 99 62 99 58 92 Z" fill="#3b2f25" />
          <path d="M74 90 C72 70 84 64 100 64 C116 64 128 70 126 90 Z" fill="#4a3b2e" />
          <path d="M74 84 h52 v6 h-52 Z" fill="#2a1f17" />
          {/* Значок */}
          <g className="mf-art__badge" transform="translate(68 196)">
            <path d="M0 -12 L3.5 -3.7 L12 -3.7 L5 1.5 L7.5 10 L0 5 L-7.5 10 L-5 1.5 L-12 -3.7 L-3.5 -3.7 Z" fill="var(--mf-accent)" stroke="#6b5414" strokeWidth="1" />
          </g>
          {/* Лупа */}
          <g transform="translate(138 160)">
            <path d="M-6 6 L-20 22" stroke="#3b2f25" strokeWidth="7" strokeLinecap="round" />
            <circle cx="4" cy="-4" r="15" fill="#cfe6ff" fillOpacity="0.35" stroke="#c9a15f" strokeWidth="4" />
            <path className="mf-art__glint" d="M-4 -10 a10 10 0 0 1 10 -4" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          </g>
        </g>
      )}
      {role === "doctor" && (
        <g>
          {/* Шапочка и зеркальце */}
          <path d="M70 92 C70 70 84 66 100 66 C116 66 130 70 130 92 Z" fill="#e8f4f2" />
          <path d="M96 76 h8 v-6 h6 v6 h8 v6 h-8 v6 h-6 v-6 h-8 Z" transform="translate(-6 -2)" fill="#d64545" />
          {/* Кардиограмма */}
          <g transform="translate(20 214)">
            <rect x="0" y="-16" width="160" height="30" rx="8" fill="#0d2a2e" opacity="0.75" />
            <path className="mf-art__ecg" d="M6 0 H50 l8 -12 l8 22 l8 -18 l6 8 H154" stroke="#7df2c8" strokeWidth="3" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          </g>
          <path className="mf-art__heart" d="M100 182 c-8 -10 -22 -4 -16 8 c3 6 16 14 16 14 c0 0 13 -8 16 -14 c6 -12 -8 -18 -16 -8 Z" fill="#d64545" />
        </g>
      )}
      {role === "civilian" && (
        <g>
          <path d="M66 94 C66 72 82 66 100 66 C118 66 134 72 134 94 C120 88 80 88 66 94 Z" fill="#7a5a3a" />
          {/* Фонарь */}
          <g transform="translate(150 178)">
            <path d="M0 -26 V-16" stroke="#3b2f25" strokeWidth="3" />
            <rect x="-11" y="-16" width="22" height="30" rx="4" fill="#3b2f25" />
            <rect x="-7" y="-12" width="14" height="22" rx="2" fill="#ffd27a" opacity="0.35" />
            <path className="mf-art__flame" d="M0 6 c-6 -4 -4 -12 0 -16 c4 4 6 12 0 16 Z" fill="#ffb347" />
          </g>
        </g>
      )}
    </svg>
  );
}

/** Рубашка карты: узор и монограмма JoyRest. */
function CardBack({ city }: { city: string }) {
  return (
    <div className="mf-card__face mf-card__back" aria-hidden="true">
      <div className="mf-card__pattern" />
      <span className="mf-card__mono">J✦R</span>
      <span className="mf-card__back-title">Мафия</span>
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
