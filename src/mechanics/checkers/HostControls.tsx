import { resultKey } from "../../core/session";
import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { secondsLeft } from "../../core/session";
import type { Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import type { CheckersContent } from "./content";
import { checkersBack, checkersPrimary, colorOfPid, currentQuestion, endGame, isRight, markTask, moveChange, nextTurn, parseCheckersResult, pathChange, revealTask, skipMove, startGame, toTask } from "./logic";
import { CheckersBoard, MovePicker } from "./views";

/**
 * Пульт «Шашек»: «Начать партию» → ходы по очереди (капитан ходит с телефона, пульт проверяет ход и ставит
 * на доску; без телефона — ведущий ходит на пульте) → съели шашку — «Вопрос команде» потерявшим →
 * «Показать ответ» (+20 за верный) → «Ход: …». «Пропустить ход», «Назад», «Завершить партию».
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
  const now = useServerNow(250, stage === "question" && r.mode === "task");
  const left = stage === "question" && r.mode === "task" ? secondsLeft(session.state, now) : null;

  // Пришёл ход капитана — проверяем по правилам и ставим на доску (любой открытый пульт; `expect` мирит).
  const moveKey = stage === "question" && r.mode === "move" ? answers.filter((a) => a.step === step && a.pid === r.mover).map((a) => a.id).join(",") : "";
  useEffect(() => {
    if (!moveKey || busy) return;
    const current = latest.current;
    const { phase, step: atStep, stage: atStage, startedAt } = current.state;
    const change = moveChange(current, answers);
    if (change) {
      void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
      return;
    }
    // Пришёл ход не по правилам (телефон видел старую доску): убираем его и просим сходить заново.
    const mover = parseCheckersResult(current.state.result).mover;
    const stale = answers.some((a) => a.step === atStep && a.pid === mover && (a.submittedAt ?? 0) >= (startedAt ?? 0));
    if (!stale) return;
    setError("Капитан прислал ход не по правилам — попросили сходить заново.");
    void control
      .clearAnswers(atStep)
      .then(() => control.apply({ state: { startedAt: "server" }, expect: { phase, step: atStep, stage: atStage } }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только когда пришёл ход
  }, [moveKey, busy, session.state.startedAt]);

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
    const seen = resultKey(session.state.result);
    try {
      const change = typeof make === "function" ? await make() : make;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      // «Назад»: сначала убрать старые ответы, потом открыть шаг заново — иначе телефон, нажавший в эту
      // секунду, получит отказ и «вспомнит» старый ответ.
      // Отставший пульт (игра уже ушла дальше) ответы не стирает: запись всё равно получит отказ.
      const cur = latest.current.state;
      if (clear && (cur.step !== atStep || cur.stage !== atStage || cur.phase !== phase || resultKey(cur.result) !== seen)) return;
      for (const s of clear ?? []) await control.clearAnswers(s);
      // Отпечаток итогов шага: второй пульт не повторит «Выполнено» / «Неверно» по устаревшему виду.
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage, result: seen } });
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
      const fresh = await control.freshAnswers(step);
      if (fresh.length > 0) all = fresh;
    } catch {
      // по тому, что пришло
    }
    return revealTask(latest.current, content, all);
  }

  const action = checkersPrimary(session, content);
  const moverColor = colorOfPid(r, r.mover);
  const backPlan = checkersBack(session);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Команда") : "—");
  const own = answers.filter((a) => a.step === step);
  const next = r.mode === "task" ? r.victim : r.mover === r.white ? r.black : r.white;
  const victimAnswer = r.mode === "task" ? own.find((a) => a.pid === r.victim) : undefined;

  const labels: Record<typeof action, string> = {
    start: "Начать партию",
    waitMove: "Ждём ход капитана…",
    task: `Вопрос команде: ${name(r.mover === r.white ? r.black : r.white)}`,
    taskReveal: "Показать ответ",
    turn: `Ход: ${name(next)}`,
    end: "Завершить партию",
    podium: "Награждение",
    podiumNext: "Открыть следующее место",
    finish: "Завершить игру",
  };

  function perform() {
    if (action === "start") void run(startGame(session, participants));
    if (action === "task") void run(toTask(session, content));
    if (action === "taskReveal") void run(revealNow);
    if (action === "turn") void run(nextTurn(session));
    if (action === "end") void run(endGame(session));
    if (action === "podium") void run(awardNow(session));
    if (action === "podiumNext") void run(podiumNext(session));
    if (action === "finish") control.requestFinish();
  }

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">Шашки · ходы по очереди · вопросов осталось {Math.max(0, content.questions.length - r.q)}</p>
      <div className="row checkers-host__sides">
        <span className={r.mover === r.white && r.mode === "move" ? "is-turn" : undefined}>
          ⚪ <NameText name={name(r.white)} />: {session.leaderboard[r.white ?? ""]?.score ?? 0}
        </span>
        <span className={r.mover === r.black && r.mode === "move" ? "is-turn" : undefined}>
          ⚫ <NameText name={name(r.black)} />: {session.leaderboard[r.black ?? ""]?.score ?? 0}
        </span>
      </div>
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : (
        <>
          {r.mode === "task" && q && (
            <div className="stack stack--tight">
              <p className="muted small">
                Отвечает <NameText name={name(r.victim)} /> — потеряли шашку. Верно — +20.
              </p>
              <p className="host-quiz__question">{q.text}</p>
              <p className="muted small">
                Верный ответ: <strong className="host-quiz__answer">{q.kind === "choice" ? q.options[q.correct] : q.answers.join(" / ")}</strong>
              </p>
              {stage === "question" && (
                <>
                  <div className="host-quiz__live" aria-live="polite">
                    <span className={left === 0 ? "host-quiz__timer is-over" : "host-quiz__timer"} role="timer">
                      {left === null ? "∞" : left === 0 ? "Время вышло" : `${left} с`}
                    </span>
                    <span>
                      Ответ с телефона: <strong>{victimAnswer ? (isRight(q, victimAnswer.value) ? "верно" : "неверно") : "ещё нет"}</strong>
                    </span>
                  </div>
                  <p className="muted small">Ответили вслух или это задание — засчитайте сами:</p>
                  <div className="row checkers-host__movers">
                    <button type="button" className="btn btn--secondary" aria-pressed={r.taskOk === true} disabled={busy} onClick={() => void run(markTask(session, r.taskOk === true ? null : true))}>
                      Верно
                    </button>
                    <button type="button" className="btn btn--secondary" aria-pressed={r.taskOk === false} disabled={busy} onClick={() => void run(markTask(session, r.taskOk === false ? null : false))}>
                      Неверно
                    </button>
                  </div>
                </>
              )}
              {stage === "reveal" && <p className="host-quiz__answer">{r.taskOk ? `Верно! +${r.taskPoints}` : "Не справились"}</p>}
            </div>
          )}
          {r.mode === "move" && stage === "question" && moverColor ? (
            <>
              <p className="muted">
                Ходит <NameText name={name(r.mover)} /> ({moverColor === "w" ? "белые" : "чёрные"}): капитан выбирает ход на телефоне, доска обновится сама. Нет телефона или репетиция — сходите за команду здесь.
              </p>
              <MovePicker
                board={r.board}
                color={moverColor}
                sending={busy}
                title={`Ход за команду: ${moverColor === "w" ? "белые" : "чёрные"}`}
                onMove={(path) => {
                  const change = pathChange(latest.current, path);
                  if (change) void run(change);
                  else setError("Такой ход не по правилам — выберите другой.");
                }}
              />
            </>
          ) : (
            r.mover && r.mode !== "task" && <CheckersBoard board={r.board} last={r.last} size="phone" />
          )}
          {r.mode === "move" && stage === "reveal" && (
            <p className="muted small">{r.points > 0 ? `Съели! +${r.points}. ${action === "task" ? "Теперь вопрос команде, которая потеряла шашку." : "Вопросы кончились — просто ход сопернику."}` : r.last ? "Ход сделан." : "Ход пропущен."}</p>
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
        {r.mode === "move" && stage === "question" && r.mover && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(skipMove(session))}>
            Пропустить ход
          </button>
        )}
        {stage !== "podium" && r.mode !== "over" && r.mover && (
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
