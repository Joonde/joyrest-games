import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { pointsLabel } from "../../core/results";
import { resultKey } from "../../core/session";
import type { Session, SessionChange } from "../../data/types";
import { scoringParticipants } from "../../core/leaderboard";
import type { HostControlsProps } from "../types";
import { heroOf, statTitle, type DragonContent } from "./content";
import { battleOf, closeHeroes, dragonBack, dragonPrimary, maxLives, nextBattle, nextTask, parseDragonResult, revealTask, showTask, startDragon, taskOf, toggleMark } from "./logic";

const LETTERS = ["A", "B", "C", "D"];

/**
 * Пульт «Боя с драконом»: «Начать игру» (капитаны выбирают героев) → «Герои выбраны — в бой!» → задание
 * («Показать задание» → «Удар!») → «Следующее задание» … → итог боя → «Следующий бой» → награждение.
 */
export function DragonHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<DragonContent>) {
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
  const r = parseDragonResult(session.state.result);
  const noTeams = scoringParticipants(participants, session.playMode).length === 0 && Object.keys(session.leaderboard).length === 0;
  const battle = battleOf(content, r);
  const task = taskOf(content, r);

  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: SessionChange | null | (() => Promise<SessionChange | null>), clear?: number[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    const seen = resultKey(session.state.result);
    try {
      const change = typeof make === "function" ? await make() : make;
      if (!change) return;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      // Отставший пульт (игра уже ушла дальше) ответы не стирает: запись всё равно получит отказ.
      const cur = latest.current.state;
      if (clear && (cur.step !== atStep || cur.stage !== atStage || cur.phase !== phase || resultKey(cur.result) !== seen)) return;
      for (const s of clear ?? []) await control.clearAnswers(s);
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage, result: seen } });
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  const fresh = <T,>(make: (list: typeof answers) => T) => () => control.freshAnswers(step).then((list) => make(list.length > 0 ? list : answers));
  const action = dragonPrimary(session, content);
  const backPlan = dragonBack(session, participants);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Команда") : "—");
  const answered = new Set(answers.filter((a) => a.step === step && (a.submittedAt ?? 0) >= (session.state.startedAt ?? 0)).map((a) => a.pid));

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">
        Бой с драконом{battle ? ` · бой ${r.battle + 1} из ${content.battles.length}: ${battle.name}` : ""}
        {battle && r.phase !== "heroes" && r.phase !== "over" ? ` · ${r.hp} / ${battle.hp} ❤` : ""}
      </p>
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : r.order.length === 0 ? (
        <p className="muted">Капитаны выберут героя и разложат {5} очков по свойствам. Команды в бою — в порядке подключения.</p>
      ) : r.phase === "heroes" ? (
        <p>
          Героев выбрали: {answered.size} из {r.order.length}. Кто не успеет — получит героя по порядку и свойства по 1.
        </p>
      ) : (
        task &&
        r.phase !== "over" && (
          <div className="card stack stack--tight">
            <p className="eyebrow">
              Задание {r.task + 1} из {battle?.tasks.length ?? 0} · {statTitle(task.stat)} · урон {task.power}
            </p>
            <p className="host-quiz__question">{task.kind === "dice" ? task.text || "Бросок кубика" : task.text}</p>
            {task.kind === "choice" && (
              <ol className="mil-host-options">
                {task.options.map((o, i) => (
                  <li key={i} className={i === task.correct ? "is-correct" : undefined}>
                    <strong>{LETTERS[i]}</strong> {o}
                    {i === task.correct ? " ★" : ""}
                  </li>
                ))}
              </ol>
            )}
            {r.phase === "task" && task.kind !== "task" && <p className="small">Ответили: {[...answered].filter((p) => r.order.includes(p)).length} из {r.order.length - r.dead.length}</p>}
            {r.phase === "task" && task.kind === "dice" && <p className="muted small">Кто не бросит — за того кубик бросится сам при «Удар!».</p>}
          </div>
        )
      )}
      {r.phase === "task" && task?.kind === "task" && (
        <section className="stack stack--tight">
          <p className="eyebrow">Кто выполнил задание</p>
          <div className="sv-marks">
            {r.order
              .filter((p) => !r.dead.includes(p))
              .map((p) => (
                <button key={p} type="button" className="column-opt" aria-pressed={r.marks.includes(p)} disabled={busy} onClick={() => void run(toggleMark(session, p))}>
                  <span className="column-opt__check" aria-hidden="true">{r.marks.includes(p) ? "✓" : ""}</span>
                  <span className="line-clamp">
                    <NameText name={name(p)} />
                  </span>
                </button>
              ))}
          </div>
        </section>
      )}
      {r.order.length > 0 && r.phase !== "heroes" && (
        <details className="quest-host__places">
          <summary>Герои, жизни и очки</summary>
          <ol>
            {r.order.map((p) => {
              const h = r.heroes[p];
              const hero = heroOf(h?.hero);
              return (
                <li key={p}>
                  {r.dead.includes(p) ? "💀" : hero?.icon} <NameText name={name(p)} /> — {hero?.name}, ❤️ {r.lives[p] ?? 0}/{maxLives(content, h)}, урон в бою {r.dmg[p] ?? 0}, {pointsLabel(session.leaderboard[p]?.score ?? 0)}
                </li>
              );
            })}
          </ol>
        </details>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {action === "start" && (
          <>
            {noTeams && <p className="muted small">Ждём, пока подключатся команды.</p>}
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || noTeams} onClick={() => void run(startDragon(session, participants))}>
              Выбор героев
            </button>
          </>
        )}
        {action === "heroesDone" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(fresh((list) => closeHeroes(latest.current, content, list, participants)))}>
            Герои выбраны — в бой!
          </button>
        )}
        {action === "show" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(showTask(session, content, participants))}>
            Показать задание
          </button>
        )}
        {action === "reveal" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(fresh((list) => revealTask(latest.current, content, list, participants)))}>
            Удар!
          </button>
        )}
        {action === "next" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(nextTask(session, content, participants))}>
            {(battle && r.task + 1 >= battle.tasks.length) || r.order.every((p) => r.dead.includes(p)) ? "Итог боя" : "Следующее задание"}
          </button>
        )}
        {action === "nextBattle" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(nextBattle(session, content, participants))}>
            {r.battle + 1 < content.battles.length ? "Следующий бой" : "К награждению"}
          </button>
        )}
        {(action === "podium" || action === "podiumNext") && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(action === "podium" ? awardNow(session) : podiumNext(session))}>
            {action === "podium" ? "Награждение" : "Открыть следующее место"}
          </button>
        )}
        {action === "finish" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => control.requestFinish()}>
            Завершить игру
          </button>
        )}
        {stage !== "podium" && r.order.length > 0 && r.phase !== "over" && r.phase !== "heroes" && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy}
            onClick={() =>
              confirm({
                title: "Закончить игру досрочно?",
                text: "Побеждает команда с большим счётом — сразу награждение. «Назад» на награждении вернёт к игре.",
                confirmLabel: "К награждению",
                run: () => run(awardNow(session)),
              })
            }
          >
            Закончить досрочно
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
