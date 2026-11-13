/**
 * Экраны зала «Бубликатора» по согласованным макетам (`scr-*`): только вид, без связи. Кадр — в единицах `--u` (1% ширины
 * сцены 16:9), мелкие подписи — не меньше 1,7% высоты экрана (`--fs-*` в `screen.css`), длинные имена — с многоточием.
 */
import { memo, type CSSProperties, type ReactNode } from "react";
import { HallTimer } from "../../../components/live/HallTimer";
import { QrCode } from "../../../components/QrCode";
import { joinHint, playUrl } from "../../../components/links";
import { formatSessionCode } from "../../../core/code";
import { VPN_HINT } from "../../../core/texts";
import { GAME_TITLE, wordsOf } from "../lexicon";
import { CAPTAIN_STAR, CAPTAIN_STARS_MAX, DRILL_MS, EVENT_MS, LAUNCH_MS, PULL_HOLD_MS, SOS_BONUS, VOTE_BONUS, VOTE_MS } from "../rules/constants";
import type { ScreenCrewView, ScreenView, Theme } from "../rules/types";
import { CrewBadge, CrewShip, crewVars, Goal, Mask, Mono, Puller, SOS_NAMES, SOS_SHAPES } from "./art";
import {
  captainLayout,
  cardColumns,
  chipsShown,
  clock,
  flightLeft,
  guessedOf,
  hullCells,
  lanesOf,
  leftUntil,
  num,
  plural,
  progressOf,
  placesText,
  pullOf,
  revealedCount,
  secondsLeft,
  shieldLook,
  sosCycleMs,
  sosLit,
  tidyName,
  speedText,
  type Bumps,
  type ScreenModel,
} from "./model";

export interface BoardProps {
  m: ScreenModel;
  v: ScreenView;
  /** Местные часы (`performance`-время экрана) — для отсчётов через модель. */
  local: number;
  code: string;
  /** Когда экран увидел раскрытие диверсантов (местные мс); null — открыли экран позже, показываем всё сразу. */
  revealSeen: number | null;
  /** Рывки кораблей, наступившие при открытом экране (`nextBumps`). */
  bumps: Bumps;
}

const q = (name: string) => `«${tidyName(name)}»`;
/** В плотной раскладке (больше 7 карточек) — без кавычек: каждая буква названия на счету (повторный аудит 2c, №6). */
const cardName = (name: string, dense: boolean) => (dense ? tidyName(name) : q(name));
const NB = "\u00A0";

function Head({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="bks-head">
      <Mono />
      <div className="bks-head__text">
        <h1 className="bks-head__title">{title}</h1>
        {sub && <p className="bks-head__sub">{sub}</p>}
      </div>
      {children && <div className="bks-head__side">{children}</div>}
    </header>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: "gold" }) {
  return <span className={tone ? `bks-chip bks-chip--${tone}` : "bks-chip"}>{children}</span>;
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="bks-kicker">{children}</p>;
}

/** Корабль экипажа со значком (значок — при 6+ экипажах; без него — звезда). */
function Craft({ crew, theme, className }: { crew: { name: string; color: number; icon: number | null }; theme: Theme; className?: string }) {
  return (
    <span className={className ? `bks-craft ${className}` : "bks-craft"} style={crewVars(crew.color)}>
      <CrewShip theme={theme} label={q(crew.name)} />
      <span className="bks-craft__badge">
        <CrewBadge icon={crew.icon} />
      </span>
    </span>
  );
}

function Badge({ crew }: { crew: { color: number; icon: number | null } }) {
  return (
    <span className="bks-badge-wrap" style={crewVars(crew.color)}>
      <CrewBadge icon={crew.icon} />
    </span>
  );
}

/**
 * QR-код входа — только при смене кода (аудит 2c, №13): доска перерисовывается от сводок и отсчётов, а QR-код (SVG на сотни
 * модулей) остаётся тем же узлом.
 */
const JoinQr = memo(function JoinQr({ code, small }: { code: string; small?: boolean }) {
  return <QrCode value={playUrl(code)} label={`QR-код для входа: ${formatSessionCode(code)}`} className={small ? "bks-qr bks-qr--small" : "bks-qr"} />;
});

function Code({ code }: { code: string }) {
  return <b className="bks-code">{formatSessionCode(code)}</b>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="bks-note">{children}</p>;
}

/** Корабли рядом: до 8 в ряд, больше — ровными рядами не шире 7 (12 → 6 + 6, 20 → 7 + 7 + 6). */
function shipCols(n: number): number {
  if (n <= 8) return Math.max(1, n);
  return Math.ceil(n / Math.ceil(n / 7));
}

function legText(v: ScreenView): string {
  return `Перелёт ${v.leg + 1} из${NB}${v.legs}`;
}

function crewsText(n: number): string {
  return `${n} ${plural(n, "экипаж", "экипажа", "экипажей")}`;
}

function guestsText(n: number): string {
  return `${n} ${plural(n, "гость", "гостя", "гостей")}`;
}

// ------------------------------------------------------------------ лобби

export function LobbyBoard({ v, m, code }: BoardProps) {
  const w = wordsOf(v.theme);
  const lobby = v.lobby;
  const crews = lobby?.crews ?? [];
  const many = crews.length > 6;
  const max = lobby?.max ?? 10;
  return (
    <div className="bks-board bks-lobby">
      <Head title={GAME_TITLE} sub={`Тема «${w.title}» · экипажи у старта`}>
        <Chip>
          В игре <b>{m.players}</b> {plural(m.players, "гость", "гостя", "гостей")}
        </Chip>
      </Head>
      <div className="bks-lobby__grid">
        <section className="bks-panel bks-lobby__qr">
          <h2 className="bks-lobby__call">{w.board}</h2>
          <p className="bks-lobby__hint">Наведите камеру на код</p>
          <JoinQr code={code} />
          <p className="bks-lobby__code">
            <span>{joinHint()} · код</span> <Code code={code} />
          </p>
          <p className="bks-lobby__vpn">{VPN_HINT}</p>
        </section>
        <section className="bks-lobby__crews">
          <div className="bks-lobby__crews-head">
            <h2 className="bks-h2">Экипажи у старта</h2>
            <span className="bks-muted">экипаж — ваша команда</span>
          </div>
          {crews.length === 0 ? (
            <p className="bks-panel bks-empty">Ждём первых гостей — входите по коду или QR.</p>
          ) : (
            <ul className={many ? "bks-lobby__list is-two" : "bks-lobby__list"} style={{ "--bks-rows": many ? Math.ceil(crews.length / 2) : crews.length } as CSSProperties}>
              {crews.map((c) => {
                const shown = chipsShown(c.names, crews.length);
                return (
                  <li key={c.id} className={shown > 0 ? "bks-panel bks-lobby__crew" : "bks-panel bks-lobby__crew is-bare"} style={crewVars(c.color)}>
                    <Craft crew={c} theme={v.theme} className="bks-lobby__ship" />
                    {/* Аудит 2c, №2: название — на всю ширину первой строкой, «N из M мест» — одной строкой рядом, имена — ниже. */}
                    <div className="bks-lobby__title">
                      <b className="bks-name">{q(c.name)}</b>
                      <span className="bks-muted bks-nowrap">
                        {`${c.count} из${NB}${max}${NB}мест`}
                      </span>
                    </div>
                    {shown > 0 && (
                      <span className={shown === 1 ? "bks-chips is-one" : "bks-chips"}>
                        {c.names.slice(0, shown).map((n, i) => (
                          <span key={`${n}-${i}`} className="bks-person">
                            {n}
                          </span>
                        ))}
                        {c.names.length > shown && <span className="bks-person bks-person--more">+{c.names.length - shown}</span>}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {lobby && lobby.waiting.length > 0 && (
            <p className="bks-panel bks-lobby__wait">
              <b>Ждут распределения: {lobby.waiting.length}</b>{" "}
              <span className="bks-lobby__wait-names">
                {lobby.waiting.slice(0, 4).join(", ")}
                {lobby.waiting.length > 4 ? ` и ещё ${lobby.waiting.length - 4}` : ""} — ведущий посадит их в свободные места
              </span>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ экипажи собраны

function initials(names: readonly string[], max: number): string[] {
  return names.slice(0, max).map((n) => (n.replace(/^\p{Extended_Pictographic}️?\s*/u, "").trim().charAt(0) || "•").toUpperCase());
}

function onlineText(c: ScreenCrewView): { text: string; ok: boolean } {
  if (c.members === 0) return { text: "Ждёт гостей", ok: false };
  const off = c.members - c.online;
  if (off <= 0) return { text: "Все на связи", ok: true };
  return { text: `${off} без связи`, ok: false };
}

export function CrewsBoard({ v, m, code }: BoardProps) {
  const w = wordsOf(v.theme);
  const crews = [...v.crews].sort((a, b) => a.id - b.id);
  const cols = cardColumns(crews.length);
  const small = crews.length > 5;
  const tiny = crews.length > 10;
  const maxInitials = crews.length <= 5 ? 12 : crews.length <= 10 ? 6 : 4;
  return (
    <div className="bks-board bks-crews">
      <Head title={GAME_TITLE} sub={`Тема «${w.title}» · экипажи собраны`}>
        <Chip>
          Гостей <b>{m.players}</b> · {crewsText(crews.length)}
        </Chip>
      </Head>
      <div className="bks-center">
        <h2 className="bks-title">Экипажи готовы к вылету</h2>
        <p className="bks-sub">
          Цель — {w.goalTitle}. Приказ приходит не тому, у кого прибор: <b className="bks-gold">кричите своему экипажу!</b>
        </p>
      </div>
      <ul className={small ? "bks-cards is-small" : "bks-cards"} style={{ "--bks-cols": cols } as CSSProperties}>
        {crews.map((c) => {
          const st = onlineText(c);
          const letters = initials(c.names, maxInitials);
          return (
            <li key={c.id} className="bks-panel bks-card" style={crewVars(c.color)}>
              {!tiny && <Craft crew={c} theme={v.theme} className="bks-card__ship" />}
              <b className="bks-card__name bks-name bks-name2">{cardName(c.name, crews.length > 5)}</b>
              <span className="bks-muted">
                {c.members} {plural(c.members, "человек", "человека", "человек")}
              </span>
              {!small && (
                <span className="bks-initials" aria-hidden="true">
                  {letters.map((l, i) => (
                    <span key={i}>{l}</span>
                  ))}
                  {c.names.length > letters.length && <span className="is-more">+{c.names.length - letters.length}</span>}
                </span>
              )}
              <span className={st.ok ? "bks-status is-ok" : "bks-status"}>{st.text}</span>
            </li>
          );
        })}
      </ul>
      <div className="bks-foot2">
        <div className="bks-panel bks-join">
          <JoinQr code={code} small />
          <div>
            <span className="bks-muted">Вход по коду · {joinHint()}</span>
            <Code code={code} />
          </div>
          <p className="bks-join__text">Опоздали? Войдите по коду — станете дублёром в самом маленьком экипаже, а со следующего перелёта получите свои приборы.</p>
        </div>
        <div className="bks-panel bks-next">
          <Kicker>Следующий шаг</Kicker>
          <b className="bks-next__title">Тренировка · {Math.round(DRILL_MS / 1000)} секунд</b>
          <span className="bks-muted">На iPhone появится кнопка «Разрешить тряску»</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ тренировка

export function DrillBoard({ v, m, local, code }: BoardProps) {
  const w = wordsOf(v.theme);
  const left = secondsLeft(leftUntil(m, v.endsAt, local));
  const over = v.endsAt === null;
  const crews = [...v.crews].sort((a, b) => a.id - b.id);
  return (
    <div className="bks-board bks-drill">
      <Head title={GAME_TITLE} sub={`Тема «${w.title}» · тренировка`}>
        <Chip>
          Вход по коду <Code code={code} />
        </Chip>
      </Head>
      <div className="bks-center bks-grow">
        <Kicker>Перед вылетом</Kicker>
        <h2 className="bks-title">{over ? "Тренировка окончена" : "Тренировка"}</h2>
        <p className="bks-sub">{over ? "Ждём ведущего — сейчас взлёт." : "Двигайте свои приборы и кричите приказы — сейчас не считается, просто пробуем."}</p>
        {!over && <HallTimer left={left} total={DRILL_MS / 1000} size="22cqh" />}
      </div>
      <ul className="bks-ships" style={{ "--bks-cols": shipCols(crews.length) } as CSSProperties}>
        {crews.map((c) => (
          <li key={c.id} className="bks-ships__item">
            <Craft crew={c} theme={v.theme} />
            <span className="bks-name">{q(c.name)}</span>
            <span className="bks-muted">
              {`на связи ${c.online} из${NB}${c.members}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ взлёт

export function LaunchBoard({ v, m, local }: BoardProps) {
  const w = wordsOf(v.theme);
  const left = secondsLeft(leftUntil(m, v.endsAt, local));
  const minutes = v.flight ? Math.round(v.flight.duration / 60_000) : null;
  const crews = [...v.crews].sort((a, b) => a.id - b.id);
  return (
    <div className="bks-board bks-launch">
      <Head title={GAME_TITLE} sub={`${legText(v)} · тема «${w.title}»`}>
        <Chip>
          Гостей <b>{m.players}</b>
        </Chip>
      </Head>
      <div className="bks-launch__mid">
        <div className="bks-center">
          <Kicker>{legText(v)}</Kicker>
          <h2 className="bks-title bks-title--xl">Взлёт</h2>
          <p className="bks-sub">
            Цель — {w.goalTitle}
            {minutes ? ` · ${minutes} ${plural(minutes, "минута", "минуты", "минут")}` : ""}
          </p>
        </div>
        <HallTimer left={left} total={LAUNCH_MS / 1000} size="24cqh" />
        <div className="bks-goal bks-launch__goal">
          <Goal theme={v.theme} />
        </div>
      </div>
      <ul className="bks-ships" style={{ "--bks-cols": shipCols(crews.length) } as CSSProperties}>
        {crews.map((c) => (
          <li key={c.id} className="bks-ships__item">
            <Craft crew={c} theme={v.theme} />
            <span className="bks-name">{q(c.name)}</span>
          </li>
        ))}
      </ul>
      <Note>
        Смотрите в телефон: <b className="bks-gold">приказ сверху — кричите его экипажу</b>
      </Note>
    </div>
  );
}

// ------------------------------------------------------------------ полёт

function Hull({ hull }: { hull: number }) {
  return (
    <span className="bks-hull" role="img" aria-label={`Прочность ${Math.round(hull * 10) / 10} из 5`}>
      {hullCells(hull).map((p, i) => (
        <span key={i} className="bks-hull__cell">
          <span style={{ transform: `scaleX(${p / 100})` }} />
        </span>
      ))}
    </span>
  );
}

function FlightClock({ m, local }: { m: ScreenModel; local: number }) {
  const f = m.view?.flight;
  if (!f) return null;
  const left = secondsLeft(flightLeft(m, local));
  return (
    <span className={f.stopped ? "bks-clock is-stopped" : "bks-clock"}>
      <HallTimer left={left} total={Math.round(f.duration / 1000)} size="8.5cqh" />
      {f.stopped && <span className="bks-clock__note">время стоит</span>}
    </span>
  );
}

const EVENT_NAMES = { meteor: "Метеоритный дождь", pull: "Притяжение", sos: "Сигнал SOS", captain: "Все на палубу!" } as const;

function Lane({ c, theme, compact, event, kids, bump }: { c: ScreenCrewView; theme: Theme; compact: boolean; event: ScreenView["event"]; kids: boolean; bump: { ok: number; fail: number } | undefined }) {
  const p = progressOf(c.dist);
  const shield = event?.kind === "meteor" && !event.warn ? c.shield : null;
  const sh = shield === null ? null : shieldLook(shield, kids);
  const late = p > 0.55;
  const cls = ["bks-lane", c.fire ? "is-fire" : "", c.repair ? "is-repair" : "", c.finished ? "is-finished" : "", late ? "is-late" : ""].filter(Boolean).join(" ");
  // Рывок — только когда счётчик вырос при открытом экране (аудит 2c, №7): ключ меняется лишь тогда, класс есть лишь после первого.
  const ok = bump?.ok ?? 0;
  const fail = bump?.fail ?? 0;
  return (
    <li className={cls} style={{ ...crewVars(c.color), "--bks-p": p } as CSSProperties}>
      <div className={compact ? "bks-panel bks-lane__card is-compact" : "bks-panel bks-lane__card"}>
        <span className={c.place === 1 ? "bks-place is-first" : "bks-place"}>{c.place}</span>
        <Badge crew={c} />
        <b className="bks-name bks-lane__name">{q(c.name)}</b>
        {!compact && <Hull hull={c.hull} />}
        <span className={c.repair ? "bks-lane__speed is-bad" : "bks-lane__speed"}>{speedText(c)}</span>
      </div>
      <div className="bks-lane__track">
        <span className="bks-lane__rail" />
        <span className="bks-lane__trail" />
        <span className="bks-lane__mover">
          <span className="bks-lane__ship">
            <span className={ok > 0 ? "bks-lane__bump is-on" : "bks-lane__bump"} key={`ok${ok}`}>
              <span className={fail > 0 ? "bks-lane__jolt is-on" : "bks-lane__jolt"} key={`f${fail}`}>
                <Craft crew={c} theme={theme} />
              </span>
            </span>
            {sh && shield !== null && (
              // Щит — вокруг корабля, поверх (полупрозрачный); растёт от силы, но корабль — не выше дорожки, и щит соседей не
              // задевает (аудит 2c, №1).
              <span className={sh.weak ? "bks-shield is-weak" : "bks-shield"} style={{ "--bks-sh": sh.scale } as CSSProperties}>
                {/* Подпись щита — когда у корабля нет своей плашки («Ремонт», «У цели!»): иначе они легли бы друг на друга. */}
                {!c.repair && !c.finished && <span className="bks-shield__text">щит {shield}</span>}
              </span>
            )}
            {c.repair && <span className="bks-tag bks-tag--alert">Ремонт · жмите «Чиним!»</span>}
            {c.finished && <span className="bks-tag bks-tag--good">У цели!</span>}
          </span>
        </span>
      </div>
    </li>
  );
}

export function FlightBoard({ v, m, local, code, bumps }: BoardProps) {
  const w = wordsOf(v.theme);
  const { lanes, rest } = lanesOf(v.crews);
  const compact = lanes.length > 5;
  const ev = v.event;
  const best = v.best ? v.crews.find((c) => c.id === v.best?.crew) : undefined;
  const glitch = v.glitchUntil !== null && (leftUntil(m, v.glitchUntil, local) ?? 0) > 0;
  const warnLeft = ev?.warn ? secondsLeft(leftUntil(m, ev.startsAt, local)) : null;
  const meteor = ev?.kind === "meteor" && !ev.warn;
  const meteorLeft = meteor ? secondsLeft(leftUntil(m, ev.endsAt, local)) : null;
  const guests = v.crews.reduce((a, c) => a + c.members, 0);
  return (
    <div className={`bks-board bks-flight${compact ? " is-many" : ""}${meteor ? " is-meteor" : ""}${glitch ? " is-glitch" : ""}`}>
      <Head title={GAME_TITLE} sub={`${legText(v)} · ${rest.length > 0 ? `${crewsText(v.crews.length)} · ${guestsText(guests)}` : `цель — ${w.goalTitle}`}`}>
        <Chip>
          Приказов выполнено <b className="bks-gold">{num(v.ordersDone)}</b>
        </Chip>
        <FlightClock m={m} local={local} />
      </Head>
      {(meteor || ev?.warn || glitch) && (
        <div className="bks-flight__bar">
          {meteor && (
            <div className="bks-banner bks-banner--event">
              <b className="bks-banner__title">Метеоритный дождь!</b>
              <span className="bks-banner__text">Трясите телефоны — включаются щиты</span>
              <HallTimer left={meteorLeft} total={EVENT_MS.meteor / 1000} size="9cqh" />
            </div>
          )}
          {ev?.warn && (
            <div className="bks-banner bks-banner--warn" role="status">
              <b className="bks-banner__title">Внимание! {EVENT_NAMES[ev.kind]}</b>
              <span className="bks-banner__text">через {warnLeft ?? 0} с — смотрите на экран</span>
            </div>
          )}
          {glitch && (
            <div className="bks-banner bks-banner--glitch" role="status">
              <b className="bks-banner__title">Глюк в системе!</b>
              <span className="bks-banner__text">Плитки на телефонах поменялись местами — приборы те же</span>
            </div>
          )}
        </div>
      )}
      <div className="bks-flight__field">
        <ul className="bks-lanes" style={{ "--bks-n": lanes.length } as CSSProperties}>
          {lanes.map((c) => (
            <Lane key={c.id} c={c} theme={v.theme} compact={compact} event={ev} kids={v.difficulty === "kids"} bump={bumps[c.id]} />
          ))}
        </ul>
        <span className="bks-finish" aria-hidden="true" />
        <div className="bks-goal">
          <Goal theme={v.theme} />
          <b className="bks-goal__title">{w.goalTitle}</b>
          <span className="bks-muted">
            {`цель ${v.leg + 1}-го перелёта из${NB}${v.legs}`}
          </span>
        </div>
        {meteor && (
          <span className="bks-meteors" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <i key={i} style={{ "--i": i } as CSSProperties} />
            ))}
          </span>
        )}
      </div>
      {rest.length > 0 ? (
        <section className="bks-panel bks-rest">
          <p className="bks-rest__head">
            <span>
              Ещё {crewsText(rest.length)} · {placesText(rest[0]?.place, rest[rest.length - 1]?.place)}
            </span>
            <span>
              Вход по коду <Code code={code} />
            </span>
          </p>
          <ul className="bks-rest__list">
            {rest.map((c) => (
              <li key={c.id} style={crewVars(c.color)}>
                <span className="bks-rest__place">{c.place}</span>
                <Badge crew={c} />
                <span className="bks-name">{q(c.name)}</span>
                <span className="bks-rest__bar">
                  <span style={{ transform: `scaleX(${progressOf(c.dist)})` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <footer className="bks-panel bks-foot">
          <span className="bks-foot__label">Слаженнее всех</span>
          <span className="bks-foot__best">
            {best && v.best ? (
              <>
                {best.fire ? "🔥 " : ""}
                <b className="bks-gold">{q(best.name)}</b> — серия {v.best.streak} {plural(v.best.streak, "приказ", "приказа", "приказов")} без промаха
                {best.fire ? ", шлейф горит" : ""}
              </>
            ) : (
              "Выполняйте приказы подряд — лучшая серия появится здесь"
            )}
          </span>
          <span className="bks-foot__code">
            Вход по коду <Code code={code} />
          </span>
        </footer>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ события

function EventHead({ kicker, title, sub, left, total }: { kicker: string; title: string; sub: ReactNode; left: number | null; total: number }) {
  return (
    <div className="bks-event__head">
      <Kicker>{kicker}</Kicker>
      <h2 className="bks-title">{title}</h2>
      <div className="bks-event__sub">
        <p className="bks-sub">{sub}</p>
        <HallTimer left={left} total={total} size="9cqh" />
      </div>
    </div>
  );
}

function eventCrews(v: ScreenView): ScreenCrewView[] {
  const ids = new Set(v.event?.crews ?? []);
  return v.crews.filter((c) => ids.has(c.id)).sort((a, b) => a.id - b.id);
}

export function PullBoard({ v, m, local }: BoardProps) {
  const w = wordsOf(v.theme);
  const ev = v.event;
  const left = secondsLeft(leftUntil(m, ev?.endsAt, local));
  const crews = eventCrews(v);
  const two = crews.length > 7;
  return (
    <div className="bks-board bks-event bks-pull">
      <EventHead kicker="Событие · Притяжение" title={w.pull} sub="Весь экипаж держит «Тягу» 3 секунды — отпустил один, отсчёт заново" left={left} total={EVENT_MS.pull / 1000} />
      <div className="bks-pull__body">
        <span className="bks-pull__puller">
          <Puller theme={v.theme} />
        </span>
        <ul className={two ? "bks-pull__list is-two" : "bks-pull__list"} style={{ "--bks-rows": two ? Math.ceil(crews.length / 2) : crews.length } as CSSProperties}>
          {crews.map((c) => {
            const p = pullOf(c, PULL_HOLD_MS);
            const who = c.pull && c.pull.notHolding.length > 0 ? `Не держит: ${c.pull.notHolding.join(", ")}` : `Держат все ${p.total}`;
            return (
              <li key={c.id} className={`bks-panel bks-pull__row is-${p.tone}`} style={crewVars(c.color)}>
                {!two && <Craft crew={c} theme={v.theme} className="bks-pull__ship" />}
                <span className="bks-pull__who">
                  <b className="bks-name">{q(c.name)}</b>
                  {!two && <span className="bks-muted bks-ellipsis">{p.tone === "ok" ? "Оторвались от погони" : who}</span>}
                </span>
                {!two && (
                  <span className="bks-dots" aria-label={`Держат ${p.holding} из ${p.total}`}>
                    {Array.from({ length: Math.min(p.total, 10) }, (_, i) => (
                      <i key={i} className={i < p.holding ? "is-on" : ""} />
                    ))}
                  </span>
                )}
                <span className="bks-bar">
                  <span style={{ transform: `scaleX(${p.share})` }} />
                </span>
                <span className="bks-pull__state">{p.text}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <Note>Не вырвались за {Math.round(EVENT_MS.pull / 1000)} секунд — минус деление прочности. Гостей без связи не ждут.</Note>
    </div>
  );
}

export function SosBoard({ v, m, local }: BoardProps) {
  const w = wordsOf(v.theme);
  const ev = v.event;
  const seq = ev?.seq ?? [];
  const left = secondsLeft(leftUntil(m, ev?.endsAt, local));
  const now = m.paused && m.pausedAt !== null ? m.pausedAt : local + (m.offset ?? 0);
  const lit = ev ? sosLit(seq.length, ev.startsAt, now) : null;
  const crews = eventCrews(v);
  const cols = cardColumns(crews.length);
  // Два ряда карточек и больше — плотно: без кавычек, капитан и итог одной строкой (повторный аудит 2c, №6).
  const dense = crews.length > 5;
  const cycle = Math.round(sosCycleMs(seq.length) / 1000);
  return (
    <div className={crews.length > 10 ? "bks-board bks-event bks-sos is-dense" : "bks-board bks-event bks-sos"}>
      <EventHead kicker="Событие · Сигнал SOS" title={`Запомните ${w.sos}!`} sub="Капитан повторяет на телефоне, экипаж подсказывает вслух" left={left} total={EVENT_MS.sos / 1000} />
      <div className="bks-garland" role="img" aria-label={`Сигнал: ${seq.map((c) => SOS_NAMES[c] ?? "").join(", ")}`}>
        <span className="bks-garland__wire" aria-hidden="true" />
        {seq.map((color, i) => (
          <span key={i} className={i === lit ? "bks-bulb is-lit" : "bks-bulb"} style={{ "--bks-bulb": `var(--bk-dial-${color})` } as CSSProperties}>
            <span className="bks-bulb__glass">{i === lit ? SOS_SHAPES[color] : ""}</span>
          </span>
        ))}
      </div>
      <p className="bks-pill">
        {lit === null ? "Сейчас повтор" : `Огонёк ${lit + 1} из${NB}${seq.length}`} · повтор каждые {cycle} {plural(cycle, "секунду", "секунды", "секунд")} · у каждого цвета своя фигура
      </p>
      <ul className={crews.length > 10 ? `bks-cards bks-sos__cards is-dense${crews.length > 14 ? " is-many" : ""}` : "bks-cards bks-sos__cards"} style={{ "--bks-cols": Math.max(1, cols) } as CSSProperties}>
        {crews.map((c) => {
          const s = c.sos;
          const progress = s?.progress ?? 0;
          const captain = s?.captain ? `капитан ${s.captain}` : "капитана нет на связи";
          return (
            <li key={c.id} className={s?.done ? "bks-panel bks-sos__card is-done" : "bks-panel bks-sos__card"} style={crewVars(c.color)}>
              <span className="bks-sos__name">
                <Badge crew={c} />
                <b className="bks-name bks-name2">{cardName(c.name, dense)}</b>
              </span>
              {/* Плотно (больше 7 экипажей) — капитан и итог одной строкой: название в две строки помещается (повторный аудит 2c, №6). */}
              {!dense && <span className="bks-muted bks-ellipsis">{captain}</span>}
              <span className="bks-boxes">
                {seq.map((_, i) => (
                  <i key={i} className={i < progress || s?.done ? "is-on" : ""} />
                ))}
              </span>
              <span className={dense ? "bks-sos__state bks-ellipsis" : "bks-sos__state"}>{s?.done ? `Принято! +${SOS_BONUS}` : dense ? captain : "Набирают…"}</span>
            </li>
          );
        })}
      </ul>
      <Note>Верно — +{SOS_BONUS} к дальности. Ошибка — набор с начала. Не успели — без штрафа.</Note>
    </div>
  );
}

export function CaptainBoard({ v, m, local }: BoardProps) {
  const ev = v.event;
  const left = secondsLeft(leftUntil(m, ev?.endsAt, local));
  const crews = eventCrews(v);
  const cols = cardColumns(crews.length);
  const task = ev?.task ?? "Задание ведущего";
  const look = captainLayout(task, crews.length);
  return (
    <div className={`bks-board bks-event bks-captain is-${look.size}`}>
      <div className="bks-event__head">
        <Kicker>Событие · Все на палубу!</Kicker>
        <h2 className="bks-title bks-captain__task">{task}</h2>
        <p className="bks-sub">Весь экипаж вместе, со звуком · приказы на паузе</p>
      </div>
      <div className="bks-captain__timer">
        <HallTimer left={left} total={EVENT_MS.captain / 1000} size={look.timer} />
      </div>
      <ul className={crews.length > 5 || !look.ships ? "bks-cards is-small" : "bks-cards"} style={{ "--bks-cols": cols } as CSSProperties}>
        {crews.map((c) => (
          <li key={c.id} className="bks-panel bks-card" style={crewVars(c.color)}>
            {look.ships && <Craft crew={c} theme={v.theme} className="bks-card__ship" />}
            <b className="bks-card__name bks-name bks-name2">{cardName(c.name, crews.length > 5)}</b>
            <span className="bks-muted">
              {c.members} {plural(c.members, "человек", "человека", "человек")}
            </span>
          </li>
        ))}
      </ul>
      <Note>
        Ведущий поставит каждому экипажу от 0 до {CAPTAIN_STARS_MAX} звёзд — до +{CAPTAIN_STAR * CAPTAIN_STARS_MAX} к дальности
      </Note>
    </div>
  );
}

// ------------------------------------------------------------------ привал

export function DockBoard({ v }: BoardProps) {
  const w = wordsOf(v.theme);
  const rows = v.dock?.rows ?? [];
  const dense = rows.length > 8;
  const winner = rows.find((r) => r.place === 1);
  const last = v.leg + 1 >= v.legs;
  const nameOf = (id: number) => v.crews.find((c) => c.id === id);
  const streak = v.dock?.bestStreak ? nameOf(v.dock.bestStreak.crew) : undefined;
  const shield = v.dock?.bestShield ? nameOf(v.dock.bestShield.crew) : undefined;
  const next = last ? "Награждение — лучший экипаж вечера" : `Перелёт ${v.leg + 2} из${NB}${v.legs}`;
  return (
    <div className="bks-board bks-dock">
      <Head title={`Привал · ${w.goalTitle}`} sub={`Итоги перелёта ${v.leg + 1} из${NB}${v.legs}`}>
        {winner && (
          <Chip>
            Победитель перелёта — <b className="bks-coral">{q(winner.name)}</b>
          </Chip>
        )}
      </Head>
      <div className={dense ? "bks-panel bks-table is-dense" : "bks-panel bks-table"} role="table" aria-label="Итоги перелёта">
        <div className="bks-table__row bks-table__head" role="row">
          <span role="columnheader">Место</span>
          <span role="columnheader">Экипаж</span>
          <span role="columnheader">За приказы</span>
          <span role="columnheader">Финиш раньше</span>
          <span role="columnheader">События</span>
          <span role="columnheader">За перелёт</span>
          <span role="columnheader">Лучшая серия</span>
          <span role="columnheader">Больше всех приказов</span>
        </div>
        <div className="bks-table__body" style={{ "--bks-rows": Math.max(1, rows.length) } as CSSProperties}>
          {rows.map((r) => {
            const crew = nameOf(r.crew);
            return (
              <div key={r.crew} className={r.place === 1 ? "bks-table__row is-first" : "bks-table__row"} role="row" style={crewVars(crew?.color ?? r.crew)}>
                <span role="cell">
                  <span className={`bks-place is-${Math.min(r.place, 4)}`}>{r.place}</span>
                </span>
                <span role="cell" className="bks-table__crew">
                  {!dense && crew && <Craft crew={crew} theme={v.theme} className="bks-table__ship" />}
                  {dense && crew && <Badge crew={crew} />}
                  <b className={dense ? "bks-name" : "bks-name bks-name2"}>{q(r.name)}</b>
                </span>
                <span role="cell">{num(r.orders)}</span>
                <span role="cell" className="bks-table__two">
                  {r.finish > 0 ? (
                    <>
                      <b className="bks-sage">+{num(r.finish)}</b>
                      {!dense && <small>за {clock((r.finish / 2) * 1000)} до конца</small>}
                    </>
                  ) : (
                    <>
                      <b>—</b>
                      {!dense && <small>не долетели</small>}
                    </>
                  )}
                </span>
                <span role="cell">+{num(r.events)}</span>
                <span role="cell" className="bks-table__total">
                  {num(r.total)}
                </span>
                <span role="cell">{r.streak > 0 ? `🔥 ${r.streak}` : "—"}</span>
                <span role="cell" className="bks-ellipsis">
                  {r.best ? `${r.best.name} · ${r.best.done}` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="bks-dock__cards">
        <div className="bks-panel bks-fact">
          <Kicker>Самая длинная серия</Kicker>
          <b className="bks-ellipsis2">{streak && v.dock?.bestStreak ? `${q(streak.name)} — ${v.dock.bestStreak.streak} ${plural(v.dock.bestStreak.streak, "приказ", "приказа", "приказов")} подряд` : "Серий не было"}</b>
        </div>
        <div className="bks-panel bks-fact">
          <Kicker>Лучший щит перелёта</Kicker>
          <b className="bks-ellipsis2">{shield && v.dock?.bestShield ? `${q(shield.name)} — щит ${v.dock.bestShield.shield}` : "Метеоритного дождя не было"}</b>
        </div>
        <div className="bks-panel bks-fact bks-fact--next">
          <Kicker>Дальше</Kicker>
          <b className="bks-ellipsis2">{v.voteAhead === true && v.stage === "dock" ? `Голосование «Кто диверсант?», затем ${last ? "награждение" : `перелёт ${v.leg + 2}`}` : next}</b>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ диверсант

export function VoteBoard({ v, m, local }: BoardProps) {
  const vote = v.vote;
  const left = secondsLeft(leftUntil(m, vote?.endsAt, local));
  const crews = v.crews.filter((c) => vote && vote.voters[String(c.id)] !== undefined).sort((a, b) => a.id - b.id);
  const cols = cardColumns(crews.length);
  return (
    <div className="bks-board bks-event bks-vote">
      <EventHead
        kicker="Режим «Диверсант на борту»"
        title="Кто мешал вашему экипажу?"
        sub="Голосуйте на телефоне — за себя нельзя, голос диверсанта не считается"
        left={left}
        total={VOTE_MS / 1000}
      />
      <ul className={crews.length > 5 ? "bks-cards is-small" : "bks-cards"} style={{ "--bks-cols": cols } as CSSProperties}>
        {crews.map((c) => {
          const all = vote?.voters[String(c.id)] ?? 0;
          const done = vote?.voted[String(c.id)] ?? 0;
          return (
            <li key={c.id} className="bks-panel bks-card" style={crewVars(c.color)}>
              {crews.length <= 10 && <Craft crew={c} theme={v.theme} className="bks-card__ship" />}
              <b className="bks-card__name bks-name bks-name2">{cardName(c.name, crews.length > 5)}</b>
              <span className="bks-bar">
                <span style={{ transform: `scaleX(${all > 0 ? done / all : 0})` }} />
              </span>
              <span className="bks-muted">
                {`проголосовали ${done} из${NB}${all}`}
              </span>
            </li>
          );
        })}
      </ul>
      <Note>Угадали диверсанта — экипажу +{VOTE_BONUS} к общему счёту. Не угадали — диверсанту лента «Мастер обмана».</Note>
    </div>
  );
}

export function RevealBoard({ v, revealSeen, local }: BoardProps) {
  const list = [...(v.reveal ?? [])].sort((a, b) => a.crew - b.crew);
  const open = revealedCount(list.length, revealSeen === null ? null : local - revealSeen);
  const cols = cardColumns(list.length);
  return (
    <div className="bks-board bks-event bks-reveal">
      <div className="bks-event__head">
        <Kicker>Режим «Диверсант на борту»</Kicker>
        <h2 className="bks-title">Кто мешал вашему экипажу?</h2>
        <p className="bks-sub">{open < list.length ? "Экипажи проголосовали. Раскрываем по одному." : "Все диверсанты раскрыты."}</p>
      </div>
      <ul className={list.length > 5 ? "bks-cards is-small" : "bks-cards"} style={{ "--bks-cols": cols } as CSSProperties}>
        {list.map((r, i) => {
          const crew = v.crews.find((c) => c.id === r.crew);
          const shown = i < open;
          const g = guessedOf(r);
          return (
            <li key={r.crew} className={shown ? "bks-panel bks-spy is-open" : "bks-panel bks-spy"} style={crewVars(crew?.color ?? r.crew)}>
              <span className="bks-spy__crew">
                {crew && <Badge crew={crew} />}
                <span className="bks-name">{q(crew?.name ?? `Экипаж ${r.crew + 1}`)}</span>
              </span>
              <span className="bks-spy__face">{shown ? <Mask /> : <span className="bks-spy__q">?</span>}</span>
              {shown ? (
                <>
                  <b className="bks-spy__name bks-name bks-name2">{r.name}</b>
                  <span className="bks-muted">
                    {r.fakes} {plural(r.fakes, "ложный приказ выполнен", "ложных приказа выполнено", "ложных приказов выполнено")}
                  </span>
                  <span className={r.guessed ? "bks-verdict is-good" : "bks-verdict is-bad"}>{r.guessed ? `Раскусили! Экипажу +${VOTE_BONUS}` : "Не раскусили — лента «Мастер обмана»"}</span>
                  <span className="bks-muted">{g.all > 0 ? `угадали ${g.right} из${NB}${g.all}` : "никто не голосовал"}</span>
                </>
              ) : (
                <>
                  <b className="bks-spy__name">Раскрываем…</b>
                  <span className="bks-muted">барабанная дробь</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <Note>Раскусили — экипажу +{VOTE_BONUS} к общему счёту. Не раскусили — диверсанту лента «Мастер обмана».</Note>
    </div>
  );
}

// ------------------------------------------------------------------ пьедестал

export function PodiumBoard({ v, m }: BoardProps) {
  const w = wordsOf(v.theme);
  const list = v.podium ?? [];
  const crewOf = (id: number) => v.crews.find((c) => c.id === id);
  const firsts = list.filter((p) => p.place <= 3);
  const step = (place: number) => firsts.filter((p) => p.place === place);
  const others = list.filter((p) => p.place > 3);
  const shownOthers = others.slice(0, 8);
  const pedestal = (place: number) => {
    const people = step(place);
    if (people.length === 0) return <div key={place} className={`bks-step is-${place} is-empty`} />;
    return (
      <div key={place} className={`bks-step is-${place}`}>
        <span className="bks-step__ships">
          {people.slice(0, 2).map((p) => {
            const c = crewOf(p.crew);
            return c ? <Craft key={p.crew} crew={c} theme={v.theme} className="bks-step__ship" /> : null;
          })}
        </span>
        <span className="bks-step__block">
          <b className="bks-step__place">{place}</b>
          {people.slice(0, people.length > 2 ? 1 : 2).map((p) => (
            <span key={p.crew} className="bks-step__who">
              <b className="bks-name bks-name2">{q(p.name)}</b>
              <span>{num(p.total)}</span>
            </span>
          ))}
          {people.length > 2 && <span className="bks-muted">и ещё {people.length - 1} с тем же счётом</span>}
        </span>
      </div>
    );
  };
  return (
    <div className="bks-board bks-podium">
      <Head title={GAME_TITLE} sub={`Итоги ${v.legs === 2 ? "двух" : "трёх"} перелётов · тема «${w.title}»`}>
        <Chip>
          Гостей <b>{m.players}</b>
        </Chip>
      </Head>
      <h2 className="bks-title bks-center">Лучший экипаж вечера</h2>
      <div className="bks-steps">{[2, 1, 3].map(pedestal)}</div>
      {others.length > 0 && (
        <ul className="bks-others">
          {shownOthers.map((p) => (
            <li key={p.crew} className="bks-chip">
              {p.place} место · <b className="bks-name">{q(p.name)}</b> · {num(p.total)}
            </li>
          ))}
          {others.length > shownOthers.length && <li className="bks-chip">и ещё {others.length - shownOthers.length}</li>}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ служебные

export function InfoBoard({ title, text, children, theme }: { title: string; text: ReactNode; children?: ReactNode; theme: Theme }) {
  return (
    <div className="bks-board bks-info">
      <Head title={GAME_TITLE} sub={`Тема «${wordsOf(theme).title}»`} />
      <div className="bks-center bks-grow bks-info__body">
        <h2 className="bks-title">{title}</h2>
        <p className="bks-sub">{text}</p>
        {children}
      </div>
    </div>
  );
}

export function OverBoard({ theme, board }: { theme: Theme; board: ReadonlyArray<{ id: string; name: string; score: number; place?: number }> }) {
  const top = board.slice(0, 10);
  return (
    <InfoBoard theme={theme} title="Игра окончена" text={top.length > 0 ? "Спасибо, что летали с нами! Итоговый счёт экипажей:" : "Спасибо, что летали с нами!"}>
      {top.length > 0 && (
        <ol className="bks-panel bks-over">
          {top.map((r, i) => (
            <li key={r.id}>
              <span className="bks-place">{r.place ?? i + 1}</span>
              <b className="bks-name">{q(r.name)}</b>
              <span>{num(r.score)}</span>
            </li>
          ))}
        </ol>
      )}
    </InfoBoard>
  );
}
