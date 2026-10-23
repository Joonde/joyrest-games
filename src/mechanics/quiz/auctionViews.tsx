// «Аукцион» в квизе: заставка и ставки на экране зала, ставка и ответ на телефоне, панель пульта.
import { useState, type FormEvent } from "react";
import { NameText } from "../../components/NameText";
import { useServerNow } from "../../components/live/useServerNow";
import { DRAW_EFFECTS, type DrawEffect } from "../../core/draw";
import { pointsLabel } from "../../core/results";
import type { Answer, Session } from "../../data/types";
import type { PhoneRole } from "../types";
import { auctionBets, auctionMax, isAuctionDraw, parseBet } from "./auction";
import { correctSet, LIMITS, usesAnswers, type QuizQuestion } from "./content";
import type { AuctionState } from "./logic";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function nameIn(session: Session, pid: string | null): string {
  return (pid && session.leaderboard[pid]?.name) || "Игрок";
}

/** Жребий ещё крутится (до остановки — не выдаём, кто отвечает). */
export function useDrawSpinning(session: Session): boolean {
  const slide = session.state.slide;
  const spinning = isAuctionDraw(session) && typeof slide?.endsAt === "number";
  const now = useServerNow(250, spinning);
  return spinning && now < (slide?.endsAt ?? 0);
}

/** Сумма со знаком: «+300» / «−300». */
export function signed(n: number): string {
  return n > 0 ? `+${pointsLabel(n)}` : n < 0 ? `−${pointsLabel(-n)}` : "0";
}

// ---------------------------------------------------------------- экран зала

/** Заставка «Аукцион!» (до ставок) и сами ставки: тема крупно, кто уже поставил. */
export function AuctionScreenSplash({
  session,
  q,
  auction,
  left,
  counter,
}: {
  session: Session;
  q: QuizQuestion;
  auction: AuctionState | undefined;
  left: number | null;
  counter: string;
}) {
  const betting = session.state.stage === "question" && auction?.phase === "bets";
  const topic = q.topic?.trim();
  return (
    <div className="quiz-screen quiz-screen--intro quiz-auction">
      <div className="quiz-auction__top">
        <span className="quiz-screen__counter">{counter}</span>
        <span className="quiz-screen__badge">Аукцион</span>
        {betting && (
          <span className={left === 0 ? "quiz-screen__timer is-over" : "quiz-screen__timer"} role="timer">
            {left === null ? (q.betTime ?? 30) : left === 0 ? "Стоп" : left}
          </span>
        )}
      </div>
      <h2 className="quiz-screen__intro quiz-auction__title">{betting ? "Делайте ставки!" : "Аукцион!"}</h2>
      <p className="quiz-auction__topic">
        {topic ? (
          <>
            <span className="quiz-auction__topic-label">Тема</span> {topic}
          </>
        ) : (
          "Тема скрыта"
        )}
      </p>
      {betting ? (
        <>
          <p className="quiz-screen__hint">
            Ставки: <strong>{auction.placed.length}</strong> · отвечает тот, кто поставит больше всех
          </p>
          {auction.placed.length > 0 && auction.placed.length <= 24 && (
            <ul className="quiz-auction__placed" aria-label="Кто поставил">
              {auction.placed.map((pid) => (
                <li key={pid}>
                  <NameText name={nameIn(session, pid)} />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="quiz-screen__hint">Ставите очки — отвечает тот, кто поставит больше всех. Верно — плюс ставка, ошибка — минус</p>
      )}
    </div>
  );
}

/** Плашка над вопросом: кто отвечает и за сколько; после ответа — «+300» / «−300». */
export function AuctionScreenPlate({ session, auction }: { session: Session; auction: AuctionState }) {
  const revealed = session.state.stage === "reveal";
  if (auction.phase === "all") {
    return <span className="quiz-auction__plate">Ставок нет — отвечают все</span>;
  }
  if (auction.phase !== "answer" || !auction.who) return null;
  const last = session.leaderboard[auction.who]?.last ?? 0;
  return (
    <span className={revealed ? `quiz-auction__plate ${last >= 0 ? "is-right" : "is-wrong"}` : "quiz-auction__plate"}>
      Отвечает <strong>{<NameText name={nameIn(session, auction.who)} />}</strong> · ставка {pointsLabel(auction.bet)}
      {revealed && <span className="quiz-auction__delta">{signed(last)}</span>}
    </span>
  );
}

// ---------------------------------------------------------------- телефон

/** Телефон во время ставок: максимум, быстрые суммы, своё число. */
export function AuctionBetForm({
  session,
  q,
  pid,
  role,
  mine,
  open,
  left,
  sending,
  onBet,
}: {
  session: Session;
  q: QuizQuestion;
  pid: string;
  role: PhoneRole;
  mine: number | null;
  open: boolean;
  left: number | null;
  sending: boolean;
  onBet: (bet: number) => void;
}) {
  const score = session.leaderboard[pid]?.score ?? 0;
  const max = auctionMax(score, q);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const quick = [...new Set([Math.round(max / 4), Math.round(max / 2), max].filter((n) => n >= 1))];
  const topic = q.topic?.trim();
  const showForm = role !== "member" && open && (mine === null || editing);
  function submit(event: FormEvent) {
    event.preventDefault();
    const n = Math.round(Number(value.replace(/\s/g, "")));
    if (!Number.isFinite(n) || n < 1) return;
    onBet(Math.min(max, n));
    setEditing(false);
  }
  return (
    <div className="quiz-phone quiz-phone--center quiz-auction-phone">
      <p className="eyebrow">Аукцион · делайте ставки</p>
      <h2 className="quiz-phone__question">{topic ? `Тема: ${topic}` : "Тема скрыта"}</h2>
      <p className="muted small">Отвечает тот, кто поставит больше всех. Верно — плюс ставка, ошибка — минус.</p>
      {role === "member" ? (
        <div className="buzz__plate" role="status">
          <strong>Ставит ваш капитан</strong>
          <span>{mine !== null ? `Ставка команды: ${pointsLabel(mine)}` : "Подскажите ему, сколько поставить"}</span>
        </div>
      ) : showForm ? (
        <form className="stack" onSubmit={submit}>
          <p>
            Можно поставить до <strong>{pointsLabel(max)}</strong>
          </p>
          <div className="pick-chips quiz-auction-phone__quick">
            {quick.map((n) => (
              <button key={n} type="button" className="pick-chip" disabled={sending} onClick={() => (onBet(n), setEditing(false))}>
                {n === max ? `Всё: ${n}` : n}
              </button>
            ))}
          </div>
          <label className="field">
            Своя ставка
            <input inputMode="numeric" pattern="[0-9]*" value={value} maxLength={7} autoComplete="off" enterKeyHint="send" onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))} />
          </label>
          <button className="btn btn--block" type="submit" disabled={sending || !value}>
            Поставить
          </button>
        </form>
      ) : mine !== null ? (
        <div className="stack">
          <p className="quiz-phone__verdict">Ставка принята: {pointsLabel(mine)}</p>
          {open && (
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setEditing(true)}>
              Изменить ставку
            </button>
          )}
        </div>
      ) : (
        <p className="muted">Время ставок вышло</p>
      )}
      <p className="quiz-phone__status muted" aria-live="polite">
        {open && left !== null ? `Осталось ${left} с` : ""}
      </p>
    </div>
  );
}

/** Телефон, когда отвечает не он: кто отвечает и за сколько (жребий ещё крутится — не выдаём). */
export function AuctionWatch({ session, auction, spinning, noScreen }: { session: Session; auction: AuctionState; spinning: boolean; noScreen: boolean }) {
  if (spinning) {
    return (
      <div className="quiz-phone quiz-phone--center">
        <p className="eyebrow">Аукцион</p>
        <h2 className="quiz-phone__question">Ставки равны — жребий!</h2>
        <p className="muted">{noScreen ? "Ведущий скажет, кому выпало." : "Смотрите на экран зала."}</p>
      </div>
    );
  }
  return (
    <div className="quiz-phone quiz-phone--center">
      <p className="eyebrow">Аукцион</p>
      <h2 className="quiz-phone__question">
        Отвечает <NameText name={nameIn(session, auction.who)} />
      </h2>
      <p>Ставка: {pointsLabel(auction.bet)}</p>
      <p className="muted">{noScreen ? "Слушайте вопрос у ведущего." : "Вопрос — на экране зала."}</p>
    </div>
  );
}

// ---------------------------------------------------------------- пульт

/** Пульт: тема, ставки, эффект жребия, кто отвечает. */
export function AuctionHostPanel({
  session,
  q,
  auction,
  answers,
  expected,
  effect,
  onEffect,
  rehearsal,
}: {
  session: Session;
  q: QuizQuestion;
  auction: AuctionState | undefined;
  answers: Answer[];
  expected: number;
  effect: DrawEffect;
  onEffect: (e: DrawEffect) => void;
  rehearsal: boolean;
}) {
  const { stage } = session.state;
  const betting = stage === "question" && auction?.phase === "bets";
  const bets = betting ? auctionBets(session, q, answers).sort((a, b) => b.bet - a.bet) : [];
  const mine = auction?.who ? answers.find((a) => a.pid === auction.who && parseBet(a.value) === null) : undefined;
  return (
    <section className="stack stack--tight quiz-auction-host" aria-label="Аукцион">
      <p className="small">
        Тема: <strong>{q.topic?.trim() || "скрыта"}</strong> · ставка до своего счёта (у кого меньше — до {pointsLabel(q.points)})
      </p>
      {stage === "ready" && <p className="muted small">«Открыть ставки» — гости ставят очки на телефонах ({q.betTime ?? 30} с). Сам вопрос на экране появится после ставок.</p>}
      {betting && (
        <>
          <p className="small">
            Ставок: <strong>{bets.length}</strong>
            {!rehearsal && ` из ${expected}`}
          </p>
          {bets.length > 0 && (
            <ul className="buzz-queue buzz-queue--plain">
              {bets.map((b) => (
                <li key={b.pid}>
                  <span className="buzz-queue__name">
                    <NameText name={nameIn(session, b.pid)} />
                  </span>
                  <span className="buzz-queue__state">{pointsLabel(b.bet)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Ставки равны у нескольких — жребий на экране:</p>
          <div className="pick-chips" role="radiogroup" aria-label="Эффект жребия">
            {DRAW_EFFECTS.map((f) => (
              <button key={f.id} type="button" className="pick-chip" role="radio" aria-checked={effect === f.id} aria-pressed={effect === f.id} title={f.hint} onClick={() => onEffect(f.id)}>
                {f.title}
              </button>
            ))}
          </div>
          <p className="muted small">Ставок нет — вопрос для всех за {pointsLabel(q.points)}.</p>
        </>
      )}
      {auction?.phase === "answer" && auction.who && stage !== "ready" && (
        <div className="host-buzz" role="status">
          <span className="host-buzz__label">Отвечает на телефоне</span>
          <span className="host-buzz__name">
            <NameText name={nameIn(session, auction.who)} />
          </span>
          <span className="small">
            Ставка {pointsLabel(auction.bet)}
            {auction.tie.length > 1 ? ` · жребий среди ${auction.tie.length} равных ставок` : ""}
          </span>
          {stage === "question" && <span className="small">{mine ? `Ответил: ${answerText(q, mine.value)}` : "Ждём ответ…"}</span>}
          {stage === "reveal" && <span className="small">{signed(session.leaderboard[auction.who]?.last ?? 0)}</span>}
        </div>
      )}
      {auction?.phase === "all" && stage !== "ready" && <p className="small">Ставок не было — отвечают все за {pointsLabel(q.points)}.</p>}
    </section>
  );
}

function answerText(q: QuizQuestion, value: unknown): string {
  if (typeof value === "number") return `${LETTERS[value] ?? "?"}. ${q.options[value] ?? ""}${correctSet(q).includes(value) ? " ✓" : ""}`;
  return typeof value === "string" ? value.slice(0, LIMITS.answer) : "—";
}

/** Отвечает ли этот телефон (аукцион: только выигравший ставку; без ставок — все). */
export function auctionMyTurn(auction: AuctionState | undefined, pid: string): boolean {
  if (!auction) return false;
  return auction.phase === "all" || (auction.phase === "answer" && auction.who === pid);
}

export function auctionWritesText(q: QuizQuestion): boolean {
  return usesAnswers(q);
}
