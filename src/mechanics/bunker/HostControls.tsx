// Пульт «Бункера»: раздача, раунды, круг открытия, обсуждение, голосование (ничья — оправдание и
// переголосование), изгнание, финал с угрозами. Особые условия с телефонов пульт применяет сам, сразу.
import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, hasPodium, podiumDone, podiumNext } from "../../core/podium";
import { resultKey } from "../../core/session";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { BUNKER_LIMITS, placesFor, type BunkerContent } from "./content";
import { charsFromCards, hostKey, keysOf, sealAll, secretsFromHost } from "./deal";
import { CAT_TITLES, CATS, cardText, type Cat } from "./decks";
import {
  ACTION_LABELS,
  answerOf,
  applyUse,
  bunkerBack,
  bunkerPrimary,
  canSkip,
  countVotes,
  dealSecrets,
  dealt,
  finishBunker,
  giveWord,
  judgeThreat,
  nameMap,
  nextSpeaker,
  nextThreat,
  openable,
  openCard,
  parseBunkerResult,
  quota,
  seatsOf,
  skipVote,
  startDeal,
  startDiscuss,
  startFinal,
  startOpening,
  startRound,
  startVote,
  type Secrets,
} from "./logic";
import { REFUSALS, SPECIAL_BY_ID } from "./specials";
import { saveManual, loadManual } from "../mafia/deal";

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function BunkerHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<BunkerContent>) {
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
  const r = parseBunkerResult(session.state.result);
  const started = session.state.result !== null && session.state.result !== undefined && r.seats.length > 0;
  const names = useMemo(() => nameMap(session, participants), [session, participants]);
  const nm = (pid: string | null) => (pid ? (names[pid] ?? "Игрок") : "—");
  const seat = (pid: string) => r.seats.indexOf(pid) + 1;
  const now = useServerNow(500, r.speakEndsAt !== null || r.voteEndsAt !== null);
  const own = answers.filter((a) => a.step === step);

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

  // Тайное игры: ключом ведущего (этот пульт раздавал) или персонажи по картам телефонов (второй пульт).
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const [partial, setPartial] = useState(false);
  const sealedKey = Object.values(r.sealed).join("").length + ":" + (r.hostSeal?.length ?? 0) + ":" + (r.hostSeal?.slice(0, 24) ?? "");
  useEffect(() => {
    if (!r.hostSeal) {
      setSecrets(null);
      return;
    }
    let live = true;
    void (async () => {
      const fromHost = await secretsFromHost(hostKey(session.id), r.hostSeal);
      if (fromHost) {
        if (live) {
          setSecrets(fromHost);
          setPartial(false);
        }
        return;
      }
      const chars = await charsFromCards(r.sealed, keys);
      if (live) {
        setSecrets({ chars, bunker: r.bunkerShown, threats: [], notes: {} });
        setPartial(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [r.hostSeal, sealedKey, keys, session.id]);
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
      if (clear !== undefined) await control.clearAnswers(clear);
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } });
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  /** Тайное поменялось (особое условие): заново зашифровать карты телефонов и ведущего. */
  async function resealed(next: Secrets, change: SessionChange): Promise<SessionChange> {
    const { sealed, hostSeal } = await sealAll(next, keys, hostKey(session.id));
    const res = (change.state?.result ?? {}) as Record<string, unknown>;
    return { ...change, state: { ...(change.state ?? {}), result: { ...res, sealed, hostSeal } } };
  }

  // Ответы телефонов, которые пульт выполняет сам: открыть карту на своём ходе, сыграть особое условие.
  const working = useRef(false);
  const [manualUse, setManualUse] = useState<{ pid: string; target: string; cat: Cat | "" }>({ pid: "", target: "", cat: "" });
  useEffect(() => {
    if (!started || !secrets || partial || working.current || stage !== "question" || r.mode === "deal") return;
    const job = pendingJob(own);
    if (!job) return;
    working.current = true;
    void (async () => {
      const cur = latest.current;
      const expect = { phase: "playing" as const, step: cur.state.step, result: resultKey(cur.state.result) };
      try {
        if (job.kind === "open") {
          const ch = openCard(cur, content, job.pid, job.cat, secrets.chars, now);
          if (ch.state) await control.apply({ ...ch, expect });
        } else {
          const out = applyUse(cur, content, secrets, job.pid, job.use, nm);
          if ("refusal" in out) await control.apply({ ...out.change, expect });
          else {
            const change = await resealed(out.secrets, out.change);
            await control.apply({ ...change, expect });
            setSecrets(out.secrets);
          }
        }
      } catch {
        // Второй пульт успел раньше или нет связи — посмотрим снова при следующем обновлении.
      } finally {
        working.current = false;
      }
    })();
  }, [own, secrets, r.mode, step, stage, partial]);

  function pendingJob(list: Answer[]): { kind: "open"; pid: string; cat: Cat } | { kind: "use"; pid: string; use: { target: string | null; cat: Cat | null } } | null {
    for (const a of list) {
      const v = answerOf(a.value);
      if (v.use && content.specials && !r.used[a.pid]) {
        const sig = `${step}:${v.use.target ?? "-"}:${v.use.cat ?? "-"}`;
        if (r.refused[a.pid]?.sig !== sig) return { kind: "use", pid: a.pid, use: v.use };
      }
    }
    if (r.mode === "open" && r.speaker && r.speakEndsAt === null) {
      const a = list.find((x) => x.pid === r.speaker);
      const cat = a ? answerOf(a.value).open : undefined;
      if (cat && openable(r, r.speaker).includes(cat)) return { kind: "open", pid: r.speaker, cat };
    }
    return null;
  }

  // Сколько проголосовало — на экран (не чаще раза в 2 секунды).
  const votedCount = r.mode === "vote" ? own.filter((a) => answerOf(a.value).vote).length : 0;
  useEffect(() => {
    if (r.mode !== "vote" || votedCount === session.state.answered) return;
    const t = window.setTimeout(() => {
      const cur = latest.current;
      void control.apply({ state: { answered: votedCount }, expect: { phase: "playing", step: cur.state.step } }).catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [r.mode, votedCount, step]);

  // Голоса игроков без телефона (вводит ведущий, хранятся на этом пульте).
  const [manual, setManual] = useState<Record<string, string>>(() => loadManual(session.id, step));
  useEffect(() => setManual(loadManual(session.id, step)), [session.id, step]);
  const setManualFor = (pid: string, value: string) => {
    const next = { ...manual };
    if (value) next[pid] = value;
    else delete next[pid];
    setManual(next);
    saveManual(session.id, step, next);
  };

  const doDeal = () =>
    run(async () => {
      const cur = latest.current;
      const list = await control.freshAnswers(step).catch(() => [] as Answer[]);
      const k = keysOf([...own, ...list]);
      const rr = parseBunkerResult(cur.state.result);
      const sec = dealSecrets(rr.seats, content);
      const { sealed, hostSeal } = await sealAll(sec, k, hostKey(cur.id));
      setKeys(k);
      setSecrets(sec);
      setPartial(false);
      return dealt(cur, content, sealed, hostSeal);
    });

  const doCount = () =>
    run(async () => {
      if (!secrets) return null;
      const list = await control.freshAnswers(step).catch(() => [] as Answer[]);
      const votes: Record<string, string> = { ...manual };
      for (const a of [...own, ...list]) {
        const v = answerOf(a.value).vote;
        if (v) votes[a.pid] = v;
      }
      return countVotes(latest.current, content, votes, secrets.chars);
    });

  const action = started ? bunkerPrimary(session, content) : "deal";
  const players = r.seats.length > 0 ? r.seats.length : seatsOf(session, participants).length;
  const tableSize = seatsOf(session, participants).length;
  const back = bunkerBack(session);
  const q = started ? quota(content, r) : 0;
  const needSecrets = !secrets || partial;
  const label = (pid: string) => (
    <>
      №{seat(pid)} <NameText name={nm(pid)} />
    </>
  );

  const primary = (() => {
    if (stage === "podium") {
      return podiumDone(session) ? (
        <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => control.requestFinish()}>
          Завершить игру
        </button>
      ) : (
        <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(podiumNext(session))}>
          Открыть следующее место
        </button>
      );
    }
    const btn = (text: string, onClick: () => void, disabled = false) => (
      <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || disabled} onClick={onClick}>
        {text}
      </button>
    );
    switch (action) {
      case "deal":
        return btn(ACTION_LABELS.deal, () => void run(startDeal(session, participants)), players < BUNKER_LIMITS.minPlayers || players > BUNKER_LIMITS.maxPlayers);
      case "dealt":
        return btn(ACTION_LABELS.dealt, () => void doDeal());
      case "round":
        return btn(`Раунд ${r.round + 1}: карта бункера`, () => secrets && void run(startRound(session, content, secrets)), needSecrets);
      case "opening":
        return btn(ACTION_LABELS.opening, () => void run(startOpening(session)));
      case "nextSpeaker":
        return btn(`Следующий: ${nm(r.order[r.turn + 1] ?? null)}`, () => void run(nextSpeaker(session)), r.speakEndsAt === null);
      case "discuss":
        return btn(ACTION_LABELS.discuss, () => void run(startDiscuss(session, content, now)), r.speakEndsAt === null);
      case "vote":
        return btn(`${ACTION_LABELS.vote} (изгнать: ${q})`, () => void run(startVote(session, content, now)));
      case "count":
        return btn(ACTION_LABELS.count, () => void doCount(), needSecrets);
      case "revote":
        return btn(ACTION_LABELS.revote, () => void run(startVote(session, content, now, r.candidates)));
      case "moreVote":
        return btn(`${ACTION_LABELS.moreVote} (ещё ${q})`, () => void run(startVote(session, content, now)));
      case "final":
        return btn(ACTION_LABELS.final, () => secrets && void run(startFinal(session, content, secrets)), needSecrets);
      case "threat":
        return btn(`${ACTION_LABELS.threat} ${r.threatsShown.length + 1} из ${content.threats}`, () => secrets && void run(nextThreat(session, secrets)), needSecrets);
      case "judge":
        return (
          <>
            {btn("Справились с угрозой", () => void run(judgeThreat(session, true)))}
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(judgeThreat(session, false))}>
              Не справились
            </button>
          </>
        );
      case "outcome":
        return btn(ACTION_LABELS.outcome, () => secrets && void run(finishBunker(session, content, secrets.chars)), needSecrets);
      case "nextParty":
        return (
          <>
            {btn(`Партия ${r.party + 1} из ${content.parties}: собрать телефоны`, () => void run(startDeal(session, participants)), tableSize < BUNKER_LIMITS.minPlayers || tableSize > BUNKER_LIMITS.maxPlayers)}
            <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => confirm({ title: "Закончить игру после этой партии?", text: "Сразу награждение по общему счёту.", confirmLabel: "К награждению", run: () => run(hasPodium(session.leaderboard) ? awardNow(session) : null) })}>
              Закончить и наградить
            </button>
          </>
        );
      case "podium":
        return (
          <>
            {hasPodium(session.leaderboard) ? btn(ACTION_LABELS.podium, () => void run(awardNow(session))) : btn("Завершить игру", () => control.requestFinish())}
            <button type="button" className="btn btn--quiet btn--block" disabled={busy || tableSize < BUNKER_LIMITS.minPlayers || tableSize > BUNKER_LIMITS.maxPlayers} onClick={() => void run(startDeal(session, participants))}>
              Сыграть ещё партию
            </button>
          </>
        );
    }
  })();

  const speaker = r.speaker;
  const manualOpen = r.mode === "open" && speaker && r.speakEndsAt === null;

  return (
    <div className="stack host-quiz bk-host">
      <p className="eyebrow">
        Бункер
        {content.parties > 1 || r.party > 1 ? ` · партия ${r.party} из ${Math.max(content.parties, r.party)}` : ""}
        {r.round > 0 ? ` · раунд ${r.round} из ${content.rounds}` : ""}
        {started && r.mode !== "deal" ? ` · в игре ${r.alive.length}, мест ${r.places}` : ""}
        {started && r.round > 0 && r.mode !== "final" ? ` · изгнать в раунде: ${q}` : ""}
      </p>

      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : !started ? (
        <p className="muted">
          Игроки — по порядку входа, от {BUNKER_LIMITS.minPlayers} до {BUNKER_LIMITS.maxPlayers}. Сейчас {players}: мест в бункере будет {placesFor(Math.max(players, 1))}. У каждого — 6 карт персонажа{content.specials ? " и особое условие" : ""}, на телефоне.
        </p>
      ) : r.mode === "deal" ? (
        <div className="card stack stack--tight">
          <p>
            Телефоны готовы: {Object.keys(keys).length} из {r.seats.length}.
          </p>
          {keyless.length > 0 && <p className="muted small">Без телефона ({keyless.map(nm).join(", ")}) — их карты увидите на пульте и подскажете тихо.</p>}
        </div>
      ) : null}

      {started && r.mode === "open" && speaker && (
        <div className="card stack stack--tight">
          <p>
            Ход: {label(speaker)}
            {r.speakEndsAt !== null ? <strong className="bk-host__timer"> · речь {clock(r.speakEndsAt - now)}</strong> : r.round <= 1 ? " — открывает профессию" : " — выбирает карту на телефоне"}
          </p>
          {manualOpen && secrets && !partial && (
            <div className="bk-host__open">
              <span className="muted small">{keys[speaker] && !rehearsal ? "Телефон не отвечает? Откройте за игрока:" : "Игрок говорит, какую карту открыть:"}</span>
              {openable(r, speaker).map((c) => (
                <button key={c} type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run(openCard(session, content, speaker, c, secrets.chars, now))}>
                  {CAT_TITLES[c]}
                </button>
              ))}
            </div>
          )}
          {r.speakEndsAt !== null && (
            <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void run(giveWord(session, speaker, r.round <= 1 ? content.firstSpeechSeconds : content.speechSeconds, now))}>
              Таймер речи заново
            </button>
          )}
        </div>
      )}

      {started && r.mode === "discuss" && (
        <div className="card stack stack--tight">
          <p>
            Обсуждение{r.speakEndsAt !== null ? <strong className="bk-host__timer"> · {clock(r.speakEndsAt - now)}</strong> : ""}. {q > 0 ? `В этом раунде изгоняем: ${q}.` : "В этом раунде без изгнания."}
          </p>
          {q > 0 && canSkip(content, r) && (
            <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => confirm({ title: "Пропустить голосование?", text: `Изгнание перейдёт на следующие раунды. Осталось пропусков: ${content.skipVotes - r.skips}.`, confirmLabel: "Пропустить", run: () => run(skipVote(session)) })}>
              Пропустить голосование
            </button>
          )}
        </div>
      )}

      {started && r.mode === "vote" && (
        <div className="card stack stack--tight">
          <p>
            {r.revote ? "Переголосование" : "Голосование"}: {votedCount} из {r.alive.length}
            {r.voteEndsAt !== null ? <strong className="bk-host__timer"> · {clock(r.voteEndsAt - now)}</strong> : ""}
          </p>
          {(r.immune.length > 0 || r.doubled.length > 0 || r.cancelled) && (
            <p className="muted small">
              {r.immune.length > 0 ? `Неприкосновенность: ${r.immune.map(nm).join(", ")}. ` : ""}
              {r.doubled.length > 0 ? `Двойной голос: ${r.doubled.map(nm).join(", ")}. ` : ""}
              {r.cancelled ? "Голосование отменено особым условием." : ""}
            </p>
          )}
          {(rehearsal ? r.alive : keyless.filter((p) => r.alive.includes(p))).map((p) => (
            <label key={p} className="field">
              <span>
                Голос: {label(p)}
                {keys[p] ? "" : " (без телефона)"}
              </span>
              <select value={manual[p] ?? ""} onChange={(e) => setManualFor(p, e.target.value)}>
                <option value="">не голосовал(а)</option>
                {r.candidates
                  .filter((c) => c !== p)
                  .map((c) => (
                    <option key={c} value={c}>
                      №{seat(c)} {nm(c)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      )}

      {started && r.mode === "justify" && (
        <div className="card stack stack--tight">
          <p>Ничья! Каждому — оправдательная речь {content.justifySeconds} с, потом переголосование только между ними. Снова ничья — жребий.</p>
          {r.candidates.map((p) => (
            <button key={p} type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run(giveWord(session, r.speaker === p ? null : p, content.justifySeconds, now))}>
              {r.speaker === p && r.speakEndsAt !== null ? `Говорит ${nm(p)} · ${clock(r.speakEndsAt - now)}` : `Слово: ${nm(p)}`}
            </button>
          ))}
        </div>
      )}

      {started && r.mode === "exile" && (
        <p className="bk-host__news">
          {r.tally?.out ? (
            <>
              Изгнан(а): {label(r.tally.out)}
              {r.tally.random ? " — по жребию" : ""}. Его карты открыты всем.
            </>
          ) : (
            "Голосование не состоялось — изгнание переносится."
          )}
        </p>
      )}

      {started && r.mode === "final" && (
        <p className="bk-host__news">
          {r.outcome ? (r.outcome.won ? "Бункер выжил!" : "Бункер не выжил.") : `В бункере ${r.alive.length}: их карты открыты. `}
          {!r.outcome && r.verdicts.some((v) => v === null) ? "Спасшиеся обсуждают угрозу: чем справятся? Решите, справились ли." : ""}
          {!r.outcome && content.rebirth && secrets ? ` «Возрождение»: ${(() => {
            const ok = r.alive.some((p) => secrets.chars[p]?.biology.startsWith("b:m")) && r.alive.some((p) => secrets.chars[p]?.biology.startsWith("b:f"));
            return ok ? "мужчина и женщина есть — проверим возраст и здоровье" : "пары нет";
          })()}.` : ""}
        </p>
      )}

      {started && partial && r.mode !== "deal" && <p className="muted small">Этот пульт не раздавал карты: ему не видны карты бункера и угрозы. Раунды и итог ведите с устройства, где раздавали.</p>}

      {started && r.mode !== "deal" && r.log.length > 0 && stage !== "podium" && (
        <details className="quest-host__places">
          <summary>Сыгранные особые условия ({r.log.length})</summary>
          <ul className="bk-host__log">
            {r.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </details>
      )}

      {started && r.mode !== "deal" && secrets && stage !== "podium" && (
        <details className="quest-host__places">
          <summary>Карты игроков (видите только вы)</summary>
          <ol className="bk-host__chars">
            {r.seats.map((p) => {
              const c = secrets.chars[p];
              return (
                <li key={p} className={r.alive.includes(p) ? undefined : "is-out"}>
                  <b>
                    {label(p)}
                    {keys[p] ? "" : " · без телефона"}
                    {r.exiled.includes(p) ? " · изгнан(а)" : ""}
                  </b>
                  {c ? (
                    <span>
                      {CATS.map((cat) => (
                        <span key={cat} className={(r.open[p] ?? []).includes(cat) ? "is-open" : undefined}>
                          {CAT_TITLES[cat]}: {cardText(c[cat])}
                        </span>
                      ))}
                      {content.specials && (
                        <span className={r.used[p] ? "is-open" : undefined}>
                          ⚡ {SPECIAL_BY_ID[c.special].title}
                          {r.used[p] ? " (сыграно)" : ""}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="muted">карты на устройстве, где раздавали</span>
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      )}

      {started && content.specials && secrets && !partial && r.mode !== "deal" && r.mode !== "final" && stage !== "podium" && (
        <details className="quest-host__places">
          <summary>Сыграть особое условие за игрока</summary>
          <div className="stack stack--tight">
            <p className="muted small">Для игроков без телефона или если телефон не работает. Игрок называет условие вслух.</p>
            <label className="field">
              Игрок
              <select value={manualUse.pid} onChange={(e) => setManualUse({ pid: e.target.value, target: "", cat: "" })}>
                <option value="">выберите</option>
                {r.alive
                  .filter((p) => !r.used[p])
                  .map((p) => (
                    <option key={p} value={p}>
                      №{seat(p)} {nm(p)} — {secrets.chars[p] ? SPECIAL_BY_ID[secrets.chars[p].special].title : "?"}
                    </option>
                  ))}
              </select>
            </label>
            {manualUse.pid && secrets.chars[manualUse.pid] && (() => {
              const sp = SPECIAL_BY_ID[(secrets.chars[manualUse.pid] as { special: keyof typeof SPECIAL_BY_ID }).special];
              const refused = r.refused[manualUse.pid];
              return (
                <>
                  <p className="small">{sp.text}</p>
                  {sp.target !== "none" && (
                    <label className="field">
                      На кого
                      <select value={manualUse.target} onChange={(e) => setManualUse({ ...manualUse, target: e.target.value, cat: "" })}>
                        <option value="">выберите</option>
                        {r.alive
                          .filter((p) => p !== manualUse.pid)
                          .map((p) => (
                            <option key={p} value={p}>
                              №{seat(p)} {nm(p)}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {sp.target === "playerCat" && manualUse.target && (
                    <label className="field">
                      Какую карту
                      <select value={manualUse.cat} onChange={(e) => setManualUse({ ...manualUse, cat: e.target.value as Cat })}>
                        <option value="">выберите</option>
                        {CATS.filter((c) => !(r.open[manualUse.target] ?? []).includes(c)).map((c) => (
                          <option key={c} value={c}>
                            {CAT_TITLES[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {refused && <p className="error small">{REFUSALS[refused.reason as keyof typeof REFUSALS] ?? "Не получилось"}</p>}
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busy || (sp.target !== "none" && !manualUse.target) || (sp.target === "playerCat" && !manualUse.cat)}
                    onClick={() =>
                      confirm({
                        title: `Сыграть «${sp.title}» за ${nm(manualUse.pid)}?`,
                        confirmLabel: "Сыграть",
                        run: () =>
                          run(async () => {
                            const out = applyUse(latest.current, content, secrets, manualUse.pid, { target: manualUse.target || null, cat: manualUse.cat || null }, nm);
                            if ("refusal" in out) return out.change;
                            const change = await resealed(out.secrets, out.change);
                            setSecrets(out.secrets);
                            setManualUse({ pid: "", target: "", cat: "" });
                            return change;
                          }),
                      })
                    }
                  >
                    Сыграть
                  </button>
                </>
              );
            })()}
          </div>
        </details>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {primary}
        {back && stage !== "podium" && started && (
          <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => confirm({ title: "Назад на одно действие?", text: "Очки этого действия снимутся, ответы шага — сотрутся.", confirmLabel: "Назад", run: () => run(back.change, back.clearAnswers) })}>
            Назад
          </button>
        )}
        {back && stage === "podium" && (
          <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void run(back.change)}>
            Назад
          </button>
        )}
      </div>
      {dialog}
    </div>
  );
}
