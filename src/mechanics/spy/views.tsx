// «Шпион»: экран зала — раздача, список возможных локаций, таймер обсуждения, голосование, последний шанс
// шпиона, итог; телефон — своя карта (локация и роль или «Вы — шпион»), догадка шпиона, тайное голосование.
// Карты — рисунки Canva AI (`public/spy/art/web/*.webp`: рубашка, шпион, фон локации), текст поверх.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import { isKey, newKey, storedKey, storeKey, unseal } from "../mafia/seal";
import type { PlayerViewProps, ViewProps } from "../types";
import { SPY_LIMITS, type SpyContent } from "./content";
import { guessOf, parseCard, parseSpyResult, playable, reasonText, talkLeftMs, voteOf, type SpyAnswerValue, type SpyCard, type SpyResult } from "./logic";

const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "Игрок") : "");

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function partyOf(content: SpyContent, r: SpyResult): string {
  const total = Math.max(content.parties, r.party);
  return total > 1 ? `Партия ${r.party} из ${total}` : "";
}

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function Who({ session, r, pid }: { session: Session; r: SpyResult; pid: string }) {
  return (
    <>
      <span className="sp-num">№{r.seats.indexOf(pid) + 1}</span> <NameText name={nameOf(session, pid)} />
    </>
  );
}

// ---------------------------------------------------------------- карты (рисунки Canva AI — public/spy/art)

export function CardBack() {
  return (
    <span className="sp-card__face sp-card__face--back">
      <span className="visually-hidden">Шпион</span>
    </span>
  );
}

function SpyFace() {
  return (
    <span className="sp-card__face sp-card__face--spy">
      <strong className="sp-card__title">Вы — шпион</strong>
      <span className="sp-card__hint">Вы не знаете, где все. Слушайте и угадайте локацию — или не выдайте себя.</span>
    </span>
  );
}

function PlaceFace({ place, role }: { place: string; role: string }) {
  return (
    <span className="sp-card__face sp-card__face--place">
      <span className="sp-card__label">Локация</span>
      <strong className="sp-card__title">{place}</strong>
      <span className="sp-card__rule" aria-hidden="true" />
      <span className="sp-card__label">Ваша роль</span>
      <strong className="sp-card__role">{role || "Гость"}</strong>
    </span>
  );
}

/** Своя карта: касание переворачивает, через 8 секунд закрывается сама. */
function MyCard({ card, seat }: { card: SpyCard; seat: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), 8000);
    return () => window.clearTimeout(timer);
  }, [open]);
  return (
    <button type="button" className={`sp-card${open ? " is-open" : ""}`} aria-pressed={open} aria-label={open ? "Закрыть карту" : "Открыть свою карту"} onClick={() => setOpen((v) => !v)}>
      <span className="sp-card__inner">
        <CardBack />
        {card.spy ? <SpyFace /> : <PlaceFace place={card.place} role={card.role} />}
      </span>
      <span className="sp-card__seat">№{seat}</span>
    </button>
  );
}

function Fan({ count }: { count: number }) {
  const n = Math.min(7, Math.max(3, count));
  return (
    <div className="sp-fan" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="sp-fan__card" style={{ ["--i" as string]: i - (n - 1) / 2 }}>
          <span className="sp-card sp-card--still">
            <span className="sp-card__inner">
              <CardBack />
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** Все возможные локации: на экране — списком, у шпиона — для выбора. */
function Locations({ content, size, real, guessed, picked, onPick, disabled }: { content: SpyContent; size: "screen" | "phone"; real?: number | null; guessed?: number | null; picked?: number | null; onPick?: (i: number) => void; disabled?: boolean }) {
  const list = playable(content);
  return (
    <ul className={`sp-places sp-places--${size}`} style={size === "screen" ? { gridTemplateColumns: `repeat(${list.length > 24 ? 6 : list.length > 12 ? 4 : 3}, minmax(0, 1fr))` } : undefined}>
      {list.map((i) => {
        const cls = `sp-place${real === i ? " is-real" : ""}${guessed === i && real !== i ? " is-wrong" : ""}${picked === i ? " is-picked" : ""}`;
        const name = content.locations[i]?.name ?? "";
        return (
          <li key={i} className={cls}>
            {onPick ? (
              <button type="button" className="sp-place__btn" aria-pressed={picked === i} disabled={disabled} onClick={() => onPick(i)}>
                {name}
              </button>
            ) : (
              <span className="sp-place__name">{name}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Tally({ session, r }: { session: Session; r: SpyResult }) {
  const rows = r.seats.filter((p) => (r.tally?.[p] ?? 0) > 0).sort((a, b) => (r.tally?.[b] ?? 0) - (r.tally?.[a] ?? 0));
  const max = Math.max(1, ...rows.map((p) => r.tally?.[p] ?? 0));
  if (rows.length === 0) return <p className="sp-note">Никто не проголосовал</p>;
  return (
    <ul className="sp-tally">
      {rows.map((p) => {
        const n = r.tally?.[p] ?? 0;
        return (
          <li key={p} className={`sp-tally__row${r.accused === p ? " is-accused" : ""}`}>
            <span className="sp-tally__name">
              <Who session={session} r={r} pid={p} />
            </span>
            <span className="sp-tally__bar">
              <span className="sp-tally__fill" style={{ width: `${(n / max) * 100}%` }} />
            </span>
            <strong className="sp-tally__n">{n}</strong>
          </li>
        );
      })}
    </ul>
  );
}

function winnerTitle(r: SpyResult): string {
  return r.winner === "town" ? "Победил город!" : r.winner === "spies" ? (r.reveal && r.reveal.spies.length > 1 ? "Победили шпионы!" : "Победил шпион!") : "Партия окончена";
}

// ---------------------------------------------------------------- экран зала

export function SpyScreenView({ session, content }: ViewProps<SpyContent>) {
  const r = parseSpyResult(session.state.result);
  const { stage, step } = session.state;
  const started = r.seats.length > 0;
  const now = useServerNow(250, stage === "question" || r.talkEndsAt !== null);
  const voteLeft = (r.mode === "vote" || r.mode === "last") && stage === "question" ? secondsLeft(session.state, now) : null;
  const talkMs = r.mode === "talk" ? talkLeftMs(r, now) : null;
  useCountdownSounds(voteLeft ?? (talkMs !== null && !r.paused ? Math.ceil(talkMs / 1000) : null));
  const prev = useRef(`${step}:${r.mode}`);
  useEffect(() => {
    const key = `${step}:${r.mode}`;
    if (prev.current !== key) {
      if (r.mode === "deal") playSound("whoosh");
      else if (r.mode === "talk") playSound("gong");
      else if (r.mode === "verdict") playSound(r.accused ? "drumroll" : "wrong");
      else if (r.mode === "last") playSound("sparkle");
      else if (r.mode === "over") playSound(r.winner ? "fanfare" : "gong");
    }
    prev.current = key;
  }, [step, r.mode]);

  let main: ReactNode;
  if (!started) {
    main = (
      <>
        <span className="quiz-screen__badge">Шпион</span>
        <h2 className="sp-title">Кто среди нас шпион?</h2>
        <p className="sp-note">
          Нужно {SPY_LIMITS.minPlayers}–{SPY_LIMITS.maxPlayers} игроков. Все знают, где мы, — кроме шпиона.
        </p>
      </>
    );
  } else if (r.mode === "deal") {
    main = (
      <>
        <Fan count={r.seats.length} />
        {partyOf(content, r) && <span className="quiz-screen__badge">{partyOf(content, r)}</span>}
        <h2 className="sp-title">Раздаём карты…</h2>
        <p className="sp-note">
          Телефоны готовы: {Math.min(session.state.answered, r.seats.length)} из {r.seats.length}
        </p>
      </>
    );
  } else if (r.mode === "cards") {
    main = (
      <>
        <h2 className="sp-title sp-title--small">Посмотрите свою карту</h2>
        <p className="sp-note">Коснитесь карты на телефоне и никому не показывайте. Шпион не знает, где мы. Вот где мы можем быть:</p>
        <Locations content={content} size="screen" />
      </>
    );
  } else if (r.mode === "talk") {
    main = (
      <>
        <div className={`sp-timer${r.paused ? " is-paused" : ""}${(talkMs ?? 0) <= 30_000 ? " is-ending" : ""}`}>
          <span className="sp-timer__label">{r.paused ? "Пауза" : "Обсуждение"}</span>
          <span className="sp-timer__time">{clock(talkMs ?? 0)}</span>
        </div>
        {r.firstAsker && (
          <p className="sp-note">
            Первым спрашивает <Who session={session} r={r} pid={r.firstAsker} />
          </p>
        )}
        <Locations content={content} size="screen" />
      </>
    );
  } else if (r.mode === "vote") {
    main = (
      <>
        <span className="quiz-screen__badge">Голосование{voteLeft !== null ? ` · ${voteLeft} с` : ""}</span>
        <h2 className="sp-title">Кто шпион?</h2>
        <p className="sp-note">Голосуйте тайно на телефоне — голос можно поменять, пока идёт время.</p>
        <p className="sp-note">
          Проголосовали: {Math.min(session.state.answered, r.seats.length)} из {r.seats.length}
        </p>
      </>
    );
  } else if (r.mode === "verdict") {
    main = (
      <>
        <span className="quiz-screen__badge">Итог голосования</span>
        <Tally session={session} r={r} />
        <p className="sp-title sp-title--small">
          {r.accused ? (
            <>
              Город обвиняет <Who session={session} r={r} pid={r.accused} />
            </>
          ) : (
            "Не договорились"
          )}
        </p>
        {!r.accused && <p className="sp-note">{(r.talkLeft ?? 0) > 0 ? `Обсуждение продолжается: осталось ${clock(r.talkLeft ?? 0)}` : "Время вышло — шпион ускользнул"}</p>}
      </>
    );
  } else if (r.mode === "last") {
    main = (
      <>
        <span className="quiz-screen__badge">Последний шанс{voteLeft !== null ? ` · ${voteLeft} с` : ""}</span>
        <h2 className="sp-title sp-title--small">{r.accused ? <Who session={session} r={r} pid={r.accused} /> : null} — шпион!</h2>
        <p className="sp-note">Угадает локацию — шпион всё равно победит.</p>
        <Locations content={content} size="screen" />
      </>
    );
  } else {
    const real = r.reveal?.location ?? null;
    main = (
      <>
        {r.winner && <Confetti burst={`sp:${step}`} />}
        {partyOf(content, r) && <span className="quiz-screen__badge">{partyOf(content, r)} · итог</span>}
        <h2 className="sp-title">{winnerTitle(r)}</h2>
        <p className="sp-note">{reasonText(r.reason)}</p>
        <div className="sp-reveal">
          <span className="sp-card sp-card--still is-open sp-reveal__card">
            <span className="sp-card__inner">
              <CardBack />
              <PlaceFace place={real !== null ? (content.locations[real]?.name ?? "") : ""} role="" />
            </span>
          </span>
          <ul className="sp-reveal__list">
            {r.seats.map((p) => {
              const spy = r.reveal?.spies.includes(p) ?? false;
              return (
                <li key={p} className={`sp-reveal__item${spy ? " is-spy" : ""}`}>
                  <span className="sp-reveal__name">
                    <Who session={session} r={r} pid={p} />
                  </span>
                  <span className="sp-reveal__role">{spy ? "🕵️ Шпион" : (r.reveal?.roles[p] ?? "—")}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {r.guess && (
          <p className="sp-note">
            Шпион назвал: «{content.locations[r.guess.index]?.name ?? ""}» — {r.guess.correct ? "верно" : "неверно"}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="sp-screen">
      <section className="sp-screen__main">{main}</section>
    </div>
  );
}

// ---------------------------------------------------------------- телефон

function useCard(key: string | null, text: string | undefined): SpyCard | null | undefined {
  const [value, setValue] = useState<SpyCard | null | undefined>(undefined);
  useEffect(() => {
    if (!key || !text) {
      setValue(null);
      return;
    }
    let live = true;
    void unseal(key, text).then((raw) => live && setValue(parseCard(raw)));
    return () => {
      live = false;
    };
  }, [key, text]);
  return value;
}

/** Выбор локации у шпиона: касание — выбрать, «Я знаю, где мы!» — после подтверждения. */
function GuessPanel({ content, sending, title, hint, onSend }: { content: SpyContent; sending: boolean; title: string; hint: string; onSend: (index: number) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [dialog, confirm] = useConfirm();
  return (
    <div className="stack">
      <h2>{title}</h2>
      <p className="muted small">{hint}</p>
      <Locations content={content} size="phone" picked={picked} onPick={setPicked} disabled={sending} />
      <button
        type="button"
        className="btn btn--block"
        disabled={sending || picked === null}
        onClick={() =>
          picked !== null &&
          confirm({
            title: `Мы — «${content.locations[picked]?.name ?? ""}»?`,
            text: "Ответ один: угадали — победа, ошиблись — побеждает город.",
            confirmLabel: "Да, мы здесь!",
            run: () => onSend(picked),
          })
        }
      >
        Я знаю, где мы!
      </button>
      {dialog}
    </div>
  );
}

export function SpyPlayerView({ session, content, pid, myAnswer, sending, onAnswer }: PlayerViewProps<SpyContent, SpyAnswerValue>) {
  const r = parseSpyResult(session.state.result);
  const { stage } = session.state;
  const [key, setKey] = useState<string | null>(() => storedKey(session.id, pid));
  const [noCrypto, setNoCrypto] = useState(false);
  const dealing = r.mode === "deal" && stage === "question" && r.seats.includes(pid);

  // Раздача: телефон сам создаёт ключ и отправляет ведущему.
  useEffect(() => {
    if (!dealing || myAnswer === undefined || sending) return;
    const sent = myAnswer ? rec(myAnswer.value).key : null;
    if (isKey(sent)) {
      if (sent !== key) {
        storeKey(session.id, pid, sent);
        setKey(sent);
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

  const card = useCard(key, r.sealed[pid]);
  const now = useServerNow(500, stage === "question" || r.talkEndsAt !== null);
  const open = acceptsAnswers(session.state, now);
  const seated = r.seats.includes(pid);
  const seatNo = r.seats.indexOf(pid) + 1;

  const head = (
    <p className="eyebrow">
      Шпион{partyOf(content, r) ? ` · ${partyOf(content, r).toLowerCase()}` : ""}
      {seated ? ` · ваш номер ${seatNo}` : ""}
    </p>
  );

  if (r.seats.length === 0) {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Скоро раздача карт</h2>
        <p className="muted">Карта придёт на этот телефон. Никому её не показывайте!</p>
      </div>
    );
  }
  if (!seated) {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Партия уже идёт</h2>
        <p className="muted">Смотрите на экран — в следующей партии сыграете.</p>
      </div>
    );
  }
  if (r.mode === "deal") {
    return (
      <div className="quiz-phone quiz-phone--center sp-phone">
        {head}
        <Fan count={4} />
        <h2>{noCrypto ? "Этот браузер не умеет тайные карты" : myAnswer ? "Телефон готов — ждём раздачу" : "Готовим вашу карту…"}</h2>
        {noCrypto && <p className="muted">Обновите браузер или скажите ведущему — он покажет карту тихо.</p>}
      </div>
    );
  }

  const cardView = card ? (
    <MyCard card={card} seat={seatNo} />
  ) : card === null && r.mode !== "over" ? (
    <p className="buzz__plate">
      <strong>Карту не открыть на этом телефоне</strong>
      <span>Подойдите к ведущему — он покажет карту тихо.</span>
    </p>
  ) : null;

  if (r.mode === "over") {
    const spy = r.reveal?.spies.includes(pid) ?? card?.spy ?? false;
    const won = r.winner === "spies" ? spy : r.winner === "town" ? !spy : false;
    const real = r.reveal?.location ?? null;
    return (
      <div className="quiz-phone sp-phone">
        {head}
        <h2>{winnerTitle(r)}</h2>
        {r.winner && <p className={won ? "success" : "muted"}>{won ? "Ваша сторона победила! 🎉" : "В этот раз не повезло"}</p>}
        <p className="muted small">{reasonText(r.reason)}</p>
        {real !== null && <p className="sp-phone__news">Мы были: «{content.locations[real]?.name ?? ""}»</p>}
        <ul className="sp-phone__reveal">
          {r.seats.map((p) => (
            <li key={p} className={r.reveal?.spies.includes(p) ? "is-spy" : undefined}>
              <Who session={session} r={r} pid={p} /> — {r.reveal?.spies.includes(p) ? "🕵️ шпион" : (r.reveal?.roles[p] ?? "—")}
            </li>
          ))}
        </ul>
        {r.party < content.parties && <p className="muted">Скоро следующая партия — новая локация и новый шпион. Очки копятся.</p>}
      </div>
    );
  }

  if (r.mode === "cards") {
    return (
      <div className="quiz-phone sp-phone">
        {head}
        <h2>Ваша карта</h2>
        <div className="sp-phone__card">{cardView ?? <p className="muted">Открываем карту…</p>}</div>
        <p className="muted small">Коснитесь карты, чтобы перевернуть. Через 8 секунд она закроется сама.</p>
      </div>
    );
  }

  let body: ReactNode = null;
  if (r.mode === "talk") {
    const sentGuess = myAnswer ? guessOf(myAnswer.value, content) : null;
    const left = talkLeftMs(r, now);
    body = (
      <div className="stack">
        <p className={`sp-phone__timer${r.paused ? " is-paused" : ""}`}>
          {r.paused ? "Пауза · " : "Обсуждение · "}
          {clock(left)}
        </p>
        {r.firstAsker && (
          <p className="muted">
            {r.firstAsker === pid ? (
              <strong>Вы спрашиваете первым!</strong>
            ) : (
              <>
                Первым спрашивает <Who session={session} r={r} pid={r.firstAsker} />
              </>
            )}
          </p>
        )}
        {card?.spy ? (
          sentGuess !== null ? (
            <p className="sp-phone__news is-me">Вы назвали «{content.locations[sentGuess]?.name ?? ""}». Ведущий открывает ответ…</p>
          ) : open ? (
            <GuessPanel content={content} sending={sending} title="Где мы?" hint="Слушайте вопросы и ответы. Поняли локацию — выберите её и нажмите «Я знаю, где мы!». Ответ один." onSend={(i) => onAnswer({ guess: i })} />
          ) : null
        ) : (
          <details className="sp-phone__mine">
            <summary>Все локации</summary>
            <Locations content={content} size="phone" />
          </details>
        )}
      </div>
    );
  } else if (r.mode === "vote") {
    const voted = myAnswer ? voteOf(myAnswer.value) : null;
    const left = secondsLeft(session.state, now);
    body = (
      <div className="stack">
        <h2>Кто шпион?{left !== null && stage === "question" ? ` · ${left} с` : ""}</h2>
        {open ? (
          <>
            <p className="muted small">Голос тайный. Пока идёт время, его можно поменять.</p>
            <div className="sp-targets">
              {r.seats
                .filter((p) => p !== pid)
                .map((p) => (
                  <button key={p} type="button" className={`sp-target${voted === p ? " is-picked" : ""}`} aria-pressed={voted === p} disabled={sending} onClick={() => onAnswer({ vote: p })}>
                    <span className="sp-target__num">№{r.seats.indexOf(p) + 1}</span>
                    <span className="sp-target__name">
                      <NameText name={nameOf(session, p)} />
                    </span>
                  </button>
                ))}
            </div>
            {voted && <p className="success">Ваш голос: №{r.seats.indexOf(voted) + 1}</p>}
          </>
        ) : (
          <p className="muted">Голосование закрыто{voted ? ` · ваш голос: №${r.seats.indexOf(voted) + 1}` : ""}</p>
        )}
      </div>
    );
  } else if (r.mode === "verdict") {
    body = (
      <div className="stack">
        <Tally session={session} r={r} />
        <p className="sp-phone__news">
          {r.accused === pid ? (
            "Город обвиняет вас!"
          ) : r.accused ? (
            <>
              Город обвиняет <Who session={session} r={r} pid={r.accused} />
            </>
          ) : (
            "Не договорились"
          )}
        </p>
      </div>
    );
  } else if (r.mode === "last") {
    const sent = myAnswer ? guessOf(myAnswer.value, content) : null;
    body =
      r.accused === pid ? (
        sent !== null ? (
          <p className="sp-phone__news is-me">Вы назвали «{content.locations[sent]?.name ?? ""}». Ведущий проверяет…</p>
        ) : open ? (
          <GuessPanel content={content} sending={sending} title="Последний шанс: где мы?" hint={`Вас вычислили! Угадаете локацию за ${SPY_LIMITS.lastChanceSeconds} секунд — всё равно победите.`} onSend={(i) => onAnswer({ guess: i })} />
        ) : (
          <p className="muted">Время вышло</p>
        )
      ) : (
        <p className="sp-phone__news">
          {r.accused ? <Who session={session} r={r} pid={r.accused} /> : null} — шпион! Он пытается угадать локацию…
        </p>
      );
  }

  return (
    <div className="quiz-phone sp-phone">
      {head}
      {body}
      {cardView && (
        <details className="sp-phone__mine">
          <summary>Моя карта</summary>
          <div className="sp-phone__card sp-phone__card--small">{cardView}</div>
        </details>
      )}
    </div>
  );
}
