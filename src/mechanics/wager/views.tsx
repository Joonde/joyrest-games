// «Держи пари»: экран зала (вопрос, поле догадок с коэффициентами и фишками, ответ и выплаты) и телефон капитана
// (догадка числом, две фишки на поле и свои очки сверху).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { NameText } from "../../components/NameText";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import { teamColorVar } from "../../themes/registry";
import type { PlayerViewProps, ViewProps } from "../types";
import { cleanNumber, formatNumber, LOW_ODDS, WAGER_LIMITS, type Slot, type WagerContent } from "./content";
import { parseWagerResult, type Bet, type WagerResult } from "./logic";

export type WagerAnswerValue = { guess: number } | { bets: Bet[] };

const nameOf = (session: Session, p: string) => session.leaderboard[p]?.name ?? "";
const valueLabel = (n: number, unit: string) => `${formatNumber(n)}${unit ? ` ${unit}` : ""}`;
const teamColor = (session: Session, p: string): CSSProperties | undefined => {
  const color = teamColorVar(session.leaderboard[p]?.colorIndex);
  return color ? ({ "--team-color": color } as CSSProperties) : undefined;
};

function Timer({ left }: { left: number | null }) {
  if (left === null) return null;
  return <span className={left === 0 ? "quiz-screen__timer is-over" : "quiz-screen__timer"}>{left}</span>;
}

/** Поле: «меньше всех» слева, дальше догадки по возрастанию. На экране зала и (компактно) на пульте. */
export function WagerBoard({ session, content, r, compact = false }: { session: Session; content: WagerContent; r: WagerResult; compact?: boolean }) {
  const question = content.questions[r.q];
  const unit = question?.unit ?? "";
  const cells: Array<{ slot: number; s: Slot | null }> = [{ slot: -1, s: null }, ...r.slots.map((s, i) => ({ slot: i, s }))];
  return (
    <ol className={compact ? "wager-board wager-board--compact" : "wager-board"} aria-label="Поле ставок">
      {cells.map(({ slot, s }) => {
        const chips = r.chips[String(slot)] ?? 0;
        const win = r.win === slot;
        const lost = r.win !== null && !win;
        return (
          <li key={slot} className={`wager-slot${slot === -1 ? " wager-slot--low" : ""}${win ? " is-win" : ""}${lost ? " is-lost" : ""}`}>
            <span className="wager-slot__odds">{slot === -1 ? LOW_ODDS : s?.odds}:1</span>
            <span className="wager-slot__value">{slot === -1 ? "Меньше всех" : valueLabel(s?.value ?? 0, unit)}</span>
            {s && !compact && (
              <span className="wager-slot__authors">
                {s.authors.map((a) => (
                  <span key={a} className="wager-slot__author" style={teamColor(session, a)}>
                    <NameText name={nameOf(session, a)} />
                  </span>
                ))}
              </span>
            )}
            <span className="wager-slot__chips" aria-label={`Фишек: ${chips}`}>
              {Array.from({ length: Math.min(chips, 12) }, (_, i) => (
                <span key={i} className="wager-chip" />
              ))}
              {chips > 12 && <span className="wager-slot__more">+{chips - 12}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function WagerScreenView({ session, content }: ViewProps<WagerContent>) {
  const r = parseWagerResult(session.state.result);
  const { stage } = session.state;
  const question = content.questions[r.q];
  const now = useServerNow(250, stage === "question");
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const total = Object.keys(session.leaderboard).length;

  const previous = useRef(`${r.q}:${r.mode}:${stage}`);
  useEffect(() => {
    const key = `${r.q}:${r.mode}:${stage}`;
    if (previous.current !== key) {
      if (r.mode === "bet" && stage === "question") playSound("whoosh");
      if (r.mode === "answer") playSound(r.win === -1 ? "gong" : "fanfare");
    }
    previous.current = key;
  }, [r.q, r.mode, stage, r.win]);

  if (stage === "ready" || !question) {
    return (
      <div className="wager-screen wager-screen--intro">
        <p className="wager-screen__brand">Держи пари</p>
        <h2 className="wager-screen__title">
          Вопрос {r.q + 1} из {content.questions.length}
        </h2>
        <p className="wager-screen__lead">Ответ — всегда число. Не знаете точно? Ставьте на того, кто знает!</p>
      </div>
    );
  }

  if (r.mode === "guess") {
    return (
      <div className="wager-screen">
        <div className="wager-screen__top">
          <span className="quiz-screen__badge">Вопрос {r.q + 1} из {content.questions.length}</span>
          <Timer left={left} />
        </div>
        <h2 className="wager-screen__question">{question.text}</h2>
        <p className="wager-screen__lead">
          Напишите число на телефоне капитана{question.unit ? ` (в «${question.unit}»)` : ""}
        </p>
        <p className="wager-screen__count">
          Догадки: <b>{r.guessed.length}</b> из {total}
        </p>
        <ul className="wager-guessed">
          {Object.keys(session.leaderboard).map((p) => (
            <li key={p} className={r.guessed.includes(p) ? "is-done" : ""} style={teamColor(session, p)}>
              <NameText name={nameOf(session, p)} />
              {r.guessed.includes(p) ? " ✓" : ""}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const winSlot = r.win !== null ? (r.win === -1 ? null : r.slots[r.win]) : null;
  const gains = Object.entries(r.payouts).sort((a, b) => b[1] - a[1]);
  return (
    <div className={r.mode === "answer" ? "wager-screen wager-screen--answer" : "wager-screen"}>
      <div className="wager-screen__top">
        <span className="quiz-screen__badge">Вопрос {r.q + 1} из {content.questions.length}</span>
        {r.mode === "bet" ? <span className="wager-screen__hint">Ставьте фишки на ответ, который ближе всех, но не больше правды</span> : null}
        <Timer left={left} />
      </div>
      <h2 className="wager-screen__question wager-screen__question--small">{question.text}</h2>
      {r.mode === "answer" && (
        <div className="wager-answer">
          <span className="wager-answer__label">Правильный ответ</span>
          <span className="wager-answer__value">{valueLabel(question.answer, question.unit)}</span>
          <span className="wager-answer__win">
            {r.win === -1 ? `Все догадки больше — выиграла ячейка «Меньше всех» ${LOW_ODDS}:1` : winSlot ? `Ближе всех: ${valueLabel(winSlot.value, question.unit)} · ${winSlot.odds}:1` : ""}
          </span>
          {question.note && <span className="wager-answer__note">{question.note}</span>}
        </div>
      )}
      <WagerBoard session={session} content={content} r={r} />
      {r.mode === "answer" && gains.length > 0 && (
        <ul className="wager-gains">
          {gains.map(([p, n]) => (
            <li key={p} className={n > 0 ? "is-plus" : "is-minus"} style={teamColor(session, p)}>
              <NameText name={nameOf(session, p)} /> <b>{n > 0 ? `+${n}` : `−${-n}`}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function WagerPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<WagerContent, WagerAnswerValue>) {
  const r = parseWagerResult(session.state.result);
  const { stage, step } = session.state;
  const question = content.questions[r.q];
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const me = session.leaderboard[pid];
  const canAnswer = role !== "member";
  const head = (
    <p className="eyebrow">
      Держи пари{question ? ` · вопрос ${r.q + 1} из ${content.questions.length}` : ""}
      {me ? ` · ${pointsLabel(me.score)}` : ""}
      {left !== null ? ` · ${left} с` : ""}
    </p>
  );

  if (stage === "ready" || !question) {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Смотрите на экран</h2>
        <p className="muted">Сейчас будет вопрос. Ответ — число: пишите свою догадку, потом ставьте фишки на самую точную.</p>
      </div>
    );
  }

  if (r.mode === "guess") {
    const sent = cleanNumber(rec(myAnswer?.value).guess);
    return (
      <div className="quiz-phone">
        {head}
        <h2 className="wager-phone__question">{question.text}</h2>
        {canAnswer ? (
          <GuessForm key={step} unit={question.unit} sent={sent} disabled={!open || sending} onSend={(guess) => onAnswer({ guess })} />
        ) : (
          <p className="muted">Капитан пишет догадку команды. Подсказывайте ему!</p>
        )}
        {!open && <p className="muted">Время вышло — ждём поле ставок.</p>}
      </div>
    );
  }

  if (r.mode === "bet") {
    const sent = Array.isArray(rec(myAnswer?.value).bets) ? (rec(myAnswer?.value).bets as Bet[]) : null;
    return (
      <div className="quiz-phone">
        {head}
        <p className="muted small">{question.text}</p>
        {canAnswer ? (
          <BetForm key={step} session={session} content={content} r={r} pid={pid} sent={sent} disabled={!open || sending} onSend={(bets) => onAnswer({ bets })} />
        ) : (
          <>
            <p className="muted">Капитан ставит фишки команды. Поле — на экране.</p>
            <WagerBoard session={session} content={content} r={r} compact />
          </>
        )}
        {!open && <p className="muted">Ставки приняты — смотрите на экран.</p>}
      </div>
    );
  }

  const mine = r.payouts[pid] ?? 0;
  return (
    <div className="quiz-phone quiz-phone--center">
      {head}
      <p className="muted">Правильный ответ</p>
      <h2 className="wager-phone__answer">{valueLabel(question.answer, question.unit)}</h2>
      <div className={mine > 0 ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
        <strong>{mine > 0 ? `+${mine} очков!` : mine < 0 ? `−${-mine} очков` : "Без изменений"}</strong>
        <span>{mine > 0 ? "Ставка сыграла" : "Следующий вопрос — новый шанс"}</span>
      </div>
    </div>
  );
}

function GuessForm({ unit, sent, disabled, onSend }: { unit: string; sent: number | null; disabled: boolean; onSend: (guess: number) => void }) {
  const [text, setText] = useState(sent !== null ? String(sent).replace(".", ",") : "");
  const value = cleanNumber(text);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (value !== null) onSend(value);
      }}
    >
      <label className="field">
        Ваша догадка{unit ? `, ${unit}` : ""}
        <input type="text" inputMode="decimal" autoComplete="off" value={text} disabled={disabled} placeholder="Например, 1250" onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="submit" className="btn btn--block" disabled={disabled || value === null || value === sent}>
        {sent === null ? "Отправить" : value === sent ? "Отправлено ✓" : "Исправить"}
      </button>
      {sent !== null && <p className="muted small">Догадка: {formatNumber(sent)}. Можно исправить, пока идёт время.</p>}
    </form>
  );
}

function BetForm({
  session,
  content,
  r,
  pid,
  sent,
  disabled,
  onSend,
}: {
  session: Session;
  content: WagerContent;
  r: WagerResult;
  pid: string;
  sent: Bet[] | null;
  disabled: boolean;
  onSend: (bets: Bet[]) => void;
}) {
  const [bets, setBets] = useState<Bet[]>(sent ?? []);
  const unit = content.questions[r.q]?.unit ?? "";
  const score = Math.max(0, session.leaderboard[pid]?.score ?? 0);
  const stakeSum = bets.reduce((s, b) => s + b.stake, 0);
  const cells: Array<{ slot: number; label: string; odds: number }> = [
    { slot: -1, label: "Меньше всех", odds: LOW_ODDS },
    ...r.slots.map((s, i) => ({ slot: i, label: valueLabel(s.value, unit), odds: s.odds })),
  ];
  const labelOf = (slot: number) => cells.find((c) => c.slot === slot)?.label ?? "";
  const same = sent !== null && JSON.stringify(sent) === JSON.stringify(bets);

  return (
    <div className="stack">
      <p className="small">
        Коснитесь ответа, который ближе всех, но <b>не больше</b> правды. У вас {WAGER_LIMITS.chips} фишки: каждая на верном ответе — {content.chipPoints} × коэффициент.
      </p>
      <ul className="wager-pick">
        {cells.map((c) => {
          const n = bets.filter((b) => b.slot === c.slot).length;
          return (
            <li key={c.slot}>
              <button
                type="button"
                className={n > 0 ? "wager-pick__btn is-on" : "wager-pick__btn"}
                disabled={disabled || bets.length >= WAGER_LIMITS.chips}
                onClick={() => setBets([...bets, { slot: c.slot, stake: 0 }])}
              >
                <span className="wager-pick__odds">{c.odds}:1</span>
                <span className="wager-pick__value">{c.label}</span>
                {n > 0 && <span className="wager-pick__chips">{"●".repeat(n)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {bets.map((b, i) => (
        <div key={i} className="wager-bet">
          <span className="wager-bet__label">
            Фишка {i + 1}: <b>{labelOf(b.slot)}</b>
          </span>
          {content.stakes && score > 0 && (
            <label className="field wager-bet__stake">
              Свои очки сверху (угадали — ×{cells.find((c) => c.slot === b.slot)?.odds ?? 1}, нет — сгорят)
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={score}
                value={b.stake || ""}
                placeholder="0"
                disabled={disabled}
                onChange={(e) => {
                  const want = Math.max(0, Math.round(Number(e.target.value) || 0));
                  const room = score - (stakeSum - b.stake);
                  setBets(bets.map((x, j) => (j === i ? { ...x, stake: Math.min(want, room) } : x)));
                }}
              />
            </label>
          )}
          <button type="button" className="btn btn--quiet" disabled={disabled} onClick={() => setBets(bets.filter((_, j) => j !== i))}>
            Убрать фишку
          </button>
        </div>
      ))}
      <button type="button" className="btn btn--block" disabled={disabled || bets.length === 0 || same} onClick={() => onSend(bets)}>
        {same ? "Ставки приняты ✓" : sent ? "Изменить ставки" : "Поставить"}
      </button>
      {content.stakes && score > 0 && <p className="muted small">Ваши очки: {score}. Свои очки сверху — по желанию.</p>}
    </div>
  );
}
