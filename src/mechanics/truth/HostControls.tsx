import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import type { Session, SessionChange } from "../../data/types";
import { scoringParticipants } from "../../core/leaderboard";
import type { HostControlsProps } from "../types";
import { KIND_TITLES, type TruthContent } from "./content";
import { choose, chooseFromAnswers, handleSuggestion, nextTurn, parseTruthResult, pendingSuggestions, redraw, resolve, roundOf, startTruth, truthBack, truthPrimary, turnPid } from "./logic";

/**
 * Пульт «Правды или действия»: «Начать игру» → игрок выбирает на телефоне (или ведущий за него) →
 * карточка на экране («Другая карточка») → «Выполнено» / «Отказ» → «Следующий игрок» → награждение.
 * Сбоку — задания, которые прислали гости: «В колоду» или «Не брать».
 */
export function TruthHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<TruthContent>) {
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
  const r = parseTruthResult(session.state.result);
  const who = turnPid(r);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Игрок") : "—");
  const noPlayers = scoringParticipants(participants, session.playMode).length === 0 && Object.keys(session.leaderboard).length === 0;

  // Выбор с телефона того, чья очередь, — сразу на экран.
  const own = answers.filter((a) => a.step === step);
  const pickKey = stage === "question" && r.mode === "pick" ? own.map((a) => a.id).join(",") : "";
  useEffect(() => {
    if (!pickKey || busy) return;
    const change = chooseFromAnswers(latest.current, content, answers);
    if (!change) return;
    const { phase, step: atStep, stage: atStage } = latest.current.state;
    void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при новом выборе
  }, [pickKey, busy]);

  function nextSession(): Promise<void> {
    return new Promise((done) => {
      const timer = window.setTimeout(done, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        done();
      });
    });
  }

  async function run(change: SessionChange | null, clear?: number) {
    if (busy || !change) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    try {
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      if (clear !== undefined) await control.clearAnswers(clear);
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } });
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  const action = truthPrimary(session, content);
  const back = truthBack(session);
  const pending = content.guestCards ? pendingSuggestions(r, answers, step) : [];
  const nextWho = r.order.length > 0 ? (r.order[(r.turn + 1) % r.order.length] ?? null) : null;

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">
        Правда или действие
        {r.order.length > 0 && stage !== "ready" ? ` · ход ${r.turn + 1} · круг ${roundOf(r)}${content.rounds > 0 ? ` из ${content.rounds}` : ""}` : ""}
      </p>

      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : stage === "ready" ? (
        <p className="muted">Игроки ходят по очереди входа. Тот, чья очередь, выбирает на телефоне «Правда» или «Действие»; без телефона — выберите за него здесь.</p>
      ) : (
        <div className="card stack stack--tight">
          <p>
            {r.mode === "done" ? "Ходил(а)" : "Ходит"}: <strong><NameText name={name(who)} /></strong>
          </p>
          {r.mode === "pick" && <p className="muted small">Ждём выбор на телефоне — или выберите за игрока:</p>}
          {r.mode === "pick" && (
            <div className="td-host__pick">
              {(["truth", "dare"] as const).map((k) => (
                <button key={k} type="button" className={`btn btn--secondary td-host__kind td-host__kind--${k}`} disabled={busy} onClick={() => void run(choose(session, content, k))}>
                  {KIND_TITLES[k]}
                </button>
              ))}
            </div>
          )}
          {r.card && r.mode !== "pick" && (
            <div className={`td-host__card td-host__card--${r.card.kind}`}>
              <span className="eyebrow">
                {KIND_TITLES[r.card.kind]}
                {r.card.from ? ` · от гостя ${name(r.card.from)}` : ""}
              </span>
              <p>{r.card.text}</p>
            </div>
          )}
          {r.mode === "done" && (
            <p className={r.outcome === "done" ? "success" : "muted"}>
              {r.outcome === "done" ? `Выполнено: +${r.delta}` : r.delta ? `Отказ: ${r.delta}` : "Отказ — фант от зала"}
            </p>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <section className="stack stack--tight">
          <p className="eyebrow">Прислали гости · {pending.length}</p>
          <ul className="td-host__inbox">
            {pending.map((s) => (
              <li key={s.id} className="td-host__suggest">
                <span className="small">
                  {KIND_TITLES[s.kind]} · от <NameText name={name(s.pid)} />
                </span>
                <span>{s.text}</span>
                <span className="td-host__suggest-btns">
                  <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void run(handleSuggestion(session, s, true))}>
                    В колоду
                  </button>
                  <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void run(handleSuggestion(session, s, false))}>
                    Не брать
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.extra.length > 0 && <p className="muted small">В очереди заданий от гостей: {r.extra.length} — выпадут первыми.</p>}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {action === "start" && (
          <>
            {noPlayers && <p className="muted small">Ждём игроков.</p>}
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || noPlayers} onClick={() => void run(startTruth(session, participants))}>
              Начать игру
            </button>
          </>
        )}
        {action === "resolve" && (
          <>
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(resolve(session, content, "done"))}>
              Выполнено (+{r.choice === "truth" ? content.truthPoints : content.darePoints})
            </button>
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(resolve(session, content, "refused"))}>
              Отказ{content.refusePenalty > 0 ? ` (−${content.refusePenalty})` : ""}
            </button>
            <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void run(redraw(session, content))}>
              Другая карточка
            </button>
          </>
        )}
        {action === "next" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(nextTurn(session, participants))}>
            Следующий: {name(nextWho)}
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
        {stage !== "ready" && stage !== "podium" && r.mode === "done" && action === "next" && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy}
            onClick={() => confirm({ title: "Закончить игру?", text: "Сразу награждение по текущему счёту. «Назад» вернёт к игре.", confirmLabel: "К награждению", run: () => run(awardNow(session)) })}
          >
            Закончить и наградить
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || back === null} onClick={() => back && void run(back.change, back.clearAnswers)}>
          Назад
        </button>
      </div>
      {dialog}
    </div>
  );
}
