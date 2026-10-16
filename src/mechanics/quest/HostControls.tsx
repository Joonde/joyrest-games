import { useEffect } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { useHostRun } from "../../components/live/useHostRun";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import type { Session } from "../../data/types";
import type { HostControlsProps } from "../types";
import { cellText, QUEST_EMOJI, QUEST_TITLES, type QuestContent } from "./content";
import { applyRoll, cellAt, judge, nextTurn, parseQuestResult, questBack, questPrimary, questTeams, rollChange, startQuest } from "./logic";

/** Момент игры для повтора касания: ход, клетка и решение ведущего. */
function questMoment(s: Session): string {
  const r = parseQuestResult(s.state.result);
  return JSON.stringify([r.mode, r.mover, r.turn, r.at, r.outcome]);
}

/**
 * Пульт «Активной настолки»: «Начать игру» → капитан (в «каждый сам» — игрок) бросает кубик на телефоне
 * (или «Бросить за команду» здесь) → задание клетки с ответом для ведущего → «Выполнено» / «Не выполнено» →
 * «Следующая команда». Первая на финише — награждение; «Завершить досрочно» — с подтверждением.
 */
export function QuestHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<QuestContent>) {
  const { busy, error, run, quiet } = useHostRun(session, control, rehearsal, { moment: questMoment });
  const [dialog, confirm] = useConfirm();
  const { stage, step } = session.state;
  const r = parseQuestResult(session.state.result);

  // Капитан бросил кубик — ставим фишку (любой открытый пульт; `expect` мирит).
  const rollKey = stage === "question" && r.mode === "roll" ? answers.filter((a) => a.step === step && a.pid === r.mover).map((a) => a.id).join(",") : "";
  useEffect(() => {
    if (!rollKey || busy) return;
    void quiet((cur) => rollChange(cur, content, answers, participants));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при броске
  }, [rollKey, busy, session.state.startedAt]);

  const action = questPrimary(session);
  const backPlan = questBack(session);
  const teams = session.playMode === "teams";
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? (teams ? "Команда" : "Игрок")) : "—");
  const cell = r.mode !== "roll" ? cellAt(content, r.at) : null;
  const hostRoll = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(1));
    return ((bytes[0] ?? 0) % 6) + 1;
  };
  const ranked = [...r.order].sort((a, b) => (r.pos[b] ?? 0) - (r.pos[a] ?? 0));

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">
        Активная настолка · {content.cells.length} клеток
      </p>
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : stage === "ready" ? (
        <p className="muted">{teams ? "Команды встанут на старт в порядке подключения. Ходит первая." : "Игроки встанут на старт в порядке подключения. Ходит первый."}</p>
      ) : (
        <>
          <p>
            {r.mode === "roll" ? "Бросает" : r.mode === "finish" ? "Финиш:" : "Ходит"} <strong><NameText name={name(r.mover)} /></strong>
            {r.roll ? ` · выпало ${r.roll} · клетка ${r.hit || r.at}${r.moved ? ` → ${r.moved > 0 ? "бонус" : "ловушка"} → клетка ${r.at}` : ""}` : ""}
          </p>
          {cell && r.mode !== "finish" && (
            <div className="card stack stack--tight quest-host__cell">
              <p className="eyebrow">
                {QUEST_EMOJI[cell.kind]} {QUEST_TITLES[cell.kind]} {cell.points > 0 ? `· ${cell.points} очков` : ""}
              </p>
              {cellText(cell, session.playMode) && <p className="host-quiz__question">{cellText(cell, session.playMode)}</p>}
              {cell.kind === "question" && cell.answer && (
                <p className="muted small">
                  Ответ: <strong className="host-quiz__answer">{cell.answer}</strong>
                </p>
              )}
              {r.outcome && <p className={r.outcome === "ok" ? "success" : "muted"}>{r.outcome === "ok" ? `Выполнено, +${r.points}` : "Не выполнено"}</p>}
            </div>
          )}
          <details className="quest-host__places">
            <summary>Где фишки</summary>
            <ol>
              {ranked.map((p) => (
                <li key={p}>
                  <NameText name={name(p)} /> — {(r.pos[p] ?? 0) >= content.cells.length + 1 ? "финиш" : `клетка ${r.pos[p] ?? 0}`}
                  {r.skip.includes(p) ? " · пропускает ход" : ""}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {action === "start" && (
          <>
            {questTeams(session, participants) === 0 && <p className="muted small">{teams ? "Ждём, пока подключатся команды — без них ходить некому." : "Ждём, пока подключатся игроки — без них ходить некому."}</p>}
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || questTeams(session, participants) === 0} onClick={() => void run((s) => startQuest(s, participants))}>
              Начать игру
            </button>
          </>
        )}
        {action === "waitRoll" && (
          <>
            <p className="muted small">{teams ? "Ждём бросок капитана. Если телефона нет — бросьте за команду." : "Ждём бросок игрока. Если телефона нет — бросьте за него."}</p>
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run((s) => applyRoll(s, content, hostRoll(), participants))}>
              🎲 {teams ? "Бросить за команду" : "Бросить за игрока"}
            </button>
          </>
        )}
        {action === "judge" && (
          <div className="host-buzz__verdict">
            <button type="button" className="btn" disabled={busy} onClick={() => void run((s) => judge(s, content, true))}>
              Выполнено
            </button>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run((s) => judge(s, content, false))}>
              Не выполнено
            </button>
          </div>
        )}
        {action === "next" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => nextTurn(s, participants))}>
            {teams ? "Следующая команда" : "Следующий игрок"}
          </button>
        )}
        {(action === "podium" || action === "podiumNext") && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => (action === "podium" ? awardNow(s) : podiumNext(s)))}>
            {action === "podium" ? "Награждение" : "Открыть следующее место"}
          </button>
        )}
        {action === "finish" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => control.requestFinish()}>
            Завершить игру
          </button>
        )}
        {stage !== "podium" && stage !== "ready" && r.mode !== "finish" && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy}
            onClick={() =>
              confirm({
                title: "Закончить игру досрочно?",
                text: `Побеждает ${teams ? "команда" : "игрок"} с большим счётом — сразу награждение. «Назад» на награждении вернёт к игре.`,
                confirmLabel: "К награждению",
                run: () => run((s) => awardNow(s)),
              })
            }
          >
            Закончить досрочно
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || backPlan === null} onClick={() => backPlan && void run((s) => questBack(s)?.change ?? null, backPlan.clear)}>
          Назад
        </button>
      </div>
      {dialog}
    </div>
  );
}
