import { useEffect, useState, type FormEvent } from "react";
import { MediaImage, preloadMedia } from "../../components/media/MediaImage";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { KIND_TITLES, LIMITS, type QuizContent, type QuizQuestion } from "./content";

export const LETTERS = ["A", "B", "C", "D", "E", "F"];

function currentQuestion(session: Session, content: QuizContent): QuizQuestion | undefined {
  return content.questions[session.state.step];
}

function correctText(q: QuizQuestion): string {
  return q.kind === "open" ? q.answers.filter((a) => a.trim()).join(" / ") : (q.options[q.correct] ?? "");
}

/**
 * Экран зала: вопрос крупно, картинка, варианты. Размеры — в единицах контейнера (cqw/cqh),
 * поэтому в предпросмотре студии вопрос выглядит так же, как на телевизоре, только мельче.
 */
export function QuizScreenView({ session, content }: ViewProps<QuizContent>) {
  const q = currentQuestion(session, content);
  const next = content.questions[session.state.step + 1];

  // Экран зала заранее качает картинку следующего вопроса.
  useEffect(() => {
    preloadMedia(session.gameId, [q?.imageId ?? null, next?.imageId ?? null], "full");
  }, [session.gameId, q?.imageId, next?.imageId]);

  if (!q) return <div className="quiz-screen quiz-screen--empty">Вопросов нет</div>;
  const revealed = session.state.revealed;

  return (
    <div className={q.imageId ? "quiz-screen quiz-screen--image" : "quiz-screen"}>
      <div className="quiz-screen__top">
        <span className="quiz-screen__counter">
          Вопрос {session.state.step + 1} из {content.questions.length}
        </span>
        <span className="quiz-screen__badge">{KIND_TITLES[q.kind]}</span>
        <span className="quiz-screen__timer" aria-label={`На ответ ${q.timeLimit} секунд`}>
          {q.timeLimit}
        </span>
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
            const state = revealed ? (i === q.correct ? " is-correct" : " is-dimmed") : "";
            return (
              <li key={i} className={`quiz-screen__option${state}`}>
                <span className="quiz-screen__letter">{LETTERS[i]}</span>
                <span>{option || "…"}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * Телефон гостя: крупные кнопки вариантов или поле ответа. Текст вопроса и уменьшенная
 * картинка — только в режиме «без экрана»: иначе вопрос виден на экране зала.
 */
export function QuizPlayerView({ session, content, canAnswer, onAnswer }: PlayerViewProps<QuizContent, number | string>) {
  const q = currentQuestion(session, content);
  const [sent, setSent] = useState<number | string | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    setSent(null);
    setText("");
  }, [q?.id]);

  if (!q) return null;
  const noScreen = session.screenMode === "none";
  const revealed = session.state.revealed;

  function answer(value: number | string) {
    if (!canAnswer || sent !== null) return;
    setSent(value);
    onAnswer(value);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (text.trim()) answer(text.trim());
  }

  return (
    <div className="quiz-phone">
      <p className="eyebrow">
        Вопрос {session.state.step + 1} из {content.questions.length}
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
              value={typeof sent === "string" ? sent : text}
              maxLength={LIMITS.answer}
              autoComplete="off"
              disabled={!canAnswer || sent !== null}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button className="btn btn--block" type="submit" disabled={!canAnswer || sent !== null || !text.trim()}>
            Отправить ответ
          </button>
        </form>
      ) : (
        <div className="quiz-phone__options">
          {q.options.map((option, i) => {
            const mark = revealed ? (i === q.correct ? " is-correct" : " is-dimmed") : sent === i ? " is-chosen" : "";
            return (
              <button
                key={i}
                type="button"
                className={`quiz-phone__option${mark}`}
                aria-pressed={sent === i}
                disabled={!canAnswer || (sent !== null && sent !== i)}
                onClick={() => answer(i)}
              >
                <span className="quiz-screen__letter">{LETTERS[i]}</span>
                <span>{option || "…"}</span>
              </button>
            );
          })}
        </div>
      )}

      <p aria-live="polite" className={sent !== null ? "success" : "muted"}>
        {revealed ? `Правильный ответ: ${correctText(q) || "—"}` : sent !== null ? "Ответ принят" : `На ответ ${q.timeLimit} секунд`}
      </p>
    </div>
  );
}

/** Пульт: что видит ведущий о текущем вопросе. Управление шагами — этап 4. */
export function QuizHostControls({ session, content }: ViewProps<QuizContent>) {
  const q = currentQuestion(session, content);
  if (!q) return <p className="muted">Вопросов нет.</p>;
  return (
    <div className="stack stack--tight">
      <p className="eyebrow">
        Вопрос {session.state.step + 1} из {content.questions.length} · {KIND_TITLES[q.kind]}
      </p>
      <p>{q.text}</p>
      <p className="muted">Верный ответ: {correctText(q) || "—"}</p>
    </div>
  );
}
