import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { scoringParticipants } from "../../core/leaderboard";
import type { Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { hostKey } from "../mafia/deal";
import type { PerudoContent } from "./content";
import { diceOf, hostCupKey, newNonce } from "./dice";
import { aliveCups, keysFrom, minQty, moveFromAnswers, parsePerudoResult, perudoBack, perudoPrimary, placeBid, resolveCall, startDeal, startRound, totalDice, type Bid } from "./logic";
import { bidText } from "./text";
import { Die } from "./views";

/**
 * Пульт «Перудо»: «Собрать стаканы» → «Бросить кости» → ставки идут с телефонов сами (за стакан без телефона
 * ставит ведущий) → «Не верю!» / «Ровно!» — вскрытие на экране → «Следующий раунд» → итог партии.
 * Ведущий — судья: видит кости всех стаканов.
 */
export function PerudoHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<PerudoContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [face, setFace] = useState(3);
  const [qty, setQty] = useState(1);
  const [peek, setPeek] = useState(false);
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
  const r = parsePerudoResult(session.state.result);
  const started = session.state.result !== null && session.state.result !== undefined;
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Игрок") : "—");
  const noPlayers = scoringParticipants(participants, session.playMode).length + Object.keys(session.leaderboard).length < 2;
  const action = perudoPrimary(session, content);
  const back = perudoBack(session);
  const host = hostKey(session.id);

  // Ключи телефонов: на раздаче — из ответов, потом — один раз свежим списком с сервера.
  const dealKeys = r.mode === "deal" && step === r.keysStep ? keysFrom(answers, r.keysStep) : null;
  const dealKey = dealKeys ? Object.keys(dealKeys).sort().join(",") : "";
  useEffect(() => {
    if (dealKeys) setKeys(dealKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- при новых ключах
  }, [dealKey]);
  useEffect(() => {
    if (r.keysStep === null || r.mode === "deal") return;
    let stop = false;
    void control
      .freshAnswers(r.keysStep)
      .then((list) => !stop && setKeys(keysFrom(list, r.keysStep)))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- на новую партию
  }, [r.keysStep, r.party]);

  /** Кости всех стаканов этого раунда (стакан без телефона — ключом ведущего). */
  function allDice(k: Record<string, string>): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const p of aliveCups(r)) out[p] = diceOf(k[p] ?? hostCupKey(host, p), r.nonce, r.dice[p] ?? 0);
    return out;
  }

  function nextSession(): Promise<void> {
    return new Promise((done) => {
      const timer = window.setTimeout(done, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        done();
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
      if (!change) {
        setError("Это действие сейчас недоступно.");
        return;
      }
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

  /** Вскрытие: свежие ключи с сервера, чтобы не ошибиться с костями. */
  const call = (kind: "dudo" | "calza") =>
    run(async () => {
      const list = r.keysStep !== null ? await control.freshAnswers(r.keysStep).catch(() => []) : [];
      const k = { ...keys, ...keysFrom(list, r.keysStep) };
      return resolveCall(latest.current, content, kind, allDice(k));
    });

  // Ход с телефона того, чья очередь, — сразу на стол.
  const moveKey = stage === "question" && r.mode === "bid" ? answers.filter((a) => a.step === step && a.pid === r.turn).map((a) => `${a.id}:${a.submittedAt ?? 0}`).join(",") : "";
  useEffect(() => {
    if (!moveKey || busy) return;
    const move = moveFromAnswers(latest.current, answers);
    if (!move) return;
    if ("bid" in move) {
      const change = placeBid(latest.current, move.pid, move.bid);
      if (!change) return;
      const { phase, step: atStep, stage: atStage } = latest.current.state;
      void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    } else void call(move.call);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только на новый ход
  }, [moveKey, busy]);

  // Ставка ведущего за стакан: подогнать грань и количество под допустимые.
  const total = totalDice(r);
  const faceMin = minQty(r.bid, face, r.palifico);
  const q = Math.min(total, Math.max(faceMin ?? 1, qty));
  const hostBid: Bid = { q, f: face };
  const dice = r.mode === "bid" || r.mode === "reveal" ? (r.shown ?? allDice(keys)) : null;
  const keyless = r.seats.filter((p) => !keys[p]);

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">
        Перудо{content.parties > 1 && started ? ` · партия ${r.party} из ${content.parties}` : ""}
        {r.round > 0 ? ` · раунд ${r.round}` : ""}
        {r.palifico && r.mode === "bid" ? " · ПАЛИФИКО" : ""}
        {started && r.seats.length > 0 ? ` · стаканов ${aliveCups(r).length}, костей ${total}` : ""}
      </p>

      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : !started ? (
        <p className="muted">За стол садятся до 10 стаканов по порядку входа (в командах стакан у капитана). Свои кости каждый видит на телефоне, вы — все. Ставки идут с телефонов; за стакан без телефона ставите вы.</p>
      ) : r.mode === "deal" ? (
        <div className="card stack stack--tight">
          <p>
            Стаканы готовы: {Object.keys(keys).length} из {r.seats.length}
          </p>
          {keyless.length > 0 && <p className="muted small">Без телефона ({keyless.map(name).join(", ")}) — их кости увидите здесь и скажете им тихо, ставки введёте сами.</p>}
          {r.waiting.length > 0 && <p className="muted small">Не поместились за стол (больше 10): {r.waiting.map(name).join(", ")} — сыграют в следующей партии.</p>}
        </div>
      ) : (
        <div className="card stack stack--tight">
          {r.mode === "bid" && (
            <p>
              {r.bid ? (
                <>
                  Ставка: <b>{bidText(r.bid)}</b> — <NameText name={name(r.bidder)} />.{" "}
                </>
              ) : (
                "Первая ставка раунда. "
              )}
              Ход: <strong><NameText name={name(r.turn)} /></strong>
            </p>
          )}
          {r.call && r.mode !== "bid" && (
            <p>
              «{r.call.kind === "dudo" ? "Не верю!" : "Ровно!"}» — <NameText name={name(r.call.by)} />: на столе {r.call.count} при ставке {bidText(r.call.bid)}.{" "}
              {r.call.loser ? <>Кость теряет <NameText name={name(r.call.loser)} />.</> : r.call.gainer ? <>Кость возвращает <NameText name={name(r.call.gainer)} />.</> : "Без потерь."}
              {r.call.out ? <> Выбывает <NameText name={name(r.call.out)} />.</> : null}
            </p>
          )}
          {r.mode === "over" && r.winner && (
            <p className="success">
              Победитель партии — <NameText name={name(r.winner)} />
            </p>
          )}
          {dice && (
            <details className="quest-host__places" open={peek} onToggle={(e) => setPeek((e.target as HTMLDetailsElement).open)}>
              <summary>Кости всех стаканов (только вам)</summary>
              <ul className="pr-host__dice">
                {r.seats.map((p) => (
                  <li key={p}>
                    <span className="line-clamp">
                      <NameText name={name(p)} />
                      {!keys[p] ? " · без телефона" : ""}
                    </span>
                    <span className="pr-host__row">{(dice[p] ?? []).map((d, i) => <Die key={i} face={d} />)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {r.mode === "bid" && stage === "question" && (
        <section className="card stack stack--tight">
          <p className="eyebrow">За стакан «{name(r.turn)}» (если нет телефона)</p>
          <div className="pr-faces">
            {[1, 2, 3, 4, 5, 6].map((f) => {
              const m = minQty(r.bid, f, r.palifico);
              return (
                <button key={f} type="button" className={`pr-face${face === f ? " is-on" : ""}`} aria-pressed={face === f} disabled={m === null || m > total} onClick={() => setFace(f)}>
                  <Die face={f} />
                </button>
              );
            })}
          </div>
          <div className="pr-qty">
            <button type="button" className="btn btn--secondary" disabled={q <= (faceMin ?? 1)} onClick={() => setQty(q - 1)} aria-label="Меньше">
              −
            </button>
            <span className="pr-qty__value">
              {q} × <Die face={face} size="1.2em" />
            </span>
            <button type="button" className="btn btn--secondary" disabled={q >= total} onClick={() => setQty(q + 1)} aria-label="Больше">
              +
            </button>
          </div>
          <button type="button" className="btn btn--secondary btn--block" disabled={busy || faceMin === null || !r.turn} onClick={() => r.turn && void run(placeBid(session, r.turn, hostBid))}>
            Ставка за стакан: {bidText(hostBid)}
          </button>
        </section>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {action === "deal" && (
          <>
            {noPlayers && <p className="muted small">Нужно хотя бы 2 игрока (или команды).</p>}
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || noPlayers} onClick={() => void run(startDeal(session, participants, content))}>
              Собрать стаканы
            </button>
          </>
        )}
        {action === "roll" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(startRound(session, newNonce()))}>
            Бросить кости
          </button>
        )}
        {action === "wait" && r.bid && (
          <>
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void call("dudo")}>
              «Не верю!» за {name(r.turn)}
            </button>
            {content.calza && (
              <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void call("calza")}>
                «Ровно!» за {name(r.turn)}
              </button>
            )}
          </>
        )}
        {action === "nextRound" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(startRound(session, newNonce()))}>
            Следующий раунд{r.palificoNext ? " — Палифико" : ""}
          </button>
        )}
        {action === "nextParty" && (
          <>
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(startDeal(session, participants, content))}>
              Партия {r.party + 1} из {content.parties}: собрать стаканы
            </button>
            <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => confirm({ title: "Закончить игру?", text: "Сразу награждение по общему счёту.", confirmLabel: "К награждению", run: () => run(awardNow(session)) })}>
              Закончить и наградить
            </button>
          </>
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
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || back === null} onClick={() => back && void run(back.change, back.clearAnswers)}>
          Назад
        </button>
      </div>
      {dialog}
    </div>
  );
}
