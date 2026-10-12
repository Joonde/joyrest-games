import { useEffect, useRef, useState } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { resultKey, secondsLeft } from "../../core/session";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { tileOf, VARIANT_TITLES, type StageContent } from "./content";
import { countVotes, defaultOpponent, finishPerform, liveGifts, liveVotes, nextTurn, parseStageResult, pickTile, setBattleWinner, stageBack, stagePrimary, startGame, startVote, toggleFull, turnPid, videoCommand, type VideoCmd } from "./logic";
import { canSeek } from "./video";
import { StageField, tileLabel } from "./views";
import "./stage.css";

/**
 * Пульт «Just Dance / Караоке на поле»: «Начать игру» → команда называет плитку, ведущий касается её → выступление:
 * плеер (пауза, −10/+10 с, остановить, на весь экран), «Выступили» (очки плитки + симпатия зала) или «Не вышли»;
 * батл — соперник, «Голосование зала», «Подсчитать голоса», поправка победителя → «Следующая команда».
 */
export function StageHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<StageContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [battle, setBattle] = useState<{ tile: string; opponent: string | null } | null>(null);
  const latest = useRef<Session>(session);
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    latest.current = session;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);
  const { stage, step } = session.state;
  const r = parseStageResult(session.state.result);
  const tile = tileOf(content, r.tile);
  const now = useServerNow(250, r.mode === "vote" && stage === "question");
  const left = r.mode === "vote" && stage === "question" ? secondsLeft(session.state, now) : null;
  const own = answers.filter((a) => a.step === step);
  const answersKey = own.map((a) => `${a.id}:${a.submittedAt ?? 0}:${JSON.stringify(a.value)}`).join("|");

  // Симпатия и голоса батла — на экран (не чаще раза в 1,5 с).
  useEffect(() => {
    if (rehearsal || stage !== "question" || (r.mode !== "perform" && r.mode !== "vote")) return;
    const timer = window.setTimeout(() => {
      const cur = latest.current;
      const change = r.mode === "perform" ? liveGifts(cur, answers, participants) : liveVotes(cur, answers, participants);
      if (!change) return;
      const { phase, step: atStep, stage: atStage } = cur.state;
      void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(timer);
    // Итоги шага тоже: команда плеера с другого пульта могла записать прежний счёт — проверяем снова.
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

  /** Плеер и «на весь экран» — без отпечатка итогов (их можно жать, пока на экран летят голоса и подарки). */
  async function media(change: SessionChange) {
    setError(null);
    const { phase, step: atStep, stage: atStage } = latest.current.state;
    try {
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } });
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    }
  }

  async function fresh(): Promise<Answer[]> {
    try {
      return await control.freshAnswers(step);
    } catch {
      return answers;
    }
  }

  const action = stagePrimary(session, content);
  const backPlan = stageBack(session, content);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Команда") : "—");
  const turn = turnPid(r);
  const sides = r.order.length > 0 ? r.order : Object.keys(session.leaderboard);

  function onPickTile(id: string) {
    const t = tileOf(content, id);
    if (!t) return;
    if (t.kind === "battle") {
      setBattle({ tile: id, opponent: defaultOpponent({ ...r, order: sides }, turn) });
      return;
    }
    void run(pickTile(session, content, id, participants));
  }

  const labels: Record<typeof action, string> = {
    start: "Начать игру",
    pickTile: "Коснитесь плитки, которую назвали",
    done: `Выступили · +${tile?.points ?? 0}`,
    vote: "Голосование зала",
    count: "Подсчитать голоса",
    next: "Следующая команда",
    podium: "Все плитки сыграны — награждение",
    podiumNext: "Открыть следующее место",
    finish: "Завершить игру",
  };
  function perform() {
    if (action === "start") void run(startGame(session, participants));
    if (action === "done") void run(async () => finishPerform(latest.current, content, await fresh(), participants, true));
    if (action === "vote") void run(startVote(session, content, Math.floor(Math.random() * 1000)));
    if (action === "count") void run(async () => countVotes(latest.current, content, await fresh(), participants));
    if (action === "next") void run(nextTurn(session, participants));
    if (action === "podium") void run(awardNow(session));
    if (action === "podiumNext") void run(podiumNext(session));
    if (action === "finish") control.requestFinish();
  }

  const hasVideo = tile ? tile.video.source !== "none" && !(tile.video.source === "link" && !tile.video.url.trim()) : false;
  const screen = session.screenMode !== "none";
  const cmd = (c: VideoCmd) => void media(videoCommand(latest.current, c));

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">
        {VARIANT_TITLES[content.variant]} · сыграно {r.played.length} из {content.tiles.length}
      </p>
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : stage === "ready" ? (
        <p className="muted">Команды по очереди называют категорию и очки, вы касаетесь плитки — на экране она переворачивается и показывает, кто выходит.</p>
      ) : r.mode === "pick" ? (
        battle ? (
          <div className="stack stack--tight">
            <p>
              Батл: <strong><NameText name={name(turn)} /></strong> против кого?
            </p>
            {sides
              .filter((p) => p !== turn)
              .map((p) => (
                <button key={p} type="button" className={battle.opponent === p ? "btn btn--block" : "btn btn--secondary btn--block"} aria-pressed={battle.opponent === p} onClick={() => setBattle({ ...battle, opponent: p })}>
                  <NameText name={name(p)} />
                </button>
              ))}
            <button
              type="button"
              className="btn btn--block host-quiz__primary"
              disabled={busy || !battle.opponent}
              onClick={() => {
                const b = battle;
                setBattle(null);
                void run(pickTile(session, content, b.tile, participants, b.opponent));
              }}
            >
              Открыть батл
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setBattle(null)}>
              Другая плитка
            </button>
          </div>
        ) : (
          <>
            <p>
              Выбирают: <strong><NameText name={name(turn)} /></strong> — коснитесь плитки, которую назвали.
            </p>
            <StageField content={content} result={r} onPick={onPickTile} disabled={busy} compact />
          </>
        )
      ) : tile ? (
        <div className="stack stack--tight">
          <p className="eyebrow">
            {content.categories.find((c) => c.id === tile.cat)?.title ?? ""} · {tile.points}
          </p>
          <p>
            <strong>{tileLabel(tile)}</strong>
            {" · "}
            {tile.kind === "battle" ? (
              <>
                <NameText name={name(r.performer)} /> против <NameText name={name(r.opponent)} />
              </>
            ) : (
              <NameText name={name(r.performer)} />
            )}
          </p>
          {tile.title && <p className="muted small">{content.variant === "karaoke" ? "Песня" : "Трек"}: {tile.title}</p>}
          {tile.note && <p className="muted small">{tile.note}</p>}

          {r.mode === "perform" && screen && hasVideo && (
            <div className="stage-player">
              <p className="stage-player__title">Видео на экране зала</p>
              <div className="stage-player__row">
                <button type="button" className="btn btn--secondary" disabled={!canSeek(tile)} onClick={() => cmd("back")} aria-label="Назад на 10 секунд">
                  −10 с
                </button>
                <button type="button" className="btn" onClick={() => cmd(r.video.paused ? "play" : "pause")}>
                  {r.video.paused ? "▶ Дальше" : "⏸ Пауза"}
                </button>
                <button type="button" className="btn btn--secondary" disabled={!canSeek(tile)} onClick={() => cmd("fwd")} aria-label="Вперёд на 10 секунд">
                  +10 с
                </button>
              </div>
              <div className="stage-player__row stage-player__row--two">
                <button type="button" className="btn btn--secondary stage-player__stop" onClick={() => cmd("stop")}>
                  ⏹ Остановить
                  <span>видео встаёт и уходит в начало</span>
                </button>
                <button type="button" className={r.full ? "btn" : "btn btn--secondary"} aria-pressed={r.full} onClick={() => void media(toggleFull(latest.current))}>
                  {r.full ? "⤡ Вернуть поле" : "⛶ На весь экран"}
                </button>
              </div>
              {!canSeek(tile) && <p className="muted small">VK Видео не даёт управлять плеером: «Пауза» и «Остановить» убирают ролик, «Дальше» запускает его заново. Перемотка — у YouTube, Rutube и файла.</p>}
            </div>
          )}

          {r.mode === "perform" && tile.kind !== "battle" && content.gift > 0 && (
            <p className="stage-host__gift">
              Симпатия зала: <strong>+{r.gifts.length * content.gift}</strong> {r.gifts.length > 0 ? `(подарили: ${r.gifts.map((g) => name(g)).join(", ")})` : "— пока никто"}
            </p>
          )}

          {r.mode === "vote" && stage === "question" && (
            <div className="host-quiz__live">
              <span className={left === 0 ? "host-quiz__timer is-over" : "host-quiz__timer"} role="timer">
                {left === null ? "∞" : left === 0 ? "Время вышло" : `${left} с`}
              </span>
              <span>
                <NameText name={name(r.performer)} /> {r.performer ? (r.votes[r.performer] ?? 0) : 0} : {r.opponent ? (r.votes[r.opponent] ?? 0) : 0} <NameText name={name(r.opponent)} />
              </span>
            </div>
          )}

          {r.mode === "result" && (
            <ul className="buzz-queue buzz-queue--plain">
              {Object.keys(r.scores).length === 0 ? (
                <li>{r.outcome === "skip" ? "Не вышли — очков нет, плитка сыграна" : "Очков нет"}</li>
              ) : (
                Object.entries(r.scores).map(([p, n]) => (
                  <li key={p} className={n > 0 ? "is-now" : ""}>
                    <span className="buzz-queue__name">
                      <NameText name={name(p)} />
                    </span>
                    <span className="buzz-queue__state">{n > 0 ? `+${n}` : `${n} (подарок)`}</span>
                  </li>
                ))
              )}
            </ul>
          )}
          {r.mode === "result" && tile.kind === "battle" && (
            <div className="stack stack--tight">
              <p className="muted small">Зал решил иначе (аплодисментами)? Поправьте итог:</p>
              <div className="row">
                {[r.performer, r.opponent].map((p) =>
                  p ? (
                    <button key={p} type="button" className={r.winner === p ? "btn" : "btn btn--secondary"} disabled={busy} onClick={() => void run(setBattleWinner(session, content, p))}>
                      Победил: <NameText name={name(p)} />
                    </button>
                  ) : null,
                )}
                <button type="button" className={r.outcome === "tie" ? "btn" : "btn btn--secondary"} disabled={busy} onClick={() => void run(setBattleWinner(session, content, "tie"))}>
                  Ничья
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {!(r.mode === "pick" && battle) && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || action === "pickTile"} onClick={perform}>
            {labels[action]}
          </button>
        )}
        {r.mode === "perform" && tile?.kind === "perform" && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(async () => finishPerform(latest.current, content, await fresh(), participants, false))}>
            Не вышли · 0
          </button>
        )}
        {r.mode === "perform" && backPlan && (
          <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void run(backPlan.change, backPlan.clear)}>
            Другая плитка — эта останется на поле
          </button>
        )}
        {r.mode !== "perform" && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy || backPlan === null} onClick={() => backPlan && void run(backPlan.change, backPlan.clear)}>
            Назад
          </button>
        )}
      </div>
    </div>
  );
}
