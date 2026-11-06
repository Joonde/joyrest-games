/**
 * Экраны телефона «Бубликатора» по согласованным макетам (`ph-*`): только вид, без связи. Данные — личное
 * (`PersonalView`), состав экипажа и уже посчитанные остатки времени; действия — колбэки.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { cap, verb, wordsOf, type ThemeWords } from "../lexicon";
import { HULL_MAX, PULL_HOLD_MS, SOS_BONUS, VOTE_BONUS } from "../rules/constants";
import type { CrewSummary, PanelControlView, PersonalView } from "../rules/types";
import { CrewMark, PauseIcon, RoleBadge, ShakePhone, Ship, ShieldCheck, Wrench } from "./art";
import { Control, twinsOf } from "./controls";
import { clockText, type Flash } from "./model";

// ---------------------------------------------------------------- общее

/** Шапка: экипаж (с ролью), корпус делениями, место, перелёт. */
export function Head({ v, crew, extra }: { v: PersonalView; crew: CrewSummary | null; extra?: string }) {
  const role = v.me.role === "double" ? "дублёр" : v.event?.kind === "sos" && v.event.sos?.captain ? "капитан" : null;
  const hull = v.ship?.hull ?? null;
  return (
    <header className="bkp-head">
      <span className="bkp-chip">
        <CrewMark />
        <span className="bkp-chip__name">«{crew?.name ?? "Экипаж"}»</span>
        {role && <span className="bkp-chip__role">· {role}</span>}
      </span>
      <span className="bkp-head__side">
        {hull !== null && (
          <span className="bkp-hull" role="img" aria-label={`Прочность ${hull} из ${HULL_MAX}`}>
            {Array.from({ length: HULL_MAX }, (_, i) => (
              <span key={i} className={`bkp-hull__seg${i < Math.round(hull) ? " is-on" : ""}`} />
            ))}
          </span>
        )}
        <span className="bkp-head__place">
          {v.ship ? `${v.ship.place}-е место` : ""}
          {extra ? ` · ${extra}` : ""}
        </span>
      </span>
    </header>
  );
}

export function Page({ kids, children, flip, label }: { kids: boolean; children: ReactNode; flip?: boolean; label: string }) {
  return (
    <main className={`bkp${kids ? " bkp--kids" : ""}${flip ? " is-flip" : ""}`} aria-label={label}>
      <div className="bkp__inner">{children}</div>
    </main>
  );
}

/** Плашка сверху: событие, пауза, глюк, переворот. */
export function Banner({ tone = "info", children, timer }: { tone?: "info" | "alert" | "gold"; children: ReactNode; timer?: string }) {
  return (
    <div className={`bkp-banner bkp-banner--${tone}`} role="status">
      <span className="bkp-banner__text">{children}</span>
      {timer && <span className="bkp-banner__timer">{timer}</span>}
    </div>
  );
}

export function Foot({ children }: { children: ReactNode }) {
  return <p className="bkp-foot">{children}</p>;
}

function Title({ eyebrow, children, timer, tone }: { eyebrow?: string; children: ReactNode; timer?: string; tone?: "alert" | "ice" }) {
  return (
    <div className="bkp-title">
      {eyebrow && <p className="bkp-eyebrow">{eyebrow}</p>}
      <div className="bkp-title__row">
        <h1 className="bkp-h1">{children}</h1>
        {timer && <span className={`bkp-timer${tone ? ` bkp-timer--${tone}` : ""}`}>{timer}</span>}
      </div>
    </div>
  );
}

export function legText(v: PersonalView): string {
  return `перелёт ${v.leg + 1} из ${v.legs}`;
}

// ---------------------------------------------------------------- вход и экипажи

export function LobbyScreen({ v, name, crew, code }: { v: PersonalView; name: string; crew: CrewSummary | null; code: string }) {
  const w = wordsOf(v.theme);
  const crews = v.lobby?.crews ?? [];
  const total = crews.reduce((a, c) => a + c.count, 0);
  const mine = v.lobby?.choice !== null && v.lobby?.choice !== undefined ? crews.find((c) => c.id === v.lobby?.choice) : undefined;
  return (
    <Page kids={v.difficulty === "kids"} label="Ждём начала">
      <header className="bkp-brand">
        <span className="bkp-brand__mark">J✦R</span>
        <span className="bkp-brand__code">Игра {code} · Бубликатор</span>
      </header>
      <Title>Вы в игре, {name}!</Title>
      <p className="bkp-lead">
        {mine ? (
          <>
            Ваш экипаж — команда <b>«{mine.name}»</b>. Ведущий соберёт экипажи, и здесь появится пульт {w.shipGen}.
          </>
        ) : (
          <>Ведущий рассаживает гостей по экипажам. Экипаж появится здесь сам — ничего нажимать не нужно.</>
        )}
      </p>
      <div className="bkp-hero">
        <Ship theme={v.theme} label={cap(w.ship)} size={190} />
      </div>
      <dl className="bkp-stats">
        <div>
          <dt>Уже в игре</dt>
          <dd>{guests(total)}</dd>
        </div>
        <div>
          <dt>Экипажей</dt>
          <dd>{crews.filter((c) => c.count > 0).length}</dd>
        </div>
      </dl>
      {crew && <CrewList crew={crew} />}
      <div className="bkp-note">Не закрывайте страницу — экран не погаснет. На iPhone потом попросим разрешить тряску.</div>
    </Page>
  );
}

function guests(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "гость" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "гостя" : "гостей";
  return `${n} ${word}`;
}

function CrewList({ crew }: { crew: CrewSummary }) {
  return (
    <section className="bkp-card">
      <p className="bkp-eyebrow">Экипаж «{crew.name}»</p>
      <ul className="bkp-members">
        {crew.members.map((m, i) => (
          <li key={`${m.name}-${i}`} className={m.online ? "" : "is-off"}>
            <span className="bkp-members__name">{m.name}</span>
            <span className="bkp-members__role">{m.role === "double" ? "дублёр" : m.online ? "" : "без связи"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CrewsScreen({ v, crew }: { v: PersonalView; crew: CrewSummary | null }) {
  const w = wordsOf(v.theme);
  return (
    <Page kids={v.difficulty === "kids"} label="Экипажи собраны">
      <Head v={v} crew={crew} />
      <Title eyebrow="Экипажи собраны">{v.me.role === "double" ? "Вы — дублёр" : "Вы в экипаже!"}</Title>
      <p className="bkp-lead">
        {v.me.role === "double"
          ? `В экипаже больше 10 человек: пульт у вас общий с игроком ${v.me.doubleOf ? `«${v.me.doubleOf}»` : "экипажа"} — двигайте приборы вместе.`
          : `Скоро ведущий запустит тренировку или сразу полёт — пульт ${w.shipGen} появится здесь.`}
      </p>
      <div className="bkp-hero">
        <Ship theme={v.theme} label={cap(w.ship)} size={170} />
      </div>
      {crew && <CrewList crew={crew} />}
    </Page>
  );
}

// ---------------------------------------------------------------- пульт

export interface PanelProps {
  v: PersonalView;
  crew: CrewSummary | null;
  shown: (c: PanelControlView) => number;
  onMove: (c: PanelControlView, state: number) => void;
  orderLeft: number | null;
  flash: Flash | null;
  /** Сейчас «Переворот», «Глюк» (мс до конца показа плашки), предупреждение о событии. */
  flipLeft: number | null;
  glitchLeft: number | null;
  warnLeft: number | null;
  drillLeft?: number | null;
  shake?: ReactNode;
}

const EVENT_TITLES = { meteor: "Метеоритный дождь", pull: "Притяжение", sos: "Сигнал SOS", captain: "Все на палубу!" } as const;

export function eventTitle(kind: keyof typeof EVENT_TITLES, w: ThemeWords): string {
  return kind === "pull" ? w.pull.replace(/!$/, "") : EVENT_TITLES[kind];
}

export function PanelScreen(p: PanelProps) {
  const { v, crew } = p;
  const kids = v.difficulty === "kids";
  const w = wordsOf(v.theme);
  const twins = v.leg === 2 ? twinsOf(v.panel) : new Set<string>();
  const drill = v.phase === "drill";
  const double = v.me.role === "double";
  const ev = v.event;
  return (
    <Page kids={kids} flip={p.flipLeft !== null && p.flipLeft > 0} label={drill ? "Тренировка" : "Пульт"}>
      <Head v={v} crew={crew} extra={drill ? undefined : legText(v)} />
      {drill && p.drillLeft !== undefined && <Banner tone="gold" timer={clockText(p.drillLeft ?? 0)}>Тренировка — очков нет</Banner>}
      {p.flipLeft !== null && p.flipLeft > 0 && (
        <Banner tone="alert" timer={clockText(p.flipLeft)}>
          Переворот! Пульт вверх ногами
        </Banner>
      )}
      {p.glitchLeft !== null && p.glitchLeft > 0 && <Banner tone="info">Глюк! Плитки поменялись местами</Banner>}
      {ev && ev.warn && p.warnLeft !== null && (
        <Banner tone="alert" timer={clockText(p.warnLeft)}>
          {ev.joined ? `Внимание: ${eventTitle(ev.kind, w)}!` : `У других — ${eventTitle(ev.kind, w)}`}
        </Banner>
      )}
      {ev && !ev.warn && !ev.joined && <Banner tone="info">У других экипажей — {eventTitle(ev.kind, w)}</Banner>}
      {p.shake}
      {double && (
        <section className="bkp-card bkp-card--gold">
          <p className="bkp-eyebrow">Вы дублёр</p>
          <h2 className="bkp-h2">Один пульт на двоих</h2>
          <p className="bkp-text">
            Пульт общий с игроком {v.me.doubleOf ? `«${v.me.doubleOf}»` : "вашего экипажа"}. Приказы приходят хозяину пульта и остальным — слушайте экипаж и двигайте приборы вместе: кто первый, тот и сделал.
          </p>
        </section>
      )}
      {!double && <OrderCard v={v} left={p.orderLeft} flash={p.flash} w={w} />}
      <p className="bkp-eyebrow bkp-eyebrow--section">{double ? "Общие приборы" : drill ? "Ваши приборы · как в полёте" : "Ваши приборы"}</p>
      <div className={`bkp-panel bkp-panel--${Math.min(4, v.panel.length)}`}>
        {v.panel.map((c) => (
          <Control key={c.id} c={c} shown={p.shown(c)} kids={kids} twin={twins.has(c.id)} onMove={(s) => p.onMove(c, s)} />
        ))}
        {v.panel.length === 0 && <p className="bkp-text bkp-empty">Приборы появятся со следующего перелёта.</p>}
      </div>
      {v.me.pending && <Foot>Вы пришли во время полёта — со следующего перелёта получите свои приборы.</Foot>}
      {!v.me.pending && !double && !drill && <Foot>Слышите своё название — сразу крутите. Видите приказ — сразу кричите.</Foot>}
    </Page>
  );
}

const FLASH_TEXT: Record<Flash["kind"], { mark: string; title: string; text: string }> = {
  done: { mark: "✓", title: "Выполнено", text: "Следующий приказ через секунду." },
  helped: { mark: "✓", title: "Вы помогли!", text: "Ваш прибор выполнил приказ товарища." },
  fail: { mark: "!", title: "Не успели!", text: "Приказ сгорел — прочность чуть ниже." },
  cancel: { mark: "×", title: "Приказ отменён", text: "Без штрафа, новый через секунду." },
};

function OrderCard({ v, left, flash, w }: { v: PersonalView; left: number | null; flash: Flash | null; w: ThemeWords }) {
  const o = v.order;
  if (flash) {
    const f = FLASH_TEXT[flash.kind];
    return (
      <section className={`bkp-order bkp-order--${flash.kind}`} aria-live="polite">
        <span className="bkp-order__mark" aria-hidden="true">
          {f.mark}
        </span>
        <div>
          <h2 className="bkp-h2">{f.title}</h2>
          <p className="bkp-text">{flash.kind === "done" ? `${cap(w.ship)} ${verb(w, "прибавил", "прибавили")}. ${f.text}` : f.text}</p>
        </div>
      </section>
    );
  }
  if (!o) {
    return (
      <section className="bkp-order bkp-order--wait" aria-live="polite">
        <p className="bkp-eyebrow">Ваш приказ</p>
        <h2 className="bkp-h2">Сейчас придёт…</h2>
      </section>
    );
  }
  const frac = o.total > 0 && left !== null ? Math.max(0, Math.min(1, left / o.total)) : 1;
  return (
    <section className={`bkp-order${o.frozen ? " is-frozen" : ""}`} aria-live="polite">
      <p className="bkp-eyebrow">Ваш приказ</p>
      <h2 className="bkp-order__text">{o.text}</h2>
      <p className="bkp-text">{o.frozen ? "Приказы на паузе — время стоит." : o.mine ? "Прибор у вас — двигайте сами!" : `Прибора «${o.control}» у вас нет — крикните экипажу!`}</p>
      <div className="bkp-order__time">
        <div className="bkp-bar" aria-hidden="true">
          <span className="bkp-bar__fill" style={{ transform: `scaleX(${frac})` }} />
        </div>
        <span className="bkp-order__left">{left === null ? "" : `${Math.ceil(left / 1000)} с`}</span>
      </div>
      {o.mark && <span className="bkp-order__dot" aria-hidden="true" />}
    </section>
  );
}

// ---------------------------------------------------------------- тренировка

export function MotionStep({ onAllow, state, live }: { onAllow: () => void; state: "need" | "granted" | "denied" | "none"; live: boolean }) {
  return (
    <section className="bkp-card">
      <p className="bkp-eyebrow">Шаг 1 · тряска телефона</p>
      <h2 className="bkp-h3">В полёте будет метеоритный дождь — нужно трясти телефон</h2>
      {live ? (
        <p className="bkp-text">✓ Тряска работает.</p>
      ) : state === "need" ? (
        <>
          <p className="bkp-text">Телефон может спросить разрешение один раз. Без него в дождь можно часто тапать по экрану.</p>
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block bkp-btn2" onClick={onAllow}>
              Разрешить тряску
            </button>
          </div>
        </>
      ) : (
        <p className="bkp-text">Если телефон не почувствует тряску — в дождь просто часто тапайте по экрану.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- события

export interface MeteorMotion {
  state: "need" | "granted" | "denied" | "none";
  /** Датчик присылает движение — можно трясти. */
  live: boolean;
  onAllow: () => void;
}

export function MeteorScreen({ v, crew, left, onTap, motion }: { v: PersonalView; crew: CrewSummary | null; left: number | null; onTap: () => void; motion: MeteorMotion }) {
  const m = v.event?.meteor;
  const shield = m?.shield ?? 0;
  const holds = shield >= 50 ? "держит" : shield >= 25 ? "минус деление" : "минус два";
  const shake = motion.live;
  return (
    <Page kids={v.difficulty === "kids"} label="Метеоритный дождь">
      <Head v={v} crew={crew} />
      <Banner tone="alert" timer={clockText(left)}>
        Метеоритный дождь! Приказы на паузе
      </Banner>
      {shake ? (
        <>
          <div className="bkp-hero">
            <ShakePhone />
          </div>
          <h1 className="bkp-mega">ТРЯСИТЕ!</h1>
          <p className="bkp-lead bkp-center">Держите телефон крепко. Чем сильнее трясёт весь экипаж, тем крепче щит.</p>
          <button type="button" className="bkp-tap" onClick={onTap}>
            Не трясётся? Тапайте сюда
          </button>
        </>
      ) : (
        <>
          {/* Без датчика — «Тапайте!» на весь экран (макет ph-meteor): вся плашка — одна большая кнопка. */}
          <button type="button" className="bkp-tap bkp-tap--big" onClick={onTap}>
            <span className="bkp-mega">ТАПАЙТЕ!</span>
            <span className="bkp-tap__hint">Часто касайтесь здесь — чем чаще тапает весь экипаж, тем крепче щит</span>
          </button>
          {motion.state === "need" && (
            <button type="button" className="btn btn--secondary btn--block bkp-btn2" onClick={motion.onAllow}>
              Разрешить тряску — трясти вместо тапов
            </button>
          )}
        </>
      )}
      <section className="bkp-card">
        <Meter label="Ваш вклад" value={m?.power ?? 0} />
        <Meter label="Щит" value={shield} note={`${shield} · ${holds}`} gold />
        {v.difficulty !== "kids" && <p className="bkp-small">Меньше 50 — минус деление прочности, меньше 25 — минус два</p>}
      </section>
    </Page>
  );
}

function Meter({ label, value, note, gold }: { label: string; value: number; note?: string; gold?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="bkp-meter">
      <span className="bkp-meter__label">{label}</span>
      <span className="bkp-meter__value">{note ?? Math.round(v)}</span>
      <span className={`bkp-meter__bar${gold ? " is-gold" : ""}`} aria-hidden="true">
        <span style={{ transform: `scaleX(${v / 100})` }} />
      </span>
    </div>
  );
}

export function PullScreen({
  v,
  crew,
  left,
  holding,
  onHold,
}: {
  v: PersonalView;
  crew: CrewSummary | null;
  left: number | null;
  holding: boolean;
  onHold: (on: boolean) => void;
}) {
  const w = wordsOf(v.theme);
  const p = v.event?.pull;
  const held = p ? Math.min(PULL_HOLD_MS, p.held) : 0;
  const all = p?.members.length ?? 0;
  const holdingN = p?.members.filter((x) => x.holding).length ?? 0;
  const done = p?.escaped === true;
  return (
    <Page kids={v.difficulty === "kids"} label="Притяжение">
      <Head v={v} crew={crew} />
      <Title timer={clockText(left)} tone="alert">
        {w.pull}
      </Title>
      <p className="bkp-lead">{done ? "Вырвались! Отпускайте — ждём остальных." : "Держите «Тягу» все вместе 3 секунды. Отпустил один — отсчёт заново."}</p>
      <section className="bkp-card">
        <div className="bkp-row">
          <span>Держат</span>
          <b>
            {holdingN} из {all}
          </b>
        </div>
        <ul className="bkp-holders">
          {(p?.members ?? []).map((x, i) => (
            <li key={`${x.name}-${i}`} className={x.holding ? "is-on" : ""}>
              {x.name}
            </li>
          ))}
        </ul>
      </section>
      <button
        type="button"
        className={`bkp-hold${holding ? " is-on" : ""}${done ? " is-done" : ""}`}
        aria-pressed={holding}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          onHold(true);
        }}
        onPointerUp={() => onHold(false)}
        onPointerCancel={() => onHold(false)}
        onContextMenu={(e) => e.preventDefault()}
        style={{ "--bk-held": String(held / PULL_HOLD_MS) } as CSSProperties}
      >
        <span className="bkp-hold__word">{done ? "ВЫРВАЛИСЬ" : "ТЯГА"}</span>
        <span className="bkp-hold__hint">{done ? "можно отпустить" : holding ? `держите · ${(held / 1000).toFixed(1)} с` : "нажмите и держите"}</span>
      </button>
      <Foot>Кого нет на связи, того не ждут. Не вырвались за 20 секунд — минус деление прочности.</Foot>
    </Page>
  );
}

const SOS_SHAPES = ["●", "▲", "■", "◆"];
const SOS_NAMES = ["красный", "жёлтый", "зелёный", "синий"];

export function SosScreen({ v, crew, left, now, onColor }: { v: PersonalView; crew: CrewSummary | null; left: number | null; now: number; onColor: (c: number) => void }) {
  const w = wordsOf(v.theme);
  const s = v.event?.sos;
  const blocked = s?.blockedUntil !== null && s?.blockedUntil !== undefined && s.blockedUntil > now;
  const len = s?.length ?? 4;
  return (
    <Page kids={v.difficulty === "kids"} label="Сигнал SOS">
      <Head v={v} crew={crew} />
      <Title timer={clockText(left)} tone="ice">
        Сигнал SOS
      </Title>
      <p className="bkp-lead">Повторите {w.sos} с большого экрана. Экипаж подсказывает вслух.</p>
      <div className="bkp-progress" aria-label={`Набрано ${s?.progress ?? 0} из ${len}`}>
        {Array.from({ length: len }, (_, i) => (
          <span key={i} className={`bkp-progress__cell${i < (s?.progress ?? 0) ? " is-on" : ""}`}>
            {i < (s?.progress ?? 0) ? "✓" : ""}
          </span>
        ))}
      </div>
      {s?.done ? (
        <section className="bkp-card bkp-card--good">
          <h2 className="bkp-h2">Сигнал принят! +{SOS_BONUS}</h2>
        </section>
      ) : (
        <div className="bkp-sos">
          {SOS_NAMES.map((name, i) => (
            <button key={name} type="button" className="bkp-sos__btn" disabled={blocked} style={{ "--bk-dot": `var(--bk-dial-${i})` } as CSSProperties} onClick={() => onColor(i)} aria-label={name}>
              <span aria-hidden="true">{SOS_SHAPES[i]}</span>
              {name}
            </button>
          ))}
        </div>
      )}
      {blocked && <Banner tone="alert">Ошибка — набор с начала через секунду</Banner>}
      <Foot>Верно — +{SOS_BONUS} к дальности. Ошиблись — 1,5 с пауза и набор с начала.</Foot>
    </Page>
  );
}

export function SosCrewScreen({ v, crew, left }: { v: PersonalView; crew: CrewSummary | null; left: number | null }) {
  const w = wordsOf(v.theme);
  const s = v.event?.sos;
  const who = s?.captainName ?? "Капитан";
  return (
    <Page kids={v.difficulty === "kids"} label="Сигнал SOS — подсказки">
      <Head v={v} crew={crew} />
      <Banner tone="info" timer={clockText(left)}>
        Сигнал SOS
      </Banner>
      <Title>Подсказывайте капитану!</Title>
      <p className="bkp-lead">
        {who} набирает {w.sos}. Смотрите на большой экран и кричите цвет и фигуру.
      </p>
      <div className="bkp-progress">
        {Array.from({ length: s?.length ?? 4 }, (_, i) => (
          <span key={i} className={`bkp-progress__cell${i < (s?.progress ?? 0) ? " is-on" : ""}`}>
            {i < (s?.progress ?? 0) ? "✓" : ""}
          </span>
        ))}
      </div>
      <p className="bkp-center bkp-text">
        {s?.done ? "Сигнал принят!" : `${who} набрал(а) ${s?.progress ?? 0} из ${s?.length ?? 4}`}
      </p>
      <Foot>Кнопки огоньков есть только у капитана. Верно — экипажу +{SOS_BONUS} к дальности.</Foot>
    </Page>
  );
}

export function DeckScreen({ v, crew, left }: { v: PersonalView; crew: CrewSummary | null; left: number | null }) {
  return (
    <Page kids={v.difficulty === "kids"} label="Все на палубу">
      <Head v={v} crew={crew} />
      <Title timer={clockText(left)} eyebrow="Все на палубу!">
        {v.event?.task ?? "Задание ведущего"}
      </Title>
      <p className="bkp-lead">Выполняйте всем экипажем — ведущий смотрит и ставит звёзды. Приказы на паузе.</p>
      <Foot>Каждая звезда — +10 к счёту экипажа.</Foot>
    </Page>
  );
}

// ---------------------------------------------------------------- ремонт, финиш

export function RepairScreen({ v, crew, left, onTap }: { v: PersonalView; crew: CrewSummary | null; left: number | null; onTap: () => void }) {
  const w = wordsOf(v.theme);
  const r = v.repair;
  const frac = r && r.target > 0 ? Math.min(1, r.taps / r.target) : 0;
  return (
    <Page kids={v.difficulty === "kids"} label="Ремонт">
      <Head v={v} crew={crew} />
      <Banner tone="alert">
        {cap(w.ship)} {verb(w, "сломался", "сломались")} — аварийный ремонт
      </Banner>
      <p className="bkp-mega bkp-mega--num">{left === null ? "" : `${Math.ceil(left / 1000)} с`}</p>
      <p className="bkp-center bkp-text">до конца ремонта · приказы на паузе</p>
      <button type="button" className="bkp-repair" onClick={onTap}>
        <Wrench />
        <span className="bkp-repair__word">ЧИНИМ!</span>
        <span className="bkp-repair__hint">тапайте быстрее</span>
      </button>
      <p className="bkp-center bkp-text">
        Ваших ударов: <b>{r?.mine ?? 0}</b>
      </p>
      <section className="bkp-card">
        <div className="bkp-row">
          <span>Чиним вместе</span>
          <b>
            {r?.taps ?? 0} из {r?.target ?? 0}
          </b>
        </div>
        <span className="bkp-meter__bar is-gold" aria-hidden="true">
          <span style={{ transform: `scaleX(${frac})` }} />
        </span>
        <p className="bkp-small">Наберёте раньше — ремонт закончится сразу, но не быстрее 5 секунд. После ремонта прочность 3 из 5.</p>
      </section>
    </Page>
  );
}

export function FinishScreen({ v, crew, onSalute }: { v: PersonalView; crew: CrewSummary | null; onSalute: () => void }) {
  const w = wordsOf(v.theme);
  return (
    <Page kids={v.difficulty === "kids"} label="Финиш">
      <Head v={v} crew={crew} />
      <p className="bkp-eyebrow bkp-center">{legText(v)}</p>
      <h1 className="bkp-mega bkp-mega--gold">Финиш!</h1>
      <p className="bkp-lead bkp-center">
        «{crew?.name ?? "Ваш экипаж"}» {verb(w, "долетел", "долетели")} до {w.goal}. Ждём остальных.
      </p>
      <div className="bkp-hero">
        <Ship theme={v.theme} label={cap(w.ship)} size={190} />
      </div>
      <p className="bkp-note bkp-center">События вас больше не задевают</p>
      <div className="actions">
        <button type="button" className="btn btn--block" onClick={onSalute}>
          ✦ Салют
        </button>
      </div>
      <Foot>Каждое касание — фейерверк цвета вашего экипажа на большом экране.</Foot>
    </Page>
  );
}

export function LaunchScreen({ v, crew, left }: { v: PersonalView; crew: CrewSummary | null; left: number | null }) {
  const w = wordsOf(v.theme);
  return (
    <Page kids={v.difficulty === "kids"} label="Взлёт">
      <Head v={v} crew={crew} extra={legText(v)} />
      <p className="bkp-eyebrow bkp-center">{legText(v)}</p>
      <h1 className="bkp-mega">Взлёт!</h1>
      <p className="bkp-mega bkp-mega--num">{left === null ? "" : Math.max(1, Math.ceil(left / 1000))}</p>
      <div className="bkp-hero">
        <Ship theme={v.theme} label={cap(w.ship)} size={170} />
      </div>
      <p className="bkp-lead bkp-center">Сейчас придут приказы. Слушайте экипаж и кричите громко!</p>
    </Page>
  );
}

// ---------------------------------------------------------------- роль, привал, голосование, карточка

export function RoleScreen({ v, crew, onSeen }: { v: PersonalView; crew: CrewSummary | null; onSeen: () => void }) {
  const sab = v.role?.saboteur === true;
  const w = wordsOf(v.theme);
  return (
    <Page kids={false} label="Тайная роль">
      <Head v={v} crew={crew} extra={legText(v)} />
      <Banner tone="info">Прикройте экран — это видите только вы</Banner>
      <section className="bkp-role">
        <RoleBadge saboteur={sab} />
        <p className="bkp-eyebrow">Тайная роль на этот перелёт</p>
        <h1 className="bkp-h1 bkp-center">{sab ? "Вы диверсант" : "Вы честный член экипажа"}</h1>
        {/* «Понятно» — сразу под ролью, в первом экране и на 320×568 (аудит 2b, №6); подробности — ниже. */}
        <div className="actions bkp-role__ok">
          <button type="button" className="btn btn--block" onClick={onSeen}>
            Понятно, скрыть
          </button>
        </div>
        <p className="bkp-small bkp-center">Окно закроется само через несколько секунд после взлёта.</p>
        <p className="bkp-text bkp-center">
          {sab
            ? `Примерно каждый третий ваш приказ — ложный. Читайте его так же уверенно: если экипаж выполнит, ${w.ship} ${verb(w, "теряет", "теряют")} прочность.`
            : `Среди вас может быть диверсант: он читает ложные приказы так же уверенно. Запоминайте, после чьих приказов трясло ${w.ship}.`}
        </p>
        <div className="bkp-card bkp-card--inner">
          <p className="bkp-small">{sab ? "Так отмечен ложный приказ — точкой у края" : "Ложный приказ выглядит как обычный"}</p>
          <p className="bkp-order__text bkp-center">Оленеметр на 5!{sab && <span className="bkp-order__dot bkp-order__dot--inline" aria-hidden="true" />}</p>
          <p className="bkp-small">{sab ? "Точку видите только вы. Выполнят — у всех обычная «✓», никто не заметит" : "Отличить можно только по последствиям: выполнили — корпус тряхнуло"}</p>
        </div>
        <p className="bkp-text bkp-center">
          {sab ? `После перелёта экипаж голосует, кто диверсант. Не раскусят — получите ленту «Мастер обмана».` : `После перелёта — голосование «Кто диверсант?». Угадаете — экипажу +${VOTE_BONUS}.`}
        </p>
      </section>
    </Page>
  );
}

export function DockScreen({ v, crew }: { v: PersonalView; crew: CrewSummary | null }) {
  const d = v.dock;
  return (
    <Page kids={v.difficulty === "kids"} label="Привал">
      <Head v={v} crew={crew} extra={legText(v)} />
      <p className="bkp-eyebrow bkp-center">Привал · {legText(v)}</p>
      <h1 className="bkp-mega bkp-mega--gold">{d ? `${d.place}-е место` : "Привал"}</h1>
      <dl className="bkp-stats">
        <div>
          <dt>За перелёт</dt>
          <dd>{d?.score ?? 0}</dd>
        </div>
        <div>
          <dt>Общий счёт</dt>
          <dd>{d?.total ?? 0}</dd>
        </div>
        <div>
          <dt>Ваши приказы</dt>
          <dd>{v.me.legDone}</dd>
        </div>
      </dl>
      <p className="bkp-lead bkp-center">Смотрите итоги на большом экране. Следующий перелёт запустит ведущий.</p>
    </Page>
  );
}

/**
 * Голос — как в макете ph-vote (аудит 2b, №5): касание выбирает, отдельная кнопка «Голосую: …» отправляет, дальше
 * «✓ Голос принят». Повторное касание выбранного ничего не снимает; передумать — выбрать другого и снова «Голосую».
 */
export function VoteScreen({ v, crew, left, onVote }: { v: PersonalView; crew: CrewSummary | null; left: number | null; onVote: (pid: string) => void }) {
  const vote = v.vote;
  const mine = vote?.mine ?? null;
  const [picked, setPicked] = useState<string | null>(mine);
  const choice = picked ?? mine;
  const name = vote?.candidates.find((c) => c.pid === choice)?.name ?? null;
  const sent = choice !== null && choice === mine;
  return (
    <Page kids={false} label="Кто диверсант">
      <Head v={v} crew={crew} />
      <Title timer={clockText(left)} tone="alert">
        Кто диверсант?
      </Title>
      <p className="bkp-lead">Вспомните, после чьих приказов трясло. Один голос, за себя нельзя.</p>
      <div className="bkp-choices" role="radiogroup" aria-label="Кто диверсант">
        {(vote?.candidates ?? []).map((c) => {
          const on = choice === c.pid;
          return (
            <button key={c.pid} type="button" role="radio" aria-checked={on} className={`bkp-choice${on ? " is-on" : ""}`} onClick={() => setPicked(c.pid)}>
              <span className="bkp-choice__ring" aria-hidden="true" />
              <span className="bkp-choice__name">{c.name}</span>
            </button>
          );
        })}
      </div>
      <div className="actions">
        <button type="button" className={`btn btn--block bkp-vote-cta${sent ? " is-sent" : ""}`} disabled={choice === null || sent} onClick={() => choice !== null && onVote(choice)}>
          {choice === null ? "Выберите одного" : sent ? `✓ Голос принят: ${name ?? ""}` : `Голосую: ${name ?? ""}`}
        </button>
      </div>
      <Foot>{sent ? "Можно передумать до конца отсчёта: выберите другого и нажмите «Голосую»." : `Угадали — экипажу +${VOTE_BONUS}. Поровну — считается, что не угадали.`}</Foot>
    </Page>
  );
}

export function NoSabScreen({ v, crew }: { v: PersonalView; crew: CrewSummary | null }) {
  return (
    <Page kids={v.difficulty === "kids"} label="Диверсанта не было">
      <Head v={v} crew={crew} extra="голосование" />
      <div className="bkp-hero">
        <ShieldCheck />
      </div>
      <h1 className="bkp-h1 bkp-center">В вашем экипаже диверсанта не было</h1>
      <p className="bkp-lead bkp-center">Диверсант бывает только в экипажах от 5 человек. Смотрите на большой экран — раскрываем диверсантов других экипажей.</p>
      <Foot>Голосовать не нужно — бонус +{VOTE_BONUS} сегодня не для вас, и штрафа нет.</Foot>
    </Page>
  );
}

export function VotedScreen({ v, crew }: { v: PersonalView; crew: CrewSummary | null }) {
  const r = v.voted;
  const me = r?.me === true;
  return (
    <Page kids={false} label="Итог голосования">
      <Head v={v} crew={crew} extra="голосование" />
      <div className="bkp-hero">
        <RoleBadge saboteur />
      </div>
      <p className="bkp-eyebrow bkp-center">Диверсант — {r?.saboteur ?? "?"}</p>
      <h1 className="bkp-h1 bkp-center">{me ? (r?.guessed ? "Вас раскусили!" : "Вас не раскусили!") : r?.guessed ? `Угадали! +${VOTE_BONUS}` : "Не угадали"}</h1>
      <p className="bkp-lead bkp-center">
        {me ? (r?.guessed ? "Экипаж угадал — в следующий раз хитрее." : "Лента «Мастер обмана» — ваша.") : r?.guessed ? "Экипаж вычислил диверсанта." : "Диверсант обвёл экипаж вокруг пальца."}
      </p>
    </Page>
  );
}

export function CardScreen({ v, crew }: { v: PersonalView; crew: CrewSummary | null }) {
  const c = v.card;
  const w = wordsOf(v.theme);
  if (!c) return null;
  return (
    <Page kids={v.difficulty === "kids"} label="Итоги игры">
      <h1 className="bkp-h1 bkp-center">Полёт окончен!</h1>
      <section className="bkp-final">
        <header className="bkp-final__head">
          <span className="bkp-brand__mark">J✦R</span>
          <span className="bkp-small">БУБЛИКАТОР</span>
          <span className="bkp-final__place">{c.place}-е место</span>
        </header>
        <div className="bkp-hero">
          <Ship theme={v.theme} label={cap(w.ship)} size={170} />
        </div>
        <h2 className="bkp-final__name">«{crew?.name ?? "Экипаж"}»</h2>
        <p className="bkp-small bkp-center">
          {crew ? `${crew.members.length} чел.` : ""} · {c.legs} {c.legs === 1 ? "перелёт" : c.legs < 5 ? "перелёта" : "перелётов"}
        </p>
        <dl className="bkp-grid">
          <div>
            <dt>Общий счёт</dt>
            <dd>{c.total}</dd>
          </div>
          <div>
            <dt>Приказов экипажа</dt>
            <dd>{c.crewOrders}</dd>
          </div>
          <div>
            <dt>Мои приказы</dt>
            <dd>{c.myOrders}</dd>
          </div>
          <div>
            <dt>Финишем первыми</dt>
            <dd>
              {c.firstFinishes} из {c.legs}
            </dd>
          </div>
        </dl>
        <div className="bkp-tags">
          {c.guessed > 0 && <span className="bkp-tag">Раскусили диверсанта</span>}
          {c.bestShield > 0 && <span className="bkp-tag">Лучший щит · {c.bestShield}</span>}
          {c.ribbon && <span className="bkp-tag bkp-tag--gold">Мастер обмана</span>}
        </div>
      </section>
      <Foot>Спасибо за игру! Итоги — на большом экране.</Foot>
    </Page>
  );
}

// ---------------------------------------------------------------- служебные экраны

export function InfoScreen({ title, text, kids, icon, children }: { title: string; text: string; kids?: boolean; icon?: ReactNode; children?: ReactNode }) {
  return (
    <Page kids={kids === true} label={title}>
      <div className="bkp-info">
        {icon && <div className="bkp-hero">{icon}</div>}
        <h1 className="bkp-h1 bkp-center">{title}</h1>
        <p className="bkp-lead bkp-center">{text}</p>
        {children}
      </div>
    </Page>
  );
}

export function PauseScreen({ v, crew }: { v: PersonalView; crew: CrewSummary | null }) {
  return (
    <Page kids={v.difficulty === "kids"} label="Пауза">
      <Head v={v} crew={crew} />
      <div className="bkp-info">
        <div className="bkp-hero">
          <PauseIcon />
        </div>
        <h1 className="bkp-h1 bkp-center">Пауза ведущего</h1>
        <p className="bkp-lead bkp-center">Приказы и время стоят у всех экипажей. Ничего не нажимайте — продолжим с того же места.</p>
        {v.order && (
          <p className="bkp-text bkp-center">
            Ваш приказ ждёт: «{v.order.text}» · {Math.ceil(v.order.left / 1000)} с
          </p>
        )}
      </div>
      <div className="bkp-note">Если пропала связь — экипаж, приборы и место сохранены, вернётесь сами.</div>
    </Page>
  );
}

