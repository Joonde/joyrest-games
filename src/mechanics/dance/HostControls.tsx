import { useEffect } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { useHostRun } from "../../components/live/useHostRun";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { secondsLeft } from "../../core/session";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { KIND_EMOJI, KIND_TITLES, type DanceContent } from "./content";
import { styleById } from "./styles";
import { canVote, cardOf, control as videoControl, danceBack, dancePrimary, nextTurn, parseDanceResult, pickCard, pickFromAnswers, resolveTie, showResult, startPick, startVote, turnPid } from "./logic";
import { CardGrid } from "./views";

/** Момент игры для повтора касания (без паузы и «Сначала» плеера). */
function danceMoment(s: Session): string {
  const r = parseDanceResult(s.state.result);
  return JSON.stringify([r.mode, r.card, r.turn, r.played.length, r.tie.length]);
}

/**
 * Пульт «Танцевального батла»: «Начать игру» → команда выбирает карточку (на телефоне капитана или
 * касанием здесь) → выступление (видео или трек на экране: «Пауза», «Сначала») → «Оценивать» →
 * «Показать итог» → «Следующая команда». Все карточки сыграны — награждение.
 */
export function DanceHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<DanceContent>) {
  const { busy, error, latest, run, quiet } = useHostRun(session, control, rehearsal, { moment: danceMoment });
  const { stage, step } = session.state;
  const r = parseDanceResult(session.state.result);
  const card = cardOf(content, r.card);
  const now = useServerNow(250, r.mode === "vote" && stage === "question");
  const left = r.mode === "vote" && stage === "question" ? secondsLeft(session.state, now) : null;
  const own = answers.filter((a) => a.step === step);

  // Капитан выбрал карточку — сразу на экран.
  const pickKey = stage === "question" && r.mode === "pick" ? own.map((a) => a.id).join(",") : "";
  useEffect(() => {
    if (!pickKey || busy) return;
    void quiet((cur) => pickFromAnswers(cur, content, answers, participants));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при новом выборе
  }, [pickKey, busy, session.state.startedAt]);

  // Счётчик голосов для экрана (не чаще раза в 2 с).
  const votes = r.mode === "vote" ? own.filter((a) => canVote(r, card, a.pid)).length : -1;
  useEffect(() => {
    if (votes < 0 || votes === (session.state.answered ?? 0) || rehearsal) return;
    const timer = window.setTimeout(() => {
      const { phase, step: atStep, stage: atStage } = latest.current.state;
      void control.apply({ state: { answered: votes }, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    }, 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- при новом числе голосов
  }, [votes]);

  async function resultNow(s: Session): Promise<SessionChange> {
    let all: Answer[] = answers;
    try {
      all = await control.freshAnswers(step);
    } catch {
      // по пришедшим
    }
    return showResult(s, content, all);
  }

  const action = dancePrimary(session, content);
  const backPlan = danceBack(session);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Команда") : "—");
  const labels: Record<typeof action, string> = {
    start: "Начать игру",
    waitPick: "Ждём выбор капитана…",
    vote: card?.kind === "battle" ? "Голосовать: кто победил" : "Оценивать выступление",
    result: "Показать итог",
    resolveTie: "Ничья — выберите победителя выше",
    next: "Следующая команда",
    podium: "Все карточки сыграны — награждение",
    podiumNext: "Открыть следующее место",
    finish: "Завершить игру",
  };
  function perform() {
    if (action === "start") void run((s) => startPick(s, participants));
    if (action === "vote") void run((s) => startVote(s, content));
    if (action === "result") void run(resultNow);
    if (action === "next") void run((s) => nextTurn(s, participants));
    if (action === "podium") void run((s) => awardNow(s));
    if (action === "podiumNext") void run((s) => podiumNext(s));
    if (action === "finish") control.requestFinish();
  }

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">
        Танцевальный батл · сыграно {r.played.length} из {content.cards.length}
      </p>
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : r.mode === "pick" && stage === "question" ? (
        <>
          <p>
            Выбирает <strong><NameText name={name(turnPid(r))} /></strong>. Капитан выбирает на телефоне — или коснитесь карточки здесь.
          </p>
          <CardGrid content={content} result={r} disabled={busy} onPick={(id) => void run((s) => pickCard(s, content, id, participants))} />
        </>
      ) : card ? (
        <div className="stack stack--tight">
          <p className="eyebrow">
            {KIND_EMOJI[card.kind]} {KIND_TITLES[card.kind]}
            {styleById(card.style) ? ` · ${styleById(card.style)?.title}` : ""}
            {card.title ? ` · ${card.title}` : ""}
          </p>
          <p>{card.kind === "battle" ? "Выступают все команды по очереди" : <>Выступает <NameText name={name(r.performer)} /></>}</p>
          {card.note && <p className="muted small">{card.note}</p>}
          {r.mode === "vote" && stage === "question" && (
            <div className="host-quiz__live">
              <span className={left === 0 ? "host-quiz__timer is-over" : "host-quiz__timer"} role="timer">
                {left === null ? "∞" : left === 0 ? "Время вышло" : `${left} с`}
              </span>
              <span>
                Голосов: <strong>{votes}</strong>
              </span>
            </div>
          )}
          {r.mode === "result" && r.tie.length > 0 && (
            <div className="stack stack--tight">
              <p className="notice small">Ничья по голосам — кто победил в батле?</p>
              {r.tie.map((p) => (
                <button key={p} type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run((s) => resolveTie(s, content, p))}>
                  Победила: <NameText name={name(p)} />
                </button>
              ))}
            </div>
          )}
          {r.mode === "result" && (
            <ul className="buzz-queue buzz-queue--plain">
              {Object.keys(r.scores).length === 0 ? (
                <li>Голосов не было — очков нет</li>
              ) : (
                Object.entries(r.scores).map(([p, n]) => (
                  <li key={p} className="is-now">
                    <span className="buzz-queue__name">
                      <NameText name={name(p)} />
                    </span>
                    <span className="buzz-queue__state">+{n}</span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      ) : null}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || action === "waitPick" || action === "resolveTie"} onClick={perform}>
          {labels[action]}
        </button>
        {r.mode === "perform" && card && session.screenMode !== "none" && (
          <div className="row dance-host__media">
            {/* Ролик по ссылке паузу с пульта не принимает (плеер чужой) — только «Сначала». */}
            {card.video.source !== "link" && (
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run((s) => videoControl(s, { paused: !r.paused }))}>
                {r.paused ? "▶ Продолжить" : "⏸ Пауза"}
              </button>
            )}
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run((s) => videoControl(s, { replay: true }))}>
              ⟲ Сначала
            </button>
          </div>
        )}
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || backPlan === null} onClick={() => backPlan && void run((s) => danceBack(s)?.change ?? null, backPlan.clear)}>
          Назад
        </button>
      </div>
    </div>
  );
}
