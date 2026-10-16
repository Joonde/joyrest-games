import { useEffect } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { useHostRun } from "../../components/live/useHostRun";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { resultKey, secondsLeft } from "../../core/session";
import type { Answer, Session } from "../../data/types";
import type { HostControlsProps } from "../types";
import { formatNumber, type WagerContent } from "./content";
import { betsFrom, guessesOf, liveProgress, nextQuestion, openBets, parseWagerResult, revealAnswer, showQuestion, wagerBack, wagerPrimary } from "./logic";
import { WagerBoard } from "./views";

/** Момент игры для повтора касания: без того, что пишет фон пульта (кто написал догадку, фишки на поле). */
function wagerMoment(s: Session): string {
  return resultKey({ ...parseWagerResult(s.state.result), guessed: [], chips: {} });
}

/**
 * Пульт «Держи пари»: «Показать вопрос» → догадки капитанов (видны только ведущему) → «Разложить ответы и открыть
 * ставки» → «Показать ответ» (выплаты по фишкам) → «Следующий вопрос» … → награждение. «Назад» — с каждого этапа.
 */
export function WagerHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<WagerContent>) {
  const { busy, error, inFlight, run, quiet } = useHostRun(session, control, rehearsal, { moment: wagerMoment });
  const { stage, step } = session.state;
  const r = parseWagerResult(session.state.result);
  const question = content.questions[r.q];
  const now = useServerNow(250, stage === "question");
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const own = answers.filter((a) => a.step === step);
  const answersKey = own.map((a) => `${a.id}:${a.submittedAt ?? 0}:${JSON.stringify(a.value)}`).join("|");

  // Кто написал догадку и фишки на поле — на экран (не чаще раза в 1,5 с).
  useEffect(() => {
    if (rehearsal || busy || stage !== "question") return;
    const timer = window.setTimeout(() => {
      if (inFlight.current) return;
      void quiet((cur) => liveProgress(cur, content, answers));
    }, 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- при новых ответах и новых итогах шага (и после записи ведущего)
  }, [answersKey, r.mode, stage, busy, resultKey(session.state.result)]);

  async function fresh(): Promise<Answer[]> {
    try {
      return await control.freshAnswers(step);
    } catch {
      return answers;
    }
  }

  const action = wagerPrimary(session, content);
  const backPlan = wagerBack(session, content);
  const name = (p: string) => session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Команда";
  const unit = question?.unit ? ` ${question.unit}` : "";

  const labels: Record<typeof action, string> = {
    show: `Показать вопрос ${r.q + 1} из ${content.questions.length}`,
    bets: "Разложить ответы и открыть ставки",
    reveal: "Показать ответ",
    next: `Следующий вопрос · ${r.q + 2}`,
    podium: "Вопросы кончились — награждение",
    podiumNext: "Открыть следующее место",
    finish: "Завершить игру",
  };
  function perform() {
    if (action === "show") void run((s) => showQuestion(s, content, participants));
    if (action === "bets") void run(async (s) => openBets(s, content, await fresh()));
    if (action === "reveal") void run(async (s) => revealAnswer(s, content, await fresh()));
    if (action === "next") void run((s) => nextQuestion(s));
    if (action === "podium") void run((s) => awardNow(s));
    if (action === "podiumNext") void run((s) => podiumNext(s));
    if (action === "finish") control.requestFinish();
  }

  const guesses = r.mode === "guess" ? guessesOf(session, own) : [];
  const bets = r.mode === "bet" ? betsFrom(session, own, r.slots, content.stakes) : r.bets;
  const teams = Object.keys(session.leaderboard);

  return (
    <div className="stack host-quiz">
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : question ? (
        <div className="stack stack--tight">
          <p className="eyebrow">
            Вопрос {r.q + 1} из {content.questions.length}
            {left !== null ? ` · осталось ${left} с` : ""}
          </p>
          <p>{question.text}</p>
          <p className="muted small">
            Ответ (видите только вы): <b>{formatNumber(question.answer)}{unit}</b>
            {question.note ? ` — ${question.note}` : ""}
          </p>

          {r.mode === "guess" && stage === "question" && (
            <ul className="wager-host-list">
              {teams.map((p) => {
                const g = guesses.find((x) => x.pid === p);
                return (
                  <li key={p}>
                    <NameText name={name(p)} />
                    <span>{g ? `${formatNumber(g.value)}${unit}` : "ждём…"}</span>
                  </li>
                );
              })}
              {teams.length === 0 && <li className="muted">Пока никого — гости подключаются по QR.</li>}
            </ul>
          )}

          {(r.mode === "bet" || r.mode === "answer") && (
            <>
              <WagerBoard session={session} content={content} r={r} compact />
              <ul className="wager-host-list">
                {teams.map((p) => (
                  <li key={p}>
                    <NameText name={name(p)} />
                    <span>
                      {(bets[p] ?? []).length === 0
                        ? r.mode === "bet"
                          ? "ждём…"
                          : "без ставок"
                        : (bets[p] ?? []).map((b) => (b.slot === -1 ? "меньше всех" : `${formatNumber(r.slots[b.slot]?.value ?? 0)}`) + ` — ${b.stake} ф.`).join(" · ")}
                      {r.mode === "answer" && r.payouts[p] ? ` → ${r.payouts[p] > 0 ? "+" : "−"}${Math.abs(r.payouts[p] ?? 0)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <p className="muted">Вопросов больше нет.</p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={perform}>
          {labels[action]}
        </button>
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || backPlan === null} onClick={() => backPlan && void run((s) => wagerBack(s, content)?.change ?? null, backPlan.clear)}>
          Назад
        </button>
      </div>
    </div>
  );
}
