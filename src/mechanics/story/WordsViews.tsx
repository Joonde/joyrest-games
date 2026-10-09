// Раздел «Сочиняем историю»: предложение с пропусками-бумажками, рулетка с именами, звёзды зала.
import { useEffect, useRef, useState } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import { personName } from "./logic";
import { sentenceParts, starsOf, wordOf, type WordsState } from "./words";

const nameOf = personName;
const WHEEL = ["#c49e96", "#e3c68c", "#a3c2aa", "#e3aa9c", "#d2a0ac", "#b3aadd"];

/** Предложение: до показа — пропуски-бумажки с меткой, после — слова золотом. */
export function Sentence({ session, w, size = "screen" }: { session: Session; w: WordsState; size?: "screen" | "phone" }) {
  const parts = sentenceParts(w);
  const open = w.mode !== "pick" && w.mode !== "intro";
  return (
    <p className={`sw-sentence sw-sentence--${size}${open ? " is-open" : ""}`}>
      {parts.map((p, i) =>
        p.slot === null ? (
          <span key={i}>{p.text}</span>
        ) : open ? (
          <mark key={i} className="sw-word" style={{ animationDelay: `${(p.slot ?? 0) * 0.45}s` }}>
            {p.text}
          </mark>
        ) : (
          <span key={i} className="sw-blank">
            <span className="sw-blank__label">{w.papers[p.slot]?.label}</span>
            {size === "screen" && w.papers[p.slot]?.pid && (
              <span className="sw-blank__who">
                <NameText name={nameOf(session, w.papers[p.slot]?.pid ?? null)} />
              </span>
            )}
          </span>
        ),
      )}
    </p>
  );
}

/** Колесо с именами: крутится при новом `spin` и останавливается на выпавшем. */
export function Wheel({ session, w }: { session: Session; w: WordsState }) {
  const n = Math.max(1, w.wheel.length);
  const idx = Math.max(0, w.wheel.indexOf(w.performer ?? ""));
  const turn = 360 * 6 + (360 - (idx + 0.5) * (360 / n));
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    setLanded(false);
    const t = window.setTimeout(() => setLanded(true), 4200);
    return () => window.clearTimeout(t);
  }, [w.spin]);
  const r = 100;
  return (
    <div className="sw-wheel">
      <span className="sw-wheel__pointer" aria-hidden="true" />
      <svg key={w.spin} className="sw-wheel__disc" viewBox="-105 -105 210 210" style={{ ["--turn" as string]: `${turn}deg` }} aria-hidden="true">
        {w.wheel.map((pid, i) => {
          const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
          const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
          const mid = (a0 + a1) / 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const name = nameOf(session, pid);
          return (
            <g key={pid}>
              <path d={`M0 0 L${r * Math.cos(a0)} ${r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`} fill={WHEEL[i % WHEEL.length]} stroke="#221e1b" strokeWidth="1.2" />
              <text x={62 * Math.cos(mid)} y={62 * Math.sin(mid)} transform={`rotate(${(mid * 180) / Math.PI} ${62 * Math.cos(mid)} ${62 * Math.sin(mid)})`} textAnchor="middle" dominantBaseline="middle" fontSize={n > 8 ? 9 : 11} fill="#221e1b" fontWeight="600">
                {name.length > 12 ? `${name.slice(0, 11)}…` : name}
              </text>
            </g>
          );
        })}
        <circle r="14" fill="#221e1b" stroke="#e3c68c" strokeWidth="2" />
      </svg>
      {landed && w.performer && (
        <p className="sw-wheel__name">
          <NameText name={nameOf(session, w.performer)} />
        </p>
      )}
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="sw-stars" aria-label={`${value} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={value >= i - 0.25 ? "is-on" : value >= i - 0.75 ? "is-half" : undefined}>
          ★
        </span>
      ))}
    </span>
  );
}

export function WordsScreen({ session, w, part }: { session: Session; w: WordsState | null; part: number }) {
  const { stage, step } = session.state;
  const now = useServerNow(250, w?.mode === "rate" && stage === "question");
  const left = w?.mode === "rate" && stage === "question" ? secondsLeft(session.state, now) : null;
  useCountdownSounds(left);
  const prev = useRef(`${step}:${w?.mode}:${w?.spin}`);
  useEffect(() => {
    const key = `${step}:${w?.mode}:${w?.spin}`;
    if (prev.current !== key) {
      if (w?.mode === "shown") playSound("sparkle");
      else if (w?.mode === "spin") {
        playSound("drumroll");
        window.setTimeout(() => playSound("fanfare"), 4200);
      } else if (w?.mode === "rated") playSound("applause");
    }
    prev.current = key;
  }, [step, w?.mode, w?.spin]);

  if (!w || w.mode === "intro") {
    return (
      <div className="st-screen">
        <section className="st-screen__main">
          <span className="quiz-screen__badge">Раздел {part + 1}</span>
          <h2 className="st-title">Сочиняем историю</h2>
          <p className="st-prompt">Каждый получит бумажку со словами и выберет одно. Из слов сложится история — а показывать её пойдёт тот, на кого укажет рулетка!</p>
        </section>
      </div>
    );
  }
  const players = Object.keys(session.leaderboard).length;
  const takers = w.papers.filter((p) => p.pid).length;
  return (
    <div className="st-screen">
      {w.mode === "rated" && (w.avg ?? 0) >= 4 && <Confetti burst={`sw:${step}`} count={40} />}
      <section className="st-screen__main">
        <span className="quiz-screen__badge">
          История {w.sentence}
          {left !== null ? ` · ${left} с` : ""}
        </span>
        {w.mode === "spin" ? (
          <Wheel session={session} w={w} />
        ) : (
          <div className="sw-paper">
            <Sentence session={session} w={w} />
          </div>
        )}
        {w.mode === "pick" && <p className="st-note">Выбирают слова на телефонах · {Math.min(session.state.answered, takers)} из {takers}</p>}
        {w.mode === "shown" && <p className="st-note">Кто покажет эту историю? Сейчас решит рулетка!</p>}
        {w.mode === "rate" && (
          <p className="st-note">
            Показывает <NameText name={nameOf(session, w.performer)} /> · оцените на телефоне · {Math.min(session.state.answered, players)}
          </p>
        )}
        {w.mode === "rated" && (
          <div className="st-reveal">
            <p className="st-author">
              <NameText name={nameOf(session, w.performer)} />
            </p>
            {w.avg !== null ? (
              <>
                <Stars value={w.avg} />
                <p className="st-note">
                  {w.avg.toLocaleString("ru-RU")} из 5 · {w.votes} голосов · +{w.points}
                </p>
              </>
            ) : (
              <p className="st-note">Оценок нет</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** Телефон: бумажка со словами, рулетка, звёзды. */
export function WordsPhone({
  session,
  w,
  pid,
  phoneId,
  isCaptain,
  myAnswer,
  sending,
  onPick,
  myStars,
  starsSending,
  onStars,
  teamOf,
}: {
  session: Session;
  w: WordsState | null;
  pid: string;
  phoneId: string;
  isCaptain: boolean;
  myAnswer: { value: unknown } | null | undefined;
  sending: boolean;
  onPick: (word: number) => void;
  myStars: { value: unknown } | null | undefined;
  starsSending: boolean;
  onStars: (stars: number) => void;
  teamOf: (phone: string) => string;
}) {
  const now = useServerNow(500, w?.mode === "rate");
  const open = acceptsAnswers(session.state, now);
  if (!w || w.mode === "intro") {
    return (
      <>
        <h2>Сочиняем историю</h2>
        <p className="muted">Сейчас вы получите бумажку со словами. Выберите самое смешное!</p>
      </>
    );
  }
  const paper = w.papers.find((p) => p.pid === pid);
  if (w.mode === "pick") {
    const chosen = myAnswer ? wordOf(myAnswer.value) : null;
    if (!paper)
      return (
        <>
          <Sentence session={session} w={w} size="phone" />
          <p className="muted">Слова выбирают: {w.papers.filter((p) => p.pid).map((p) => nameOf(session, p.pid)).join(", ")}</p>
        </>
      );
    return (
      <>
        <p className="muted small">Ваш пропуск в истории:</p>
        <div className="sw-note">
          <span className="sw-note__label">{paper.label}</span>
          {chosen !== null ? (
            <p className="sw-note__chosen">{paper.words[chosen]}</p>
          ) : !isCaptain ? (
            <ul className="sw-note__list">
              {paper.words.map((word) => (
                <li key={word}>{word}</li>
              ))}
            </ul>
          ) : (
            <div className="sw-note__words">
              {paper.words.map((word, i) => (
                <button key={word} type="button" className="sw-note__word" disabled={sending} onClick={() => onPick(i)}>
                  {word}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className={chosen !== null ? "success" : "muted small"}>{chosen !== null ? "Слово выбрано — смотрите на экран!" : isCaptain ? "Выберите одно слово — оно попадёт в историю" : "Слово выбирает капитан"}</p>
      </>
    );
  }
  const me = w.performer === phoneId;
  if (w.mode === "shown" || w.mode === "spin") {
    return (
      <>
        <Sentence session={session} w={w} size="phone" />
        {w.mode === "spin" && (me ? <p className="sw-me">Это вы! Выходите и покажите историю 🎭</p> : <p className="muted">Показывает: <NameText name={nameOf(session, w.performer)} /></p>)}
      </>
    );
  }
  if (w.mode === "rate") {
    const mine = myStars ? starsOf(myStars.value) : null;
    const excluded = me || (w.scoreTo !== null && teamOf(phoneId) === w.scoreTo && w.scoreTo !== w.performer);
    return (
      <>
        <Sentence session={session} w={w} size="phone" />
        {excluded ? (
          <p className="muted">Зал оценивает {me ? "ваш" : "вашей команды"} показ…</p>
        ) : mine ? (
          <p className="success">Ваша оценка: {"★".repeat(mine)}</p>
        ) : open ? (
          <div className="sw-rate" role="group" aria-label="Оценка">
            {[1, 2, 3, 4, 5].map((s) => (
              <button key={s} type="button" className="sw-rate__star" disabled={starsSending} onClick={() => onStars(s)} aria-label={`${s} из 5`}>
                ★<span>{s}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">Оценка закрыта</p>
        )}
      </>
    );
  }
  return (
    <>
      <p className="st-phone__author">
        <NameText name={nameOf(session, w.performer)} />
      </p>
      {w.avg !== null ? (
        <>
          <Stars value={w.avg} />
          <p className={me ? "success" : "muted"}>
            {w.avg.toLocaleString("ru-RU")} из 5 · +{w.points}
          </p>
        </>
      ) : (
        <p className="muted">Оценок нет</p>
      )}
    </>
  );
}
