import { useEffect, useRef, useState } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { resultKey, secondsLeft } from "../../core/session";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { COLOR_TITLES, SWEETNESS_TITLES, WORLD_TITLES, winningKeys, type WineContent } from "./content";
import { betsOf, liveChips, nextWine, openBets, openBottle, parseWineResult, wineBack, winePrimary } from "./logic";
import { WineTable } from "./views";

/**
 * Пульт «Винного казино»: заставка бутылки → «Открыть ставки» (гости ставят фишки) → «Открыть бутылку» (паспорт и
 * выплаты) → «Следующая бутылка» … → награждение. Паспорт вина ведущий видит всё время, гости — только после открытия.
 */
export function WineHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<WineContent>) {
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
  const r = parseWineResult(session.state.result);
  const wine = content.wines[r.w];
  const now = useServerNow(250, stage === "question");
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const own = answers.filter((a) => a.step === step);
  const answersKey = own.map((a) => `${a.id}:${a.submittedAt ?? 0}:${JSON.stringify(a.value)}`).join("|");

  // Фишки на поле — на экран (не чаще раза в 1,5 с).
  useEffect(() => {
    if (rehearsal || stage !== "question") return;
    const timer = window.setTimeout(() => {
      const cur = latest.current;
      const change = liveChips(cur, content, answers);
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

  const action = winePrimary(session, content);
  const backPlan = wineBack(session);
  const name = (p: string) => session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Гость";
  const labels: Record<typeof action, string> = {
    bets: `Открыть ставки · бутылка ${r.w + 1} из ${content.wines.length}`,
    open: "Открыть бутылку",
    next: `Следующая бутылка · ${r.w + 2}`,
    podium: "Бутылки кончились — награждение",
    podiumNext: "Открыть следующее место",
    finish: "Завершить игру",
  };
  function perform() {
    if (action === "bets") void run(openBets(session, content, participants));
    if (action === "open") void run(async () => openBottle(latest.current, content, await fresh()));
    if (action === "next") void run(nextWine(session));
    if (action === "podium") void run(awardNow(session));
    if (action === "podiumNext") void run(podiumNext(session));
    if (action === "finish") control.requestFinish();
  }

  const bets = r.mode === "bet" && stage === "question" ? betsOf(session, content, own) : {};
  const players = Object.keys(session.leaderboard);

  return (
    <div className="stack host-quiz">
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : wine ? (
        <div className="stack stack--tight">
          <p className="eyebrow">
            Бутылка {r.w + 1} из {content.wines.length}
            {left !== null ? ` · осталось ${left} с` : ""}
          </p>
          <p className="muted small">
            Паспорт (видите только вы): <b>{wine.name}</b> — {COLOR_TITLES[wine.color]}, {SWEETNESS_TITLES[wine.sweetness]}, {WORLD_TITLES[wine.world]}, {wine.country}, {wine.grape},{" "}
            {wine.year ?? "без года"}
          </p>
          {stage !== "ready" && <WineTable content={content} r={r} win={r.mode === "open" ? winningKeys(content, wine, r.year) : null} compact />}
          {r.mode === "bet" && stage === "question" && (
            <p className="small">
              Поставили: {Object.keys(bets).length} из {players.length}
            </p>
          )}
          {r.mode === "open" && (
            <ul className="wager-host-list">
              {players
                .filter((p) => r.payouts[p])
                .sort((a, b) => (r.payouts[b] ?? 0) - (r.payouts[a] ?? 0))
                .map((p) => (
                  <li key={p}>
                    <NameText name={name(p)} />
                    <span>+{r.payouts[p]}</span>
                  </li>
                ))}
              {players.every((p) => !r.payouts[p]) && <li className="muted">Никто не угадал.</li>}
            </ul>
          )}
        </div>
      ) : (
        <p className="muted">Бутылок больше нет.</p>
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
