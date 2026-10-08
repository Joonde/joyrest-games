// «Танцевальный батл»: карточки на экране, видео или трек выступления, оценки на телефонах.
import { useEffect, useRef, useState } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { loadLocalVideo, saveLocalVideo } from "../../components/media/localVideo";
import { useFragment } from "../../components/music/useFragment";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { embedUrl, KIND_EMOJI, KIND_TITLES, type DanceCard, type DanceContent } from "./content";
import { canVote, cardOf, parseDanceResult, turnPid, type DanceResult } from "./logic";

/** Ответ: выбор карточки, оценка или голос за команду в батле. */
export type DanceAnswerValue = { card: string } | { rate: number } | { team: string };

const nameOf = (session: Session, p: string | null) => (p ? (session.leaderboard[p]?.name ?? "") : "");

export function CardGrid({ content, result, onPick, disabled }: { content: DanceContent; result: DanceResult; onPick?: (id: string) => void; disabled?: boolean }) {
  return (
    <div className="dance-cards" role="list">
      {content.cards.map((card, i) => {
        const played = result.played.includes(card.id);
        const current = result.card === card.id;
        const body = (
          <>
            <span className="dance-card__emoji" aria-hidden="true">
              {played ? "✓" : KIND_EMOJI[card.kind]}
            </span>
            <span className="dance-card__kind">{KIND_TITLES[card.kind]}</span>
            <span className="dance-card__n">{i + 1}</span>
          </>
        );
        const cls = `dance-card dance-card--${card.kind}${played ? " is-played" : ""}${current ? " is-current" : ""}`;
        return onPick && !played ? (
          <button key={card.id} type="button" role="listitem" className={cls} disabled={disabled} onClick={() => onPick(card.id)} aria-label={`${KIND_TITLES[card.kind]} ${i + 1}`}>
            {body}
          </button>
        ) : (
          <div key={card.id} role="listitem" className={cls} aria-label={`${KIND_TITLES[card.kind]} ${i + 1}${played ? ", сыграна" : ""}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Видео карточки на экране зала: файл с этого устройства или ролик по ссылке. */
function CardVideo({ card, paused, replay }: { card: DanceCard; paused: boolean; replay: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (card.video.source !== "file") return;
    let made: string | null = null;
    let cancelled = false;
    void loadLocalVideo(card.id).then((v) => {
      if (cancelled) return;
      if (!v) return setMissing(true);
      made = URL.createObjectURL(v.blob);
      setUrl(made);
      setMissing(false);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [card.id, card.video.source]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (paused) el.pause();
    else void el.play().catch(() => undefined);
  }, [paused, url]);

  useEffect(() => {
    const el = ref.current;
    if (!el || replay === 0) return;
    el.currentTime = 0;
    void el.play().catch(() => undefined);
  }, [replay]);

  if (card.video.source === "link") {
    const src = embedUrl(card.video.url);
    if (!src) return <p className="dance-screen__note">Ссылку на видео не открыть. Проверьте её в конструкторе: подходят YouTube, VK Видео и Rutube.</p>;
    // Пауза ролика по ссылке — кнопками самого плеера; «Сначала» перезагружает плеер.
    return <iframe key={replay} className="dance-screen__video" src={paused ? "about:blank" : src} title={card.title || "Видео"} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />;
  }
  if (card.video.source === "file") {
    if (missing) {
      return (
        <div className="dance-screen__pick">
          <p>На этом устройстве нет видео «{card.video.name || card.title}».</p>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Выбрать видео на этом устройстве
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void saveLocalVideo(card.id, file).then(() => {
                setUrl(URL.createObjectURL(file));
                setMissing(false);
              });
            }}
          />
        </div>
      );
    }
    return url ? <video ref={ref} className="dance-screen__video" src={url} playsInline autoPlay controls={false} /> : null;
  }
  return null;
}

export function DanceScreenView({ session, content }: ViewProps<DanceContent>) {
  const r = parseDanceResult(session.state.result);
  const { stage, step } = session.state;
  const card = cardOf(content, r.card);
  const now = useServerNow(250, r.mode === "vote" && stage === "question");
  const left = r.mode === "vote" && stage === "question" ? secondsLeft(session.state, now) : null;
  const performing = r.mode === "perform";
  const battleTrack = card && card.trackId && (card.kind === "battle" || card.video.source === "none") ? card : null;
  useFragment(
    battleTrack?.trackId ?? null,
    battleTrack?.trackStart ?? 0,
    Math.max(battleTrack?.trackLength ?? 60, 30),
    battleTrack && performing ? `d:${step}:${r.replay}` : null,
    { options: { fadeIn: battleTrack?.fadeIn ?? 0, fadeOut: battleTrack?.fadeOut ?? 0 }, paused: r.paused },
  );
  const previous = useRef(`${step}:${r.mode}`);
  useEffect(() => {
    const key = `${step}:${r.mode}`;
    if (previous.current !== key && r.mode === "result" && Object.keys(r.scores).length > 0) playSound("applause");
    if (previous.current !== key && r.mode === "perform") playSound("drumroll");
    previous.current = key;
  }, [step, r.mode, r.scores]);

  if (stage === "ready") {
    return (
      <div className="dance-screen dance-screen--intro">
        <span className="quiz-screen__badge">Танцевальный батл</span>
        <h2 className="dance-screen__title" data-shine="on">
          Начнём игру!
        </h2>
        <p className="dance-screen__note">Команды по очереди выбирают: ⚡ батл, 💃 танец или 🎤 караоке</p>
      </div>
    );
  }

  if (r.mode === "pick" || !card) {
    const who = nameOf(session, turnPid(r));
    return (
      <div className="dance-screen">
        <div className="dance-screen__top">
          <span className="quiz-screen__badge">Танцевальный батл</span>
          {who && (
            <span className="dance-screen__who">
              Выбирает <NameText name={who} />
            </span>
          )}
        </div>
        <CardGrid content={content} result={r} />
      </div>
    );
  }

  const performer = nameOf(session, r.performer);
  const head = (
    <div className="dance-screen__top">
      <span className={`quiz-screen__badge dance-badge--${card.kind}`}>
        {KIND_EMOJI[card.kind]} {KIND_TITLES[card.kind]}
      </span>
      <span className="dance-screen__who">{card.kind === "battle" ? "Выступают все команды" : <NameText name={performer} />}</span>
    </div>
  );

  if (performing) {
    return (
      <div className="dance-screen dance-screen--perform">
        {head}
        {card.title && <h2 className="dance-screen__card-title">{card.title}</h2>}
        <CardVideo card={card} paused={r.paused} replay={r.replay} />
        {card.note && <p className="dance-screen__note">{card.note}</p>}
      </div>
    );
  }

  if (r.mode === "vote") {
    return (
      <div className="dance-screen dance-screen--vote">
        {head}
        <h2 className="dance-screen__title">{card.kind === "battle" ? "Кто победил в батле?" : "Оцените выступление!"}</h2>
        <p className="dance-screen__note">
          {card.kind === "battle" ? "Капитаны голосуют на телефонах — за свою команду нельзя" : `Другие команды ставят от ${content.minRate} до ${content.maxRate}`}
        </p>
        <p className="dance-screen__timer" role="timer">
          {left === null ? "" : left === 0 ? "Голосование закрыто" : `${left} с`}
        </p>
        <p className="dance-screen__note">Голосов: {session.state.answered ?? 0}</p>
      </div>
    );
  }

  const entries = Object.entries(r.scores);
  return (
    <div className="dance-screen dance-screen--result">
      {entries.length > 0 && <Confetti burst={`dance:${step}`} />}
      {head}
      {entries.length === 0 ? (
        <h2 className="dance-screen__title">Голосов нет</h2>
      ) : (
        entries.map(([p, n]) => (
          <div key={p} className="dance-screen__score">
            <NameText name={nameOf(session, p)} />
            <strong>+{n}</strong>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------- телефон

function RateForm({ min, max, sending, onRate }: { min: number; max: number; sending: boolean; onRate: (n: number) => void }) {
  const step = max - min >= 50 ? 10 : 1;
  const values: number[] = [];
  for (let v = min; v <= max && values.length < 20; v += step) values.push(v);
  if (values[values.length - 1] !== max) values.push(max);
  return (
    <div className="dance-rate" role="group" aria-label="Оценка">
      {values.map((v) => (
        <button key={v} type="button" className="btn btn--secondary dance-rate__btn" disabled={sending} onClick={() => onRate(v)}>
          {v}
        </button>
      ))}
    </div>
  );
}

export function DancePlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<DanceContent, DanceAnswerValue>) {
  const r = parseDanceResult(session.state.result);
  const { stage } = session.state;
  const card = cardOf(content, r.card);
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const me = session.leaderboard[pid];
  const head = (
    <p className="eyebrow">
      Танцевальный батл{me ? ` · ${pointsLabel(me.score)}` : ""}
    </p>
  );
  const captain = role !== "member";

  if (stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Скоро начнём!</h2>
        <p className="muted">Команды по очереди выбирают батл, танец или караоке.</p>
      </div>
    );
  }

  if (r.mode === "pick") {
    const mine = turnPid(r) === pid;
    if (mine && captain && !myAnswer && open) {
      return (
        <div className="quiz-phone quiz-phone--center">
          {head}
          <div className="buzz__plate buzz__plate--glow" role="status">
            <strong>Ваш выбор!</strong>
            <span>Коснитесь карточки — что будете исполнять</span>
          </div>
          <CardGrid content={content} result={r} disabled={sending} onPick={(card) => onAnswer({ card })} />
        </div>
      );
    }
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>{mine ? (captain ? "Выбор отправлен" : "Выбирает ваш капитан") : <>Выбирает <NameText name={nameOf(session, turnPid(r))} /></>}</h2>
      </div>
    );
  }

  if (!card) return null;

  if (r.mode === "perform") {
    const ours = card.kind === "battle" || r.performer === pid;
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <p className="eyebrow">
          {KIND_EMOJI[card.kind]} {KIND_TITLES[card.kind]}
        </p>
        <div className={ours ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
          <strong>{ours ? "Ваш выход! Смотрите на экран" : <>Выступает <NameText name={nameOf(session, r.performer)} /></>}</strong>
          <span>{card.title || (card.kind === "battle" ? "Покажите лучшее под этот трек" : card.kind === "karaoke" ? "Пойте вместе с экраном" : "Повторяйте движения за экраном")}</span>
        </div>
      </div>
    );
  }

  if (r.mode === "vote" && stage === "question") {
    if (!captain) return <div className="quiz-phone quiz-phone--center">{head}<p className="muted">Голосует капитан — подскажите ему.</p></div>;
    if (!canVote(r, card, pid)) {
      return (
        <div className="quiz-phone quiz-phone--center">
          {head}
          <div className="buzz__plate" role="status">
            <strong>Вас оценивают другие команды</strong>
            <span>Ждите итог на экране</span>
          </div>
        </div>
      );
    }
    if (myAnswer) {
      return (
        <div className="quiz-phone quiz-phone--center">
          {head}
          <div className="buzz__plate buzz__plate--glow" role="status">
            <strong>Голос принят</strong>
          </div>
        </div>
      );
    }
    if (!open) return <div className="quiz-phone quiz-phone--center">{head}<p className="muted">Голосование закрыто.</p></div>;
    if (card.kind === "battle") {
      const others = r.order.filter((p) => p !== pid);
      return (
        <div className="quiz-phone">
          {head}
          <h2>Кто победил в батле?</h2>
          <div className="stack stack--tight">
            {others.map((p) => (
              <button key={p} type="button" className="btn btn--secondary btn--block" disabled={sending} onClick={() => onAnswer({ team: p })}>
                <NameText name={nameOf(session, p)} />
              </button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="quiz-phone">
        {head}
        <h2>
          Оцените: <NameText name={nameOf(session, r.performer)} />
        </h2>
        <RateForm min={content.minRate} max={content.maxRate} sending={sending} onRate={(rate) => onAnswer({ rate })} />
      </div>
    );
  }

  const mine = r.scores[pid];
  return (
    <div className="quiz-phone quiz-phone--center">
      {head}
      <h2>{mine ? `+${mine} вашей команде!` : "Итог на экране"}</h2>
    </div>
  );
}
