import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { podiumNext, startPodium } from "../../core/podium";
import { secondsLeft } from "../../core/session";
import type { Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import type { CheckersContent } from "./content";
import { checkersBack, checkersPrimary, currentQuestion, endGame, isRight, moveChange, nextQuestion, parseCheckersResult, revealQuestion, showQuestion, skipMove, toMove } from "./logic";
import { CheckersBoard } from "./views";

/**
 * Пульт «Шашек»: вопрос → «Показать ответ» (ход получает верно и быстрее ответившая команда) →
 * «Ход команды» → капитан ходит с телефона, пульт сам проверяет ход по правилам и ставит на доску →
 * «Следующий вопрос». «Пропустить ход», «Назад», «Завершить партию».
 */
export function CheckersHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<CheckersContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();
  const latest = useRef<Session>(session);
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    latest.current = session;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);
  const { stage, step } = session.state;
  const r = parseCheckersResult(session.state.result);
  const q = currentQuestion(content, r);
  const now = useServerNow(250, stage === "question" && r.mode === "question");
  const left = stage === "question" && r.mode === "question" ? secondsLeft(session.state, now) : null;

  // Пришёл ход капитана — проверяем по правилам и ставим на доску (любой открытый пульт; `expect` мирит).
  const moveKey = stage === "question" && r.mode === "move" ? answers.filter((a) => a.step === step && a.pid === r.mover).map((a) => a.id).join(",") : "";
  useEffect(() => {
    if (!moveKey || busy) return;
    const change = moveChange(latest.current, answers);
    if (!change) return;
    const { phase, step: atStep, stage: atStage } = latest.current.state;
    void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только когда пришёл ход
  }, [moveKey, busy]);

  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: SessionChange | (() => Promise<SessionChange>), clear?: number[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    try {
      const change = typeof make === "function" ? await make() : make;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } });
      for (const s of clear ?? []) await control.clearAnswers(s);
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function revealNow(): Promise<SessionChange> {
    let all = answers;
    try {
      all = await control.freshAnswers(step);
    } catch {
      // по тому, что пришло
    }
    return revealQuestion(latest.current, content, all, participants);
  }

  const action = checkersPrimary(session, content);
  const backPlan = checkersBack(session);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Команда") : "—");
  const own = answers.filter((a) => a.step === step);

  const labels: Record<typeof action, string> = {
    show: "Показать вопрос",
    reveal: "Показать ответ",
    toMove: `Ход: ${name(r.mover)}`,
    waitMove: "Ждём ход капитана…",
    next: "Следующий вопрос",
    end: "Завершить партию",
    podium: "Награждение",
    podiumNext: "Открыть следующее место",
    finish: "Завершить игру",
  };

  function perform() {
    if (action === "show") void run(showQuestion(session, content, participants));
    if (action === "reveal") void run(revealNow);
    if (action === "toMove") void run(toMove(session));
    if (action === "next") void run(nextQuestion(session));
    if (action === "end") void run(endGame(session));
    if (action === "podium") void run(startPodium(session));
    if (action === "podiumNext") void run(podiumNext(session));
    if (action === "finish") control.requestFinish();
  }

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">
        Шашки · вопрос {Math.min(r.q + 1, content.questions.length)} из {content.questions.length}
      </p>
      <div className="row checkers-host__sides">
        <span>
          ⚪ <NameText name={name(r.white)} />: {session.leaderboard[r.white ?? ""]?.score ?? 0}
        </span>
        <span>
          ⚫ <NameText name={name(r.black)} />: {session.leaderboard[r.black ?? ""]?.score ?? 0}
        </span>
      </div>
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : (
        <>
          {q && r.mode === "question" && (
            <div className="stack stack--tight">
              <p className="host-quiz__question">{q.text}</p>
              <p className="muted small">
                Верный ответ: <strong className="host-quiz__answer">{q.kind === "choice" ? q.options[q.correct] : q.answers.join(" / ")}</strong>
              </p>
            </div>
          )}
          {stage === "question" && r.mode === "question" && (
            <div className="host-quiz__live" aria-live="polite">
              <span className={left === 0 ? "host-quiz__timer is-over" : "host-quiz__timer"} role="timer">
                {left === null ? "∞" : left === 0 ? "Время вышло" : `${left} с`}
              </span>
              <span>
                Ответили: <strong>{own.filter((a) => a.pid === r.white || a.pid === r.black).length}</strong> из 2
              </span>
            </div>
          )}
          {stage === "reveal" && r.mode === "question" && q && (
            <ul className="buzz-queue">
              {[r.white, r.black].map((p) => {
                const a = own.find((x) => x.pid === p);
                return (
                  <li key={p ?? "none"} className={p === r.mover ? "is-now" : undefined}>
                    <span className="buzz-queue__name">
                      <NameText name={name(p)} />
                    </span>
                    <span className="buzz-queue__state">{!a ? "нет ответа" : isRight(q, a.value) ? (p === r.mover ? "верно, быстрее — ход" : "верно") : "неверно"}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {r.mode !== "question" && <CheckersBoard board={r.board} last={r.last} size="phone" />}
          {r.mode === "move" && stage === "question" && (
            <p className="muted">
              Ходит <NameText name={name(r.mover)} />: капитан выбирает ход на телефоне, доска обновится сама.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || action === "waitMove"} onClick={perform}>
          {labels[action]}
        </button>
        {r.mode === "move" && stage === "question" && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(skipMove(session))}>
            Пропустить ход
          </button>
        )}
        {stage !== "podium" && r.mode !== "over" && action !== "end" && content.questions.length > 0 && (
          <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() =>
              confirm({
                title: "Завершить партию досрочно?",
                text: "Вопросы дальше не пойдут. Побеждает команда с большим счётом, потом награждение. «Назад» вернёт партию.",
                confirmLabel: "Завершить партию",
                run: () => run(endGame(session)),
              })
            }
          >
            Завершить партию досрочно
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || backPlan === null} onClick={() => backPlan && void run(backPlan.change, backPlan.clear)}>
          Назад
        </button>
      </div>
      {dialog}
    </div>
  );
}
