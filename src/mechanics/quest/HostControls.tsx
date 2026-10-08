import { resultKey } from "../../core/session";
import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import type { Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { QUEST_EMOJI, QUEST_TITLES, type QuestContent } from "./content";
import { applyRoll, cellAt, judge, nextTurn, parseQuestResult, questBack, questPrimary, questTeams, rollChange, startQuest } from "./logic";

/**
 * Пульт «Активной настолки»: «Начать игру» → капитан бросает кубик на телефоне (или «Бросить за
 * команду» здесь) → задание клетки с ответом для ведущего → «Выполнено» / «Не выполнено» →
 * «Следующая команда». Первая на финише — награждение; «Завершить досрочно» — с подтверждением.
 */
export function QuestHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<QuestContent>) {
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
  const r = parseQuestResult(session.state.result);

  // Капитан бросил кубик — ставим фишку (любой открытый пульт; `expect` мирит).
  const rollKey = stage === "question" && r.mode === "roll" ? answers.filter((a) => a.step === step && a.pid === r.mover).map((a) => a.id).join(",") : "";
  useEffect(() => {
    if (!rollKey || busy) return;
    const change = rollChange(latest.current, content, answers, participants);
    if (!change) return;
    const { phase, step: atStep, stage: atStage } = latest.current.state;
    void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при броске
  }, [rollKey, busy, session.state.startedAt]);

  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(change: SessionChange, clear?: number[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    const seen = resultKey(session.state.result);
    try {
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

  const action = questPrimary(session);
  const backPlan = questBack(session);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Команда") : "—");
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
        <p className="muted">Команды встанут на старт в порядке подключения. Ходит первая.</p>
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
              {cell.text && <p className="host-quiz__question">{cell.text}</p>}
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
            {questTeams(session, participants) === 0 && <p className="muted small">Ждём, пока подключатся команды — без них ходить некому.</p>}
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || questTeams(session, participants) === 0} onClick={() => void run(startQuest(session, participants))}>
              Начать игру
            </button>
          </>
        )}
        {action === "waitRoll" && (
          <>
            <p className="muted small">Ждём бросок капитана. Если телефона нет — бросьте за команду.</p>
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(applyRoll(session, content, hostRoll(), participants))}>
              🎲 Бросить за команду
            </button>
          </>
        )}
        {action === "judge" && (
          <div className="host-buzz__verdict">
            <button type="button" className="btn" disabled={busy} onClick={() => void run(judge(session, content, true))}>
              Выполнено
            </button>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run(judge(session, content, false))}>
              Не выполнено
            </button>
          </div>
        )}
        {action === "next" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(nextTurn(session, participants))}>
            Следующая команда
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
        {stage !== "podium" && stage !== "ready" && r.mode !== "finish" && (
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
