import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { useHostRun } from "../../components/live/useHostRun";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { pointsLabel } from "../../core/results";
import { clock } from "../../data";
import type { Session } from "../../data/types";
import { scoringParticipants } from "../../core/leaderboard";
import type { HostControlsProps } from "../types";
import { KIND_TITLES, LETTERS, roundText, warIndex, type SurvivalContent, taskWordFor, taskWords } from "./content";
import {
  startTaskTimer,
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

/** Момент игры для повтора касания: раунд, его часть, отметки и итоги войнушки или аукциона. */
function survivalMoment(s: Session): string {
  const r = parseSurvivalResult(s.state.result);
  return JSON.stringify([r.round, r.phase, r.marks, r.winner, r.bid, r.taskTimer?.pid ?? null]);
}

/**
 * Пульт «Гонки на выживание»: раунд → «Показать вопрос» → «Показать ответ» (задание — отметить команды и
 * «Засчитать») → «Следующий раунд». Войнушка: «Открыть ставки» → «Ставки приняты» → вопрос → банк.
 * Аукцион билета — перед раундами, которые отметил ведущий в конструкторе.
 */
export function SurvivalHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<SurvivalContent>) {
  const { busy, error, run } = useHostRun(session, control, rehearsal, { moment: survivalMoment });
  const [dialog, confirm] = useConfirm();
  const { stage, step } = session.state;
  const r = parseSurvivalResult(session.state.result);
  const noTeams = scoringParticipants(participants, session.playMode).length === 0 && Object.keys(session.leaderboard).length === 0;
  const round = roundOf(content, r);
  const war = isWarRound(content, r);

  /** Свежие ответы шага с сервера (пришедшие в последнюю секунду тоже считаются). */
  const fresh = <T,>(make: (s: Session, list: typeof answers) => T) => (s: Session) => control.freshAnswers(step).then((list) => make(s, list.length > 0 ? list : answers));

  const action = survivalPrimary(session, content);
  const backPlan = survivalBack(session, content, participants);
  const teams = session.playMode === "teams";
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? (teams ? "Команда" : "Игрок")) : "—");
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
        <p className="muted">{teams ? "Команды" : "Игроки"} в гонке — в порядке подключения. Никто не выбывает, после последнего раунда — награждение.</p>
      ) : (
        <>
          {r.phase === "intro" && auctionPending(content, r) && <p>Перед раундом — аукцион «билета освобождения». {teams ? "Капитаны ставят" : "Игроки ставят"} очки, платит только победитель.</p>}
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
              <p className="host-quiz__question">{roundText(round, session.playMode)}</p>
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
              {round.kind === "task" && taskWords(round).length > 0 && (
                <p className="muted small">
                  {teams
                    ? "Капитаны видят на телефоне своё слово. Зовите команды по очереди: капитан показывает, команда угадывает — отметьте угадавших."
                    : "Каждый видит на телефоне своё слово. Зовите игроков по очереди: игрок показывает, зал угадывает — отметьте тех, чьё слово угадали."}
                </p>
              )}
              <div className="sv-marks">
                {r.order.map((p) => {
                  const auto = right.has(p);
                  const on = auto || r.marks.includes(p);
                  const text = round.kind === "open" ? answers.find((a) => a.step === step && a.pid === p)?.value : null;
                  return (
<div key={p} className="sv-mark-row">
                                        <button type="button" className="column-opt" aria-pressed={on} disabled={busy || auto || r.phase !== "play"} onClick={() => void run((s) => toggleMark(s, p))}>
                      <span className="column-opt__check" aria-hidden="true">{on ? "✓" : ""}</span>
                      <span className="line-clamp">
                        <NameText name={name(p)} />
                        {text && typeof (text as { text?: unknown }).text === "string" ? ` — «${(text as { text: string }).text}»` : ""}
                        {round.kind === "task" && taskWordFor(round, r.order, p) ? ` — слово «${taskWordFor(round, r.order, p)}»` : ""}
                      </span>
                    </button>
                    {round.kind === "task" && r.phase === "play" && (
                      // Та же кнопка убирает отсчёт с экрана (решение владельца 14 октября 2026: «открыл — закрыл той же кнопкой»).
                      <button
                        type="button"
                        className={r.taskTimer?.pid === p ? "btn sv-mark-row__timer" : "btn btn--secondary sv-mark-row__timer"}
                        aria-pressed={r.taskTimer?.pid === p}
                        disabled={busy}
                        onClick={() => void run((s) => startTaskTimer(s, r.taskTimer?.pid === p ? null : p, Date.now() + clock.offset()))}
                      >
                        {r.taskTimer?.pid === p ? "⏹ Убрать" : "▶ 30 с"}
                      </button>
                    )}
                    </div>
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
            {noTeams && <p className="muted small">{teams ? "Ждём, пока подключатся команды." : "Ждём, пока подключатся игроки."}</p>}
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || noTeams} onClick={() => void run((s) => startSurvival(s, participants))}>
              Начать гонку
            </button>
          </>
        )}
        {action === "auction" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => openAuction(s, content))}>
            Открыть аукцион билета
          </button>
        )}
        {action === "auctionDone" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(fresh((s, list) => finishAuction(s, list, participants)))}>
            Итоги аукциона
          </button>
        )}
        {action === "afterAuction" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => afterAuction(s))}>
            К раунду
          </button>
        )}
        {action === "bets" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => openBets(s, content))}>
            Открыть ставки
          </button>
        )}
        {action === "betsDone" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(fresh((s, list) => closeBets(s, content, list, participants)))}>
            Ставки приняты — вопрос
          </button>
        )}
        {action === "show" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => showRound(s, content, participants))}>
            {round?.kind === "task" ? "Показать задание" : "Показать вопрос"}
          </button>
        )}
        {action === "reveal" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(fresh((s, list) => revealRound(s, content, list, participants)))}>
            {round?.kind === "task" ? "Засчитать" : war ? "Показать ответ и банк" : "Показать ответ"}
          </button>
        )}
        {action === "next" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => nextRound(s, content, participants))}>
            {roundNumber(r) >= content.rounds.length ? "Финиш гонки" : "Следующий раунд"}
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
        {stage !== "podium" && r.order.length > 0 && r.phase !== "over" && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy}
            onClick={() =>
              confirm({
                title: "Закончить гонку досрочно?",
                text: `Побеждает ${teams ? "команда" : "игрок"} с большим счётом — сразу награждение. «Назад» на награждении вернёт к игре.`,
                confirmLabel: "К награждению",
                run: () => run((s) => awardNow(s)),
              })
            }
          >
            Закончить досрочно
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || backPlan === null} onClick={() => backPlan && void run((s) => survivalBack(s, content, participants)?.change ?? null, backPlan.clear)}>
          Назад
        </button>
      </div>
      {dialog}
    </div>
  );
}
