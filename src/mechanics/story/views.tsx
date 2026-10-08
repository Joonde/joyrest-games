// «Не моя история»: экран зала — письмо с историей (кремовая бумага, золотая рамка, сургучная печать с
// эмблемой), голосование, «Это история…»; телефон — написать свою историю, угадать автора.
import { useEffect, useRef, useState } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { useServerNow } from "../../components/live/useServerNow";
import { Logo } from "../../components/Logo";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { STORY_LIMITS, type StoryContent } from "./content";
import { guessOf, parseStoryResult, sameText, storyOf, type StoryResult } from "./logic";

export type StoryAnswerValue = { story: string } | { guess: string };

const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "Игрок") : "");

/** Письмо с историей: номер, текст, сургучная печать с эмблемой (при открытии автора — сломана). */
export function Letter({ text, label, open = false, size = "screen" }: { text: string; label: string; open?: boolean; size?: "screen" | "phone" }) {
  return (
    <div className={`st-letter st-letter--${size}${open ? " is-open" : ""}`}>
      <span className="st-letter__frame" aria-hidden="true" />
      <span className="st-letter__label">{label}</span>
      <span className="st-letter__quote" aria-hidden="true">
        «
      </span>
      <p className="st-letter__text">{text}</p>
      <span className="st-seal" aria-hidden="true">
        <span className="st-seal__wax" />
        <Logo kind="monogram" tone="cream" title="" className="st-seal__mark" />
      </span>
    </div>
  );
}

function Envelopes({ count }: { count: number }) {
  const n = Math.min(9, Math.max(3, count));
  return (
    <div className="st-env" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="st-env__item" style={{ ["--i" as string]: i - (n - 1) / 2, animationDelay: `${i * 0.25}s` }}>
          <svg viewBox="0 0 120 80">
            <rect x="2" y="2" width="116" height="76" rx="6" fill="#fbf6f1" stroke="#c9a15f" strokeWidth="2" />
            <path d="M4 6 L60 46 L116 6" fill="none" stroke="#c9a15f" strokeWidth="2" />
            <circle cx="60" cy="46" r="9" fill="#8a2a3e" />
          </svg>
        </span>
      ))}
    </div>
  );
}

function Votes({ session, r }: { session: Session; r: StoryResult }) {
  if (!r.reveal) return null;
  const list = Object.entries(r.reveal.counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  if (list.length === 0) return <p className="st-note">Никто не голосовал</p>;
  return (
    <ul className="st-votes">
      {list.map(([pid, n]) => (
        <li key={pid} className={pid === r.reveal?.author ? "is-author" : undefined}>
          <NameText name={nameOf(session, pid)} /> <strong>{n}</strong>
        </li>
      ))}
    </ul>
  );
}

export function StoryScreenView({ session, content }: ViewProps<StoryContent>) {
  const r = parseStoryResult(session.state.result);
  const { stage, step } = session.state;
  const now = useServerNow(250, stage === "question" && r.mode === "guess");
  const left = stage === "question" && r.mode === "guess" ? secondsLeft(session.state, now) : null;
  useCountdownSounds(left);
  const story = r.stories[r.current];
  const prev = useRef(`${step}:${stage}`);
  useEffect(() => {
    const key = `${step}:${stage}`;
    if (prev.current !== key) {
      if (stage === "reveal") playSound(r.reveal && r.reveal.right.length === 0 ? "fanfare" : "correct");
      else if (r.mode === "guess" && stage === "question") playSound("whoosh");
    }
    prev.current = key;
  }, [step, stage]);
  const players = Object.keys(session.leaderboard).length;

  if (stage === "ready" || r.mode === "write") {
    return (
      <div className="st-screen">
        <section className="st-screen__main">
          <span className="quiz-screen__badge">Не моя история</span>
          <Envelopes count={session.state.answered} />
          <h2 className="st-title">{stage === "ready" ? "Скоро пишем истории" : "Пишем истории…"}</h2>
          <p className="st-prompt">{content.prompt}</p>
          {r.mode === "write" && stage === "question" && <p className="st-note">Историй: {session.state.answered}. Никому не говорите, что написали!</p>}
        </section>
      </div>
    );
  }

  const author = r.reveal?.author ?? null;
  const nobody = r.reveal !== null && r.reveal.right.length === 0;
  return (
    <div className="st-screen">
      {stage === "reveal" && nobody && author && <Confetti burst={`st:${step}`} count={40} />}
      <section className="st-screen__main">
        <span className="quiz-screen__badge">
          История {r.current + 1} из {r.stories.length}
          {left !== null ? ` · ${left} с` : ""}
        </span>
        {story && <Letter text={story.text} label={stage === "reveal" ? "Это история" : "Чья это история?"} open={stage === "reveal"} />}
        {stage === "question" ? (
          <p className="st-note">
            Голосуйте на телефоне · {Math.min(session.state.answered, players)} из {players}
          </p>
        ) : (
          <div className="st-reveal">
            <p className="st-author">
              {author ? <NameText name={nameOf(session, author)} /> : "Автор ушёл"}
            </p>
            <p className="st-note">{nobody ? (author && content.authorBonus ? `Никто не догадался! +${content.authorBonus} автору` : "Никто не догадался!") : `Угадали: ${r.reveal?.right.length ?? 0} · +${content.guessPoints} каждому`}</p>
            <Votes session={session} r={r} />
          </div>
        )}
      </section>
    </div>
  );
}

const MINE = "joyrest.story";

function loadMine(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function saveMine(key: string, text: string): void {
  try {
    localStorage.setItem(key, text);
  } catch {
    // Приватный режим: свою историю телефон узнает по ответу.
  }
}

export function StoryPlayerView({ session, content, pid, myAnswer, sending, onAnswer }: PlayerViewProps<StoryContent, StoryAnswerValue>) {
  const r = parseStoryResult(session.state.result);
  const { stage } = session.state;
  const key = `${MINE}.${session.id}.${pid}`;
  const [mine, setMine] = useState(() => loadMine(key));
  const sent = r.mode === "write" && myAnswer ? storyOf(myAnswer.value) : "";
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const now = useServerNow(500, stage === "question" && r.mode === "guess");
  const open = acceptsAnswers(session.state, now);
  const me = session.leaderboard[pid];
  useEffect(() => {
    if (sent && sent !== mine) {
      saveMine(key, sent);
      setMine(sent);
    }
  }, [sent]);

  const head = (
    <p className="eyebrow">
      Не моя история{r.mode === "guess" ? ` · ${r.current + 1} из ${r.stories.length}` : ""}
      {me ? ` · ${pointsLabel(me.score)}` : ""}
    </p>
  );

  if (stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Скоро напишем истории</h2>
        <p className="muted">Вспомните случай из жизни, о котором здесь почти никто не знает.</p>
      </div>
    );
  }

  if (r.mode === "write") {
    const send = () => {
      const text = draft.trim();
      saveMine(key, text);
      setMine(text);
      setEditing(false);
      onAnswer({ story: text });
    };
    if (sent && !editing) {
      return (
        <div className="quiz-phone st-phone">
          {head}
          <Letter text={sent} label="Ваша история" size="phone" />
          <p className="success">Отправлено ведущему. Никому не говорите, что написали! 🤫</p>
          {stage === "question" && (
            <button type="button" className="btn btn--secondary btn--block" onClick={() => { setDraft(sent); setEditing(true); }}>
              Изменить историю
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="quiz-phone st-phone">
        {head}
        <h2>{content.prompt}</h2>
        <label className="field">
          <span className="visually-hidden">Ваша история</span>
          <textarea className="input st-phone__input" rows={5} maxLength={STORY_LIMITS.story} value={draft} placeholder="Однажды я…" onChange={(e) => setDraft(e.target.value)} />
        </label>
        <p className="muted small">
          {draft.length} / {STORY_LIMITS.story} · пишите от первого лица, без имён — гости будут угадывать автора
        </p>
        <button type="button" className="btn btn--block" disabled={sending || draft.trim().length < 10 || stage !== "question"} onClick={send}>
          Отправить историю
        </button>
        {content.examples.length > 0 && (
          <details className="st-phone__ideas">
            <summary>Примеры</summary>
            <ul>
              {content.examples.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }

  const story = r.stories[r.current];
  const isMine = Boolean(story && mine && sameText(mine, story.text));
  const vote = myAnswer ? guessOf(myAnswer.value) : null;
  const others = Object.keys(session.leaderboard).filter((p) => p !== pid);

  if (stage === "reveal" && r.reveal) {
    const right = r.reveal.right.includes(pid);
    return (
      <div className="quiz-phone st-phone">
        {head}
        {story && <Letter text={story.text} label="Это история" size="phone" open />}
        <p className="st-phone__author">
          <NameText name={r.reveal.author ? nameOf(session, r.reveal.author) : "автор ушёл"} />
        </p>
        <p className={right || (isMine && r.reveal.deltas[pid]) ? "success" : "muted"}>
          {isMine ? (r.reveal.deltas[pid] ? `Никто не догадался! +${r.reveal.deltas[pid]}` : "Вас раскусили!") : right ? `Угадали! +${r.reveal.deltas[pid] ?? 0}` : vote ? "Не угадали" : "Вы не голосовали"}
        </p>
      </div>
    );
  }

  return (
    <div className="quiz-phone st-phone">
      {head}
      {story && <Letter text={story.text} label="Чья это история?" size="phone" />}
      {isMine && <p className="buzz__plate"><strong>Это ваша история! 🤫</strong><span>Выберите кого угодно, чтобы не выдать себя, — ваш голос не считается.</span></p>}
      {vote ? (
        <p className="success">Голос принят: {nameOf(session, vote)}</p>
      ) : open ? (
        <div className="st-targets">
          {others.map((p) => (
            <button key={p} type="button" className="mf-target" disabled={sending} onClick={() => onAnswer({ guess: p })}>
              <span className="mf-target__name">
                <NameText name={nameOf(session, p)} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">Голосование закрыто</p>
      )}
    </div>
  );
}
