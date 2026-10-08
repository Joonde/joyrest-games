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
import { KIND_TITLES, LETTERS, warIndex, type SurvivalContent } from "./content";
import {
  afterAuction,
  auctionPending,
  closeBets,
  finishAuction,
  isWarRound,
  nextRound,
  openAuction,
  openBets,
  parseSurvivalResult,
  revealRound,
  rightTeams,
  roundNumber,
  roundOf,
  showRound,
  startSurvival,
  survivalBack,
  survivalPrimary,
  toggleMark,
} from "./logic";

/**
 * Пульт «Гонки на выживание»: раунд → «Показать вопрос» → «Показать ответ» (задание — отметить команды и
 * «Засчитать») → «Следующий раунд». Войнушка: «Открыть ставки» → «Ставки приняты» → вопрос → банк.
 * Аукцион билета — перед раундами, которые отметил ведущий в конструкторе.
 */
export function SurvivalHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<SurvivalContent>) {
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
  const r = parseSurvivalResult(session.state.result);
  const noTeams = scoringParticipants(participants, session.playMode).length === 0 && Object.keys(session.leaderboard).length === 0;
  const round = roundOf(content, r);
  const war = isWarRound(content, r);

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

  /** Свежие ответы шага с сервера (пришедшие в последнюю секунду тоже считаются). */
  const fresh = <T,>(make: (list: typeof answers) => T) => () => control.freshAnswers(step).then((list) => make(list.length > 0 ? list : answers));

  const action = survivalPrimary(session, content);
  const backPlan = survivalBack(session, content, participants);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Команда") : "—");
  const answered = new Set(answers.filter((a) => a.step === step && a.submittedAt !== undefined && (a.submittedAt ?? 0) >= (session.state.startedAt ?? 0)).map((a) => a.pid));
  const right = new Set(rightTeams(session, content, answers).map((a) => a.pid));
  const sorted = [...r.order].sort((a, b) => (session.leaderboard[b]?.score ?? 0) - (session.leaderboard[a]?.score ?? 0));

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">
        Гонка на выживание · раунд {Math.min(roundNumber(r), content.rounds.length)} из {content.rounds.length}
        {war ? ` · ⚔️ войнушка №${warIndex(content, roundNumber(r))}` : ""}
      </p>
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : r.order.length === 0 ? (
        <p className="muted">Команды в гонке — в порядке подключения. Никто не выбывает, после последнего раунда — награждение.</p>
      ) : (
        <>
          {r.phase === "intro" && auctionPending(content, r) && <p>Перед раундом — аукцион «билета освобождения». Капитаны ставят очки, платит только победитель.</p>}
          {(r.phase === "auction" || r.phase === "auctionDone") && (
            <div className="card stack stack--tight">
              <p className="eyebrow">🎟 Аукцион</p>
              <p className="small">Ставок пришло: {answered.size}</p>
              {r.phase === "auctionDone" && <p className={r.bid ? "success" : "muted"}>{r.bid ? `Билет у «${name(r.bid.pid)}» за ${pointsLabel(r.bid.amount)}` : "Никто не поставил — билет не продан"}</p>}
            </div>
          )}
          {r.phase === "bet" && <p className="small">Ставки пришли: {answered.size} из {r.order.length}. Не успевшим поставится половина счёта.</p>}
          {round && (r.phase === "play" || r.phase === "war" || r.phase === "reveal" || r.phase === "intro") && !auctionPending(content, r) && (
            <div className="card stack stack--tight">
              <p className="eyebrow">
                {KIND_TITLES[round.kind]} · {war ? `банк ${pointsLabel(r.bank || 0)}` : pointsLabel(round.points)}
              </p>
              <p className="host-quiz__question">{round.text}</p>
              {round.kind === "choice" && (
                <ol className="mil-host-options">
                  {round.options.map((o, i) => (
                    <li key={i} className={i === round.correct ? "is-correct" : undefined}>
                      <strong>{LETTERS[i]}</strong> {o}
                      {i === round.correct ? " ★" : ""}
                    </li>
                  ))}
                </ol>
              )}
              {round.kind !== "choice" && round.answer && <p className="muted small">{round.kind === "open" ? "Ответ" : "Подсказка"}: {round.answer}</p>}
              {war && r.phase !== "intro" && (
                <ul className="meta">
                  {Object.entries(r.bets).map(([p, b]) => (
                    <li key={p}>
                      <NameText name={name(p)} />: {pointsLabel(b)}
                    </li>
                  ))}
                  {r.freed.map((p) => (
                    <li key={p}>
                      <NameText name={name(p)} />: 🎟 билет
                    </li>
                  ))}
                </ul>
              )}
              {r.phase === "reveal" && war && <p className={r.winner ? "success" : "muted"}>{r.winner ? `Банк забирает «${name(r.winner)}»` : "Верных нет — ставки сгорели"}</p>}
            </div>
          )}
          {(r.phase === "play" || (r.phase === "reveal" && !war)) && round && round.kind !== "choice" && (
            <section className="stack stack--tight">
              <p className="eyebrow">{round.kind === "task" ? "Кто выполнил задание" : "Засчитать ответ вручную"}</p>
              <div className="sv-marks">
                {r.order.map((p) => {
                  const auto = right.has(p);
                  const on = auto || r.marks.includes(p);
                  const text = round.kind === "open" ? answers.find((a) => a.step === step && a.pid === p)?.value : null;
                  return (
                    <button key={p} type="button" className="column-opt" aria-pressed={on} disabled={busy || auto || r.phase !== "play"} onClick={() => void run(toggleMark(session, p))}>
                      <span className="column-opt__check" aria-hidden="true">{on ? "✓" : ""}</span>
                      <span className="line-clamp">
                        <NameText name={name(p)} />
                        {text && typeof (text as { text?: unknown }).text === "string" ? ` — «${(text as { text: string }).text}»` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {(r.phase === "play" || r.phase === "war") && round?.kind !== "task" && (
            <p className="small">
              Ответили: {[...answered].filter((p) => r.order.includes(p)).length} из {war ? Object.keys(r.bets).length : r.order.length}
            </p>
          )}
          <details className="quest-host__places">
            <summary>Счёт и билеты</summary>
            <ol>
              {sorted.map((p) => (
                <li key={p}>
                  <NameText name={name(p)} /> — {pointsLabel(session.leaderboard[p]?.score ?? 0)}
                  {(r.tickets[p] ?? 0) > 0 ? ` · 🎟×${r.tickets[p]}` : ""}
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
            {noTeams && <p className="muted small">Ждём, пока подключатся команды.</p>}
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || noTeams} onClick={() => void run(startSurvival(session, participants))}>
              Начать гонку
            </button>
          </>
        )}
        {action === "auction" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(openAuction(session, content))}>
            Открыть аукцион билета
          </button>
        )}
        {action === "auctionDone" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(fresh((list) => finishAuction(latest.current, list, participants)))}>
            Итоги аукциона
          </button>
        )}
        {action === "afterAuction" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(afterAuction(session))}>
            К раунду
          </button>
        )}
        {action === "bets" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(openBets(session, content))}>
            Открыть ставки
          </button>
        )}
        {action === "betsDone" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(fresh((list) => closeBets(latest.current, content, list, participants)))}>
            Ставки приняты — вопрос
          </button>
        )}
        {action === "show" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(showRound(session, content, participants))}>
            {round?.kind === "task" ? "Показать задание" : "Показать вопрос"}
          </button>
        )}
        {action === "reveal" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(fresh((list) => revealRound(latest.current, content, list, participants)))}>
            {round?.kind === "task" ? "Засчитать" : war ? "Показать ответ и банк" : "Показать ответ"}
          </button>
        )}
        {action === "next" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(nextRound(session, content, participants))}>
            {roundNumber(r) >= content.rounds.length ? "Финиш гонки" : "Следующий раунд"}
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
        {stage !== "podium" && r.order.length > 0 && r.phase !== "over" && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy}
            onClick={() =>
              confirm({
                title: "Закончить гонку досрочно?",
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
