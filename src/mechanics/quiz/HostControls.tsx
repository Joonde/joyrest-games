import { useEffect, useRef, useState } from "react";
import { scoringParticipants } from "../../core/leaderboard";
import { secondsLeft } from "../../core/session";
import { useServerNow } from "../../components/live/useServerNow";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { correctSet, KIND_TITLES, roundAt, roundTitle, type QuizContent } from "./content";
import { PodiumHostList } from "../../components/live/Podium";
import { podiumNext, startPodium } from "../../core/podium";
import { actionLabel, back, extraAction, nextQuestion, primaryAction, reveal, showBoard, showQuestion, showTotal, toggleAccepted, type QuizAction } from "./flow";
import { groupOpenAnswers, parseResult } from "./logic";
import { correctText, LETTERS } from "./views";

/**
 * Пульт квиза: одна главная кнопка на каждом этапе («Показать вопрос» → «Показать ответ» →
 * «Таблица» → «Следующий вопрос»), «Назад» на шаг, таймер, кто ответил и кто ещё нет,
 * открытые ответы гостей с засчитыванием похожих одним касанием.
 */
export function QuizHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<QuizContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  // Последняя сессия, которую видит пульт: кнопка ждёт, пока своё изменение не придёт обратно.
  const latest = useRef<Session>(session);
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    latest.current = session;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);
  const { stage, step } = session.state;
  const now = useServerNow(250, stage === "question");
  const q = content.questions[step];
  if (!q) return <p className="muted">В игре нет вопросов.</p>;

  const total = content.questions.length;
  const round = roundAt(content, step);
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const result = parseResult(session.state.result);
  const own = answers.filter((a) => a.step === step);
  const answeredIds = new Set(own.map((a) => a.pid));
  // Кто должен ответить: все в таблице и те, кого пульт ещё не успел в неё внести.
  // Участники, добавленные ведущим вручную (без телефона), не отвечают — их не ждём.
  const known = new Set(participants.map((p) => p.id));
  const expected = new Map(
    Object.entries(session.leaderboard)
      .filter(([id]) => rehearsal || known.has(id))
      .map(([id, e]) => [id, e.name]),
  );
  for (const p of scoringParticipants(participants, session.playMode)) if (!expected.has(p.id)) expected.set(p.id, p.name);
  const missing = [...expected.entries()].filter(([id]) => !answeredIds.has(id)).map(([, name]) => name);
  const action = primaryAction(session, content);

  /** Новое состояние пришло (или прошло 3 с) — кнопку можно нажимать снова. */
  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: SessionChange | (() => Promise<SessionChange>), afterClear?: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Изменение — только если игра всё ещё там, где её видит этот пульт (второй пульт, двойное касание).
    const { phase, step: atStep, stage: atStage } = session.state;
    try {
      const change = typeof make === "function" ? await make() : make;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } });
      // Ответы убираем после закрытия вопроса: новые гости уже не успеют ответить.
      if (afterClear !== undefined) await control.clearAnswers(afterClear);
      await arrived;
    } catch (e) {
      // Игра уже ушла вперёд — пульт сейчас покажет, где она; ничего не делаем.
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) {
        setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Очки — по свежему списку ответов с сервера: ответ последней секунды мог ещё не дойти до пульта. */
  async function revealChange(): Promise<SessionChange> {
    let all: Answer[] = own;
    try {
      const fresh = await control.freshAnswers(step);
      const byId = new Map(own.map((a) => [a.id, a]));
      for (const a of fresh) if (a.step === step) byId.set(a.id, a);
      all = [...byId.values()];
    } catch {
      // Нет связи — считаем по тому, что уже пришло.
    }
    return reveal(latest.current, content, all, participants);
  }

  function perform(action: QuizAction) {
    if (action === "show") void run(showQuestion(session, content));
    if (action === "reveal") void run(revealChange);
    if (action === "board") void run(showBoard(session, content));
    if (action === "total") void run(showTotal(session));
    if (action === "next") void run(nextQuestion(session, content));
    if (action === "podium") void run(startPodium(session));
    if (action === "podiumNext") void run(podiumNext(session));
    if (action === "finish") control.requestFinish();
  }

  const onPrimary = () => perform(action);
  const extra = extraAction(session, content);
  const backPlan = back(session);
  const groups = q.kind === "open" ? groupOpenAnswers(q, own, result.accepted) : [];

  const buttons = (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={onPrimary}>
          {actionLabel(session, content, action)}
        </button>
        {extra && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => perform(extra)}>
            Показать таблицу
          </button>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={busy || backPlan === null}
          onClick={() => backPlan && void run(backPlan.change, backPlan.clearAnswers)}
        >
          Назад
        </button>
      </div>
    </>
  );

  if (stage === "podium") {
    return (
      <div className="stack host-quiz">
        <div className="stack stack--tight">
          <p className="eyebrow">Награждение</p>
          <p className="muted small">Открывайте места по одному: экран покажет их с третьего по первое.</p>
        </div>
        <PodiumHostList session={session} />
        {buttons}
      </div>
    );
  }

  return (
    <div className="stack host-quiz">
      <div className="stack stack--tight">
        {round && <p className="eyebrow">{roundTitle(round)}</p>}
        <p className="eyebrow">
          Вопрос {step + 1} из {total} · {KIND_TITLES[q.kind]} · {q.points} очк.
        </p>
        <p className="host-quiz__question">{q.text}</p>
        <p className="muted small">
          Верный ответ: <strong className="host-quiz__answer">{correctText(q) || "—"}</strong>
        </p>
      </div>

      {stage === "question" && (
        <div className="host-quiz__live" aria-live="polite">
          <span className={left === 0 ? "host-quiz__timer is-over" : "host-quiz__timer"} role="timer">
            {left === null ? "∞" : left === 0 ? "Время вышло" : `${left} с`}
          </span>
          <span>
            {rehearsal ? (
              "Репетиция: гостей нет"
            ) : (
              <>
                Ответили: <strong>{own.length}</strong> из {expected.size}
              </>
            )}
          </span>
        </div>
      )}

      {stage === "question" && missing.length > 0 && !rehearsal && (
        <div className="stack stack--tight">
          <button type="button" className="btn btn--quiet host-quiz__toggle" aria-expanded={showMissing} onClick={() => setShowMissing((v) => !v)}>
            {showMissing ? "Скрыть, кто ещё не ответил" : `Ещё не ответили: ${missing.length}`}
          </button>
          {showMissing && <p className="muted small host-quiz__missing">{missing.join(", ")}</p>}
        </div>
      )}
      {stage === "question" && missing.length === 0 && expected.size > 0 && <p className="success">Ответили все!</p>}

      {q.kind === "open" && (stage === "question" || stage === "reveal") && groups.length > 0 && (
        <section className="stack stack--tight" aria-label="Ответы гостей">
          <h3 className="host-quiz__subtitle">Ответы гостей</h3>
          {stage === "question" && (
            <p className="muted small">Похожий ответ с опечаткой? Нажмите «Засчитать» до показа ответа.</p>
          )}
          <ul className="open-answers">
            {groups.map((g) => (
              <li key={g.key} className={`open-answers__item open-answers__item--${g.status}`}>
                <span className="open-answers__text">
                  {g.text} <span className="muted">× {g.count}</span>
                </span>
                {g.status === "correct" ? (
                  <span className="open-answers__mark">Верно</span>
                ) : stage === "question" ? (
                  <button
                    type="button"
                    className={g.status === "accepted" ? "btn btn--secondary open-answers__btn" : "btn btn--quiet open-answers__btn"}
                    aria-pressed={g.status === "accepted"}
                    disabled={busy}
                    onClick={() => void run(toggleAccepted(session, g.key))}
                  >
                    {g.status === "accepted" ? "Засчитано ✓" : "Засчитать"}
                  </button>
                ) : (
                  <span className="open-answers__mark">{g.status === "accepted" ? "Засчитано" : "Неверно"}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {stage === "reveal" && q.kind !== "open" && (
        <ul className="host-quiz__dist">
          {q.options.map((o, i) => (
            <li key={i} className={correctSet(q).includes(i) ? "is-correct" : undefined}>
              {LETTERS[i]}. {o} — <strong>{result.counts[i] ?? 0}</strong>
            </li>
          ))}
        </ul>
      )}
      {stage === "reveal" && (
        <p className="muted small">
          Верно ответили: {result.correct} из {result.total}
        </p>
      )}

      {buttons}
    </div>
  );
}
