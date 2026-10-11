// «Перудо»: экран зала (стол со стаканами, ставка крупно, вскрытие) и телефон (свои кости, ставка, «Не верю!»).
import { useEffect, useMemo, useState } from "react";
import { NameText } from "../../components/NameText";
import { playSound } from "../../components/live/sound";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { newKey } from "../mafia/seal";
import type { PerudoContent } from "./content";
import { diceOf, storeCupKey, storedCupKey } from "./dice";
import { bidText, diceWord } from "./text";
import { aliveCups, minQty, parsePerudoResult, totalDice, type Bid, type PerudoAnswerValue, type PerudoResult } from "./logic";


const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

/** Кость: грань с точками; 1 — «пако» (джокер) с золотой меткой; null — закрытая. */
export function Die({ face, hit, size, className }: { face: number | null; hit?: boolean; size?: string; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`pr-die${face === 1 ? " is-paco" : ""}${face === null ? " is-hidden" : ""}${hit ? " is-hit" : ""}${className ? ` ${className}` : ""}`} style={size ? { width: size, height: size } : undefined} aria-label={face ? `кость ${face}` : "закрытая кость"} role="img">
      <rect x="4" y="4" width="92" height="92" rx="20" className="pr-die__body" />
      {face === null ? (
        <text x="50" y="64" textAnchor="middle" className="pr-die__q">
          ?
        </text>
      ) : face === 1 ? (
        <>
          <circle cx="50" cy="50" r="17" className="pr-die__paco" />
          <path d="M50 38 L54 47 L63 47 L56 53 L59 62 L50 56 L41 62 L44 53 L37 47 L46 47 Z" className="pr-die__star" />
        </>
      ) : (
        (PIPS[face] ?? []).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="9" className="pr-die__pip" />)
      )}
    </svg>
  );
}

const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "Игрок") : "");

/** Кость засчитывается в ставку при вскрытии. */
const hits = (d: number, r: PerudoResult) => !!r.call && (d === r.call.bid.f || (!r.palifico && r.call.bid.f !== 1 && d === 1));

function Cups({ session, r }: { session: Session; r: PerudoResult }) {
  return (
    <ul className="pr-cups">
      {r.seats.map((pid) => {
        const n = r.dice[pid] ?? 0;
        const shown = r.shown?.[pid];
        const turn = r.mode === "bid" && r.turn === pid;
        const lost = r.call && (r.call.loser === pid || r.call.gainer === pid);
        return (
          <li key={pid} className={`pr-cup${turn ? " is-turn" : ""}${n === 0 ? " is-out" : ""}${lost ? (r.call?.loser === pid ? " is-lost" : " is-gained") : ""}`}>
            <span className="pr-cup__name">
              <NameText name={nameOf(session, pid)} />
            </span>
            <span className="pr-cup__dice">
              {shown && shown.length > 0
                ? shown.map((d, i) => <Die key={i} face={d} hit={hits(d, r)} />)
                : n > 0
                  ? Array.from({ length: n }, (_, i) => <Die key={i} face={null} />)
                  : <span className="pr-cup__out">выбыл</span>}
            </span>
            {lost && <span className="pr-cup__mark">{r.call?.loser === pid ? "−1 кость" : "+1 кость"}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function PerudoScreenView({ session, content }: ViewProps<PerudoContent>) {
  const started = session.state.result !== null && session.state.result !== undefined;
  const r = parsePerudoResult(session.state.result);
  const key = `${r.round}:${r.mode}:${r.history.length}`;
  const [seen, setSeen] = useState(key);
  useEffect(() => {
    if (key === seen) return;
    setSeen(key);
    if (r.mode === "bid" && r.history.length === 0) playSound("dice");
    else if (r.mode === "bid") playSound("tick");
    else if (r.mode === "reveal") playSound(r.call?.ok ? "correct" : "wrong");
    else if (r.mode === "over") playSound("fanfare");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- звук только на смену момента
  }, [key]);

  let main;
  if (!started || r.seats.length === 0) {
    main = (
      <div className="pr-intro">
        <span className="quiz-screen__badge">Перудо · кости лжеца</span>
        <h2 className="pr-title">Скоро стаканы на стол</h2>
        <p className="pr-note">У каждого {content.startDice} костей под стаканом — видите только свои, на телефоне. Ставьте, сколько на столе костей одной грани. Не верите — «Не верю!». Единицы — джокеры.</p>
      </div>
    );
  } else if (r.mode === "deal") {
    main = (
      <div className="pr-intro">
        <span className="quiz-screen__badge">{content.parties > 1 ? `Партия ${r.party} из ${content.parties}` : "Перудо"}</span>
        <h2 className="pr-title">Стаканы на стол!</h2>
        <p className="pr-note">Свои кости увидите на телефоне. Держите его так, чтобы соседи не подглядели.</p>
      </div>
    );
  } else if (r.mode === "bid") {
    main = (
      <div className="pr-bid">
        <span className="quiz-screen__badge">
          Раунд {r.round}
          {r.palifico ? " · ПАЛИФИКО" : ""} · на столе {diceWord(totalDice(r))}
        </span>
        {r.bid ? (
          <div className="pr-bid__now" key={r.history.length}>
            <span className="pr-bid__who">
              <NameText name={nameOf(session, r.bidder)} /> ставит:
            </span>
            <span className="pr-bid__value">
              <b>{r.bid.q}</b> × <Die face={r.bid.f} size="1em" />
            </span>
          </div>
        ) : (
          <div className="pr-bid__now">
            <span className="pr-bid__who">Первая ставка раунда</span>
          </div>
        )}
        <p className="pr-turn">
          Ход: <NameText name={nameOf(session, r.turn)} /> — поднять ставку{r.bid ? " или «Не верю!»" : ""}
        </p>
        {r.palifico && <p className="pr-note">Палифико: единицы не джокеры, грань не меняется — только больше костей.</p>}
      </div>
    );
  } else {
    const c = r.call;
    main = (
      <div className="pr-bid">
        <span className="quiz-screen__badge">{r.mode === "over" ? "Итог партии" : `Вскрытие · раунд ${r.round}`}</span>
        {c && (
          <>
            <p className="pr-turn">
              <NameText name={nameOf(session, c.by)} />: «{c.kind === "dudo" ? "Не верю!" : "Ровно!"}» на ставку <b>{bidText(c.bid)}</b>
            </p>
            <div className="pr-bid__now">
              <span className="pr-bid__value">
                на столе <b>{c.count}</b> × <Die face={c.bid.f} size="1em" />
              </span>
            </div>
            <p className={`pr-verdict${c.ok ? " is-ok" : " is-no"}`}>
              {c.kind === "dudo"
                ? c.ok
                  ? "Ставка честная!"
                  : "Блеф раскрыт!"
                : c.ok
                  ? "Ровно — в точку!"
                  : "Не ровно!"}{" "}
              {c.loser ? (
                <>
                  Кость теряет <NameText name={nameOf(session, c.loser)} />
                </>
              ) : c.gainer ? (
                <>
                  <NameText name={nameOf(session, c.gainer)} /> возвращает кость
                </>
              ) : (
                "Никто не теряет кость"
              )}
              {c.out ? (
                <>
                  {" "}
                  · <NameText name={nameOf(session, c.out)} /> выбывает
                </>
              ) : null}
            </p>
          </>
        )}
        {r.mode === "over" && r.winner && (
          <p className="pr-winner" data-shine="on">
            Победитель — <NameText name={nameOf(session, r.winner)} />!
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="pr-screen">
      <section className="pr-screen__main">{main}</section>
      {started && r.seats.length > 0 && (
        <section className="pr-screen__table" aria-label="Стаканы">
          <Cups session={session} r={r} />
        </section>
      )}
    </div>
  );
}

/** Ставка на телефоне: грань и количество — только допустимые. */
function BidForm({ r, sending, onBid }: { r: PerudoResult; sending: boolean; onBid: (b: Bid) => void }) {
  const total = totalDice(r);
  const faces = [1, 2, 3, 4, 5, 6].filter((f) => {
    const m = minQty(r.bid, f, r.palifico);
    return m !== null && m <= total;
  });
  const [face, setFace] = useState<number>(() => faces.find((f) => f !== 1) ?? faces[0] ?? 2);
  const min = minQty(r.bid, face, r.palifico) ?? 1;
  const [qty, setQty] = useState(min);
  const q = Math.min(total, Math.max(min, qty));
  if (faces.length === 0) return <p className="muted">Поднять ставку уже нельзя — только «Не верю!».</p>;
  return (
    <div className="stack stack--tight">
      <p className="muted small">Грань</p>
      <div className="pr-faces">
        {faces.map((f) => (
          <button key={f} type="button" className={`pr-face${face === f ? " is-on" : ""}`} aria-pressed={face === f} onClick={() => setFace(f)}>
            <Die face={f} />
          </button>
        ))}
      </div>
      <div className="pr-qty">
        <button type="button" className="btn btn--secondary" disabled={q <= min} onClick={() => setQty(q - 1)} aria-label="Меньше">
          −
        </button>
        <span className="pr-qty__value">
          {q} × <Die face={face} size="1.2em" />
        </span>
        <button type="button" className="btn btn--secondary" disabled={q >= total} onClick={() => setQty(q + 1)} aria-label="Больше">
          +
        </button>
      </div>
      <button type="button" className="btn btn--block" disabled={sending} onClick={() => onBid({ q, f: face })}>
        Ставлю: {bidText({ q, f: face })}
      </button>
    </div>
  );
}

export function PerudoPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<PerudoContent, PerudoAnswerValue>) {
  const r = parsePerudoResult(session.state.result);
  const started = session.state.result !== null && session.state.result !== undefined && r.seats.length > 0;
  const seated = r.seats.includes(pid);
  const [key, setKey] = useState<string | null>(() => storedCupKey(session.id, pid));
  const dealing = r.mode === "deal" && seated && session.state.step === r.keysStep && role !== "member";

  // Раздача: телефон сам создаёт ключ стакана и отправляет ведущему.
  useEffect(() => {
    if (!dealing || myAnswer === undefined || sending) return;
    const sent = myAnswer && typeof myAnswer.value === "object" && myAnswer.value !== null ? (myAnswer.value as { key?: unknown }).key : null;
    if (typeof sent === "string" && sent.length >= 16) {
      if (sent !== key) {
        storeCupKey(session.id, pid, sent);
        setKey(sent);
      }
      return;
    }
    if (myAnswer) return;
    try {
      const k = key ?? newKey();
      storeCupKey(session.id, pid, k);
      setKey(k);
      onAnswer({ key: k });
    } catch {
      // Нет криптографии в браузере — кости покажет ведущий.
    }
  }, [dealing, myAnswer, sending]);

  const mine = useMemo(() => (key && r.nonce && (r.dice[pid] ?? 0) > 0 && r.mode !== "deal" ? diceOf(key, r.nonce, r.dice[pid] ?? 0) : null), [key, r.nonce, r.dice[pid], r.mode]);
  const myTurn = r.mode === "bid" && r.turn === pid && role !== "member";
  const sentSeq = myAnswer && typeof myAnswer.value === "object" && myAnswer.value !== null ? (myAnswer.value as { n?: unknown }).n : null;
  const waiting = myTurn && sentSeq === String(r.seq);
  const n = String(r.seq);

  const head = (
    <p className="eyebrow">
      Перудо{content.parties > 1 && started ? ` · партия ${r.party}` : ""}
      {r.round > 0 && r.mode !== "deal" ? ` · раунд ${r.round}` : ""}
      {seated ? ` · у вас ${diceWord(r.dice[pid] ?? 0)}` : ""}
    </p>
  );

  if (!started) {
    return (
      <div className="quiz-phone quiz-phone--center pr-phone">
        {head}
        <h2>Скоро стаканы на стол</h2>
        <p className="muted">Ваши кости придут на этот телефон. Никому не показывайте!</p>
      </div>
    );
  }
  if (!seated) {
    return (
      <div className="quiz-phone quiz-phone--center pr-phone">
        {head}
        <h2>{r.waiting.includes(pid) ? "За столом нет места" : "Партия уже идёт"}</h2>
        <p className="muted">Смотрите на экран — сыграете в следующей партии.</p>
      </div>
    );
  }

  const myDice = mine ? (
    <div className="pr-mine" aria-label="Ваши кости">
      {mine.map((d, i) => (
        <Die key={i} face={d} hit={r.mode !== "bid" && hits(d, r)} />
      ))}
    </div>
  ) : (r.dice[pid] ?? 0) > 0 && r.mode !== "deal" ? (
    <p className="buzz__plate">
      <strong>{role === "member" ? "Кости у капитана" : "Кости не открыть на этом телефоне"}</strong>
      <span>{role === "member" ? "Подсказывайте ему — и следите за экраном" : "Ведущий видит ваши кости — подойдите к нему тихо"}</span>
    </p>
  ) : null;

  if (r.mode === "deal") {
    return (
      <div className="quiz-phone quiz-phone--center pr-phone">
        {head}
        <h2>{role === "member" ? "Стакан у капитана" : myAnswer ? "Стакан готов — ждём бросок" : "Готовим стакан…"}</h2>
      </div>
    );
  }

  if ((r.dice[pid] ?? 0) === 0 && r.mode !== "over") {
    return (
      <div className="quiz-phone quiz-phone--center pr-phone">
        {head}
        <h2>Вы выбыли</h2>
        <p className="muted">Смотрите, кто останется последним, — и не подсказывайте 🤫</p>
      </div>
    );
  }

  if (r.mode === "bid") {
    return (
      <div className="quiz-phone pr-phone">
        {head}
        {myDice}
        <p className="pr-phone__bid">
          {r.bid ? (
            <>
              Ставка: <b>{bidText(r.bid)}</b> — <NameText name={nameOf(session, r.bidder)} />
            </>
          ) : (
            "Ставок пока нет"
          )}
          {r.palifico ? " · Палифико: единицы не джокеры" : ""}
        </p>
        {myTurn ? (
          waiting ? (
            <p className="success">Отправлено — смотрите на экран</p>
          ) : (
            <div className="stack">
              <h2>Ваш ход</h2>
              <BidForm key={r.seq} r={r} sending={sending} onBid={(bid) => onAnswer({ n, bid })} />
              {r.bid && (
                <div className="actions">
                  <button type="button" className="btn btn--secondary btn--block" disabled={sending} onClick={() => onAnswer({ n, dudo: true })}>
                    Не верю! (Dudo)
                  </button>
                  {content.calza && (
                    <button type="button" className="btn btn--quiet btn--block" disabled={sending} onClick={() => onAnswer({ n, calza: true })}>
                      Ровно! (Calza)
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        ) : (
          <p className="muted">
            Ходит <NameText name={nameOf(session, r.turn)} />
          </p>
        )}
      </div>
    );
  }

  const c = r.call;
  return (
    <div className="quiz-phone quiz-phone--center pr-phone">
      {head}
      {myDice}
      {c && (
        <p>
          На столе {c.count} × <Die face={c.bid.f} size="1em" /> при ставке {bidText(c.bid)}.{" "}
          {c.loser === pid ? "Вы теряете кость." : c.gainer === pid ? "Вы возвращаете кость!" : ""}
        </p>
      )}
      {r.mode === "over" && <h2>{r.winner === pid ? "Вы победили! 🏴‍☠️" : <>Победил(а) <NameText name={nameOf(session, r.winner)} /></>}</h2>}
      <p className="muted small">Стаканов в игре: {aliveCups(r).length}</p>
    </div>
  );
}
