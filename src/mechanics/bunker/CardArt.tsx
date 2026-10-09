// Карты «Бункера»: личное дело выжившего. У каждой колоды — свой цвет, свой знак и своя рамка:
// характеристики — карточки досье на плотной бумаге, особые условия — чёрное золото с молнией,
// катастрофа — тревожная красная с полосами, бункер — синий чертёж, угроза — жёлтый знак опасности.
// Рубашка — чёрно-жёлтые полосы и эмблема JoyRest в люке. Рисунки — свои, простые линии.
import type { ReactNode } from "react";
import { Logo } from "../../components/Logo";
import { NameText } from "../../components/NameText";
import { BUNKER_CARDS, CAT_TITLES, CATASTROPHES, cardText, THREATS, type Cat } from "./decks";
import { SPECIAL_BY_ID, type SpecialId } from "./specials";

const P = (d: string) => <path d={d} />;

/** Знаки: 24×24, линия `currentColor`. */
export const ICONS: Record<string, ReactNode> = {
  profession: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      {P("M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12.5h18M10.5 12.5v2h3v-2")}
    </>
  ),
  biology: P("M8 3c0 6 8 6 8 12 0 2.6-1.2 4.2-2 6M16 3c0 6-8 6-8 12 0 2.6 1.2 4.2 2 6M9 6.5h6M10 12h4M9 17.5h6"),
  health: P("M12 20.5S4.5 16 4.5 9.8A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 16 12 20.5 12 20.5ZM6.5 12.5h3l1.3-2.6 2 5 1.4-2.4h3.3"),
  hobby: (
    <>
      {P("M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.4-1.4-1.7-.5-2.9.4-.5 1-.6 1.7-.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z")}
      <circle cx="7.5" cy="11" r="1.2" />
      <circle cx="10" cy="7" r="1.2" />
      <circle cx="14.5" cy="7" r="1.2" />
    </>
  ),
  baggage: (
    <>
      <rect x="4" y="7" width="16" height="13" rx="2" />
      {P("M9 7V4.5h6V7M8 7v13M16 7v13M6.5 20v1.5M17.5 20v1.5")}
    </>
  ),
  fact: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      {P("M15.3 15.3 21 21M8 9a2.7 2.7 0 0 1 5 0M7.5 12a3.4 3.4 0 0 0 6 0")}
    </>
  ),
  bolt: P("M13 2 4.5 13.5h6L9.5 22 19.5 9.5h-6.5L13 2Z"),
  swap: P("M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"),
  new: P("M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"),
  heal: P("M9 3.5h6v5.5h5.5v6H15v5.5H9V15H3.5V9H9V3.5Z"),
  virus: (
    <>
      <circle cx="12" cy="12" r="5" />
      {P("M12 4v3M12 17v3M4 12h3M17 12h3M6.3 6.3l2.2 2.2M15.5 15.5l2.2 2.2M17.7 6.3l-2.2 2.2M8.5 15.5l-2.2 2.2M10.5 11h.01M13.5 13h.01")}
      <circle cx="12" cy="3" r="1.2" />
      <circle cx="12" cy="21" r="1.2" />
      <circle cx="3" cy="12" r="1.2" />
      <circle cx="21" cy="12" r="1.2" />
      <circle cx="5.6" cy="5.6" r="1.2" />
      <circle cx="18.4" cy="18.4" r="1.2" />
      <circle cx="18.4" cy="5.6" r="1.2" />
      <circle cx="5.6" cy="18.4" r="1.2" />
    </>
  ),
  lamp: P("M4 21h16M12 21v-5M6.5 16h11L15 8H9l-2.5 8ZM12 3v2.5M5.5 5.5 7 7M18.5 5.5 17 7"),
  polygraph: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {P("M5 13h3l1.5-4 2.5 8 2-6 1.5 2H19")}
    </>
  ),
  hand: P("M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10.5V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6 7-2.7 0-4.2-1.5-5.6-3.6L3.8 14a1.5 1.5 0 0 1 2.4-1.8L8 14.5"),
  eye: (
    <>
      {P("M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z")}
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  spot: P("M9 3h6l-1 5h-4L9 3ZM10 8 4 21h16L14 8M8.5 15h7"),
  shield: P("M12 2.5 4.5 5.5v6c0 4.6 3.2 8.4 7.5 10 4.3-1.6 7.5-5.4 7.5-10v-6L12 2.5ZM8.5 12l2.5 2.5 4.5-5"),
  double: (
    <>
      <rect x="3" y="8" width="11" height="13" rx="1.5" />
      {P("M7 8V4.5A1.5 1.5 0 0 1 8.5 3h11A1.5 1.5 0 0 1 21 4.5v11a1.5 1.5 0 0 1-1.5 1.5H14M6 14.5l2 2 3-4")}
    </>
  ),
  cross: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P("M8.5 8.5l7 7M15.5 8.5l-7 7")}
    </>
  ),
  bed: P("M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6M7 11.5a1.8 1.8 0 1 0 0-.1"),
  rocks: P("M3 20h18l-3-6-3 2-3-6-3 4-2-2-4 8ZM10 4l1 2M14 3l-.5 2.5M6 6l1.5 1.5"),
  back: P("M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"),
  shuffle: P("M3 7h3.5c4.5 0 6.5 10 11 10H21M18 14l3 3-3 3M3 17h3.5c1.6 0 2.8-1.3 3.8-3M13.7 10c1-1.7 2.2-3 3.8-3H21M18 4l3 3-3 3"),
  hatch: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      {P("M12 3v5M12 16v5M3 12h5M16 12h5")}
    </>
  ),
  radiation: (
    <>
      <circle cx="12" cy="12" r="1.8" />
      {P("M12 10.2 9 4.8a8 8 0 0 0-5 8.4h6M13.8 12h6a8 8 0 0 0-5-8.4l-3 5.4M10.6 13.4l-3 5.3a8 8 0 0 0 8.8 0l-3-5.3")}
    </>
  ),
  meteor: (
    <>
      <circle cx="15" cy="15" r="5" />
      {P("M3 3l7.5 7.5M6 3l6 6M3 6l6 6M13.5 13.5l1.5 1.5")}
    </>
  ),
  wave: P("M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M4 10c0-4 3-7 7-7 3 0 4 2 3 4-1-1-3-1-4 1"),
  robot: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2" />
      {P("M12 8V4.5M9.5 12.5v1M14.5 12.5v1M9 16.5h6M2.5 12v3M21.5 12v3")}
      <circle cx="12" cy="3.5" r="1" />
    </>
  ),
  volcano: P("M2 21l7-11h6l7 11H2ZM9 10l1.5 3 1.5-2 1.5 2 1.5-3M10 6l-1-3M12 5.5V2.5M14 6l1-3"),
  zombie: P("M7 21v-6l-2-5 2-1 1 3V6a1.3 1.3 0 0 1 2.6 0v5V4.5a1.3 1.3 0 0 1 2.6 0V11V6a1.3 1.3 0 0 1 2.6 0v6l1.5-2.5 1.6 1-2.7 5.5V21M3 21h18"),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      {P("M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1")}
    </>
  ),
  ufo: (
    <>
      <ellipse cx="12" cy="11" rx="10" ry="3.5" />
      {P("M7.5 9a4.5 4.5 0 0 1 9 0M8 17l-1.5 4M12 17v4M16 17l1.5 4")}
    </>
  ),
  snow: P("M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5"),
  medic: P("M9 3.5h6v5.5h5.5v6H15v5.5H9V15H3.5V9H9V3.5Z"),
  plant: P("M12 21v-9M12 12c0-4 3-7 8-7 0 5-3 7-8 7ZM12 15c0-3-2-5-7-5 0 4 2 5 7 5ZM7 21h10"),
  gun: P("M3 9h15l2 2v2h-6l-1 2h-3l-1 4H5l1-4-3-2V9ZM18 9V7"),
  book: P("M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5V4.5ZM4 19.5A1.5 1.5 0 0 0 5.5 21H20M8 7h8"),
  tools: P("M14.5 6.5a4 4 0 0 0 5 5l-9 9a2 2 0 0 1-3-3l9-9a4 4 0 0 1-2-2ZM4 4l5 5M3 7l4-4"),
  radio: (
    <>
      <rect x="3" y="9" width="18" height="12" rx="2" />
      <circle cx="9" cy="15" r="3" />
      {P("M15 13h3M15 16h3M7 9l9-6")}
    </>
  ),
  can: (
    <>
      <ellipse cx="12" cy="5.5" rx="6" ry="2.5" />
      {P("M6 5.5v13c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-13M6 10.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5")}
    </>
  ),
  toy: (
    <>
      <circle cx="12" cy="13" r="6.5" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="6.5" r="2.5" />
      {P("M9.5 12h.01M14.5 12h.01M10 16a2.8 2.8 0 0 0 4 0")}
    </>
  ),
  gym: P("M6 8v8M3.5 10v4M18 8v8M20.5 10v4M6 12h12"),
  seed: P("M12 21c-4.5-2-7-6-7-10 0-4 3-7 7-8 4 1 7 4 7 8 0 4-2.5 8-7 10ZM12 21V9"),
  power: P("M13 2 4.5 13.5h6L9.5 22 19.5 9.5h-6.5L13 2Z"),
  water: P("M12 3s-6.5 7.2-6.5 11.5a6.5 6.5 0 0 0 13 0C18.5 10.2 12 3 12 3ZM9 15a3 3 0 0 0 3 3"),
  wine: P("M7 3h10l-.5 5a4.5 4.5 0 0 1-9 0L7 3ZM12 12.5V20M8 21h8M7.3 6.5h9.4"),
  lab: P("M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 15h9"),
  film: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      {P("M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4")}
    </>
  ),
  door: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="7" />
      {P("M12 7v10M8.5 12h7")}
    </>
  ),
  egg: P("M12 3c3.5 0 6.5 5.5 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.5 8.5 3 12 3Z"),
  fan: (
    <>
      <circle cx="12" cy="12" r="1.5" />
      {P("M12 10.5C11 6 12.5 3 15 3c2 0 2.5 3-3 7.5ZM13.5 12c4.5-1 7.5.5 7.5 3 0 2-3 2.5-7.5-3ZM12 13.5c1 4.5-.5 7.5-3 7.5-2 0-2.5-3 3-7.5ZM10.5 12C6 13 3 11.5 3 9c0-2 3-2.5 7.5 3Z")}
    </>
  ),
  box: P("M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9ZM3 7.5l9 4.5 9-4.5M12 12v9"),
  music: (
    <>
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
      {P("M9 18V5l11-2v13")}
    </>
  ),
  warn: P("M12 3 2 20.5h20L12 3ZM12 9.5v5M12 17.5v.01"),
};

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={className ?? "bk-icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name] ?? ICONS.box}
    </svg>
  );
}

/** Рубашка: чёрно-жёлтые полосы, люк с эмблемой JoyRest, надпись трафаретом. */
export function CardBack({ label = "Бункер", small = false }: { label?: string; small?: boolean }) {
  return (
    <div className={`bk-card bk-back${small ? " bk-card--small" : ""}`} aria-label="Закрытая карта">
      <div className="bk-in">
        <span className="bk-back__stripes" aria-hidden="true" />
        <span className="bk-back__hatch" aria-hidden="true">
          <Logo kind="emblem" tone="gold" title="" className="bk-back__emblem" />
        </span>
        {!small && <span className="bk-back__word">{label}</span>}
        <span className="bk-rivets" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Карта характеристики: открыта — текст, закрыта — рубашка цвета колоды. */
export function TraitCard({ cat, refId, open = true, mine = false, small = false, fresh = false }: { cat: Cat; refId: string | null | undefined; open?: boolean; mine?: boolean; small?: boolean; fresh?: boolean }) {
  if (!open || !refId) {
    return (
      <div className={`bk-card bk-trait bk-trait--${cat} bk-trait--closed${small ? " bk-card--small" : ""}`} aria-label={`${CAT_TITLES[cat]}: закрыта`}>
        <div className="bk-in">
          <span className="bk-trait__band">
            <Icon name={cat} />
            {!small && <span>{CAT_TITLES[cat]}</span>}
          </span>
          <span className="bk-trait__lock" aria-hidden="true">
            <Icon name={cat} className="bk-icon bk-icon--ghost" />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={`bk-card bk-trait bk-trait--${cat}${small ? " bk-card--small" : ""}${fresh ? " is-fresh" : ""}`}>
      <div className="bk-in">
        <span className="bk-trait__band">
          <Icon name={cat} />
          <span>{CAT_TITLES[cat]}</span>
        </span>
        <span className="bk-trait__text">{cardText(refId)}</span>
        <Icon name={cat} className="bk-icon bk-icon--water" />
        {mine && <span className="bk-trait__stamp">только вам</span>}
      </div>
    </div>
  );
}

/** Особое условие: чёрное золото, молния и знак действия. */
export function SpecialCard({ id, used = false, small = false }: { id: SpecialId; used?: boolean; small?: boolean }) {
  const s = SPECIAL_BY_ID[id];
  return (
    <div className={`bk-card bk-special${used ? " is-used" : ""}${small ? " bk-card--small" : ""}`}>
      <div className="bk-in">
        <span className="bk-special__band">
          <Icon name="bolt" />
          <span>Особое условие</span>
        </span>
        <span className="bk-special__sign">
          <Icon name={s.icon} />
        </span>
        <span className="bk-special__title">{s.title}</span>
        {!small && <span className="bk-special__text">{s.text}</span>}
        {s.when === "vote" && !small && <span className="bk-special__when">во время голосования</span>}
        {used && <span className="bk-special__stamp">сыграно</span>}
      </div>
    </div>
  );
}

/** Катастрофа: тревога — красное зарево, полосы опасности, крупный знак. */
export function CatastropheCard({ id, years, places, area, compact = false }: { id: number; years: number; places?: number; area?: number; compact?: boolean }) {
  const c = CATASTROPHES.find((x) => x.id === id) ?? CATASTROPHES[0];
  if (!c) return null;
  return (
    <div className={`bk-card bk-cata${compact ? " bk-cata--compact" : ""}`}>
      <div className="bk-in">
        <span className="bk-cata__hazard" aria-hidden="true" />
        <span className="bk-cata__kicker">Катастрофа</span>
        <span className="bk-cata__sign">
          <Icon name={c.icon} />
        </span>
        <span className="bk-cata__title">{c.title}</span>
        {!compact && (
          <>
            <span className="bk-cata__text">{c.text}</span>
            <span className="bk-cata__text bk-cata__text--muted">{c.outside}</span>
          </>
        )}
        <span className="bk-cata__facts">
          <span>
            <b>{years}</b> {years === 1 ? "год" : years < 5 ? "года" : "лет"} в бункере
          </span>
          {places !== undefined && (
            <span>
              <b>{places}</b> мест
            </span>
          )}
          {area !== undefined && !compact && (
            <span>
              <b>{area}</b> м²
            </span>
          )}
        </span>
        <span className="bk-cata__hazard bk-cata__hazard--bottom" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Карта бункера: синий чертёж — сетка, план отсека, знак комнаты. Закрыта — люк. */
export function BunkerCard({ index, n, small = false, fresh = false }: { index: number | null; n: number; small?: boolean; fresh?: boolean }) {
  const card = index === null ? null : BUNKER_CARDS[index];
  if (!card) {
    return (
      <div className={`bk-card bk-plan bk-plan--closed${small ? " bk-card--small" : ""}`} aria-label={`Карта бункера ${n}: закрыта`}>
        <div className="bk-in">
          <span className="bk-plan__num">{n}</span>
          <Icon name="hatch" className="bk-icon bk-plan__hatch" />
        </div>
      </div>
    );
  }
  return (
    <div className={`bk-card bk-plan${small ? " bk-card--small" : ""}${fresh ? " is-fresh" : ""}`}>
      <div className="bk-in">
        <span className="bk-plan__num">{n}</span>
        <span className="bk-plan__sign">
          <Icon name={card.icon} />
        </span>
        <span className="bk-plan__title">{card.title}</span>
        {!small && <span className="bk-plan__text">{card.text}</span>}
      </div>
    </div>
  );
}

/** Угроза финала: жёлтый знак опасности; решение ведущего — штамп. */
export function ThreatCard({ index, verdict }: { index: number; verdict: boolean | null }) {
  const t = THREATS[index];
  if (!t) return null;
  return (
    <div className="bk-card bk-threat">
      <div className="bk-in">
        <span className="bk-threat__sign">
          <Icon name="warn" />
        </span>
        <span className="bk-threat__kicker">Угроза</span>
        <span className="bk-threat__title">{t.title}</span>
        <span className="bk-threat__text">{t.text}</span>
        <span className="bk-threat__helps">Поможет: {t.helps}</span>
        {verdict !== null && <span className={`bk-threat__stamp ${verdict ? "is-ok" : "is-bad"}`}>{verdict ? "Справились" : "Не справились"}</span>}
      </div>
    </div>
  );
}

/** Досье игрока на экране: имя, шесть строк характеристик, особое условие. */
export function Dossier({ name, seat, shown, used, exiled = false, speaking = false, big = false }: { name: string; seat: number; shown: Partial<Record<Cat, string>>; used: SpecialId | null; exiled?: boolean; speaking?: boolean; big?: boolean }) {
  return (
    <article className={`bk-dossier${exiled ? " is-exiled" : ""}${speaking ? " is-speaking" : ""}${big ? " bk-dossier--big" : ""}`}>
      <header className="bk-dossier__head">
        <span className="bk-dossier__seat">№{seat}</span>
        <span className="bk-dossier__name">
          <NameText name={name} />
        </span>
      </header>
      <ul className="bk-dossier__rows">
        {(["profession", "biology", "health", "hobby", "baggage", "fact"] as Cat[]).map((cat) => (
          <li key={cat} className={`bk-row bk-row--${cat}${shown[cat] ? "" : " is-closed"}`}>
            <Icon name={cat} />
            <span className="bk-row__text">{shown[cat] ? cardText(shown[cat]) : CAT_TITLES[cat]}</span>
          </li>
        ))}
      </ul>
      {used && (
        <p className="bk-dossier__used">
          <Icon name="bolt" /> {SPECIAL_BY_ID[used].title}
        </p>
      )}
      {exiled && <span className="bk-dossier__stamp">Изгнан</span>}
    </article>
  );
}
