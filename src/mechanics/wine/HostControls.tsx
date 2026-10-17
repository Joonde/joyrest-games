import { useEffect } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { useHostRun } from "../../components/live/useHostRun";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { resultKey, secondsLeft } from "../../core/session";
import type { Answer, Session } from "../../data/types";
import type { HostControlsProps } from "../types";
import { COLOR_TITLES, SWEETNESS_TITLES, WORLD_TITLES, winningKeys, type WineContent } from "./content";
import { betsOf, liveChips, nextWine, openBets, openBottle, parseWineResult, wineBack, winePrimary } from "./logic";
import { WineTable } from "./views";

/** Момент игры для повтора касания: без фишек на поле и списка поставивших (их пишет фон пульта). */
function wineMoment(s: Session): string {
  return resultKey({ ...parseWineResult(s.state.result), chips: {}, bettors: [] });
}

/**
 * Пульт «Винного казино»: заставка бутылки → «Открыть ставки» (гости ставят фишки) → «Открыть бутылку» (паспорт и
 * выплаты) → «Следующая бутылка» … → награждение. Паспорт вина ведущий видит всё время, гости — только после открытия.
 */
export function WineHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<WineContent>) {
  const { busy, error, inFlight, run, quiet } = useHostRun(session, control, rehearsal, { moment: wineMoment });
  const { stage, step } = session.state;
  const r = parseWineResult(session.state.result);
  const wine = content.wines[r.w];
  const now = useServerNow(250, stage === "question");
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const own = answers.filter((a) => a.step === step);
  const answersKey = own.map((a) => `${a.id}:${a.submittedAt ?? 0}:${JSON.stringify(a.value)}`).join("|");

  // Фишки на поле — на экран (не чаще раза в 1,5 с).
  useEffect(() => {
    if (rehearsal || busy || stage !== "question") return;
    const timer = window.setTimeout(() => {
      if (inFlight.current) return;
      void quiet((cur) => liveChips(cur, content, answers));
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
    if (action === "bets") void run((s) => openBets(s, content, participants));
    if (action === "open") void run(async (s) => openBottle(s, content, await fresh()));
    if (action === "next") void run((s) => nextWine(s));
    if (action === "podium") void run((s) => awardNow(s));
    if (action === "podiumNext") void run((s) => podiumNext(s));
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
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || backPlan === null} onClick={() => backPlan && void run((s) => wineBack(s)?.change ?? null, backPlan.clear)}>
          Назад
        </button>
      </div>
    </div>
  );
}
