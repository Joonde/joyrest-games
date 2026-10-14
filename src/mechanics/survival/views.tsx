// «Гонка на выживание»: на экране зала — дорожки команд (кто впереди по очкам), счётчик раундов, до
// войнушки, билеты 🎟; вопрос или задание раунда, ставки и банк войнушки, аукцион билета.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { isWar, KIND_TITLES, LETTERS, taskWordFor, taskWords, warIndex, type SurvivalContent, type SurvivalRound } from "./content";
import { auctionPending, isWarRound, minBet, parseSurvivalResult, roundNumber, roundOf, TASK_MS, type SurvivalResult } from "./logic";
import { showStageClass } from "../showLook";

export type SurvivalAnswerValue = { choice: number } | { text: string } | { bet: number } | { ticket: true } | { bid: number };

const TEAM_COLORS = ["#E3AA9C", "#E3C68C", "#A3C2AA", "#D2A0AC", "#B3AADD", "#9FC3D6", "#E0B3A0", "#C9C08F"];
const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "") : "");

function colorOf(session: Session, r: SurvivalResult, pid: string): string {
  const index = session.leaderboard[pid]?.colorIndex ?? Math.max(0, r.order.indexOf(pid));
  return TEAM_COLORS[index % TEAM_COLORS.length] ?? "#E3C68C";
}

/** До следующей войнушки: «через 2 раунда» или «сейчас». */
function warNote(content: SurvivalContent, r: SurvivalResult): string {
  const n = roundNumber(r);
  if (isWar(content, n)) return `Войнушка №${warIndex(content, n)}`;
  const next = Math.ceil(n / content.warEvery) * content.warEvery;
  if (next > content.rounds.length) return "Войнушек больше нет";
  const left = next - n;
  return `До войнушки: ${left} ${left === 1 ? "раунд" : left < 5 ? "раунда" : "раундов"}`;
}

/**
 * Длина трассы — сколько очков можно набрать за всю игру (очки всех раундов и призы войнушек), чтобы
 * фишки ехали понемногу, раунд за раундом, а не стояли у финиша с первого ответа.
 */
export function raceGoal(content: SurvivalContent): number {
  let goal = 0;
  content.rounds.forEach((round, i) => {
    const n = i + 1;
    goal += isWar(content, n) ? content.warPrize * warIndex(content, n) : round.points;
  });
  return Math.max(1, goal);
}

/** Гонщик на дорожке: смайлик команды или первая буква. */
function carOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? "?";
  return /\p{Extended_Pictographic}/u.test(first) ? first : first.toUpperCase();
}

/**
 * Болид оформления «Трасса» / «Вечер JoyRest»: вид сбоку, едет вправо. Цвета — классы (`.sv-car__*` в
 * src/styles.css, корпус — цвет команды `--team`), в кабине — «шлем» со смайликом или буквой команды.
 */
function RaceCar({ name }: { name: string }) {
  return (
    <span className="sv-car">
      <svg className="sv-car__body" viewBox="0 0 96 36" aria-hidden="true">
        <path className="sv-car__shadow" d="M8 31h84" />
        <path className="sv-car__paint" d="M5 27V11l11 1 2 4 13-2 10-7h17l7 7 18 3c6 1 10 4 11 9v1z" />
        <path className="sv-car__wing" d="M3 9l14 1v4L4 13z" />
        <path className="sv-car__stripe" d="M10 21h80" />
        <path className="sv-car__glass" d="M45 13l5-4h9l4 4z" />
        <path className="sv-car__nose" d="M84 21l10 3v3h-14z" />
        <circle className="sv-car__tyre" cx="23" cy="27" r="7" />
        <circle className="sv-car__rim" cx="23" cy="27" r="2.6" />
        <circle className="sv-car__tyre" cx="74" cy="27" r="7" />
        <circle className="sv-car__rim" cx="74" cy="27" r="2.6" />
      </svg>
      <span className="sv-car__helmet">{carOf(name)}</span>
    </span>
  );
}

/** Фишка казино с суммой (ставки и банк войнушки в оформлении телешоу). */
function Chip({ amount, big = false }: { amount: number; big?: boolean }) {
  return (
    <span className={big ? "sv-chip sv-chip--big" : "sv-chip"}>
      <span className="sv-chip__n">{amount.toLocaleString("ru-RU")}</span>
    </span>
  );
}

export function RaceLanes({ session, content, result, size = "screen" }: { session: Session; content: SurvivalContent; result: SurvivalResult; size?: "screen" | "phone" }) {
  const scores = result.order.map((p) => session.leaderboard[p]?.score ?? 0);
  const top = Math.max(1, ...scores);
  // Трасса — вся игра: фишки двигаются по делениям раунд за раундом (финиш — максимум очков игры).
  const goal = Math.max(raceGoal(content), top);
  const ranked = [...result.order].sort((a, b) => (session.leaderboard[b]?.score ?? 0) - (session.leaderboard[a]?.score ?? 0));
  // Много команд — дорожки в две-три колонки.
  const cols = size === "phone" ? 1 : ranked.length > 12 ? 3 : ranked.length > 6 ? 2 : 1;
  const segs = Math.max(1, Math.min(30, content.rounds.length));
  // Оформление телешоу («Трасса», «Вечер JoyRest»): болиды, фишки ставок; телефон — всегда простой вид.
  const show = size === "screen" && content.look !== "classic";
  const betsOn = show && isWarRound(content, result) && (result.phase === "war" || result.phase === "reveal");
  // Лидер — единственный с наибольшим счётом больше нуля (лёгкое свечение дорожки).
  const first = ranked[0] ? (session.leaderboard[ranked[0]]?.score ?? 0) : 0;
  const second = ranked[1] ? (session.leaderboard[ranked[1]]?.score ?? 0) : -1;
  const leader = ranked[0] && first > 0 && first > second ? ranked[0] : null;
  return (
    <ol className={`sv-lanes sv-lanes--${size}${cols > 1 ? " sv-lanes--multi" : ""}${cols > 2 ? " sv-lanes--three" : ""}`} aria-label="Гонка по очкам" style={{ ["--cols" as string]: String(cols), ["--segs" as string]: String(segs), ["--war" as string]: String(Math.max(1, content.warEvery)) }}>
      {ranked.map((p) => {
        const score = session.leaderboard[p]?.score ?? 0;
        const share = Math.max(0, Math.min(1, score / goal));
        const tickets = result.tickets[p] ?? 0;
        return (
          <li key={p} className={`sv-lane${p === result.winner ? " is-winner" : ""}${p === leader ? " is-leader" : ""}`} style={{ ["--team" as string]: colorOf(session, result, p), ["--share" as string]: String(share) }}>
            <span className="sv-lane__who">
              <span className="sv-lane__name">
                <NameText name={nameOf(session, p)} />
              </span>
              {tickets > 0 ? <span className="sv-lane__ticket" aria-label={`Билетов: ${tickets}`}>{"🎟".repeat(tickets)}</span> : null}
              {betsOn && p in result.bets ? <Chip amount={result.bets[p] ?? 0} /> : null}
            </span>
            <span className="sv-lane__track">
              <span className="sv-lane__marks" aria-hidden="true" />
              <span className="sv-lane__runner" />
              {show ? (
                <span className="sv-lane__pos" aria-hidden="true">
                  <RaceCar name={nameOf(session, p)} />
                </span>
              ) : (
                <span className="sv-lane__car" aria-hidden="true">
                  {carOf(nameOf(session, p))}
                </span>
              )}
            </span>
            <span className="sv-lane__score">{pointsLabel(score)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RoundCard({ round, result, reveal, size = "screen" }: { round: SurvivalRound; result: SurvivalResult; reveal: boolean; size?: "screen" | "phone" }) {
  return (
    <div className={`sv-round sv-round--${size}`}>
      <p className="sv-round__text">{round.text}</p>
      {round.kind === "choice" && (
        <ol className="mil-options sv-options">
          {round.options.map((text, i) => (
            <li key={i} className={`mil-option${reveal && i === round.correct ? " is-right" : ""}`}>
              {/* Плашка оформления телешоу (в «Классике» и на телефоне скрыта). */}
              <span className="mil-option__plate" aria-hidden="true" />
              <span className="mil-option__letter">{LETTERS[i]}</span>
              <span className="mil-option__text">{text}</span>
            </li>
          ))}
        </ol>
      )}
      {round.kind === "open" && reveal && <p className="sv-round__answer">Ответ: {round.answer.split("|")[0]?.trim()}</p>}
      {result.phase === "reveal" && result.deltas && Object.keys(result.deltas).length === 0 && reveal && <p className="sv-round__note">Очков в этом раунде никто не получил</p>}
    </div>
  );
}

/** Очередь команды в задании: крупный отсчёт 30 секунд по часам сервера. */
function TaskTimer({ session, timer }: { session: Session; timer: { pid: string; endsAt: number } }) {
  const now = useServerNow(200, true);
  const left = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  useCountdownSounds(left);
  // Доля оставшегося времени — кольцо круглого таймера в оформлении телешоу.
  const frac = Math.max(0, Math.min(1, (timer.endsAt - now) / TASK_MS));
  return (
    <div className={left === 0 ? "sv-task-timer is-over" : "sv-task-timer"} role="timer" style={{ ["--frac" as string]: String(frac) }}>
      <span className="sv-task-timer__who">
        Показывает <NameText name={nameOf(session, timer.pid)} />
      </span>
      <span className="sv-task-timer__n">{left === 0 ? "Время!" : left}</span>
    </div>
  );
}

/** Билет освобождения купоном (оформление телешоу); `price` — за сколько продан. */
function Ticket({ price = null }: { price?: number | null }) {
  return (
    <div className="sv-ticket">
      <div className="sv-ticket__paper">
        <span className="sv-ticket__stub" aria-hidden="true">
          🎟
        </span>
        <span className="sv-ticket__body">
          <span className="sv-ticket__kicker">{price === null ? "Аукцион" : "Продан"}</span>
          <strong className="sv-ticket__title">Билет освобождения</strong>
          <span className="sv-ticket__note">{price === null ? "пропуск одной войнушки" : `за ${pointsLabel(price)}`}</span>
        </span>
      </div>
    </div>
  );
}

export function SurvivalScreenView({ session, content }: ViewProps<SurvivalContent>) {
  const r = parseSurvivalResult(session.state.result);
  const { stage, step } = session.state;
  const round = roundOf(content, r);
  const now = useServerNow(250, stage === "question");
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  useCountdownSounds(left);
  const war = isWarRound(content, r);
  const show = content.look !== "classic";
  const prev = useRef(`${step}:${r.phase}`);
  useEffect(() => {
    const key = `${step}:${r.phase}`;
    if (prev.current !== key) {
      if (r.phase === "bet") playSound("drumroll");
      else if (r.phase === "reveal" || r.phase === "auctionDone") playSound(war && r.winner ? "fanfare" : Object.keys(r.deltas).length > 0 ? "correct" : "wrong");
      else if (r.phase === "intro" && war) playSound("gong");
    }
    prev.current = key;
  }, [step, r.phase, war, r.winner, r.deltas]);

  let main;
  if (r.order.length === 0) {
    main = (
      <>
        <span className="quiz-screen__badge">Гонка на выживание</span>
        <h2 className="sv-title">Скоро старт!</h2>
        <p className="sv-note">{content.rounds.length} раундов. Каждый {content.warEvery}-й — войнушка со ставками. Никто не выбывает — побеждают очки.</p>
      </>
    );
  } else if (r.phase === "over") {
    main = <h2 className="sv-title">Финиш гонки!</h2>;
  } else if (r.phase === "intro") {
    main = auctionPending(content, r) ? (
      <>
        <span className="quiz-screen__badge">Аукцион</span>
        {show ? <Ticket /> : <h2 className="sv-title">🎟 Билет освобождения</h2>}
        <p className="sv-note">Освобождает от одной войнушки: не нужно ставить очки.</p>
      </>
    ) : (
      <>
        <span className="quiz-screen__badge">Раунд {roundNumber(r)} из {content.rounds.length}</span>
        {war ? (
          <h2 className="sv-title sv-war-title">
            <span className="sv-war-title__sword sv-war-title__sword--l" aria-hidden="true">
              🗡️
            </span>
            Войнушка №{warIndex(content, roundNumber(r))}
            <span className="sv-war-title__sword sv-war-title__sword--r" aria-hidden="true">
              🗡️
            </span>
          </h2>
        ) : (
          <h2 className="sv-title">{round ? KIND_TITLES[round.kind] : ""}</h2>
        )}
        {war && <p className="sv-note">Приз — {pointsLabel(content.warPrize * warIndex(content, roundNumber(r)))}. Ставка — не меньше половины своих очков.</p>}
      </>
    );
  } else if (r.phase === "auction" || r.phase === "auctionDone") {
    main = (
      <>
        <span className="quiz-screen__badge">Аукцион{left !== null && r.phase === "auction" ? ` · ${left} с` : ""}</span>
        {show ? <Ticket price={r.phase === "auctionDone" && r.bid ? r.bid.amount : null} /> : <h2 className="sv-title">🎟 Билет освобождения</h2>}
        {r.phase === "auction" ? (
          <p className="sv-note">Капитаны, ставьте очки на телефонах! Кто больше — тот и забирает.</p>
        ) : r.bid ? (
          <p className="sv-who">
            Билет у <NameText name={nameOf(session, r.bid.pid)} /> за {pointsLabel(r.bid.amount)}
          </p>
        ) : (
          <p className="sv-note">Никто не поставил — билет не продан.</p>
        )}
      </>
    );
  } else if (r.phase === "bet") {
    main = (
      <>
        <span className="quiz-screen__badge">⚔️ Войнушка · ставки{left !== null ? ` · ${left} с` : ""}</span>
        <h2 className="sv-title">Делайте ставки!</h2>
        {show && (
          <div className="sv-bank">
            <Chip amount={r.prize} big />
            <span className="sv-bank__label">приз войнушки</span>
          </div>
        )}
        <p className="sv-note">Не меньше половины своих очков. Приз войнушки — {pointsLabel(r.prize)}. С билетом можно пропустить.</p>
      </>
    );
  } else if (round) {
    main = (
      <>
        <span className="quiz-screen__badge">
          {war ? `⚔️ Банк ${pointsLabel(r.bank)}` : `Раунд ${roundNumber(r)} · ${pointsLabel(round.points)}`}
          {left !== null && stage === "question" ? ` · ${left} с` : ""}
        </span>
        {round.kind === "task" && <p className="sv-kind">Задание</p>}
        {show && war && (
          <div className="sv-bank sv-bank--row">
            <Chip amount={r.bank} big />
            <span className="sv-bank__label">банк</span>
          </div>
        )}
        <RoundCard round={round} result={r} reveal={stage === "reveal"} />
        {round.kind === "task" && taskWords(round).length > 0 && stage === "question" && <p className="sv-note">Капитаны видят своё слово на телефоне — показывают по очереди, без слов</p>}
        {round.kind === "task" && stage === "question" && r.taskTimer && <TaskTimer session={session} timer={r.taskTimer} />}
        {war && r.freed.length > 0 && (
          <p className="sv-note">
            По билету пропускают: {r.freed.map((p) => nameOf(session, p)).join(", ")}
          </p>
        )}
        {war && stage === "reveal" && (
          <p className="sv-who">
            {r.winner ? (
              <>
                Банк забирает <NameText name={nameOf(session, r.winner)} />!
              </>
            ) : (
              "Верных нет — ставки сгорают"
            )}
          </p>
        )}
      </>
    );
  }

  return (
    <div className={`sv-screen${show && war && r.phase !== "over" ? " sv-screen--war" : ""}${showStageClass(content.look)}`}>
      {war && r.phase === "reveal" && r.winner && <Confetti burst={`sv:${step}`} />}
      {/* В оформлении телешоу банк войнушки и отсчёт задания стоят в правом верхнем углу — вопросу нужны поля. */}
      <section className={`sv-screen__main${show && ((war && round && (r.phase === "war" || r.phase === "reveal")) || (r.taskTimer && stage === "question" && round?.kind === "task")) ? " sv-screen__main--corner" : ""}`}>{main}</section>
      <section className="sv-screen__side" aria-label="Гонка">
        <p className="sv-counter">
          Раунд {Math.min(roundNumber(r), content.rounds.length)}/{content.rounds.length} · {warNote(content, r)}
        </p>
        <RaceLanes session={session} content={content} result={r} />
      </section>
    </div>
  );
}

function BetForm({ score, label, hint, min, onSend, sending, extra }: { score: number; label: string; hint: string; min: number; onSend: (n: number) => void; sending: boolean; extra?: ReactNode }) {
  const [value, setValue] = useState(String(min));
  const n = Math.floor(Number(value));
  const ok = Number.isFinite(n) && n >= min && n <= score;
  return (
    <div className="stack stack--tight sv-bet">
      <label className="field">
        {label}
        <input type="number" inputMode="numeric" min={min} max={score} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <p className="muted small">{hint}</p>
      <div className="sv-bet__quick">
        <button type="button" className="btn btn--secondary" onClick={() => setValue(String(min))}>
          {min === 0 ? "0" : "Минимум"}
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => setValue(String(Math.max(min, Math.round((min + score) / 2))))}>
          Середина
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => setValue(String(score))}>
          Ва-банк
        </button>
      </div>
      <button type="button" className="btn btn--block" disabled={!ok || sending} onClick={() => onSend(n)}>
        Поставить {ok ? pointsLabel(n) : ""}
      </button>
      {extra}
    </div>
  );
}

export function SurvivalPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<SurvivalContent, SurvivalAnswerValue>) {
  const r = parseSurvivalResult(session.state.result);
  const { stage } = session.state;
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const round = roundOf(content, r);
  const me = session.leaderboard[pid];
  const score = me?.score ?? 0;
  const tickets = r.tickets[pid] ?? 0;
  const canAct = role !== "member" && open && !myAnswer && r.order.includes(pid);
  const [text, setText] = useState("");
  // Новый раунд — пустое поле (иначе одно касание отправит прошлый ответ).
  useEffect(() => setText(""), [session.state.step]);
  const head = (
    <p className="eyebrow">
      Гонка · раунд {Math.min(roundNumber(r), content.rounds.length)}/{content.rounds.length}
      {me ? ` · ${pointsLabel(score)}` : ""}
      {tickets > 0 ? ` · 🎟×${tickets}` : ""}
    </p>
  );
  const sent = myAnswer ? <p className="success">Отправлено — смотрите на экран</p> : null;
  const memberNote = role === "member" ? <p className="muted">Отвечает капитан — подсказывайте!</p> : null;

  if (r.order.length === 0 || r.phase === "intro" || r.phase === "over") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>{r.phase === "over" ? "Финиш гонки!" : r.order.length === 0 ? "Скоро старт!" : isWarRound(content, r) ? "⚔️ Войнушка!" : auctionPending(content, r) ? "🎟 Аукцион билета" : `Раунд ${roundNumber(r)}`}</h2>
        {session.screenMode === "none" && r.order.length > 0 && <RaceLanes session={session} content={content} result={r} size="phone" />}
      </div>
    );
  }

  if (r.phase === "auction" || r.phase === "auctionDone") {
    return (
      <div className="quiz-phone">
        {head}
        <h2>🎟 Аукцион билета</h2>
        <p className="muted">Билет освобождает от одной войнушки. Платит только победитель — свою ставку.</p>
        {r.phase === "auction" && canAct && score > 0 ? (
          <BetForm score={score} min={0} label="Сколько очков ставите" hint={`У вас ${pointsLabel(score)}. 0 — не участвуем.`} sending={sending} onSend={(n) => onAnswer({ bid: n })} />
        ) : r.phase === "auction" && canAct ? (
          <p className="muted">Очков пока нет — в этом аукционе вы не участвуете.</p>
        ) : r.phase === "auctionDone" ? (
          <p className={r.bid?.pid === pid ? "success" : "muted"}>{r.bid ? (r.bid.pid === pid ? `Билет ваш за ${pointsLabel(r.bid.amount)}!` : `Билет у ${nameOf(session, r.bid.pid)}`) : "Билет не продан"}</p>
        ) : (
          (sent ?? memberNote)
        )}
      </div>
    );
  }

  if (r.phase === "bet") {
    const min = minBet(score);
    return (
      <div className="quiz-phone">
        {head}
        <h2>⚔️ Ставка на войнушку</h2>
        <p className="muted">Приз — {pointsLabel(r.prize)}. Банк забирает тот, кто первым ответит верно.</p>
        {canAct ? (
          <BetForm
            score={score}
            min={min}
            label="Ваша ставка"
            hint={`Не меньше половины: от ${pointsLabel(min)} до ${pointsLabel(score)}. Не успеете — поставится минимум.`}
            sending={sending}
            onSend={(n) => onAnswer({ bet: n })}
            extra={
              tickets > 0 ? (
                <button type="button" className="btn btn--secondary btn--block" disabled={sending} onClick={() => onAnswer({ ticket: true })}>
                  🎟 Использовать билет — пропустить войнушку
                </button>
              ) : null
            }
          />
        ) : (
          (sent ?? memberNote)
        )}
      </div>
    );
  }

  if (!round) return <div className="quiz-phone quiz-phone--center">{head}</div>;
  const war = r.phase === "war" || (r.phase === "reveal" && isWarRound(content, r));
  const freed = r.freed.includes(pid);
  const inWar = !war || pid in r.bets;
  return (
    <div className="quiz-phone">
      {head}
      {war && (
        <div className="buzz__plate" role="status">
          <strong>⚔️ Банк {pointsLabel(r.bank)}</strong>
          <span>{freed ? "Вы пропускаете по билету" : pid in r.bets ? `Ваша ставка — ${pointsLabel(r.bets[pid] ?? 0)}` : "Вы не участвуете"}</span>
        </div>
      )}
      {stage === "question" && round.kind === "choice" && canAct && inWar ? (
        <>
          <p className="sv-round__text">{round.text}</p>
          <div className="mil-phone-options">
            {round.options.map((t, i) => (
              <button key={i} type="button" className="btn btn--secondary mil-phone-option" disabled={sending} onClick={() => onAnswer({ choice: i })}>
                <span className="mil-option__letter">{LETTERS[i]}</span> {t}
              </button>
            ))}
          </div>
        </>
      ) : stage === "question" && round.kind === "open" && canAct && inWar ? (
        <form
          className="stack stack--tight"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onAnswer({ text: text.trim().slice(0, 120) });
          }}
        >
          <p className="sv-round__text">{round.text}</p>
          <input value={text} maxLength={120} placeholder="Ваш ответ" onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn--block" disabled={!text.trim() || sending}>
            Ответить
          </button>
        </form>
      ) : (
        <>
          {round.kind === "task" && <p className="eyebrow">Задание · {pointsLabel(round.points)}</p>}
          <RoundCard round={round} result={r} reveal={stage === "reveal"} size="phone" />
          {stage === "question" && round.kind === "task" && r.taskTimer && (
            <div className={r.taskTimer.pid === pid ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
              <strong>{r.taskTimer.pid === pid ? "Ваша очередь — показывайте!" : <>Сейчас показывает <NameText name={session.leaderboard[r.taskTimer.pid]?.name ?? "команда"} /></>}</strong>
              {r.taskTimer.pid !== pid && <span>Вы наблюдаете — ждите, когда ведущий позовёт вас</span>}
            </div>
          )}
          {stage === "question" && round.kind === "task" && taskWordFor(round, r.order, pid) && role !== "member" && (
            <div className="buzz__plate buzz__plate--glow sv-secret" role="status">
              <span>Ваше слово — видите только вы:</span>
              <strong>{taskWordFor(round, r.order, pid)}</strong>
              <span>Покажите его команде без слов, когда ведущий позовёт</span>
            </div>
          )}
          {stage === "question" && round.kind === "task" && taskWords(round).length > 0 && role === "member" && <p className="muted">Капитан покажет слово — угадывайте! Ведущий засчитает.</p>}
          {stage === "question" && round.kind === "task" && taskWords(round).length === 0 && <p className="muted">Выполняйте — ведущий засчитает.</p>}
          {stage === "question" && round.kind !== "task" && (sent ?? memberNote)}
          {stage === "reveal" && (
            <p className={(r.deltas[pid] ?? 0) > 0 ? "success" : (r.deltas[pid] ?? 0) < 0 ? "error" : "muted"}>
              {(r.deltas[pid] ?? 0) > 0 ? `+${pointsLabel(r.deltas[pid] ?? 0)}` : (r.deltas[pid] ?? 0) < 0 ? `−${pointsLabel(-(r.deltas[pid] ?? 0))}` : "В этом раунде без очков"}
            </p>
          )}
        </>
      )}
      {session.screenMode === "none" && <RaceLanes session={session} content={content} result={r} size="phone" />}
    </div>
  );
}
