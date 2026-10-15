import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, hasPodium, podiumBack, podiumDone, podiumNext } from "../../core/podium";
import { storeScope } from "../../core/program";
import { pointsLabel } from "../../core/results";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { SPY_LIMITS, spiesFor, type SpyContent } from "./content";
import { hostKey, keysOf, loadManual, saveManual, sealDeal, secretFromCards, secretFromHost } from "./deal";
import {
  abortParty,
  ACTION_LABELS,
  addMinute,
  continueTalk,
  dealSecret,
  dealt,
  guessOf,
  nameMap,
  openAccused,
  parseSpyResult,
  pauseTalk,
  pendingGuess,
  playable,
  reasonText,
  resolveGuess,
  resolveLast,
  resumeTalk,
  spyBack,
  spyPrimary,
  startDeal,
  startTalk,
  startVote,
  talkLeftMs,
  timeUp,
  verdict,
  type SpySecret,
} from "./logic";

export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Пульт «Шпиона»: «Собрать телефоны» → «Раздать карты» → «Начать обсуждение» (таймер, пауза, +1 минута) →
 * «Голосование» → «Подсчитать голоса» → «Открыть карту обвиняемого» (шпион — последний шанс) → итог партии →
 * следующая партия или награждение. Шпион может в любой момент обсуждения назвать локацию с телефона.
 */
export function SpyHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<SpyContent>) {
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
  const r = parseSpyResult(session.state.result);
  const started = session.state.result !== null && session.state.result !== undefined && r.seats.length > 0;
  const names = useMemo(() => nameMap(session, participants), [session, participants]);
  const nm = (pid: string | null) => (pid ? (names[pid] ?? "Игрок") : "—");
  const seat = (pid: string) => r.seats.indexOf(pid) + 1;
  const now = useServerNow(500, true);
  const own = answers.filter((a) => a.step === step);
  const place = (i: number | null | undefined) => (i === null || i === undefined ? "—" : (content.locations[i]?.name ?? "—"));

  // Ключи телефонов: на раздаче — из текущих ответов, потом — один раз с сервера.
  const [keys, setKeys] = useState<Record<string, string>>({});
  const dealing = r.mode === "deal" && stage === "question";
  useEffect(() => {
    if (r.dealStep === null) return;
    if (dealing) {
      setKeys(keysOf(answers.filter((a) => a.step === r.dealStep)));
      return;
    }
    let live = true;
    void control
      .freshAnswers(r.dealStep)
      .then((list) => live && setKeys(keysOf(list)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [r.dealStep, dealing, dealing ? answers : null, session.id]);

  // Тайна партии: ключом ведущего (этот пульт раздавал) или по картам телефонов (второй пульт).
  const [secret, setSecret] = useState<SpySecret | null>(null);
  const [complete, setComplete] = useState(false);
  const sealedKey = Object.keys(r.sealed).sort().join(",");
  useEffect(() => {
    if (!r.hostSeal) {
      setSecret(r.reveal);
      setComplete(r.reveal !== null);
      return;
    }
    let live = true;
    void (async () => {
      const fromHost = await secretFromHost(hostKey(session.id), r.hostSeal);
      if (fromHost) {
        if (live) {
          setSecret(fromHost);
          setComplete(true);
        }
        return;
      }
      const found = await secretFromCards(r.seats, r.sealed, keys);
      if (live) {
        setSecret(found.secret);
        setComplete(found.complete);
      }
    })();
    return () => {
      live = false;
    };
  }, [r.hostSeal, sealedKey, keys, session.id, r.reveal?.location]);

  // Выбор ведущего за игроков без телефона (голос, догадка) — на этом шаге.
  const scope = storeScope(session);
  const [manual, setManual] = useState<Record<string, string>>(() => loadManual(scope, step));
  useEffect(() => setManual(loadManual(scope, step)), [scope, step]);
  const setManualFor = (pid: string, value: string) => {
    const next = { ...manual };
    if (value) next[pid] = value;
    else delete next[pid];
    setManual(next);
    saveManual(scope, step, next);
  };
  const keyless = r.seats.filter((p) => !keys[p]);

  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: SessionChange | null | (() => Promise<SessionChange | null>), clear?: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    try {
      const change = typeof make === "function" ? await make() : make;
      if (!change) return;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      const cur = latest.current.state;
      if (clear !== undefined && (cur.step !== atStep || cur.stage !== atStage)) return;
      if (clear !== undefined) await control.clearAnswers(clear);
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } });
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  const freshOwn = async (): Promise<Answer[]> => {
    const list = await control.freshAnswers(step).catch(() => [] as Answer[]);
    return list.length > 0 ? list : own;
  };

  const pending = r.mode === "talk" && stage === "question" && secret ? pendingGuess(own, step, secret.spies, content) : null;
  const action = started ? spyPrimary(session, content.parties, pending !== null) : "deal";
  const players = r.seats.length > 0 ? r.seats.length : participants.filter((p) => p.kind === "player").length + Object.keys(session.leaderboard).filter((id) => !participants.some((p) => p.id === id)).length;
  const back = stage === "podium" ? { change: podiumBack(session) } : spyBack(session);
  const left = talkLeftMs(r, now);
  const enough = players >= SPY_LIMITS.minPlayers && players <= SPY_LIMITS.maxPlayers;
  const secretReady = secret !== null && complete;

  const doDeal = () =>
    run(async () => {
      const cur = latest.current;
      const list = await freshOwn();
      const k = keysOf([...own, ...list]);
      const rr = parseSpyResult(cur.state.result);
      const s = dealSecret(rr.seats, content, rr.used);
      const { sealed, hostSeal } = await sealDeal(rr.seats, s, content, k, hostKey(cur.id));
      setKeys(k);
      setSecret(s);
      setComplete(true);
      return dealt(cur, sealed, hostSeal);
    });

  const doVerdict = () =>
    run(async () => {
      const list = await freshOwn();
      const voted = new Set(list.map((a) => a.pid));
      const extra: Answer[] = Object.entries(manual)
        .filter(([pid, vote]) => !voted.has(pid) && !pid.includes("#") && vote)
        .map(([pid, vote]) => ({ id: `${step}_${pid}`, step, pid, uid: pid, value: { vote }, submittedAt: null }));
      return verdict(latest.current, [...list, ...extra]);
    });

  const doGuess = () =>
    run(async () => {
      if (!secret) return null;
      const list = await freshOwn();
      const g = pendingGuess(list, step, secret.spies, content) ?? pending;
      return g ? resolveGuess(latest.current, content, secret, g.pid, g.index, now) : null;
    });

  const doLast = () =>
    run(async () => {
      if (!secret || !r.accused) return null;
      const list = await freshOwn();
      const mine = list.find((a) => a.pid === r.accused) ?? own.find((a) => a.pid === r.accused);
      const typed = manual[`${r.accused}#guess`];
      const index = (mine ? guessOf(mine.value, content) : null) ?? (typed ? Number(typed) : null);
      return resolveLast(latest.current, content, secret, index);
    });

  const label = (pid: string) => (
    <>
      №{seat(pid)} <NameText name={nm(pid)} />
    </>
  );

  const locationOptions = playable(content).map((i) => (
    <option key={i} value={String(i)}>
      {content.locations[i]?.name}
    </option>
  ));

  const lastAnswer = r.mode === "last" && r.accused ? own.find((a) => a.pid === r.accused) : undefined;
  const lastIndex = lastAnswer ? guessOf(lastAnswer.value, content) : null;

  return (
    <div className="stack host-quiz sp-host">
      <p className="eyebrow">
        Шпион
        {content.parties > 1 || r.party > 1 ? ` · партия ${r.party} из ${Math.max(content.parties, r.party)}` : ""}
        {started ? ` · за столом ${r.seats.length}` : ""}
      </p>

      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : !started ? (
        <p className="muted">
          Игроки за столом — по порядку входа. Нужно {SPY_LIMITS.minPlayers}–{SPY_LIMITS.maxPlayers} игроков, сейчас {players}. Шпионов: {spiesFor(content, Math.max(players, SPY_LIMITS.minPlayers))}. Локация и шпион выбираются случайно.
        </p>
      ) : r.mode === "deal" ? (
        <div className="card stack stack--tight">
          <p>
            Телефоны готовы: {Object.keys(keys).length} из {r.seats.length}.
          </p>
          {keyless.length > 0 && <p className="muted small">Без телефона ({keyless.map(nm).join(", ")}) — их карты будут на пульте, покажете тихо.</p>}
          <p className="muted small">Шпионов в этой партии: {spiesFor(content, r.seats.length)}.</p>
        </div>
      ) : r.mode === "cards" ? (
        <div className="stack stack--tight">
          <p>Гости смотрят свои карты: локация и роль, у шпиона — «Вы — шпион». Когда все посмотрели — «Начать обсуждение».</p>
          {keyless.length > 0 && <p className="muted small">Без телефона: {keyless.map(nm).join(", ")} — покажите им карту тихо («Карты игроков» ниже).</p>}
        </div>
      ) : null}

      {started && r.mode === "talk" && stage !== "podium" && (
        <section className="card stack stack--tight sp-host__talk">
          <p className="sp-host__timer" aria-live="off">
            {r.paused ? "Пауза · " : ""}
            {clock(left)}
          </p>
          {r.firstAsker && <p>Первым спрашивает: {label(r.firstAsker)}</p>}
          <p className="muted small">Игроки по очереди задают друг другу вопросы о локации. Кто ответил — спрашивает следующего. Голосование можно начать в любой момент.</p>
          <div className="sp-host__row">
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run(r.paused ? resumeTalk(session, now) : pauseTalk(session, now))}>
              {r.paused ? "Продолжить" : "Пауза"}
            </button>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run(addMinute(session, now))}>
              +1 минута
            </button>
          </div>
          {pending && (
            <p className="sp-host__alert" role="status">
              {label(pending.pid)} — шпион! Называет локацию: «{place(pending.index)}»
            </p>
          )}
          {!pending && secret && keyless.some((p) => secret.spies.includes(p)) && (
            <div className="stack stack--tight">
              <p className="eyebrow">Шпион без телефона называет локацию</p>
              {keyless
                .filter((p) => secret.spies.includes(p))
                .map((p) => (
                  <div key={p} className="stack stack--tight">
                    <label className="field">
                      <span>{label(p)}</span>
                      <select value={manual[`${p}#guess`] ?? ""} onChange={(e) => setManualFor(`${p}#guess`, e.target.value)}>
                        <option value="">ещё не назвал</option>
                        {locationOptions}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn--secondary btn--block"
                      disabled={busy || !manual[`${p}#guess`]}
                      onClick={() => {
                        const idx = Number(manual[`${p}#guess`]);
                        confirm({ title: "Шпион называет локацию?", text: `«${place(idx)}» — партия сразу закончится.`, confirmLabel: "Открыть", run: () => run(resolveGuess(session, content, secret, p, idx, now)) });
                      }}
                    >
                      Шпион назвал локацию
                    </button>
                  </div>
                ))}
            </div>
          )}
        </section>
      )}

      {started && r.mode === "vote" && (
        <section className="card stack stack--tight">
          <p>
            Проголосовали: {own.filter((a) => r.seats.includes(a.pid)).length} из {r.seats.length - keyless.length} с телефонами. Голос можно поменять, пока идёт время.
          </p>
          <p className="muted small">Обвинить можно, только если за одного проголосовало больше половины игроков ({Math.floor(r.seats.length / 2) + 1} из {r.seats.length}).</p>
          {keyless.length > 0 && (
            <div className="stack stack--tight">
              <p className="eyebrow">Голоса игроков без телефона</p>
              {keyless.map((p) => (
                <label key={p} className="field">
                  <span>{label(p)}</span>
                  <select value={manual[p] ?? ""} onChange={(e) => setManualFor(p, e.target.value)}>
                    <option value="">не голосует</option>
                    {r.seats
                      .filter((n) => n !== p)
                      .map((n) => (
                        <option key={n} value={n}>
                          №{seat(n)} {nm(n)}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      {started && r.mode === "verdict" && (
        <section className="card stack stack--tight">
          <p className="eyebrow">Итог голосования</p>
          <ul className="sp-host__tally">
            {r.seats
              .filter((p) => (r.tally?.[p] ?? 0) > 0)
              .sort((a, b) => (r.tally?.[b] ?? 0) - (r.tally?.[a] ?? 0))
              .map((p) => (
                <li key={p}>
                  {label(p)} — {r.tally?.[p] ?? 0}
                </li>
              ))}
          </ul>
          <p className="sp-host__news">{r.accused ? <>Город обвиняет {label(r.accused)}</> : (r.talkLeft ?? 0) > 0 ? `Не договорились — обсуждение продолжается (осталось ${clock(r.talkLeft ?? 0)})` : "Не договорились, а время вышло — шпион побеждает"}</p>
        </section>
      )}

      {started && r.mode === "last" && r.accused && (
        <section className="card stack stack--tight">
          <p className="sp-host__news">{label(r.accused)} — шпион! Последний шанс: назвать локацию за {SPY_LIMITS.lastChanceSeconds} секунд.</p>
          <p>{lastIndex !== null ? `Ответ шпиона: «${place(lastIndex)}»` : "Ждём ответ шпиона…"}</p>
          {keyless.includes(r.accused) && (
            <label className="field">
              <span>Шпион без телефона называет</span>
              <select value={manual[`${r.accused}#guess`] ?? ""} onChange={(e) => setManualFor(`${r.accused ?? ""}#guess`, e.target.value)}>
                <option value="">не назвал</option>
                {locationOptions}
              </select>
            </label>
          )}
        </section>
      )}

      {started && r.mode === "over" && stage !== "podium" && (
        <section className="card stack stack--tight">
          <p className="sp-host__news">{r.winner === "town" ? "Победил город!" : r.winner === "spies" ? "Победил шпион!" : "Партия окончена"}</p>
          <p className="muted small">{reasonText(r.reason)}</p>
          {r.reveal && (
            <p>
              Локация: «{place(r.reveal.location)}». Шпион{r.reveal.spies.length > 1 ? "ы" : ""}: {r.reveal.spies.map((p) => `№${seat(p)} ${nm(p)}`).join(", ")}.
            </p>
          )}
          {r.guess && <p className="muted small">Догадка шпиона: «{place(r.guess.index)}» — {r.guess.correct ? "верно" : "неверно"}.</p>}
        </section>
      )}

      {started && r.mode !== "deal" && secret && stage !== "podium" && (
        <details className="quest-host__places">
          <summary>Карты игроков (видите только вы)</summary>
          <p className="muted small">Локация: «{place(secret.location)}»</p>
          <ol className="sp-host__cards">
            {r.seats.map((p) => (
              <li key={p} className={secret.spies.includes(p) ? "is-spy" : undefined}>
                {label(p)} — {secret.spies.includes(p) ? "🕵️ шпион" : (secret.roles[p] ?? "неизвестно")}
                {keys[p] ? "" : " · без телефона"}
                {r.mode === "over" ? ` · ${pointsLabel(session.leaderboard[p]?.score ?? 0)}` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
      {started && r.mode !== "deal" && r.mode !== "over" && !complete && (
        <p className="muted small">Этот пульт знает не все карты (игроки без телефона). Итог партии ведите с устройства, где раздавали карты.</p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {stage === "podium" ? (
          podiumDone(session) ? (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => control.requestFinish()}>
              Завершить игру
            </button>
          ) : (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(podiumNext(session))}>
              Открыть следующее место
            </button>
          )
        ) : action === "deal" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || !enough} onClick={() => void run(startDeal(session, participants))}>
            {ACTION_LABELS.deal}
          </button>
        ) : action === "dealt" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void doDeal()}>
            {ACTION_LABELS.dealt}
          </button>
        ) : action === "talk" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(startTalk(session, content, now))}>
            {ACTION_LABELS.talk} · {content.roundMinutes} мин
          </button>
        ) : action === "guess" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || !secretReady} onClick={() => void doGuess()}>
            {ACTION_LABELS.guess}
          </button>
        ) : action === "vote" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(startVote(session, content, now))}>
            {left > 0 ? ACTION_LABELS.vote : "Время вышло — финальное голосование"}
          </button>
        ) : action === "verdict" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void doVerdict()}>
            {ACTION_LABELS.verdict}
          </button>
        ) : action === "open" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || !secretReady} onClick={() => secret && void run(openAccused(session, content, secret))}>
            {ACTION_LABELS.open}
          </button>
        ) : action === "continue" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(continueTalk(session, now))}>
            {ACTION_LABELS.continue}
          </button>
        ) : action === "timeUp" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || !secretReady} onClick={() => secret && void run(timeUp(session, content, secret))}>
            {ACTION_LABELS.timeUp}
          </button>
        ) : action === "lastCheck" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || !secretReady} onClick={() => void doLast()}>
            {ACTION_LABELS.lastCheck}
          </button>
        ) : action === "nextParty" ? (
          <>
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || !enough} onClick={() => void run(startDeal(session, participants))}>
              Партия {r.party + 1} из {content.parties}: собрать телефоны
            </button>
            <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => confirm({ title: "Закончить игру после этой партии?", text: "Сразу награждение по общему счёту.", confirmLabel: "К награждению", run: () => (hasPodium(session.leaderboard) ? run(awardNow(session)) : control.requestFinish()) })}>
              Закончить и наградить
            </button>
          </>
        ) : action === "podium" ? (
          <>
            {hasPodium(session.leaderboard) ? (
              <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(awardNow(session))}>
                {ACTION_LABELS.podium}
              </button>
            ) : (
              <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => control.requestFinish()}>
                Завершить игру
              </button>
            )}
            {started && r.mode === "over" && (
              <button type="button" className="btn btn--quiet btn--block" disabled={busy || !enough} onClick={() => void run(startDeal(session, participants))}>
                Сыграть ещё партию
              </button>
            )}
          </>
        ) : null}
        {started && r.mode !== "deal" && r.mode !== "over" && stage !== "podium" && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy || !secretReady}
            onClick={() =>
              confirm({
                title: "Закончить партию досрочно?",
                text: "Локация и шпион откроются, очков никто не получит. Отменить можно кнопкой «Назад».",
                confirmLabel: "Открыть карты",
                run: () => run(secret ? abortParty(session, content, secret) : null),
              })
            }
          >
            Закончить досрочно
          </button>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={busy || back === null}
          onClick={() => back && void run(back.change, "clearAnswers" in back ? back.clearAnswers : undefined)}
        >
          Назад
        </button>
      </div>
      {dialog}
    </div>
  );
}
