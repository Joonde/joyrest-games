// Разделы «Две правды и ложь» и «Что было дальше?»: экран зала и телефон.
import { useEffect, useRef, useState } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { StoryContent } from "./content";
import { END_MAX, endingPickOf, fakeOf, START_MAX, storyParts, type EndingState } from "./ending";
import { FACT_MAX, factsOf, pickOf, type LiesState } from "./lies";
import { personName } from "./logic";
import { sameText } from "./text";
import { Letter } from "./Letter";

const LETTERS = ["А", "Б", "В", "Г", "Д", "Е"];

function useTimer(session: Session, on: boolean) {
  const now = useServerNow(250, on);
  const left = on ? secondsLeft(session.state, now) : null;
  return { now, left };
}

function useStepSound(key: string, play: () => void) {
  const prev = useRef(key);
  useEffect(() => {
    if (prev.current !== key) play();
    prev.current = key;
  }, [key]);
}

// ---------------------------------------------------------------- Две правды и ложь

function FactCard({ text, n, state, count }: { text: string; n: number; state?: "lie" | "truth" | null; count?: number }) {
  return (
    <div className={`sl-card${state ? ` is-${state}` : ""}`} style={{ animationDelay: `${n * 0.12}s` }}>
      <span className="sl-card__n">{LETTERS[n]}</span>
      <p className="sl-card__text">{text}</p>
      {state && <span className={`sl-stamp sl-stamp--${state}`}>{state === "lie" ? "Ложь" : "Правда"}</span>}
      {count !== undefined && <span className="sl-card__count">{count}</span>}
    </div>
  );
}

export function LiesScreen({ session, l, part }: { session: Session; l: LiesState | null; part: number }) {
  const { stage, step } = session.state;
  const { left } = useTimer(session, stage === "question" && l?.phase === "show");
  useCountdownSounds(left);
  useStepSound(`${step}:${stage}`, () => {
    if (stage === "reveal") playSound("drumroll");
  });
  if (!l || l.phase === "write") {
    return (
      <div className="st-screen">
        <section className="st-screen__main">
          <span className="quiz-screen__badge">Раздел {part + 1}</span>
          <h2 className="st-title">Две правды и ложь</h2>
          <div className="sl-row sl-row--intro" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <FactCard key={i} n={i} text={i === 1 ? "?" : "…"} />
            ))}
          </div>
          <p className="st-prompt">Напишите на телефоне три факта о себе — два правдивых и один выдуманный.</p>
          {l && <p className="st-note">Написали: {session.state.answered}</p>}
        </section>
      </div>
    );
  }
  const item = l.items[l.current];
  const rev = l.reveal;
  return (
    <div className="st-screen">
      {rev && rev.right.length === 0 && <Confetti burst={`sl:${step}`} count={40} />}
      <section className="st-screen__main">
        <span className="quiz-screen__badge">
          {l.current + 1} из {l.items.length}
          {left !== null ? ` · ${left} с` : ""}
        </span>
        <p className="st-author">
          <NameText name={personName(session, item?.pid ?? null)} />
        </p>
        <div className="sl-row">
          {item?.facts.map((f, i) => (
            <FactCard key={`${step}:${i}`} n={i} text={f} state={rev ? (rev.lieAt === i ? "lie" : "truth") : null} count={rev ? (rev.counts[i] ?? 0) : undefined} />
          ))}
        </div>
        <p className="st-note">{rev ? (rev.right.length ? `Раскусили: ${rev.right.length}` : "Никто не догадался — мастер обмана!") : "Где ложь? Выберите на телефоне"}</p>
      </section>
    </div>
  );
}

export function LiesPhone({ session, l, me, scoreKey, myAnswer, sending, onAnswer }: { session: Session; l: LiesState | null; me: string; scoreKey: string; myAnswer: { value: unknown } | null | undefined; sending: boolean; onAnswer: (v: { facts: string[]; lie: number } | { pick: number }) => void }) {
  const [facts, setFacts] = useState(["", "", ""]);
  const [lie, setLie] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const now = useServerNow(500, session.state.stage === "question");
  const open = acceptsAnswers(session.state, now);
  if (!l) return <h2>Две правды и ложь</h2>;
  if (l.phase === "write") {
    const sent = myAnswer ? factsOf(myAnswer.value) : null;
    if (sent && !editing) {
      return (
        <>
          <h2>Ваши факты</h2>
          <div className="sl-row sl-row--phone">
            {sent.facts.map((f, i) => (
              <FactCard key={i} n={i} text={f} state={i === sent.lie ? "lie" : "truth"} />
            ))}
          </div>
          <p className="success">Отправлено. Не выдавайте себя! 🤫</p>
          <button type="button" className="btn btn--secondary btn--block" onClick={() => { setFacts(sent.facts); setLie(sent.lie); setEditing(true); }}>
            Изменить
          </button>
        </>
      );
    }
    return (
      <>
        <h2>Три факта о себе: два правдивых, один выдуманный</h2>
        {facts.map((f, i) => (
          <div key={i} className="sl-input">
            <label className="field">
              <span>Факт {LETTERS[i]}</span>
              <textarea className="input" rows={2} maxLength={FACT_MAX} value={f} onChange={(e) => setFacts((cur) => cur.map((x, k) => (k === i ? e.target.value : x)))} />
            </label>
            <label className="choice">
              <input type="radio" name="lie" checked={lie === i} onChange={() => setLie(i)} />
              <span className="choice__text">
                <span className="choice__title">Это ложь</span>
              </span>
            </label>
          </div>
        ))}
        <button type="button" className="btn btn--block" disabled={sending || lie === null || facts.some((f) => f.trim().length < 3)} onClick={() => { setEditing(false); onAnswer({ facts: facts.map((f) => f.trim()), lie: lie ?? 0 }); }}>
          Отправить
        </button>
      </>
    );
  }
  const item = l.items[l.current];
  const pick = myAnswer ? pickOf(myAnswer.value) : null;
  const mine = item?.pid === me;
  const rev = l.reveal;
  return (
    <>
      <p className="st-phone__author">
        <NameText name={personName(session, item?.pid ?? null)} />
      </p>
      {mine && !rev && <p className="buzz__plate"><strong>Это ваши факты! 🤫</strong><span>Молчите и сохраняйте покерфейс.</span></p>}
      <div className="sl-row sl-row--phone">
        {item?.facts.map((f, i) =>
          !mine && !rev && pick === null && open ? (
            <button key={i} type="button" className="sl-pick" disabled={sending} onClick={() => onAnswer({ pick: i })}>
              <FactCard n={i} text={f} />
            </button>
          ) : (
            <FactCard key={i} n={i} text={f} state={rev ? (rev.lieAt === i ? "lie" : "truth") : null} />
          ),
        )}
      </div>
      {!mine && !rev && <p className={pick !== null ? "success" : "muted small"}>{pick !== null ? `Вы думаете, ложь — ${LETTERS[pick]}` : "Коснитесь карточки, где, по-вашему, ложь"}</p>}
      {rev && <p className={rev.deltas[scoreKey] ? "success" : "muted"}>{mine ? (rev.deltas[scoreKey] ? `Обманули зал! +${rev.deltas[scoreKey]}` : "Вас раскусили!") : pick === rev.lieAt ? `Угадали! +${rev.deltas[scoreKey] ?? 0}` : "Не угадали"}</p>}
    </>
  );
}

// ---------------------------------------------------------------- Что было дальше?

export function EndingScreen({ session, content, e, part }: { session: Session; content: StoryContent; e: EndingState | null; part: number }) {
  const { stage, step } = session.state;
  const { left } = useTimer(session, stage === "question" && (e?.phase === "fake" || e?.phase === "vote"));
  useCountdownSounds(left);
  useStepSound(`${step}:${stage}`, () => {
    if (stage === "reveal") playSound(e?.reveal?.right.length ? "correct" : "fanfare");
  });
  if (!e || e.phase === "write") {
    return (
      <div className="st-screen">
        <section className="st-screen__main">
          <span className="quiz-screen__badge">Раздел {part + 1}</span>
          <h2 className="st-title">Что было дальше?</h2>
          <p className="st-prompt">Напишите начало своей истории — и чем она закончилась на самом деле. Остальные будут придумывать концовку, а потом искать правду!</p>
          {e && <p className="st-note">Историй: {session.state.answered}</p>}
        </section>
      </div>
    );
  }
  const item = e.items[e.current];
  const rev = e.reveal;
  if (e.phase === "fake") {
    return (
      <div className="st-screen">
        <section className="st-screen__main">
          <span className="quiz-screen__badge">
            История {e.current + 1} из {e.items.length}
            {left !== null ? ` · ${left} с` : ""}
          </span>
          {item && <Letter text={`${item.start}…`} label={`История: ${personName(session, item.pid)}`} />}
          <p className="st-note">
            Что было дальше? Придумайте концовку на телефоне · {session.state.answered}
          </p>
        </section>
      </div>
    );
  }
  return (
    <div className="st-screen">
      {rev && rev.right.length === 0 && <Confetti burst={`se:${step}`} count={40} />}
      <section className="st-screen__main">
        <span className="quiz-screen__badge">
          {rev ? "Правда!" : "Какая концовка настоящая?"}
          {left !== null ? ` · ${left} с` : ""}
        </span>
        {item && <p className="se-start">«{item.start}…»</p>}
        <ol className="se-options">
          {e.options.map((o, i) => {
            const real = rev?.realId === o.id;
            const owner = rev ? rev.owners[o.id] : undefined;
            return (
              <li key={o.id} className={`se-option${rev ? (real ? " is-real" : " is-fake") : ""}`} style={{ animationDelay: `${i * 0.1}s` }}>
                <span className="se-option__n">{i + 1}</span>
                <span className="se-option__text">{o.text}</span>
                {rev && (
                  <span className="se-option__who">
                    {real ? "★ правда" : owner ? <NameText name={personName(session, owner)} /> : ""} · {rev.counts[o.id] ?? 0}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {rev && <p className="st-note">{rev.right.length ? `Угадали: ${rev.right.length} · +${content.guessPoints}; выдумщикам — +${content.foolPoints} за каждого поверившего` : "Никто не угадал — правда оказалась невероятнее выдумки!"}</p>}
      </section>
    </div>
  );
}

const MY_FAKE = "joyrest.story.fake";

export function EndingPhone({ session, e, me, scoreKey, myAnswer, sending, onAnswer }: { session: Session; e: EndingState | null; me: string; scoreKey: string; myAnswer: { value: unknown } | null | undefined; sending: boolean; onAnswer: (v: { start: string; end: string } | { fake: string } | { pick: string }) => void }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [fake, setFake] = useState("");
  const [editing, setEditing] = useState(false);
  const now = useServerNow(500, session.state.stage === "question");
  const open = acceptsAnswers(session.state, now);
  const key = `${MY_FAKE}.${session.id}.${me}.${e?.fakeStep ?? 0}`;
  if (!e) return <h2>Что было дальше?</h2>;
  if (e.phase === "write") {
    const sent = myAnswer ? storyParts(myAnswer.value) : null;
    if (sent && !editing) {
      return (
        <>
          <Letter text={`${sent.start} … ${sent.end}`} label="Ваша история" size="phone" />
          <p className="success">Отправлено. Концовку никому не говорите! 🤫</p>
          <button type="button" className="btn btn--secondary btn--block" onClick={() => { setStart(sent.start); setEnd(sent.end); setEditing(true); }}>
            Изменить
          </button>
        </>
      );
    }
    return (
      <>
        <h2>Начало истории — и чем она кончилась</h2>
        <label className="field">
          <span>Начало (оборвите на самом интересном)</span>
          <textarea className="input" rows={3} maxLength={START_MAX} value={start} placeholder="Однажды на даче я полез на крышу за мячом, и тут…" onChange={(ev) => setStart(ev.target.value)} />
        </label>
        <label className="field">
          <span>Чем закончилось на самом деле</span>
          <textarea className="input" rows={2} maxLength={END_MAX} value={end} placeholder="…меня снимала пожарная команда" onChange={(ev) => setEnd(ev.target.value)} />
        </label>
        <button type="button" className="btn btn--block" disabled={sending || start.trim().length < 10 || end.trim().length < 3} onClick={() => { setEditing(false); onAnswer({ start: start.trim(), end: end.trim() }); }}>
          Отправить
        </button>
      </>
    );
  }
  const item = e.items[e.current];
  const mine = item?.pid === me;
  if (e.phase === "fake" && !e.reveal) {
    const sent = myAnswer ? fakeOf(myAnswer.value) : "";
    return (
      <>
        {item && <Letter text={`${item.start}…`} label={`История: ${personName(session, item.pid)}`} size="phone" />}
        {mine ? (
          <p className="buzz__plate"><strong>Это ваша история! 🤫</strong><span>Остальные придумывают концовку — молчите.</span></p>
        ) : sent && !editing ? (
          <>
            <p className="success">Ваша концовка: «{sent}»</p>
            {open && <button type="button" className="btn btn--secondary btn--block" onClick={() => { setFake(sent); setEditing(true); }}>Изменить</button>}
          </>
        ) : open ? (
          <>
            <label className="field">
              <span>Что было дальше? Придумайте правдоподобно</span>
              <textarea className="input" rows={3} maxLength={END_MAX} value={fake} onChange={(ev) => setFake(ev.target.value)} />
            </label>
            <button type="button" className="btn btn--block" disabled={sending || fake.trim().length < 3} onClick={() => { try { localStorage.setItem(key, fake.trim()); } catch { /* приватный режим */ } setEditing(false); onAnswer({ fake: fake.trim() }); }}>
              Отправить концовку
            </button>
          </>
        ) : (
          <p className="muted">Время вышло</p>
        )}
      </>
    );
  }
  let myFake = "";
  try {
    myFake = localStorage.getItem(key) ?? "";
  } catch {
    myFake = "";
  }
  const pick = myAnswer ? endingPickOf(myAnswer.value) : null;
  const rev = e.reveal;
  return (
    <>
      {item && <p className="se-start se-start--phone">«{item.start}…»</p>}
      <div className="se-phone-options">
        {e.options.map((o, i) => {
          const own = myFake !== "" && sameText(myFake, o.text);
          const real = rev?.realId === o.id;
          return (
            <button key={o.id} type="button" className={`se-phone-option${pick === o.id ? " is-picked" : ""}${rev ? (real ? " is-real" : " is-fake") : ""}`} disabled={sending || mine || own || pick !== null || !!rev || !open} onClick={() => onAnswer({ pick: o.id })}>
              <strong>{i + 1}.</strong> {o.text}
              {own && <em> — ваша</em>}
            </button>
          );
        })}
      </div>
      {!rev && <p className="muted small">{mine ? "Это ваша история — молчите 🤫" : pick ? "Голос принят" : "Какая концовка — правда?"}</p>}
      {rev && <p className={rev.deltas[scoreKey] ? "success" : "muted"}>{rev.deltas[scoreKey] ? `+${rev.deltas[scoreKey]} очков` : pick === rev.realId ? "Угадали!" : "Не угадали"}</p>}
    </>
  );
}
