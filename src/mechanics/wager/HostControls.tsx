import { useEffect, useRef, useState } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { resultKey, secondsLeft } from "../../core/session";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { formatNumber, type WagerContent } from "./content";
import { betsFrom, guessesOf, liveProgress, nextQuestion, openBets, parseWagerResult, revealAnswer, showQuestion, wagerBack, wagerPrimary } from "./logic";
import { WagerBoard } from "./views";

/**
 * Пульт «Держи пари»: «Показать вопрос» → догадки капитанов (видны только ведущему) → «Разложить ответы и открыть
 * ставки» → «Показать ответ» (выплаты по фишкам) → «Следующий вопрос» … → награждение. «Назад» — с каждого этапа.
 */
export function WagerHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<WagerContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Session>(session);
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    latest.current = session;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);
  const { stage, step } = session.state;
  const r = parseWagerResult(session.state.result);
  const question = content.questions[r.q];
  const now = useServerNow(250, stage === "question");
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const own = answers.filter((a) => a.step === step);
  const answersKey = own.map((a) => `${a.id}:${a.submittedAt ?? 0}:${JSON.stringify(a.value)}`).join("|");

  // Кто написал догадку и фишки на поле — на экран (не чаще раза в 1,5 с).
  useEffect(() => {
    if (rehearsal || stage !== "question") return;
    const timer = window.setTimeout(() => {
      const cur = latest.current;
      const change = liveProgress(cur, content, answers);
      if (!change) return;
      const { phase, step: atStep, stage: atStage } = cur.state;
      void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- при новых ответах и новых итогах шага
  }, [answersKey, r.mode, stage, resultKey(session.state.result)]);

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
      if (!change.state && !change.addScore && !change.leaderboard) return;
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
    if (action === "show") void run(showQuestion(session, content, participants));
    if (action === "bets") void run(async () => openBets(latest.current, content, await fresh()));
    if (action === "reveal") void run(async () => revealAnswer(latest.current, content, await fresh()));
    if (action === "next") void run(nextQuestion(session));
    if (action === "podium") void run(awardNow(session));
    if (action === "podiumNext") void run(podiumNext(session));
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
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || backPlan === null} onClick={() => backPlan && void run(backPlan.change, backPlan.clear)}>
          Назад
        </button>
      </div>
    </div>
  );
}
