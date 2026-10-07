import { useEffect, useRef, useState, type FormEvent } from "react";
import { BoardView } from "../../components/live/BoardView";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { MediaImage, preloadMedia } from "../../components/media/MediaImage";
import { placeOf } from "../../core/leaderboard";
import { bestInRound, moveLabel, roundLeaderboard, roundScore } from "../../core/rounds";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { KIND_TITLES, LIMITS, roundAt, roundTitle, type QuizContent, type QuizQuestion } from "./content";
import { boardView, startsRound } from "./flow";
import { isCorrect, parseResult } from "./logic";

export const LETTERS = ["A", "B", "C", "D", "E", "F"];

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
  return q.kind === "open" ? q.answers.filter((a) => a.trim()).join(" / ") : (q.options[q.correct] ?? "");
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

  // Экран зала заранее качает картинку текущего и следующего вопроса.
  useEffect(() => {
    preloadMedia(session.gameId, [q?.imageId ?? null, next?.imageId ?? null], "full");
  }, [session.gameId, q?.imageId, next?.imageId]);

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
  const result = parseResult(session.state.result);
  const maxCount = Math.max(1, ...result.counts);

  return (
    <div className={q.imageId ? "quiz-screen quiz-screen--image" : "quiz-screen"}>
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
      <h2 className="quiz-screen__question">{q.text || "Текст вопроса"}</h2>
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
        <ol className="quiz-screen__options" data-count={q.options.length}>
          {q.options.map((option, i) => {
            const mark = revealed ? (i === q.correct ? " is-correct" : " is-dimmed") : "";
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
}: PlayerViewProps<QuizContent, number | string>) {
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

  if (stage === "reveal") {
    const accepted = parseResult(session.state.result).accepted;
    const right = answered && isCorrect(q, myAnswer?.value, accepted);
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
        <>
          <h2 className="quiz-phone__question">{q.text || "Текст вопроса"}</h2>
          {q.imageId && (
            <MediaImage className="quiz-phone__image" gameId={session.gameId} mediaId={q.imageId} variant="small" alt="" />
          )}
        </>
      ) : (
        <p className="muted">Вопрос на экране зала</p>
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
