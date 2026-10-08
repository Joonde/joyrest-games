// «Давайте знакомиться»: экран зала — письмо с историей (кремовая бумага, золотая рамка, сургучная печать с
// эмблемой), голосование, «Это история…»; телефон — написать свою историю, угадать автора.
import { useEffect, useRef, useState } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { STORY_LIMITS, type StoryContent } from "./content";
import { guessOf, kindOf, parseStoryResult, personName, sameText, storyOf, type StoryResult } from "./logic";
import { WordsPhone, WordsScreen } from "./WordsViews";
import { EndingPhone, EndingScreen, LiesPhone, LiesScreen } from "./SectionViews";
import { Letter } from "./Letter";
import { SECTION_HINTS, SECTION_TITLES } from "./content";
import { rankedLeaderboard } from "../../core/leaderboard";

export { Letter };

/** Заставка раздела: название, как играем, после первого раздела — пятёрка лидеров. */
function SectionIntro({ session, content, part }: { session: Session; content: StoryContent; part: number }) {
  const kind = kindOf(content, part);
  const top = rankedLeaderboard(session.leaderboard).filter((e) => e.score > 0).slice(0, 5);
  return (
    <div className="st-screen">
      <section className="st-screen__main">
        <span className="quiz-screen__badge">{content.sections.length > 1 ? `Раздел ${part + 1} из ${content.sections.length}` : "Давайте знакомиться"}</span>
        <h2 className="st-title">{SECTION_TITLES[kind]}</h2>
        <p className="st-prompt">{SECTION_HINTS[kind]}</p>
        {part > 0 && top.length > 0 && (
          <ol className="st-top">
            {top.map((e) => (
              <li key={e.id}>
                <span className="st-top__place">{e.place}</span>
                <span className="st-top__name">
                  <NameText name={e.name} />
                </span>
                <strong>{e.score}</strong>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export type StoryAnswerValue = { story: string } | { guess: string } | { word: number } | { stars: number } | { facts: string[]; lie: number } | { pick: number | string } | { start: string; end: string } | { fake: string };

const nameOf = personName;

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
  const kind = kindOf(content, r.part);
  if (stage === "ready") return <SectionIntro session={session} content={content} part={r.part} />;
  if (kind === "words") return <WordsScreen session={session} w={r.words} part={r.part} />;
  if (kind === "lies") return <LiesScreen session={session} l={r.lies} part={r.part} />;
  if (kind === "ending") return <EndingScreen session={session} content={content} e={r.ending} part={r.part} />;
  const said = kind === "said";
  const prompt = said ? (content.saidQuestions[r.q] ?? content.prompt) : content.prompt;

  if (r.mode === "write") {
    return (
      <div className="st-screen">
        <section className="st-screen__main">
          <span className="quiz-screen__badge">{said ? `Кто это сказал? · вопрос ${r.q + 1} из ${content.saidQuestions.length}` : `Раздел ${r.part + 1} · Чья история?`}</span>
          <Envelopes count={session.state.answered} />
          <h2 className="st-title">{said ? prompt : "Пишем истории…"}</h2>
          {!said && <p className="st-prompt">{prompt}</p>}
          <p className="st-note">{said ? "Ответьте на телефоне — анонимно" : "Никому не говорите, что написали!"} · {session.state.answered}</p>
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
          {said ? `Ответ ${r.current + 1} из ${r.stories.length}` : `История ${r.current + 1} из ${r.stories.length}`}
          {left !== null ? ` · ${left} с` : ""}
        </span>
        {said && <p className="st-prompt">{prompt}</p>}
        {story && <Letter text={story.text} label={stage === "reveal" ? (said ? "Это ответ" : "Это история") : said ? "Чей это ответ?" : "Чья это история?"} open={stage === "reveal"} />}
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

export function StoryPlayerView({ session, content, participant, pid, role, myAnswer: teamAnswer, sending: teamSending, onAnswer: teamSend, personal }: PlayerViewProps<StoryContent, StoryAnswerValue>) {
  const r = parseStoryResult(session.state.result);
  const teams = session.playMode === "teams";
  // В командах истории, догадки и звёзды — свои у каждого телефона, бумажку выбирает капитан.
  const myAnswer = teams ? personal?.value : teamAnswer;
  const sending = teams ? (personal?.sending ?? false) : teamSending;
  const onAnswer = (v: StoryAnswerValue) => (teams ? personal?.send(v) : teamSend(v));
  const { stage } = session.state;
  const key = `${MINE}.${session.id}.${participant.id}`;
  const kind = kindOf(content, r.part);
  const said = kind === "said";
  const prompt = said ? (content.saidQuestions[r.q] ?? content.prompt) : content.prompt;
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
      {SECTION_TITLES[kind]}
      {r.mode === "guess" && (kind === "author" || kind === "said") && stage !== "ready" ? ` · ${r.current + 1} из ${r.stories.length}` : ""}
      {me ? ` · ${pointsLabel(me.score)}` : ""}
    </p>
  );

  if (stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>{SECTION_TITLES[kind]}</h2>
        <p className="muted">{SECTION_HINTS[kind]}</p>
      </div>
    );
  }

  if (kind === "lies" || kind === "ending") {
    return (
      <div className="quiz-phone st-phone">
        {head}
        {kind === "lies" ? (
          <LiesPhone session={session} l={r.lies} me={participant.id} scoreKey={pid} myAnswer={myAnswer} sending={sending} onAnswer={(v) => onAnswer(v as StoryAnswerValue)} />
        ) : (
          <EndingPhone session={session} e={r.ending} me={participant.id} scoreKey={pid} myAnswer={myAnswer} sending={sending} onAnswer={(v) => onAnswer(v as StoryAnswerValue)} />
        )}
      </div>
    );
  }

  if (kind === "words") {
    return (
      <div className="quiz-phone st-phone">
        {head}
        <WordsPhone
          session={session}
          w={r.words}
          pid={pid}
          phoneId={participant.id}
          isCaptain={role !== "member"}
          myAnswer={teamAnswer}
          sending={teamSending}
          onPick={(word) => teamSend({ word })}
          myStars={myAnswer}
          starsSending={sending}
          onStars={(stars) => onAnswer({ stars })}
          teamOf={(phone) => (phone === participant.id ? (participant.teamId ?? phone) : phone)}
        />
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
          <Letter text={sent} label={said ? "Ваш ответ" : "Ваша история"} size="phone" />
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
        <h2>{prompt}</h2>
        <label className="field">
          <span className="visually-hidden">Ваша история</span>
          <textarea className="input st-phone__input" rows={5} maxLength={STORY_LIMITS.story} value={draft} placeholder={said ? "Ваш ответ…" : "Однажды я…"} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <p className="muted small">
          {draft.length} / {STORY_LIMITS.story} · пишите от первого лица, без имён — гости будут угадывать автора
        </p>
        <button type="button" className="btn btn--block" disabled={sending || draft.trim().length < (said ? 2 : 10) || stage !== "question"} onClick={send}>
          {said ? "Отправить ответ" : "Отправить историю"}
        </button>
        {!said && content.examples.length > 0 && (
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
  const others = (teams ? (r.people ?? []) : Object.keys(session.leaderboard)).filter((p) => p !== participant.id);

  if (stage === "reveal" && r.reveal) {
    const right = r.reveal.right.includes(participant.id);
    return (
      <div className="quiz-phone st-phone">
        {head}
        {said && <p className="se-start se-start--phone">{prompt}</p>}
        {story && <Letter text={story.text} label={said ? "Это ответ" : "Это история"} size="phone" open />}
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
      {said && <p className="se-start se-start--phone">{prompt}</p>}
      {story && <Letter text={story.text} label={said ? "Чей это ответ?" : "Чья это история?"} size="phone" />}
      {isMine && <p className="buzz__plate"><strong>{said ? "Это ваш ответ! 🤫" : "Это ваша история! 🤫"}</strong><span>Выберите кого угодно, чтобы не выдать себя, — ваш голос не считается.</span></p>}
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
