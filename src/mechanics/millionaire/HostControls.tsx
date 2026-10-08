import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { pointsLabel } from "../../core/results";
import { resultKey, secondsLeft } from "../../core/session";
import type { Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { LETTERS, LEVELS, LIFELINES, lifelineTitle, pointsAt, type LifelineId, type MillionaireContent } from "./content";
import {
  applyLifeline,
  audienceVotes,
  canUseLifeline,
  endCall,
  finishAudience,
  levelToPlay,
  markPick,
  millionaireBack,
  millionairePrimary,
  millionaireTeams,
  nextTurn,
  parseMillionaireResult,
  questionOf,
  requestedLifeline,
  retryQuestion,
  revealAnswer,
  showQuestion,
  startMillionaire,
  teamPick,
} from "./logic";
import { teamsCovered } from "./validate";

/**
 * Пульт «Миллионера»: «Начать игру» → «Показать вопрос» команды → капитан выбирает на телефоне (или
 * ведущий отмечает ответ команды) → «Показать ответ» → «Следующая команда». Подсказки — плитками: каждая
 * у команды один раз; капитан может попросить подсказку с телефона — пульт включает её сам.
 */
export function MillionaireHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<MillionaireContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState<string | null>(null);
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
  const r = parseMillionaireResult(session.state.result);
  const q = questionOf(content, r);
  const now = useServerNow(500, stage === "question");

  // Капитан попросил подсказку с телефона — включаем (любой открытый пульт; отпечаток итогов шага мирит).
  const asked = requestedLifeline(session, answers, participants);
  const askKey = asked ? `${step}:${asked}` : "";
  const askedBlocked = asked ? canUseLifeline(session, content, answers, asked) : null;
  useEffect(() => {
    if (!askKey || busy || !asked) return;
    const s = latest.current;
    const change = applyLifeline(s, content, answers, asked, now);
    if (!change) return;
    const { phase, step: atStep, stage: atStage } = s.state;
    void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage, result: resultKey(s.state.result) } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при новой просьбе
  }, [askKey, busy]);

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
      if (!change) {
        setError("Сейчас этого сделать нельзя — проверьте, что вопрос открыт.");
        return;
      }
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      for (const s of clear ?? []) await control.clearAnswers(s);
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage, result: seen } });
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  const action = millionairePrimary(session);
  const backPlan = millionaireBack(session, content, participants);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Команда") : "—");
  const teams = millionaireTeams(session, participants);
  const pick = teamPick(session, answers);
  const level = levelToPlay(r, r.turn);
  const used = r.turn ? (r.used[r.turn] ?? []) : [];
  const votes = r.mode === "audience" ? audienceVotes(session, answers, participants) : [0, 0, 0, 0];
  const voteLeft = r.mode === "audience" ? secondsLeft(session.state, now) : null;
  const callLeft = r.callEndsAt !== null ? Math.max(0, Math.ceil((r.callEndsAt - now) / 1000)) : 0;

  function askLifeline(id: LifelineId) {
    const l = LIFELINES.find((x) => x.id === id);
    confirm({
      title: `Подсказка «${lifelineTitle(id)}»?`,
      text: `${l?.hint ?? ""}. У команды «${name(r.turn)}» она пропадёт до конца игры.`,
      confirmLabel: "Взять подсказку",
      run: () => run(() => Promise.resolve(applyLifeline(latest.current, content, answers, id, now))),
    });
  }

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">Кто хочет стать миллионером · {content.players === "one" ? "одна команда" : "команды по очереди"}</p>
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : r.order.length === 0 ? (
        <>
          <p className="muted">
            Вопросов хватит на {teamsCovered(content)} {content.players === "one" ? "игру" : "команд без замен"}. Команды ходят в порядке подключения.
          </p>
          {content.players === "one" && teams.length > 0 && (
            <fieldset className="stack stack--tight">
              <legend>Кто играет</legend>
              {teams.map((p) => (
                <label key={p} className="choice">
                  <input type="radio" name="mil-only" checked={(only ?? teams[0]) === p} onChange={() => setOnly(p)} />
                  <span className="choice__text">
                    <span className="choice__title">
                      <NameText name={name(p)} />
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      ) : r.mode === "over" ? (
        <p>Все команды закончили. Дальше — награждение.</p>
      ) : (
        <>
          <p>
            Ход: <strong><NameText name={name(r.turn)} /></strong> · вопрос {level} — {pointsLabel(pointsAt(content, level))}
            {content.safe.includes(level) ? " · несгораемая" : ""}
          </p>
          {q && stage !== "ready" && (
            <div className="card stack stack--tight">
              <p className="host-quiz__question">{q.text}</p>
              <ol className="mil-host-options">
                {q.options.map((text, i) => (
                  <li key={i} className={`${r.removed.includes(i) ? "is-gone" : ""}${i === q.correct ? " is-correct" : ""}`}>
                    <strong>{LETTERS[i]}</strong> {text}
                    {i === q.correct ? " ★" : ""}
                    {r.audience ? ` · зал ${r.audience[i] ?? 0}%` : ""}
                  </li>
                ))}
              </ol>
              {q.note && <p className="muted small">{q.note}</p>}
              {stage === "question" && r.mode === "question" && (
                <>
                  <p className="small">
                    Ответ команды: <strong>{pick !== null ? LETTERS[pick] : "ещё нет"}</strong>
                    {pick !== null && r.hostPick === null ? " (с телефона капитана)" : ""}
                  </p>
                  <div className="mil-host-pick" role="group" aria-label="Отметить ответ команды">
                    {q.options.map((_, i) =>
                      r.removed.includes(i) ? null : (
                        <button key={i} type="button" className="btn btn--secondary" aria-pressed={r.hostPick === i} disabled={busy} onClick={() => void run(markPick(session, r.hostPick === i ? null : i))}>
                          {LETTERS[i]}
                        </button>
                      ),
                    )}
                  </div>
                  <p className="muted small">Капитан ответил вслух или телефона нет — отметьте ответ команды здесь.</p>
                </>
              )}
              {stage === "reveal" && (
                <p className={r.outcome === "right" ? "success" : "error"}>
                  {r.outcome === "right" ? `Верно — ступень ${r.levels[r.turn ?? ""] ?? 0}` : r.outcome === "saved" ? "Неверно, но спасло право на ошибку" : `Неверно — вниз до ступени ${r.levels[r.turn ?? ""] ?? 0}`}
                </p>
              )}
              {r.mode === "audience" && (
                <p className="small">
                  Голоса зала: {votes.map((n, i) => `${LETTERS[i]} ${n}`).join(" · ")}
                  {voteLeft !== null ? ` · ${voteLeft} с` : ""}
                </p>
              )}
              {callLeft > 0 && stage === "question" && (
                <div className="row">
                  <span>📞 Звонок другу: {callLeft} с</span>
                  <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void run(endCall(session, now))}>
                    Закончить звонок
                  </button>
                </div>
              )}
            </div>
          )}
          {asked && askedBlocked && !askedBlocked.ok && askedBlocked.reason !== "Уже использована" && (
            <p className="error small" role="status">
              Капитан просит «{lifelineTitle(asked)}» — нельзя: {askedBlocked.reason?.toLowerCase()}.
            </p>
          )}
          {stage === "question" && r.mode === "question" && content.lifelines.length > 0 && (
            <section className="stack stack--tight">
              <p className="eyebrow">Подсказки команды</p>
              <div className="tiles tiles--small mil-host-lifelines">
                {LIFELINES.filter((l) => content.lifelines.includes(l.id)).map((l) => {
                  const check = canUseLifeline(session, content, answers, l.id);
                  const gone = used.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className={gone ? "tile mil-host-lifeline is-used" : "tile mil-host-lifeline"}
                      disabled={busy || !check.ok}
                      title={check.reason ?? l.hint}
                      onClick={() => askLifeline(l.id)}
                    >
                      <span className="tile__icon" aria-hidden="true">
                        {l.icon}
                      </span>
                      <span className="tile__label">{l.title}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          <details className="quest-host__places">
            <summary>Лестницы команд</summary>
            <ol>
              {[...r.order]
                .sort((a, b) => (r.levels[b] ?? 0) - (r.levels[a] ?? 0))
                .map((p) => (
                  <li key={p}>
                    <NameText name={name(p)} /> — ступень {r.levels[p] ?? 0} из {LEVELS} · подсказок осталось {content.lifelines.filter((l) => !(r.used[p] ?? []).includes(l)).length}
                    {r.done.includes(p) ? " · закончила" : ""}
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
            {teams.length === 0 && <p className="muted small">Ждём, пока подключатся команды.</p>}
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || teams.length === 0} onClick={() => void run(startMillionaire(session, participants, content, only ?? teams[0] ?? null))}>
              Начать игру
            </button>
          </>
        )}
        {action === "show" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(showQuestion(session, content))}>
            Показать вопрос
          </button>
        )}
        {action === "reveal" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || pick === null} onClick={() => void run(() => control.freshAnswers(step).then((fresh) => revealAnswer(latest.current, content, fresh.length > 0 ? fresh : answers, participants)))}>
            {pick === null ? "Ждём ответ команды" : `Показать ответ (${LETTERS[pick]})`}
          </button>
        )}
        {action === "audienceDone" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(() => control.freshAnswers(step).then((fresh) => finishAudience(latest.current, fresh.length > 0 ? fresh : answers, participants)))}>
            Итоги голосования на экран
          </button>
        )}
        {action === "retry" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(retryQuestion(session))}>
            Ответить ещё раз
          </button>
        )}
        {action === "next" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(nextTurn(session, content, participants))}>
            {content.players === "one" ? "Следующий вопрос" : "Следующая команда"}
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
        {stage !== "podium" && r.order.length > 0 && r.mode !== "over" && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy}
            onClick={() =>
              confirm({
                title: "Закончить игру досрочно?",
                text: "Побеждает команда, поднявшаяся выше всех, — сразу награждение. «Назад» на награждении вернёт к игре.",
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
