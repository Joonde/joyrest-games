// «100 к 1»: экран зала (табло, плашки команд, крестики, банк; «Большая игра»; «Весь зал») и телефон гостя
// («Жми первым!» у капитанов играющей пары, до трёх ответов в «Весь зал»).
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { playSound } from "../../components/live/sound";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { buzzPhone, isBuzz } from "../../core/buzz";
import { placeOf } from "../../core/leaderboard";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import { teamColorVar } from "../../themes/registry";
import type { PlayerViewProps, ViewProps } from "../types";
import { showStageClass } from "../showLook";
import { answerPoints, HUNDRED_LIMITS, multiplierOf, ranked, ROUND_TITLES, roundLine, sourceLine, type HundredContent, type HundredQuestion, type RoundKind } from "./content";
import { bigTotal, hallNumber, hitsOf, opponentOf, parseHundredResult, questionOf, roundOf, type HundredResult } from "./logic";
import { matchedAnswers, wordsOf } from "./match";

/** Ответ телефона: нажатие «Жми первым!» или до трёх ответов «Весь зал». */
export type HundredAnswerValue = { buzz: true } | { words: string[] };

function useSoundOnChange(value: string, sound: Parameters<typeof playSound>[0]) {
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current !== value && value !== "") playSound(sound);
    previous.current = value;
  }, [value, sound]);
}

function nameOf(session: Session, pid: string | null): string {
  return pid ? (session.leaderboard[pid]?.name ?? "") : "";
}

function teamStyle(session: Session, pid: string | null): CSSProperties | undefined {
  const entry = pid ? session.leaderboard[pid] : undefined;
  return entry?.kind === "team" ? ({ "--team-color": teamColorVar(entry.colorIndex) } as CSSProperties) : undefined;
}

function timeText(left: number): string {
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- табло

/**
 * Табло: две колонки (1–3 слева, 4–6 справа при шести ответах). Закрытая строка — номер, открытая — ответ и очки
 * (переворот: только transform/opacity). Открытые в конце без очков — приглушены.
 */
export function HundredBoard({ question, kind, r, small = false }: { question: HundredQuestion; kind: RoundKind; r: Pick<HundredResult, "opened" | "shown" | "hits" | "mode">; small?: boolean }) {
  const list = ranked(question);
  const half = Math.ceil(list.length / 2);
  const columns = [list.slice(0, half), list.slice(half)];
  const hall = r.mode === "hallCheck" || r.mode === "hall";
  return (
    <div className={small ? "hd-board hd-board--small" : "hd-board"} role="list" aria-label="Табло ответов">
      {columns.map((col, c) => (
        <div key={c} className="hd-board__col">
          {col.map((a, i) => {
            const n = c * half + i + 1;
            const open = r.opened.includes(a.id);
            const shown = r.shown.includes(a.id);
            const hits = hall && open ? hitsOf(r, a.id) : null;
            return (
              <div key={a.id} role="listitem" className={`hd-row${open ? " is-open" : ""}${shown ? " is-open is-shown" : ""}`} aria-label={open || shown ? `${n}. ${a.text}, ${answerPoints(kind, question, a.id)}` : `Ответ ${n} закрыт`}>
                <div className="hd-row__inner">
                  <div className="hd-row__face hd-row__face--closed" aria-hidden={open || shown}>
                    <span className="hd-row__n">{n}</span>
                  </div>
                  <div className="hd-row__face hd-row__face--open" aria-hidden={!(open || shown)}>
                    <span className="hd-row__text">
                      {a.text}
                      {hits !== null && <small className="hd-row__hits">угадали: {hits}</small>}
                    </span>
                    <span className="hd-row__points">{answerPoints(kind, question, a.id)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Strikes({ n, total = HUNDRED_LIMITS.strikes }: { n: number; total?: number }) {
  return (
    <span className="hd-strikes" role="img" aria-label={`Ошибок: ${n} из ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < n ? "hd-strikes__x is-on" : "hd-strikes__x"} aria-hidden="true">
          ✕
        </span>
      ))}
    </span>
  );
}

function TeamPlate({ session, pid, status, active }: { session: Session; pid: string | null; status: string; active: boolean }) {
  if (!pid) return <div className="hd-plate hd-plate--empty" />;
  const entry = session.leaderboard[pid];
  return (
    <div className={active ? "hd-plate is-active" : "hd-plate"} style={teamStyle(session, pid)}>
      <span className="hd-plate__name">
        <NameText name={entry?.name ?? ""} />
      </span>
      <strong className="hd-plate__score">{entry?.score ?? 0}</strong>
      <span className="hd-plate__status">{status}</span>
    </div>
  );
}

// ---------------------------------------------------------------- экран зала

export function HundredScreenView({ session, content }: ViewProps<HundredContent>) {
  const { stage, step } = session.state;
  const r = parseHundredResult(session.state.result);
  const round = roundOf(content, r);
  const question = questionOf(content, r);
  const timed = stage === "question" && session.state.timeLimit !== null && !r.buzz.current;
  const now = useServerNow(250, timed);
  const left = timed ? secondsLeft(session.state, now) : null;
  useCountdownSounds(left);
  useSoundOnChange(r.opened.length > 0 ? `${r.round}:${r.q}:${r.opened.length}` : "", "correct");
  useSoundOnChange(r.strikes > 0 || r.faceMiss > 0 ? `${step}:${r.strikes}:${r.faceMiss}` : "", "wrong");
  useSoundOnChange(r.buzz.current ? `${step}:${r.buzz.current}` : "", "gong");
  useSoundOnChange(r.mode === "done" || r.mode === "bigDone" ? `${step}:done` : "", "fanfare");
  useSoundOnChange(r.mode === "steal" ? `${step}:steal` : "", "drumroll");
  useSoundOnChange(r.big.repeat !== null ? `${step}:rep:${r.big.repeat}` : "", "wrong");
  const look = showStageClass(content.look);

  if (!round || !question) {
    return (
      <div className={`hd-screen hd-screen--intro${look}`}>
        <h2 className="hd-screen__title" data-shine="on">
          100 к 1
        </h2>
      </div>
    );
  }

  const isBigClassic = round.kind === "big" && content.mode === "classic";
  if (isBigClassic && r.mode !== "intro") return <BigScreen session={session} content={content} r={r} left={left} look={look} />;

  if (r.mode === "intro") {
    const pair = r.pair.map((p) => nameOf(session, p)).filter(Boolean);
    const hall = content.mode === "hall" ? hallNumber(content, r) : null;
    return (
      <div className={`hd-screen hd-screen--intro${look}`}>
        <p className="hd-screen__eyebrow">{hall ? `Весь зал · вопрос ${hall.n} из ${hall.total}` : "100 к 1"}</p>
        <h2 className="hd-screen__title" data-shine="on">
          {ROUND_TITLES[round.kind]}
        </h2>
        <p className="hd-screen__hint">
          {round.kind === "reverse"
            ? "Ищем самые редкие ответы: чем реже ответ, тем дороже"
            : round.kind === "big"
              ? hall
                ? "Финал: пишем ответы с телефонов"
                : "Финал для лидера: два игрока, пять вопросов"
              : multiplierOf(round.kind) > 1
                ? `Очки ×${multiplierOf(round.kind)}`
                : "Угадайте самые популярные ответы"}
        </p>
        {!hall && pair.length > 0 && (
          <p className="hd-screen__pair">
            Играют:{" "}
            {pair.map((n, i) => (
              <span key={n}>
                {i > 0 ? " и " : ""}
                <NameText name={n} />
              </span>
            ))}
          </p>
        )}
        {isBigClassic && r.big.team && (
          <p className="hd-screen__pair">
            Играет <NameText name={nameOf(session, r.big.team)} />
          </p>
        )}
      </div>
    );
  }

  const mult = multiplierOf(round.kind);
  const hallMode = r.mode === "hall" || r.mode === "hallCheck";
  const hallNo = hallMode ? hallNumber(content, r) : null;
  const [leftPid, rightPid] = [r.pair[0] ?? null, r.pair[1] ?? null];
  const status = (pid: string | null): { text: string; active: boolean } => {
    if (!pid) return { text: "", active: false };
    if (r.mode === "face") return r.buzz.current === pid ? { text: "отвечает", active: true } : { text: r.armed ? "жмите кнопку!" : "слушают вопрос", active: false };
    if (r.mode === "play") return pid === r.playing ? { text: "отвечают", active: true } : { text: "ждут своего шанса", active: false };
    if (r.mode === "steal") return pid === r.playing ? { text: "ждут", active: false } : { text: "шанс!", active: true };
    if (r.mode === "done") return pid === r.winner ? { text: `+${r.award}`, active: true } : { text: "", active: false };
    return { text: "", active: false };
  };
  const ls = status(leftPid);
  const rs = status(rightPid);
  return (
    <div className={`hd-screen${hallMode ? " hd-screen--hall" : ""}${look}`}>
      <div className="hd-screen__top">
        <span className="quiz-screen__badge">{hallNo ? `Весь зал · вопрос ${hallNo.n} из ${hallNo.total}${mult > 1 ? ` · очки ×${mult}` : ""}` : roundLine(round.kind)}</span>
        <span className="hd-screen__source">{sourceLine(question)}</span>
        {left !== null && (
          <span className={left === 0 ? "hd-screen__count is-over" : "hd-screen__count"} role="timer">
            {left === 0 ? "Время вышло" : hallMode ? timeText(left) : left}
          </span>
        )}
      </div>
      <h2 className="hd-screen__question">{question.text}</h2>
      <div className={hallMode ? "hd-screen__mid hd-screen__mid--solo" : "hd-screen__mid"}>
        {!hallMode && <TeamPlate session={session} pid={leftPid} status={ls.text} active={ls.active} />}
        <HundredBoard question={question} kind={round.kind} r={r} />
        {!hallMode && <TeamPlate session={session} pid={rightPid} status={rs.text} active={rs.active} />}
      </div>
      <div className="hd-screen__bottom" role="status" aria-live="polite">
        {hallMode ? (
          r.mode === "hall" ? (
            <span>Пишите до трёх ответов на телефоне · ответили: {session.state.answered ?? 0}</span>
          ) : (
            <span>Каждый угаданный ответ — его очки{mult > 1 ? ` ×${mult}` : ""}</span>
          )
        ) : (
          <>
            {r.mode === "face" && r.buzz.current ? (
              <span className="hd-screen__speaker">
                Отвечает <NameText name={nameOf(session, r.buzz.current)} />
              </span>
            ) : r.mode === "face" ? (
              <span>{r.armed ? "Капитаны, жмите «Жми первым!» на телефоне" : "Слушаем вопрос — кнопки включатся по отсчёту ведущего"}</span>
            ) : r.mode === "steal" ? (
              <span className="hd-screen__speaker">
                Шанс для <NameText name={nameOf(session, opponentOf(r))} />: один ответ
              </span>
            ) : r.mode === "done" ? (
              <span className="hd-screen__speaker">
                {r.winner ? (
                  <>
                    Банк — <NameText name={nameOf(session, r.winner)} />
                  </>
                ) : (
                  "Банк никому"
                )}
              </span>
            ) : (
              <span>
                Ошибки <Strikes n={r.strikes} />
              </span>
            )}
            <span className="hd-screen__bank">
              Банк раунда {r.bank}
              {mult > 1 ? ` × ${mult} = ${r.bank * mult}` : ""}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function BigScreen({ session, content, r, left, look }: { session: Session; content: HundredContent; r: HundredResult; left: number | null; look: string }) {
  const round = roundOf(content, r);
  if (!round) return null;
  const total = bigTotal(r.big);
  const player = r.big.player;
  const done = r.mode === "bigDone";
  return (
    <div className={`hd-screen hd-screen--big${look}`}>
      <div className="hd-screen__top">
        <span className="quiz-screen__badge">
          Большая игра · <NameText name={nameOf(session, r.big.team)} />
        </span>
        <span className="hd-screen__source">{done ? `Итог: ${total} из ${content.bigGoal}` : `${player === 0 ? "Первый" : "Второй"} игрок · ${content.bigTimes[player]} секунд`}</span>
        {left !== null && (
          <span className={left === 0 ? "hd-screen__count is-over" : "hd-screen__count"} role="timer">
            {left === 0 ? "Время вышло" : left}
          </span>
        )}
      </div>
      <div className="hd-big" role="table" aria-label="Ответы Большой игры">
        {round.questions.map((q, i) => (
          <div key={q.id} className={r.big.repeat === i ? "hd-big__row is-repeat" : "hd-big__row"} role="row">
            <span className="hd-big__q" role="rowheader">
              {i + 1}. {q.text}
            </span>
            {[0, 1].map((p) => {
              const cell = r.big.cells[p as 0 | 1][i];
              return (
                <span key={p} role="cell" className={`hd-big__cell${cell ? " is-open" : ""}${cell && cell.points === 0 ? " is-zero" : ""}`}>
                  <span className="hd-big__text">{cell ? cell.text : ""}</span>
                  <strong className="hd-big__points">{cell ? cell.points : ""}</strong>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="hd-screen__bottom" role="status" aria-live="polite">
        {r.big.repeat !== null ? (
          <span className="hd-screen__speaker hd-screen__speaker--warn">Повтор, другой ответ!</span>
        ) : done ? (
          <span className="hd-screen__speaker">{total >= content.bigGoal ? `Победа! +${content.bigBonus} бонус` : "Почти получилось!"}</span>
        ) : (
          <span>{player === 1 ? "Ответ, который уже назвал первый игрок, повторять нельзя" : "Отвечайте быстро — пять вопросов подряд"}</span>
        )}
        <span className="hd-screen__bank">
          {total} из {content.bigGoal}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- телефон

function HallForm({ initial, sending, open, onSend }: { initial: string[]; sending: boolean; open: boolean; onSend: (words: string[]) => void }) {
  const [words, setWords] = useState<string[]>(() => Array.from({ length: HUNDRED_LIMITS.hallWords }, (_, i) => initial[i] ?? ""));
  const filled = words.map((w) => w.trim()).filter(Boolean);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (filled.length > 0) onSend(filled);
  }
  return (
    <form className="stack hd-hall-form" onSubmit={submit}>
      <p className="muted small">Напишите до трёх ответов. Каждый, что есть на табло, приносит его очки.</p>
      {words.map((w, i) => (
        <label key={i} className="field">
          <span className="field__label">Ответ {i + 1}</span>
          <input value={w} maxLength={60} autoComplete="off" disabled={!open} onChange={(e) => setWords(words.map((x, k) => (k === i ? e.target.value : x)))} />
        </label>
      ))}
      <p className="muted small">Пишите как слышится — регистр, «ё» и небольшие опечатки не важны, ведущий видит всё.</p>
      <button className="btn btn--block" type="submit" disabled={!open || sending || filled.length === 0}>
        {sending ? "Отправляем…" : initial.length > 0 ? "Исправить ответы" : "Отправить ответы"}
      </button>
    </form>
  );
}

export function HundredPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<HundredContent, HundredAnswerValue>) {
  const { stage } = session.state;
  const r = parseHundredResult(session.state.result);
  const round = roundOf(content, r);
  const question = questionOf(content, r);
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const me = session.leaderboard[pid];
  const place = placeOf(session.leaderboard, pid);
  const noScreen = session.screenMode === "none";
  const teams = session.playMode === "teams";
  const who = me ? (
    <p className="eyebrow">
      <NameText name={me.name} />
      {teams ? (role === "captain" ? " · капитан" : "") : ""}
    </p>
  ) : null;
  const scoreLine = me ? (
    <p className="muted small">
      Ваш счёт: {pointsLabel(me.score)}
      {place ? ` · ${place.place} место из ${place.total}` : ""}
    </p>
  ) : null;
  if (!round || !question) {
    return (
      <div className="quiz-phone quiz-phone--center">
        {who}
        <h2>100 к 1</h2>
        {scoreLine}
      </div>
    );
  }
  const board = noScreen && r.mode !== "intro" && r.mode !== "big" && r.mode !== "bigDone" ? <HundredBoard question={question} kind={round.kind} r={r} small /> : null;

  // «Большая игра» (классика).
  if (round.kind === "big" && content.mode === "classic") {
    const mine = r.big.team === pid;
    return (
      <div className="quiz-phone quiz-phone--center">
        {who}
        <p className="eyebrow">Большая игра</p>
        <div className={mine ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
          <strong>{mine ? "Большая игра — ваша!" : r.big.team ? <>Играет <NameText name={nameOf(session, r.big.team)} /></> : "Финал для лидера"}</strong>
          <span>{mine ? "Два игрока по очереди отвечают ведущему вслух на пять вопросов" : "Смотрите на экран — болейте!"}</span>
        </div>
        {noScreen && r.mode !== "intro" && (
          <ol className="hd-phone-big">
            {round.questions.map((q, i) => (
              <li key={q.id}>
                {q.text}: {r.big.cells[0][i]?.text ?? "—"} / {r.big.cells[1][i]?.text ?? "—"}
              </li>
            ))}
          </ol>
        )}
        {r.mode === "bigDone" && <p className="success">Итог: {bigTotal(r.big)} из {content.bigGoal}</p>}
        {scoreLine}
      </div>
    );
  }

  const title = (
    <>
      {who}
      <p className="eyebrow">
        {content.mode === "hall" ? `Весь зал · вопрос ${hallNumber(content, r).n} из ${hallNumber(content, r).total}` : `${ROUND_TITLES[round.kind]}${r.mode === "face" ? " · розыгрыш" : ""}`}
        {left !== null && content.mode === "hall" ? ` ${timeText(left)}` : ""}
      </p>
    </>
  );

  if (r.mode === "intro") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {title}
        <h2>{content.mode === "hall" ? "Скоро вопрос" : roundLine(round.kind)}</h2>
        <p className="muted">Смотрите на экран — ведущий открывает вопрос.</p>
        {scoreLine}
      </div>
    );
  }

  // «Весь зал».
  if (r.mode === "hall" || r.mode === "hallCheck") {
    const sent = myAnswer && typeof myAnswer.value === "object" ? wordsOf(myAnswer.value) : [];
    const hit = r.mode === "hallCheck" ? matchedAnswers(question, sent, r.accepted).filter((id) => r.opened.includes(id)) : [];
    return (
      <div className="quiz-phone">
        {title}
        <h2 className="quiz-phone__question">{question.text}</h2>
        <p className="muted small">{sourceLine(question)}</p>
        {r.mode === "hall" && role === "member" ? (
          <div className="buzz__plate" role="status">
            <strong>Ответы пишет капитан</strong>
            <span>Подскажите ему, что ответили бы люди</span>
          </div>
        ) : r.mode === "hall" ? (
          <>
            {/* Ключ — шаг: на новом вопросе поля пустые. */}
            <HallForm key={session.state.step} initial={sent} sending={sending} open={open} onSend={(words) => onAnswer({ words })} />
            {sent.length > 0 && <p className="success">Ответы отправлены: {sent.join(", ")}. Пока идёт время, можно исправить.</p>}
          </>
        ) : (
          <div className="buzz__plate" role="status">
            <strong>Смотрите на табло!</strong>
            <span>
              {sent.length === 0
                ? "Ответов от вас нет"
                : `Ваши ответы: ${sent.join(", ")}${hit.length > 0 ? ` · на табло: ${hit.length}` : ""}`}
            </span>
          </div>
        )}
        {board}
        {scoreLine}
      </div>
    );
  }

  // Классика: розыгрыш и ход команды.
  const inPair = r.pair.includes(pid);
  const pairNames = r.pair.map((p) => nameOf(session, p)).filter(Boolean);
  const pressed = myAnswer !== null && myAnswer !== undefined && isBuzz(myAnswer.value);
  let body: ReactNode;
  if (r.mode === "face" && inPair && role !== "member") {
    const phone = buzzPhone(r.buzz, pid, pressed, open && r.armed);
    body = !r.armed ? (
      <div className="buzz__plate" role="status">
        <strong>Слушайте вопрос</strong>
        <span>Кнопка загорится, когда ведущий запустит отсчёт</span>
      </div>
    ) : phone.state === "press" ? (
      <div className="buzz buzz--press hd-press">
        <p className="muted small">Знаете ответ из табло? Жмите первым — и говорите вслух ведущему.</p>
        <div className="buzz__ring">
          <button type="button" className="buzz__button" disabled={sending} onClick={() => onAnswer({ buzz: true })}>
            {sending ? "…" : "Жми первым!"}
          </button>
        </div>
        <p className="muted small">Нажатие раньше «Отсчёта» ведущего не считается. Первого определяет сервер по своим часам.</p>
      </div>
    ) : (
      <div className={phone.state === "turn" ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
        <strong>{phone.state === "turn" ? "Ваше слово! Назовите ответ вслух" : phone.state === "out" ? "Слово перешло сопернику" : phone.state === "queued" ? "Нажато — ждите" : "Время вышло"}</strong>
        <span>{r.buzz.current && r.buzz.current !== pid ? `Отвечает ${nameOf(session, r.buzz.current)}` : "Ведущий слушает"}</span>
      </div>
    );
  } else if (r.mode === "face") {
    body = (
      <div className="buzz__plate" role="status">
        <strong>{inPair ? "Кнопку жмёт капитан" : `Отвечают ${pairNames.join(" и ")}`}</strong>
        <span>{inPair ? "Подскажите ему ответ" : "Смотрите на экран"}</span>
      </div>
    );
  } else if (r.mode === "play" || r.mode === "steal") {
    const mine = r.mode === "play" ? r.playing === pid : opponentOf(r) === pid;
    body = (
      <div className={mine ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
        <strong>
          {r.mode === "steal" ? (mine ? "Шанс! Посоветуйтесь и назовите один ответ" : <>Шанс для <NameText name={nameOf(session, opponentOf(r))} /></>) : mine ? "Ваша команда отвечает" : <>Отвечают <NameText name={nameOf(session, r.playing)} /> — смотрите на экран</>}
        </strong>
        <span>
          {r.mode === "play" ? (mine ? "Называйте ответы ведущему по очереди. Три ошибки — шанс соперника" : `Ошибок: ${r.strikes} из ${HUNDRED_LIMITS.strikes}. После трёх — шанс у соперника`) : "Угадают — банк их"}
        </span>
      </div>
    );
  } else {
    body = (
      <div className={r.winner === pid ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
        <strong>{r.winner ? <>Банк — <NameText name={nameOf(session, r.winner)} /></> : "Банк никому"}</strong>
        <span>{r.award > 0 ? `+${r.award} очков` : "Ждём следующий раунд"}</span>
      </div>
    );
  }
  return (
    <div className="quiz-phone quiz-phone--center">
      {title}
      <h2 className="quiz-phone__question">{question.text}</h2>
      {body}
      {board}
      {scoreLine}
    </div>
  );
}
