// «Бункер»: экран зала — катастрофа, карты бункера, досье всех игроков, ход, голосование, изгнание,
// финал; телефон — свои шесть карт и особое условие (видит только хозяин), ход, тайный голос.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Confetti } from "../../components/live/Confetti";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { isKey, newKey, storedKey, storeKey } from "../mafia/seal";
import { quotaNow, type BunkerContent } from "./content";
import { BunkerCard, CardBack, CatastropheCard, Dossier, Icon, SpecialCard, ThreatCard, TraitCard } from "./CardArt";
import { openPhoneCard, type PhoneCard } from "./deal";
import { CAT_TITLES, CATS, cardText, type Cat } from "./decks";
import { answerOf, openable, parseBunkerResult, type BunkerAnswer, type BunkerResult } from "./logic";
import { REFUSALS, SPECIAL_BY_ID, type Refusal } from "./specials";

export type BunkerAnswerValue = BunkerAnswer;

const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "Игрок") : "");

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

function Who({ session, r, pid }: { session: Session; r: BunkerResult; pid: string }) {
  return (
    <>
      <span className="bk-num">№{r.seats.indexOf(pid) + 1}</span> <NameText name={nameOf(session, pid)} />
    </>
  );
}

/** Сколько изгнать в этом раунде (для подписи). */
function quotaOf(content: BunkerContent, r: BunkerResult): number {
  return quotaNow(r.round, content.rounds, r.alive.length, r.places, r.done);
}

/** Таймер речи, обсуждения или голосования (по часам сервера). */
function Timer({ endsAt, now, label }: { endsAt: number | null; now: number; label: string }) {
  const left = endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
  useCountdownSounds(left);
  if (endsAt === null) return null;
  return (
    <p className={`bk-timer${left !== null && left <= 5 ? " is-low" : ""}`} aria-live="off">
      <span>{label}</span> {clock(endsAt - now)}
    </p>
  );
}

// ——————————————————————————————————————————— экран зала

function BunkerRow({ r, content }: { r: BunkerResult; content: BunkerContent }) {
  return (
    <ol className="bk-screen__bunker" aria-label="Карты бункера">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i}>
          <BunkerCard index={r.bunkerShown[i] ?? null} n={i + 1} small />
        </li>
      ))}
      <li className="bk-screen__rounds" aria-hidden="true">
        {r.round > 0 ? `${Math.min(r.round, content.rounds)}/${content.rounds}` : ""}
      </li>
    </ol>
  );
}

function Dossiers({ session, r, highlight }: { session: Session; r: BunkerResult; highlight: string | null }) {
  const cols = r.seats.length <= 8 ? r.seats.length : Math.ceil(r.seats.length / 2);
  return (
    <ol className="bk-screen__dossiers" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))`, ["--bk-fs" as string]: `${Math.min(1.2, 9 / Math.max(cols, 6))}cqw` }}>
      {r.seats.map((p, i) => (
        <li key={p}>
          <Dossier name={nameOf(session, p)} seat={i + 1} shown={r.shown[p] ?? {}} used={r.used[p] ?? null} exiled={r.exiled.includes(p)} speaking={highlight === p} />
        </li>
      ))}
    </ol>
  );
}

export function BunkerScreenView({ session, content }: ViewProps<BunkerContent>) {
  const r = parseBunkerResult(session.state.result);
  const started = session.state.result !== null && session.state.result !== undefined && r.seats.length > 0;
  const now = useServerNow(250, r.speakEndsAt !== null || r.voteEndsAt !== null);
  const lastLog = r.log[r.log.length - 1] ?? null;

  if (!started || r.mode === "deal") {
    return (
      <div className="bk-screen bk-screen--intro">
        <div className="bk-fan" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} style={{ ["--i" as string]: i - 2 }}>
              <CardBack />
            </span>
          ))}
        </div>
        <h2 className="bk-title">Бункер</h2>
        <p className="bk-lead">{started ? `Раздаём карты: ${r.seats.length} ${plural(r.seats.length, "игрок", "игрока", "игроков")}, мест в бункере — ${Math.max(1, Math.floor(r.seats.length / 2))}` : "Катастрофа близко. Мест в бункере — только на половину из вас."}</p>
      </div>
    );
  }

  const quota = quotaOf(content, r);
  let stage: ReactNode = null;
  let big = false;
  switch (r.mode) {
    case "catastrophe":
      big = true;
      stage = (
        <div className="bk-stage bk-stage--cards">
          <div className="bk-stage__card bk-stage__card--wide">
            <CatastropheCard id={r.catastrophe} years={r.years} places={r.places} area={r.area} />
          </div>
          <div className="bk-stage__text">
            <p className="bk-kicker">Катастрофа случилась</p>
            <h2 className="bk-title">
              В бункере {r.places} {plural(r.places, "место", "места", "мест")} на {r.seats.length}
            </h2>
            <p className="bk-lead">
              {content.rounds} {plural(content.rounds, "раунд", "раунда", "раундов")}: каждый открывает карты и доказывает, что пригодится в бункере. Голосованием изгоняем лишних.
              {content.rebirth ? " Среди спасшихся должна быть пара, чтобы продолжить род." : ""}
            </p>
          </div>
        </div>
      );
      break;
    case "bunker": {
      const card = r.bunkerShown[r.round - 1] ?? null;
      big = true;
      stage = (
        <div className="bk-stage bk-stage--cards">
          <div className="bk-stage__card">
            <BunkerCard index={card} n={r.round} fresh />
          </div>
          <div className="bk-stage__text">
            <p className="bk-kicker">Раунд {r.round} · исследуем бункер</p>
            <h2 className="bk-title">Карта бункера №{r.round}</h2>
            <p className="bk-lead">{quota > 0 ? `В этом раунде изгоняем: ${quota}` : "В этом раунде без изгнания — знакомимся"}</p>
          </div>
        </div>
      );
      break;
    }
    case "open": {
      const sp = r.speaker;
      const cats = sp ? (r.open[sp] ?? []) : [];
      const last = cats[cats.length - 1] ?? null;
      const opened = r.speakEndsAt !== null;
      stage = (
        <div className="bk-stage bk-stage--turn">
          <div className="bk-stage__text">
            <p className="bk-kicker">
              Раунд {r.round} · круг открытия · {r.turn + 1} из {r.order.length}
            </p>
            <h2 className="bk-title">{sp ? <Who session={session} r={r} pid={sp} /> : "—"}</h2>
            <p className="bk-lead">{opened ? "Убедите всех, что вы нужны в бункере" : r.round <= 1 ? "Открывает профессию" : "Выбирает, какую карту открыть"}</p>
            <Timer endsAt={r.speakEndsAt} now={now} label="Речь" />
          </div>
          {opened && last && sp && (
            <div className="bk-stage__card bk-stage__card--small" key={`${sp}-${last}`}>
              <TraitCard cat={last} refId={r.shown[sp]?.[last]} fresh />
            </div>
          )}
        </div>
      );
      break;
    }
    case "discuss":
      stage = (
        <div className="bk-stage bk-stage--turn">
          <div className="bk-stage__text">
            <p className="bk-kicker">Раунд {r.round} · обсуждение</p>
            <h2 className="bk-title">{quota > 0 ? `Кого не берём? Изгоняем: ${quota}` : "В этом раунде без изгнания"}</h2>
            <Timer endsAt={r.speakEndsAt} now={now} label="Обсуждение" />
          </div>
        </div>
      );
      break;
    case "vote":
      stage = (
        <div className="bk-stage bk-stage--turn">
          <div className="bk-stage__text">
            <p className="bk-kicker">Раунд {r.round} · {r.revote ? "переголосование" : "тайное голосование"}</p>
            <h2 className="bk-title">Голосуйте на телефонах</h2>
            <p className="bk-lead">
              {r.revote ? (
                <>
                  Между:{" "}
                  {r.candidates.map((p, i) => (
                    <span key={p}>
                      {i > 0 ? ", " : ""}
                      <Who session={session} r={r} pid={p} />
                    </span>
                  ))}
                </>
              ) : (
                `Проголосовали: ${session.state.answered} из ${r.alive.length}`
              )}
            </p>
            {r.immune.length > 0 && (
              <p className="bk-chip bk-chip--gold">
                <Icon name="shield" /> Неприкосновенность: {r.immune.map((p) => nameOf(session, p)).join(", ")}
              </p>
            )}
            {r.cancelled && <p className="bk-chip bk-chip--red">Голосование будет отменено</p>}
            <Timer endsAt={r.voteEndsAt} now={now} label="Голосование" />
          </div>
        </div>
      );
      break;
    case "justify":
      stage = (
        <div className="bk-stage bk-stage--turn">
          <div className="bk-stage__text">
            <p className="bk-kicker">Ничья</p>
            <h2 className="bk-title">
              Оправдательная речь:{" "}
              {r.candidates.map((p, i) => (
                <span key={p}>
                  {i > 0 ? ", " : ""}
                  <Who session={session} r={r} pid={p} />
                </span>
              ))}
            </h2>
            {r.speaker && (
              <p className="bk-lead">
                Говорит <Who session={session} r={r} pid={r.speaker} />
              </p>
            )}
            <Timer endsAt={r.speakEndsAt} now={now} label="Речь" />
            <p className="bk-lead bk-lead--muted">Снова ничья — решит жребий.</p>
          </div>
        </div>
      );
      break;
    case "exile": {
      const out = r.tally?.out ?? null;
      big = true;
      stage = out ? (
        <div className="bk-stage bk-stage--exile">
          <div className="bk-stage__dossier">
            <Dossier name={nameOf(session, out)} seat={r.seats.indexOf(out) + 1} shown={r.shown[out] ?? {}} used={r.used[out] ?? null} exiled big />
          </div>
          <div className="bk-stage__text">
            <p className="bk-kicker">{r.tally?.random ? "Снова ничья — решил жребий" : "Итог голосования"}</p>
            <h2 className="bk-title">
              <Who session={session} r={r} pid={out} /> покидает бункер
            </h2>
            <Tally session={session} r={r} />
          </div>
        </div>
      ) : (
        <div className="bk-stage bk-stage--turn">
          <div className="bk-stage__text">
            <p className="bk-kicker">Раунд {r.round}</p>
            <h2 className="bk-title">{r.skips > 0 && !r.tally?.voters ? "Голосование пропущено" : "Голосование отменено"}</h2>
            <p className="bk-lead">Изгнание переносится на следующие раунды.</p>
          </div>
        </div>
      );
      break;
    }
    case "final":
      return <Final session={session} content={content} r={r} />;
  }

  return (
    <div className={`bk-screen${big ? " bk-screen--big" : ""}`}>
      <header className="bk-screen__top">
        <div className="bk-screen__cata">
          <CatastropheCard id={r.catastrophe} years={r.years} places={r.places} compact />
        </div>
        <p className="bk-screen__status">
          <span>
            Раунд <b>{r.round || "—"}</b> из {content.rounds}
          </span>
          <span>
            Мест <b>{r.places}</b>
          </span>
          <span>
            В игре <b>{r.alive.length}</b>
          </span>
        </p>
        <BunkerRow r={r} content={content} />
      </header>
      <section className="bk-screen__stage">{stage}</section>
      {!big && <Dossiers session={session} r={r} highlight={r.mode === "open" || r.mode === "justify" ? r.speaker : null} />}
      {lastLog && (
        <p className="bk-screen__log" key={lastLog}>
          <Icon name="bolt" /> {lastLog}
        </p>
      )}
    </div>
  );
}

function Tally({ session, r }: { session: Session; r: BunkerResult }) {
  const t = r.tally;
  if (!t) return null;
  const rows = Object.entries(t.counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <ul className="bk-tally">
      {rows.map(([p, n]) => (
        <li key={p} className={p === t.out ? "is-out" : undefined}>
          <span className="bk-tally__name">
            <NameText name={nameOf(session, p)} />
          </span>
          <span className="bk-tally__bar" style={{ width: `${(n / max) * 100}%` }} />
          <b>{n}</b>
        </li>
      ))}
      {t.exiledPick && <li className="bk-tally__note">Голос изгнанных: {nameOf(session, t.exiledPick)}</li>}
    </ul>
  );
}

function Final({ session, content, r }: { session: Session; content: BunkerContent; r: BunkerResult }) {
  const o = r.outcome;
  const cols = Math.max(1, Math.min(r.alive.length, 4));
  return (
    <div className="bk-screen bk-screen--final">
      {o?.won && <Confetti burst={`bk:${session.state.step}`} />}
      <header className="bk-final__head">
        <p className="bk-kicker">Двери бункера закрываются</p>
        <h2 className="bk-title">{o ? (o.won ? "Бункер выжил!" : "Бункер не выжил") : `В бункере: ${r.alive.length} ${plural(r.alive.length, "человек", "человека", "человек")}`}</h2>
        {o && (
          <p className="bk-lead">
            {o.rebirth === false ? "Нет пары, чтобы продолжить род. " : o.rebirth ? "Есть пара — человечество возродится. " : ""}
            {o.threats > 0 ? `Угрозы: справились с ${o.beaten} из ${o.threats}.` : ""}
            {o.won && content.winPoints > 0 ? ` Каждому в бункере +${content.winPoints}.` : ""}
          </p>
        )}
      </header>
      <div className="bk-final__body">
        <ol className="bk-screen__dossiers bk-final__survivors" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, ["--bk-fs" as string]: `${Math.min(1.5, 7 / cols)}cqw` }}>
          {r.alive.map((p) => (
            <li key={p}>
              <Dossier name={nameOf(session, p)} seat={r.seats.indexOf(p) + 1} shown={r.shown[p] ?? {}} used={r.used[p] ?? null} />
            </li>
          ))}
        </ol>
        <div className="bk-final__side">
          <ol className="bk-screen__bunker bk-final__bunker">
            {r.bunkerShown.map((c, i) => (
              <li key={i}>
                <BunkerCard index={c} n={i + 1} small />
              </li>
            ))}
          </ol>
          {r.threatsShown.length > 0 && (
            <ol className="bk-final__threats">
              {r.threatsShown.map((t, i) => (
                <li key={t}>
                  <ThreatCard index={t} verdict={r.verdicts[i] ?? null} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

// ——————————————————————————————————————————— телефон

function usePhoneCard(key: string | null, sealed: string | undefined): PhoneCard | null | undefined {
  const [card, setCard] = useState<PhoneCard | null | undefined>(undefined);
  useEffect(() => {
    if (!key || !sealed) {
      setCard(sealed ? null : undefined);
      return;
    }
    let live = true;
    void openPhoneCard(key, sealed).then((c) => live && setCard(c));
    return () => {
      live = false;
    };
  }, [key, sealed]);
  return card;
}

export function BunkerPlayerView({ session, content, pid, myAnswer, sending, onAnswer }: PlayerViewProps<BunkerContent, BunkerAnswerValue>) {
  const r = parseBunkerResult(session.state.result);
  const { stage } = session.state;
  const [key, setKey] = useState<string | null>(() => storedKey(session.id, pid));
  const [noCrypto, setNoCrypto] = useState(false);
  const dealing = r.mode === "deal" && stage === "question" && r.seats.includes(pid);
  const mine = useMemo(() => answerOf(myAnswer?.value), [myAnswer]);

  // Раздача: телефон сам создаёт ключ и отправляет ведущему.
  useEffect(() => {
    if (!dealing || myAnswer === undefined || sending) return;
    if (isKey(mine.key)) {
      if (mine.key !== key) {
        storeKey(session.id, pid, mine.key);
        setKey(mine.key);
      }
      return;
    }
    if (myAnswer) return;
    try {
      const k = key ?? newKey();
      storeKey(session.id, pid, k);
      setKey(k);
      onAnswer({ key: k });
    } catch {
      setNoCrypto(true);
    }
  }, [dealing, myAnswer, sending]);

  const card = usePhoneCard(key, r.sealed[pid]);
  const now = useServerNow(500, r.speakEndsAt !== null || r.voteEndsAt !== null);
  const seated = r.seats.includes(pid);
  const alive = r.alive.includes(pid);
  const send = (patch: BunkerAnswer) => onAnswer({ ...mine, ...patch });

  const head = (
    <p className="eyebrow">
      Бункер{seated ? ` · ваш номер ${r.seats.indexOf(pid) + 1}` : ""}
      {r.round > 0 && r.mode !== "final" ? ` · раунд ${r.round} из ${content.rounds}` : ""}
    </p>
  );

  if (r.seats.length === 0 || !seated) {
    return (
      <div className="quiz-phone quiz-phone--center bk-phone">
        {head}
        <h2>{r.seats.length === 0 ? "Скоро раздача карт" : "Партия уже идёт"}</h2>
        <p className="muted">{r.seats.length === 0 ? "Ваш персонаж придёт на этот телефон. Карты не показывайте никому!" : "Смотрите на экран — в следующей партии сыграете."}</p>
      </div>
    );
  }
  if (r.mode === "deal") {
    return (
      <div className="quiz-phone quiz-phone--center bk-phone">
        {head}
        <div className="bk-phone__back">
          <CardBack />
        </div>
        <h2>{noCrypto ? "Этот браузер не умеет тайные карты" : myAnswer ? "Телефон готов — ждём раздачу" : "Готовим ваши карты…"}</h2>
        {noCrypto && <p className="muted">Обновите браузер или скажите ведущему — он покажет карты на пульте.</p>}
      </div>
    );
  }

  // Что сейчас нужно от игрока.
  let task: ReactNode = null;
  const myTurn = r.mode === "open" && r.speaker === pid && r.speakEndsAt === null && alive;
  if (myTurn) {
    const can = openable(r, pid);
    task = (
      <section className="bk-phone__task">
        <h2>Ваш ход! Откройте карту</h2>
        <p className="muted small">{r.round <= 1 ? "В первом раунде все открывают профессию." : "Какую карту покажете всем? Потом — речь."}</p>
        <div className="bk-phone__pick">
          {can.map((c) => (
            <button key={c} type="button" className={`bk-pick bk-row--${c}${mine.open === c ? " is-picked" : ""}`} disabled={sending || mine.open !== undefined} onClick={() => send({ open: c })}>
              <Icon name={c} />
              <span>
                <b>{CAT_TITLES[c]}</b>
                {card?.char[c] ? <small>{cardText(card.char[c])}</small> : null}
              </span>
            </button>
          ))}
        </div>
        {mine.open && <p className="muted small">Открываем «{CAT_TITLES[mine.open]}»…</p>}
      </section>
    );
  } else if (r.mode === "open" && r.speaker === pid) {
    task = (
      <section className="bk-phone__task">
        <h2>Ваша речь</h2>
        <Timer endsAt={r.speakEndsAt} now={now} label="Осталось" />
      </section>
    );
  } else if (r.mode === "vote" && (alive || (content.exiledVote === "common" && r.exiled.includes(pid)))) {
    const list = r.candidates.filter((p) => p !== pid);
    task = (
      <section className="bk-phone__task">
        <h2>{alive ? "Кого изгоняем?" : "Голос изгнанных"}</h2>
        <p className="muted small">{alive ? "Голос тайный, за себя нельзя." : "Изгнанные вместе дают один голос — по большинству."}</p>
        <Timer endsAt={r.voteEndsAt} now={now} label="Голосование" />
        <div className="bk-phone__targets">
          {list.map((p) => (
            <button key={p} type="button" className={`bk-target${mine.vote === p ? " is-picked" : ""}`} disabled={sending || mine.vote !== undefined} onClick={() => send({ vote: p })}>
              <Who session={session} r={r} pid={p} />
              <small>{(["profession", "health", "baggage"] as Cat[]).map((c) => (r.shown[p]?.[c] ? cardText(r.shown[p]?.[c]) : null)).filter(Boolean).join(" · ") || "карты закрыты"}</small>
            </button>
          ))}
        </div>
        {mine.vote && (
          <p className="success">
            Голос отдан: <NameText name={nameOf(session, mine.vote)} />
          </p>
        )}
      </section>
    );
  } else if (r.mode === "justify" && r.candidates.includes(pid)) {
    task = (
      <section className="bk-phone__task">
        <h2>Ничья — ваша оправдательная речь</h2>
        {r.speaker === pid && <Timer endsAt={r.speakEndsAt} now={now} label="Осталось" />}
      </section>
    );
  } else if (r.mode === "final") {
    const o = r.outcome;
    task = (
      <section className="bk-phone__task">
        <h2>{alive ? (o ? (o.won ? "Вы в бункере — и бункер выжил!" : "Вы в бункере, но бункер не выжил") : "Вы в бункере!") : "Вы остались снаружи"}</h2>
        {!o && <p className="muted">Смотрите на экран: угрозы и итог.</p>}
      </section>
    );
  } else if (!alive) {
    task = (
      <section className="bk-phone__task bk-phone__task--out">
        <h2>Вы изгнаны</h2>
        <p className="muted">Ваши карты открыты всем. Можно спорить и подсказывать{content.exiledVote === "common" ? ", а на голосовании изгнанные дают общий голос" : ""}.</p>
      </section>
    );
  } else {
    const label: Record<string, string> = { catastrophe: "Катастрофа — смотрите на экран", bunker: "Открываем карту бункера", open: `Ход: ${nameOf(session, r.speaker)}`, discuss: "Обсуждение: кого не берём в бункер?", justify: "Ничья — оправдательные речи", exile: r.tally?.out ? `Изгнан: ${nameOf(session, r.tally.out)}` : "Голосование отменено" };
    task = (
      <section className="bk-phone__task bk-phone__task--quiet">
        <p>{label[r.mode] ?? ""}</p>
        <Timer endsAt={r.speakEndsAt} now={now} label={r.mode === "discuss" ? "Обсуждение" : "Речь"} />
      </section>
    );
  }

  return (
    <div className="quiz-phone bk-phone">
      {head}
      {task}
      {card === null ? (
        <p className="buzz__plate">
          <strong>Карты не открыть на этом телефоне</strong>
          <span>Ведущий видит их на пульте — подойдите к нему тихо.</span>
        </p>
      ) : card ? (
        <MyCards session={session} content={content} r={r} pid={pid} card={card} mine={mine} sending={sending} send={send} />
      ) : (
        <p className="muted">Открываем ваши карты…</p>
      )}
      <details className="bk-phone__all">
        <summary>Все игроки</summary>
        <ul className="bk-phone__list">
          {r.seats.map((p) => (
            <li key={p} className={r.exiled.includes(p) ? "is-exiled" : undefined}>
              <b>
                <Who session={session} r={r} pid={p} />
                {r.exiled.includes(p) ? " · изгнан" : ""}
              </b>
              <span>{CATS.map((c) => (r.shown[p]?.[c] ? `${CAT_TITLES[c]}: ${cardText(r.shown[p]?.[c])}` : null)).filter(Boolean).join(" · ") || "карты закрыты"}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Свои карты и особое условие. */
function MyCards({ session, content, r, pid, card, mine, sending, send }: { session: Session; content: BunkerContent; r: BunkerResult; pid: string; card: PhoneCard; mine: BunkerAnswer; sending: boolean; send: (p: BunkerAnswer) => void }) {
  const [target, setTarget] = useState<string>("");
  const [cat, setCat] = useState<Cat | "">("");
  const [choosing, setChoosing] = useState(false);
  const s = SPECIAL_BY_ID[card.char.special];
  const used = !!r.used[pid];
  const alive = r.alive.includes(pid);
  const refused = r.refused[pid];
  const others = r.alive.filter((p) => p !== pid);
  const closedOf = (p: string) => CATS.filter((c) => !(r.open[p] ?? []).includes(c));
  const ready = s.target === "none" || (target && (s.target === "player" || cat));
  const timing = s.when === "vote" && r.mode !== "vote";
  const pending = !!mine.use && !used && !(refused && refused.sig.startsWith(`${session.state.step}:${mine.use.target ?? "-"}:${mine.use.cat ?? "-"}`));
  return (
    <section className="bk-phone__mine">
      <h3 className="bk-phone__h">Ваш персонаж</h3>
      <ul className="bk-phone__cards">
        {CATS.map((c) => {
          const isOpen = (r.open[pid] ?? []).includes(c);
          return (
            <li key={c} className={isOpen ? "is-open" : undefined}>
              <TraitCard cat={c} refId={card.char[c]} />
              <span className="bk-phone__state">{isOpen ? "открыта всем" : "видите только вы"}</span>
            </li>
          );
        })}
      </ul>
      {content.specials && (
        <div className="bk-phone__special">
          <div className="bk-phone__specialcard">
            <SpecialCard id={card.char.special} used={used} />
          </div>
          {!used && alive && r.mode !== "final" && (
            <div className="stack stack--tight">
              {!choosing ? (
                <button type="button" className="btn btn--secondary btn--block" disabled={timing || pending} onClick={() => (s.target === "none" ? send({ use: { target: null, cat: null } }) : setChoosing(true))}>
                  {pending ? "Ведущий применяет…" : timing ? "Сыграть можно на голосовании" : "Сыграть особое условие"}
                </button>
              ) : (
                <>
                  <label className="field">
                    На кого
                    <select value={target} onChange={(e) => setTarget(e.target.value)}>
                      <option value="">выберите игрока</option>
                      {others.map((p) => (
                        <option key={p} value={p}>
                          №{r.seats.indexOf(p) + 1} {nameOf(session, p)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {s.target === "playerCat" && target && (
                    <label className="field">
                      Какую карту
                      <select value={cat} onChange={(e) => setCat(e.target.value as Cat)}>
                        <option value="">выберите закрытую карту</option>
                        {closedOf(target).map((c) => (
                          <option key={c} value={c}>
                            {CAT_TITLES[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    className="btn btn--block"
                    disabled={!ready || sending}
                    onClick={() => {
                      send({ use: { target: target || null, cat: cat || null } });
                      setChoosing(false);
                    }}
                  >
                    Сыграть
                  </button>
                  <button type="button" className="btn btn--quiet btn--block" onClick={() => setChoosing(false)}>
                    Отмена
                  </button>
                </>
              )}
              {refused && !used && <p className="error small">{REFUSALS[refused.reason as Refusal] ?? "Не получилось"}</p>}
            </div>
          )}
        </div>
      )}
      {card.notes.length > 0 && (
        <div className="bk-phone__notes">
          <h3 className="bk-phone__h">Вы подсмотрели</h3>
          {card.notes.map((n, i) => {
            const [who, ref] = n.split("|");
            return (
              <p key={i}>
                <Icon name="eye" /> {who}: <b>{cardText(ref)}</b>
              </p>
            );
          })}
        </div>
      )}
    </section>
  );
}
