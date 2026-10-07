import { useEffect, useRef, useState } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { podiumLabel, podiumNext, startPodium } from "../../core/podium";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { RULE_TITLES, type LottoContent } from "./content";
import { cardFor, isClaim, isWin, lottoBack, lottoPrimary, nextSong, parseLottoResult, playedUpTo, playSong, replaySong, revealSong, type LottoAction } from "./logic";

const LABELS: Record<LottoAction, string> = {
  play: "Включить первую песню",
  reveal: "Показать название",
  next: "Следующая песня",
  podium: "Награждение",
  podiumNext: "Показать место",
  finish: "Завершить игру",
};

/**
 * Пульт лото: какая песня звучит (ведущему видно название), заявки «Лото!» с проверкой прямо
 * сейчас, победители; «Показать название» засчитывает верные заявки.
 */
export function LottoHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<LottoContent>) {
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
  const song = content.songs[step];
  const result = parseLottoResult(session.state.result);
  const action = lottoPrimary(session, content);
  const own = answers.filter((a) => a.step === step && isClaim(a.value));
  const played = playedUpTo(content, step);
  const nameOf = (pid: string) => session.leaderboard[pid]?.name ?? participants.find((p) => p.id === pid)?.name ?? "Игрок";

  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: SessionChange | (() => Promise<SessionChange>), afterClear?: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    try {
      const change = typeof make === "function" ? await make() : make;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } });
      if (afterClear !== undefined) await control.clearAnswers(afterClear);
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) {
        setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Заявки — по свежему списку с сервера: нажатие в последнюю секунду не потеряется. */
  async function revealChange(): Promise<SessionChange> {
    let all: Answer[] = answers.filter((a) => a.step === step);
    try {
      const fresh = await control.freshAnswers(step);
      const byId = new Map(all.map((a) => [a.id, a]));
      for (const a of fresh) if (a.step === step) byId.set(a.id, a);
      all = [...byId.values()];
    } catch {
      // Нет связи — считаем по тому, что уже пришло.
    }
    return revealSong(latest.current, content, all, participants);
  }

  function onPrimary() {
    if (action === "play") void run(playSong(session));
    if (action === "reveal") void run(revealChange);
    if (action === "next") void run(nextSong(session));
    if (action === "podium") void run(startPodium(session));
    if (action === "podiumNext") void run(podiumNext(session));
    if (action === "finish") control.requestFinish();
  }

  const back = lottoBack(session);
  const buttons = (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={onPrimary}>
          {action === "podiumNext" ? podiumLabel(session) : LABELS[action]}
        </button>
        {song?.trackId && stage === "question" && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(replaySong(session))}>
            ♪ Повторить песню
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || back === null} onClick={() => back && void run(back.change, back.clearAnswers)}>
          Назад
        </button>
      </div>
    </>
  );

  if (stage === "podium") {
    return (
      <div className="stack host-quiz">
        <p className="eyebrow">Награждение</p>
        <PodiumHostList session={session} />
        {buttons}
      </div>
    );
  }

  return (
    <div className="stack host-quiz">
      <div className="stack stack--tight">
        <p className="eyebrow">
          Музыкальное лото · {RULE_TITLES[content.rule].toLowerCase()} · песня {step + 1} из {content.songs.length}
        </p>
        {song && (
          <p className="host-quiz__question">
            {stage === "ready" ? "Первая: " : ""}
            {song.title}
            {song.artist ? <span className="muted"> — {song.artist}</span> : null}
          </p>
        )}
        {!song?.trackId && stage !== "ready" && <p className="muted small">У песни нет трека — включите её со своего плеера.</p>}
      </div>

      {stage === "question" && (
        <section className="stack stack--tight" aria-live="polite">
          <h3 className="host-quiz__subtitle">Заявки «Лото!»: {own.length}</h3>
          {own.length === 0 ? (
            <p className="muted small">Пока никто не собрал карточку.</p>
          ) : (
            <ul className="open-answers">
              {own.map((a) => {
                const ok = isWin(cardFor(content, a.pid), played, content.size, content.rule) && !result.winners.includes(a.pid);
                return (
                  <li key={a.id} className={`open-answers__item open-answers__item--${ok ? "correct" : "wrong"}`}>
                    <span className="open-answers__text">{nameOf(a.pid)}</span>
                    <span className="open-answers__mark">{ok ? "Верно" : "Не совпадает"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {result.winners.length > 0 && (
        <section className="stack stack--tight">
          <h3 className="host-quiz__subtitle">Победители</h3>
          <ol className="lotto-winners">
            {result.winners.map((pid) => (
              <li key={pid}>{nameOf(pid)}</li>
            ))}
          </ol>
        </section>
      )}

      {buttons}
    </div>
  );
}
