import { useEffect, useRef, useState, type FormEvent } from "react";
import { BoardView } from "../../components/live/BoardView";
import { BuzzButton } from "../../components/live/BuzzButton";
import { Confetti } from "../../components/live/Confetti";
import { RaceLanes } from "../../components/live/RaceLanes";
import { NameText } from "../../components/NameText";
import { buzzPhone, EMPTY_BUZZ, isBuzz } from "../../core/buzz";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { MediaImage, preloadMedia } from "../../components/media/MediaImage";
import { preloadTrack, useFragment } from "../../components/music/useFragment";
import { placeOf } from "../../core/leaderboard";
import { bestInRound, moveLabel, roundLeaderboard, roundScore } from "../../core/rounds";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { clipOf, correctSet, KIND_TITLES, LIMITS, roundAt, roundTitle, settingsOf, type QuizContent, type QuizQuestion } from "./content";
import { boardView, startsRound } from "./flow";
import { isCorrect, parseResult, picturesRight } from "./logic";

export const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** Ответ гостя: номер варианта, текст, ответы к картинкам или нажатие кнопки «кто первый». */
export type QuizAnswerValue = number | string | string[] | { buzz: true };

function plural(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

function currentQuestion(session: Session, content: QuizContent): QuizQuestion | undefined {
  return content.questions[session.state.step];
}

export function correctText(q: QuizQuestion): string {
  if (q.kind === "open" || q.kind === "buzz") return q.answers.filter((a) => a.trim()).join(" / ");
  if (q.kind === "pictures") return (q.pictures ?? []).map((p, i) => `${i + 1}. ${p.answers.find((a) => a.trim()) ?? "—"}`).join(" · ");
  return correctSet(q)
    .map((i) => q.options[i] ?? "")
    .filter(Boolean)
    .join(" / ");
}

/** Секунды до конца ответа по часам сервера; тикает, только пока вопрос открыт. */
function useSecondsLeft(session: Session): number | null {
  const open = session.state.stage === "question";
  const now = useServerNow(250, open);
  return open ? secondsLeft(session.state, now) : null;
}

/** Звук при смене значения (не при первом показе: перезагрузка экрана не должна звенеть). */
function useSoundOnChange(value: string, sound: Parameters<typeof playSound>[0], when: (value: string) => boolean) {
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current !== value && when(value)) playSound(sound);
    previous.current = value;
  }, [value, sound, when]);
}

const isReveal = (v: string) => v.endsWith(":reveal");
const isZero = (v: string) => v === "0";
const isSet = (v: string) => v !== "";
const isTick = (v: string) => {
  const n = Number(v);
  return n > 0 && n <= 5;
};

/**
 * Экран зала: «готовы?», вопрос крупно с таймером и счётчиком ответов, правильный ответ
 * с распределением, таблица. Размеры — в единицах контейнера (cqw/cqh), поэтому в
 * предпросмотре студии вопрос выглядит так же, как на телевизоре, только мельче.
 */
export function QuizScreenView({ session, content }: ViewProps<QuizContent>) {
  const q = currentQuestion(session, content);
  const next = content.questions[session.state.step + 1];
  const left = useSecondsLeft(session);
  const { stage, step } = session.state;

  useSoundOnChange(`${step}:${stage}`, "correct", isReveal);
  useSoundOnChange(String(left ?? ""), "tick", isTick);
  useSoundOnChange(String(left ?? ""), "timeUp", isZero);
  // Заставка нового раунда — со свистом перехода.
  const roundIntro = stage === "ready" && startsRound(content, step) ? `intro:${step}` : "";
  useSoundOnChange(roundIntro, "whoosh", isSet);

  // Экран зала заранее качает картинки и музыку текущего и следующего вопроса.
  useEffect(() => {
    const images = [q?.imageId ?? null, next?.imageId ?? null, ...(q?.pictures ?? []).map((p) => p.imageId), ...(next?.pictures ?? []).map((p) => p.imageId)];
    preloadMedia(session.gameId, images, "full");
    preloadTrack(q?.trackId);
    preloadTrack(next?.trackId);
  }, [session.gameId, q, next]);

  // Музыка вопроса: угадывание — при показе вопроса и по «Повторить»; на верном ответе — припев
  // (если задан) или снова фрагмент. Пока гость отвечает (кнопка), фрагмент на паузе.
  const parsed = parseResult(session.state.result);
  const buzz = parsed.buzz ?? null;
  const replay = typeof (session.state.result as { replay?: unknown } | null)?.replay === "number" ? (session.state.result as { replay: number }).replay : 0;
  const clip = q ? clipOf(q) : null;
  const chorus = stage === "reveal" && clip?.chorusStart !== null && clip?.chorusStart !== undefined;
  const fragmentKey = !clip?.trackId ? null : stage === "question" ? `q:${step}:${session.state.startedAt ?? 0}:${replay}` : stage === "reveal" ? `r:${step}:${replay}` : null;
  useFragment(
    clip?.trackId ?? null,
    chorus ? (clip?.chorusStart ?? 0) : (clip?.start ?? 0),
    chorus ? (clip?.chorusLength ?? 10) : stage === "reveal" ? Math.max(20, clip?.length ?? 0) : (clip?.length ?? 15),
    fragmentKey,
    { options: { fadeIn: clip?.fadeIn ?? 0, fadeOut: clip?.fadeOut ?? 0 }, chorus: chorus ? clip?.join : undefined, paused: stage === "question" && Boolean(buzz?.current) },
  );
  // Кто-то нажал кнопку — короткий звук «слово ему».
  useSoundOnChange(buzz?.current ?? "", "gong", isSet);

  if (!q) return <div className="quiz-screen quiz-screen--empty">Вопросов нет</div>;
  const total = content.questions.length;

  const round = roundAt(content, step);

  if (stage === "board") {
    const view = boardView(session);
    if (view === "round" && round) {
      return (
        <div className="quiz-screen quiz-screen--board">
          <BoardView
            leaderboard={roundLeaderboard(session.leaderboard)}
            title={`Итоги: ${roundTitle(round)}`}
            showLast={false}
            stars={bestInRound(session.leaderboard)}
          />
        </div>
      );
    }
    return (
      <div className="quiz-screen quiz-screen--board">
        <BoardView
          leaderboard={session.leaderboard}
          title={view === "total" && round ? `Общий счёт после раунда ${round.number}` : `Таблица после ${step + 1}-го вопроса из ${total}`}
          showLast={view !== "total"}
          showMoves
          stars={view === "total" ? bestInRound(session.leaderboard) : undefined}
        />
      </div>
    );
  }

  if (stage === "ready" && round && (startsRound(content, step) || step === 0)) {
    // Заставка раунда: «Раунд 2» крупно, название, сколько вопросов.
    const count = round.to - round.from + 1;
    const named = roundTitle(round) !== `Раунд ${round.number}`;
    return (
      <div className="quiz-screen quiz-screen--intro">
        {named && <span className="quiz-screen__badge">Раунд {round.number}</span>}
        <h2 className="quiz-screen__intro">{named ? round.title : `Раунд ${round.number}`}</h2>
        <p className="quiz-screen__hint">
          {count} {plural(count, "вопрос", "вопроса", "вопросов")} · первый — {KIND_TITLES[q.kind].toLowerCase()}
        </p>
      </div>
    );
  }

  if (stage === "ready") {
    return (
      <div className="quiz-screen quiz-screen--intro">
        <span className="quiz-screen__badge">{KIND_TITLES[q.kind]}</span>
        <h2 className="quiz-screen__intro">
          Вопрос {step + 1} <span className="quiz-screen__of">из {total}</span>
        </h2>
        <p className="quiz-screen__hint">Приготовьте телефоны</p>
      </div>
    );
  }

  const revealed = stage === "reveal";
  const result = parsed;
  const maxCount = Math.max(1, ...result.counts);
  const someoneRight = q.kind === "buzz" ? Boolean(buzz?.winner) : result.correct > 0;
  const confetti = revealed && someoneRight && Boolean(clip?.confetti) && (Boolean(clip?.trackId) || q.kind === "buzz") ? (
    <Confetti burst={`${step}:${session.state.startedAt ?? 0}`} />
  ) : null;

  if (q.kind === "buzz") {
    const target = settingsOf(content).raceTarget;
    const winner = buzz?.winner ? session.leaderboard[buzz.winner] : null;
    const finished = winner && (winner.race ?? 0) >= target;
    return (
      <div className="quiz-screen quiz-screen--race">
        {confetti}
        <div className="quiz-screen__top">
          <span className="quiz-screen__counter">
            Вопрос {step + 1} из {total}
          </span>
          <span className="quiz-screen__badge">Гонка · финиш — {target}</span>
          {!revealed && <span className="quiz-screen__answered">Нажали: {buzz?.order.length ?? 0}</span>}
        </div>
        <h2 className="quiz-screen__question">
          {q.trackId && (
            <span className="quiz-screen__note" aria-hidden="true">
              ♪{" "}
            </span>
          )}
          {q.text || "Угадайте мелодию"}
        </h2>
        {revealed && (
          <p className="quiz-screen__race-answer">
            {winner ? (
              <>
                Верно — <NameText name={winner.name} />: <strong>{correctText(q) || "—"}</strong>
              </>
            ) : (
              <>
                Правильный ответ: <strong>{correctText(q) || "—"}</strong>
              </>
            )}
          </p>
        )}
        {finished && winner && (
          <p className="quiz-screen__finish">
            Финиш! <NameText name={winner.name} /> выигрывает гонку
          </p>
        )}
        <RaceLanes leaderboard={session.leaderboard} buzz={buzz ?? EMPTY_BUZZ} target={target} />
      </div>
    );
  }

  if (q.kind === "pictures") {
    const pics = q.pictures ?? [];
    return (
      <div className="quiz-screen quiz-screen--pictures">
        {confetti}
        <div className="quiz-screen__top">
          <span className="quiz-screen__counter">
            Вопрос {step + 1} из {total}
          </span>
          <span className="quiz-screen__badge">Картинки · {pics.length}</span>
          {revealed ? (
            <span className="quiz-screen__answered">
              Всё верно: {result.correct} из {result.total}
            </span>
          ) : (
            <span className="quiz-screen__answered">Ответили: {session.state.answered}</span>
          )}
          {!revealed && (
            <span className={left === 0 ? "quiz-screen__timer is-over" : "quiz-screen__timer"} role="timer">
              {left === null ? q.timeLimit : left === 0 ? "Стоп" : left}
            </span>
          )}
        </div>
        <h2 className="quiz-screen__question">{q.text || "Что на картинках?"}</h2>
        <ol className="quiz-screen__pictures" data-count={pics.length}>
          {pics.map((p, i) => (
            <li key={i} className="quiz-screen__picture">
              {p.imageId ? <MediaImage className="quiz-screen__picture-img" gameId={session.gameId} mediaId={p.imageId} variant="full" alt="" /> : <span className="quiz-screen__picture-empty" />}
              <span className="quiz-screen__picture-num">{i + 1}</span>
              {revealed && (
                <span className="quiz-screen__picture-cap">
                  <strong>{p.answers.find((a) => a.trim()) ?? "—"}</strong>
                  <span>угадали {result.right?.[i] ?? 0}</span>
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className={q.imageId ? "quiz-screen quiz-screen--image" : "quiz-screen"}>
      {confetti}
      <div className="quiz-screen__top">
        <span className="quiz-screen__counter">
          Вопрос {step + 1} из {total}
        </span>
        <span className="quiz-screen__badge">{KIND_TITLES[q.kind]}</span>
        {revealed ? (
          <span className="quiz-screen__answered">
            Верно ответили: {result.correct} из {result.total}
          </span>
        ) : (
          <span className="quiz-screen__answered">Ответили: {session.state.answered}</span>
        )}
        {!revealed && (
          <span
            className={left === 0 ? "quiz-screen__timer is-over" : "quiz-screen__timer"}
            role="timer"
            aria-label={left === null ? `На ответ ${q.timeLimit} секунд` : `Осталось ${left} секунд`}
          >
            {left === null ? q.timeLimit : left === 0 ? "Стоп" : left}
          </span>
        )}
      </div>
      <h2 className="quiz-screen__question">
        {q.trackId && (
          <span className="quiz-screen__note" aria-hidden="true">
            ♪{" "}
          </span>
        )}
        {q.text || "Текст вопроса"}
      </h2>
      {q.imageId && (
        <MediaImage className="quiz-screen__image" gameId={session.gameId} mediaId={q.imageId} variant="full" alt="" />
      )}
      {q.kind === "open" ? (
        <div className="quiz-screen__open">
          {revealed ? (
            <>
              <span className="quiz-screen__hint">Правильный ответ</span>
              <strong>{correctText(q) || "—"}</strong>
            </>
          ) : (
            <span className="quiz-screen__hint">Напишите ответ на телефоне</span>
          )}
        </div>
      ) : (
        <ol className="quiz-screen__options" data-count={q.options.length} data-len={optionsSize(q.options)}>
          {q.options.map((option, i) => {
            const mark = revealed ? (correctSet(q).includes(i) ? " is-correct" : " is-dimmed") : "";
            const count = result.counts[i] ?? 0;
            return (
              <li key={i} className={`quiz-screen__option${mark}`}>
                <span className="quiz-screen__letter">{LETTERS[i]}</span>
                <span className="quiz-screen__text">{option || "…"}</span>
                {revealed && (
                  <span className="quiz-screen__count">
                    {count}
                    <span className="quiz-screen__bar" style={{ width: `${(count / maxCount) * 100}%` }} aria-hidden="true" />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Крупность вариантов на экране зала: короткие — крупно, длинные — мельче, но без пустых карточек. */
function optionsSize(options: string[]): "s" | "m" | "l" {
  const longest = Math.max(0, ...options.map((o) => o.length));
  return longest <= 18 ? "s" : longest <= 42 ? "m" : "l";
}

/** Ответ гостя, запомненный телефоном: номер варианта или текст. */
function answerLabel(q: QuizQuestion, value: unknown): string {
  if (typeof value === "number") return `${LETTERS[value] ?? "?"}. ${q.options[value] ?? ""}`;
  return typeof value === "string" ? value : "";
}

/**
 * Телефон гостя: крупные кнопки вариантов или поле ответа, «Ответ принят», затем
 * верно/неверно, свои очки и место. Текст вопроса и уменьшенная картинка — только в режиме
 * «без экрана»: иначе вопрос виден на экране зала.
 */
export function QuizPlayerView({
  session,
  content,
  pid,
  role,
  myAnswer,
  sending,
  onAnswer,
}: PlayerViewProps<QuizContent, QuizAnswerValue>) {
  const q = currentQuestion(session, content);
  const [text, setText] = useState("");
  const now = useServerNow(500, session.state.stage === "question");
  const left = secondsLeft(session.state, now);

  useEffect(() => setText(""), [q?.id]);

  if (!q) return null;
  const { stage, step } = session.state;
  const total = content.questions.length;
  const noScreen = session.screenMode === "none";
  const me = session.leaderboard[pid];
  const place = placeOf(session.leaderboard, pid);
  const answered = myAnswer !== null && myAnswer !== undefined;
  const open = acceptsAnswers(session.state, now);
  const canAnswer = role !== "member" && open && myAnswer === null && !sending;

  const scoreLine = me && place && (
    <p className="quiz-phone__score">
      {pointsLabel(me.score)} · {place.place}-е место из {place.total}
    </p>
  );

  const round = roundAt(content, step);

  if (stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {round && <p className="eyebrow">{roundTitle(round)}</p>}
        <p className="eyebrow">
          Вопрос {step + 1} из {total}
        </p>
        <h2 className="quiz-phone__question">Приготовьтесь!</h2>
        <p className="muted">{noScreen ? "Ведущий сейчас покажет вопрос." : "Смотрите на экран зала."}</p>
        {scoreLine}
      </div>
    );
  }

  if (stage === "board") {
    const view = boardView(session);
    if (view === "round" && round && me) {
      const roundPlace = placeOf(roundLeaderboard(session.leaderboard), pid);
      return (
        <div className="quiz-phone quiz-phone--center">
          <p className="eyebrow">Итоги: {roundTitle(round)}</p>
          {roundPlace && <p className="quiz-phone__place">{roundPlace.place}</p>}
          <p className="quiz-phone__score">
            место в раунде · {pointsLabel(roundScore(me))} за раунд
          </p>
          {bestInRound(session.leaderboard).has(pid) && <p className="success">★ Лучший в раунде!</p>}
        </div>
      );
    }
    return (
      <div className="quiz-phone quiz-phone--center">
        <p className="eyebrow">{view === "total" && round ? `Общий счёт после раунда ${round.number}` : `Таблица после ${step + 1}-го вопроса`}</p>
        {me && place ? (
          <>
            <p className="quiz-phone__place">{place.place}</p>
            <p className="quiz-phone__score">
              место из {place.total} · {pointsLabel(me.score)}
              {moveLabel(me.move) && ` · ${moveLabel(me.move)}`}
            </p>
          </>
        ) : (
          <p className="muted">Вы появитесь в таблице после следующего вопроса.</p>
        )}
      </div>
    );
  }

  if (q.kind === "buzz" && (stage === "question" || stage === "reveal")) {
    const buzz = parseResult(session.state.result).buzz ?? EMPTY_BUZZ;
    const pressed = myAnswer !== null && myAnswer !== undefined && isBuzz(myAnswer.value);
    const phone = buzzPhone(buzz, pid, pressed, open && role !== "member");
    const speakerId = buzz.winner ?? buzz.current;
    const speaker = speakerId ? (session.leaderboard[speakerId]?.name ?? null) : null;
    const target = settingsOf(content).raceTarget;
    return (
      <div className="quiz-phone quiz-phone--center">
        <p className="eyebrow">
          Вопрос {step + 1} из {total} · Гонка
        </p>
        {me && (
          <p className="quiz-phone__race">
            <NameText name={me.name} /> · {Math.min(target, me.race ?? 0)} из {target} до финиша
          </p>
        )}
        {noScreen && <h2 className="quiz-phone__question">{q.text || "Угадайте мелодию"}</h2>}
        {role === "member" ? (
          <div className="buzz">
            <div className="buzz__plate" role="status">
              <strong>Кнопку жмёт капитан</strong>
              <span>{speaker ? `Отвечает ${speaker}` : "Подскажите капитану ответ"}</span>
            </div>
          </div>
        ) : (
          <BuzzButton state={phone.state} place={phone.place} speaker={speaker} sending={sending} onPress={() => onAnswer({ buzz: true })} />
        )}
        {stage === "reveal" && (
          <p>
            Правильный ответ: <strong>{correctText(q) || "—"}</strong>
          </p>
        )}
        {scoreLine}
      </div>
    );
  }

  if (stage === "reveal") {
    const accepted = parseResult(session.state.result).accepted;
    const right = answered && isCorrect(q, myAnswer?.value, accepted);
    if (q.kind === "pictures") {
      const marks = answered ? picturesRight(q, myAnswer?.value, accepted) : [];
      const mine = answered && Array.isArray(myAnswer?.value) ? (myAnswer.value as unknown[]) : [];
      return (
        <div className="quiz-phone" aria-live="polite">
          <p className="eyebrow">
            Вопрос {step + 1} из {total} · Картинки
          </p>
          {!answered && <p className="quiz-phone__verdict">Ответа не было</p>}
          <ol className="quiz-phone__picture-answers">
            {(q.pictures ?? []).map((p, i) => (
              <li key={i} className={marks[i] ? "is-right" : "is-wrong"}>
                <span className="quiz-phone__picture-num">{i + 1}</span>
                <span>
                  <strong>{p.answers.find((a) => a.trim()) ?? "—"}</strong>
                  {answered && (
                    <span className="muted small">
                      {" "}
                      · ваш ответ: {typeof mine[i] === "string" && mine[i] ? String(mine[i]) : "—"} {marks[i] ? "✓" : "✕"}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {me && (me.last ?? 0) > 0 && <p className="quiz-phone__plus">+{pointsLabel(me.last ?? 0)}</p>}
          {scoreLine}
        </div>
      );
    }
    return (
      <div className="quiz-phone quiz-phone--center" aria-live="polite">
        <p className="eyebrow">
          Вопрос {step + 1} из {total}
        </p>
        {myAnswer === undefined ? (
          <p className="muted">Проверяем ответ…</p>
        ) : !answered ? (
          <p className="quiz-phone__verdict">Ответа не было</p>
        ) : (
          <p className={right ? "quiz-phone__verdict is-right" : "quiz-phone__verdict is-wrong"}>
            {right ? "Верно!" : "Неверно"}
          </p>
        )}
        {answered && <p className="muted">Ваш ответ: {answerLabel(q, myAnswer?.value)}</p>}
        <p>
          Правильный ответ: <strong>{correctText(q) || "—"}</strong>
        </p>
        {me && (me.last ?? 0) > 0 && <p className="quiz-phone__plus">+{pointsLabel(me.last ?? 0)}</p>}
        {scoreLine}
      </div>
    );
  }

  // Вопрос открыт.
  if (q.kind === "pictures") {
    return (
      <PicturesForm
        key={q.id}
        session={session}
        content={content}
        q={q}
        canAnswer={canAnswer}
        sending={sending}
        role={role}
        answered={answered}
        mine={answered && Array.isArray(myAnswer?.value) ? (myAnswer.value as unknown[]).map((v) => (typeof v === "string" ? v : "")) : null}
        left={left}
        open={open}
        onAnswer={(values) => onAnswer(values)}
      />
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (canAnswer && text.trim()) onAnswer(text.trim().slice(0, LIMITS.answer));
  }

  let status: string;
  if (sending) status = "Отправляем ответ…";
  else if (answered) status = role === "member" ? "Капитан ответил" : "Ответ принят";
  else if (role === "member") status = "Отвечает капитан команды";
  else if (!open) status = "Время вышло";
  else status = left === null ? "Выберите ответ" : `Осталось ${left} с`;

  return (
    <div className="quiz-phone">
      <p className="eyebrow">
        Вопрос {step + 1} из {total} · {KIND_TITLES[q.kind]}
      </p>
      {noScreen ? (
        <h2 className="quiz-phone__question">{q.text || "Текст вопроса"}</h2>
      ) : (
        <p className="muted">Вопрос на экране зала</p>
      )}
      {/* Картинка: без экрана — всегда, с экраном — если ведущий включил «Картинки на телефонах». */}
      {q.imageId && (noScreen || settingsOf(content).phoneImages) && (
        <MediaImage className="quiz-phone__image" gameId={session.gameId} mediaId={q.imageId} variant="small" alt="" />
      )}

      {q.kind === "open" ? (
        <form className="stack" onSubmit={onSubmit}>
          <label className="field">
            Ваш ответ
            <input
              value={typeof myAnswer?.value === "string" ? myAnswer.value : text}
              maxLength={LIMITS.answer}
              autoComplete="off"
              enterKeyHint="send"
              disabled={!canAnswer}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {role !== "member" && (
            <button className="btn btn--block" type="submit" disabled={!canAnswer || !text.trim()}>
              Отправить ответ
            </button>
          )}
        </form>
      ) : (
        <div className="quiz-phone__options">
          {q.options.map((option, i) => {
            const chosen = myAnswer?.value === i;
            return (
              <button
                key={i}
                type="button"
                className={chosen ? "quiz-phone__option is-chosen" : "quiz-phone__option"}
                aria-pressed={chosen}
                disabled={!canAnswer}
                onClick={() => onAnswer(i)}
              >
                <span className="quiz-screen__letter">{LETTERS[i]}</span>
                <span>{option || "…"}</span>
              </button>
            );
          })}
        </div>
      )}

      <p aria-live="polite" className={answered ? "quiz-phone__status success" : "quiz-phone__status muted"}>
        {status}
      </p>
    </div>
  );
}

/** Телефон: ответы к нескольким картинкам — поле на каждую, номера как на экране зала. */
function PicturesForm({
  session,
  content,
  q,
  canAnswer,
  sending,
  role,
  answered,
  mine,
  left,
  open,
  onAnswer,
}: {
  session: Session;
  content: QuizContent;
  q: QuizQuestion;
  canAnswer: boolean;
  sending: boolean;
  role: PlayerViewProps<QuizContent, QuizAnswerValue>["role"];
  answered: boolean;
  mine: string[] | null;
  left: number | null;
  open: boolean;
  onAnswer: (values: string[]) => void;
}) {
  const pics = q.pictures ?? [];
  const [values, setValues] = useState<string[]>(() => pics.map(() => ""));
  const noScreen = session.screenMode === "none";
  const showImages = noScreen || settingsOf(content).phoneImages;
  const total = content.questions.length;
  const shown = mine ?? values;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (canAnswer && values.some((v) => v.trim())) onAnswer(values.map((v) => v.trim().slice(0, LIMITS.answer)));
  }
  let status: string;
  if (sending) status = "Отправляем ответ…";
  else if (answered) status = role === "member" ? "Капитан ответил" : "Ответ принят";
  else if (role === "member") status = "Отвечает капитан команды";
  else if (!open) status = "Время вышло";
  else status = left === null ? "Напишите ответы" : `Осталось ${left} с`;
  return (
    <form className="quiz-phone stack" onSubmit={submit}>
      <p className="eyebrow">
        Вопрос {session.state.step + 1} из {total} · Картинки
      </p>
      <h2 className="quiz-phone__question">{q.text || "Что на картинках?"}</h2>
      <p className="muted small">Номера — как на экране. Можно оставить пустым; очки — за каждый верный ответ.</p>
      {pics.map((p, i) => (
        <label key={i} className="quiz-phone__picture-field">
          <span className="quiz-phone__picture-num" aria-hidden="true">
            {i + 1}
          </span>
          {showImages && p.imageId && <MediaImage className="quiz-phone__picture-img" gameId={session.gameId} mediaId={p.imageId} variant="small" alt="" />}
          <input
            aria-label={`Ответ к картинке ${i + 1}`}
            value={shown[i] ?? ""}
            maxLength={LIMITS.answer}
            autoComplete="off"
            disabled={!canAnswer}
            onChange={(e) => setValues((cur) => cur.map((v, j) => (j === i ? e.target.value : v)))}
          />
        </label>
      ))}
      {role !== "member" && (
        <button className="btn btn--block" type="submit" disabled={!canAnswer || !values.some((v) => v.trim())}>
          Отправить ответы
        </button>
      )}
      <p aria-live="polite" className={answered ? "quiz-phone__status success" : "quiz-phone__status muted"}>
        {status}
      </p>
    </form>
  );
}
