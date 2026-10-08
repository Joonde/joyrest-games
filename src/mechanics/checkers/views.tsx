// «Шашки»: доска на экране зала, вопрос, ход капитана на телефоне.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { MediaImage } from "../../components/media/MediaImage";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import type { CheckersContent, CheckersQuestion } from "./content";
import { colorOfPid, currentQuestion, parseCheckersResult, type CheckersResult } from "./logic";
import { colorOf, completeMove, count, isDark, isKing, legalMoves, nextTargets, POINTS, type Color } from "./rules";

/** Ответ: номер варианта, текст или ход `{ path }`. */
export type CheckersAnswerValue = number | string | { path: number[] };

const LETTERS = ["A", "B", "C", "D"];

/** Доска 8×8. `flip` — чёрные смотрят со своей стороны. */
export function CheckersBoard({
  board,
  flip = false,
  last,
  selected = [],
  targets = [],
  movable = [],
  onCell,
  size = "screen",
}: {
  board: string;
  flip?: boolean;
  last?: CheckersResult["last"];
  selected?: number[];
  targets?: number[];
  movable?: number[];
  onCell?: (cell: number) => void;
  size?: "screen" | "phone";
}) {
  const order = useMemo(() => {
    const all = Array.from({ length: 64 }, (_, i) => i);
    return flip ? all.reverse() : all;
  }, [flip]);
  const lastSet = new Set(last?.path ?? []);
  return (
    <div className={`checkers checkers--${size}`} role="grid" aria-label="Доска">
      {order.map((i) => {
        const piece = board[i] ?? ".";
        const color = colorOf(piece);
        const dark = isDark(i);
        const cls = [
          "checkers__cell",
          dark ? "is-dark" : "is-light",
          lastSet.has(i) ? "is-last" : "",
          selected.includes(i) ? "is-selected" : "",
          targets.includes(i) ? "is-target" : "",
          movable.includes(i) ? "is-movable" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const content = color ? <span className={`checkers__piece checkers__piece--${color}${isKing(piece) ? " is-king" : ""}`}>{isKing(piece) ? "♛" : ""}</span> : null;
        const tappable = onCell && dark && (targets.includes(i) || movable.includes(i) || selected.includes(i));
        return tappable ? (
          <button key={i} type="button" className={cls} onClick={() => onCell(i)} aria-label={targets.includes(i) ? "Сюда" : "Эта шашка"}>
            {content}
          </button>
        ) : (
          <span key={i} className={cls} role="gridcell">
            {content}
          </span>
        );
      })}
    </div>
  );
}

function Side({ session, result, color }: { session: Session; result: CheckersResult; color: Color }) {
  const id = color === "w" ? result.white : result.black;
  const entry = id ? session.leaderboard[id] : null;
  const left = count(result.board, color);
  const moving = result.mover === id && result.mode === "move";
  return (
    <div className={`checkers-side checkers-side--${color}${moving ? " is-moving" : ""}`}>
      <span className={`checkers__piece checkers__piece--${color} checkers-side__chip`} aria-hidden="true" />
      <span className="checkers-side__name">{entry ? <NameText name={entry.name} /> : color === "w" ? "Белые" : "Чёрные"}</span>
      <span className="checkers-side__score">{pointsLabel(entry?.score ?? 0)}</span>
      <span className="checkers-side__left">
        шашек: {left.men}
        {left.kings > 0 ? ` · дамок: ${left.kings}` : ""}
      </span>
    </div>
  );
}

function useSoundOnChange(value: string, sound: Parameters<typeof playSound>[0]) {
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current !== value && value !== "") playSound(sound);
    previous.current = value;
  }, [value, sound]);
}

function answerText(q: CheckersQuestion): string {
  return q.kind === "choice" ? (q.options[q.correct] ?? "") : q.answers.filter((a) => a.trim()).join(" / ");
}

export function CheckersScreenView({ session, content }: ViewProps<CheckersContent>) {
  const r = parseCheckersResult(session.state.result);
  const { stage, step } = session.state;
  const q = currentQuestion(content, r);
  const now = useServerNow(250, stage === "question" && r.mode === "task");
  const left = stage === "question" && r.mode === "task" ? secondsLeft(session.state, now) : null;
  const nameOf = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? "") : "");
  const side = (p: string | null) => (p === r.white ? "белые" : "чёрные");
  useSoundOnChange(stage === "reveal" && r.mode !== "task" && (r.last?.captured.length ?? 0) > 0 ? `${step}:take` : "", "correct");
  useSoundOnChange(stage === "question" && r.mode === "task" ? `${step}:task` : "", "gong");
  useSoundOnChange(stage === "reveal" && r.mode === "task" ? `${step}:${r.taskOk ? "ok" : "no"}` : "", r.taskOk ? "correct" : "wrong");

  let banner: ReactNode = null;
  if (r.mode === "over") {
    banner = r.winner ? (
      <>
        Победа! <NameText name={nameOf(r.winner)} />
      </>
    ) : (
      "Партия окончена — побеждает больший счёт"
    );
  } else if (!r.mover || stage === "ready") banner = "Партия начинается: первыми ходят белые";
  else if (r.mode === "move" && stage === "question")
    banner = (
      <>
        Ходят {side(r.mover)}: <NameText name={nameOf(r.mover)} />
      </>
    );
  else if (r.mode === "move" && stage === "reveal")
    banner = r.points > 0 ? (
      <>
        Съели! +{r.points} — <NameText name={nameOf(r.mover)} />
      </>
    ) : r.last ? (
      "Ход сделан"
    ) : (
      "Ход пропущен"
    );
  else if (r.mode === "task")
    banner = (
      <>
        Задание: <NameText name={nameOf(r.victim)} />
      </>
    );

  return (
    <div className="checkers-screen">
      {r.mode === "over" && <Confetti burst={`checkers:${step}`} />}
      <div className="checkers-screen__board">
        <CheckersBoard board={r.board} last={r.last} />
      </div>
      <div className="checkers-screen__side">
        <Side session={session} result={r} color="b" />
        {banner && (
          <p className={r.mode === "move" && stage === "reveal" && r.points > 0 ? "checkers-screen__banner is-take" : "checkers-screen__banner"} role="status">
            {banner}
          </p>
        )}
        {r.mode === "task" && q && (
          <div className="checkers-screen__question">
            <div className="row checkers-screen__qtop">
              <span className="quiz-screen__badge">Потеряли шашку — отвечайте</span>
              {left !== null && <span className="checkers-screen__timer">{left === 0 ? "Время!" : `${left} с`}</span>}
            </div>
            <h2>{q.text}</h2>
            {q.imageId && <MediaImage className="checkers-screen__image" gameId={session.gameId} mediaId={q.imageId} variant="full" alt="" />}
            {q.kind === "choice" && (
              <ol className="checkers-screen__options">
                {q.options.map((o, i) => (
                  <li key={i} className={stage === "reveal" && i === q.correct ? "is-right" : undefined}>
                    <span>{LETTERS[i]}</span> {o}
                  </li>
                ))}
              </ol>
            )}
            {stage === "reveal" && (
              <p className="checkers-screen__verdict">
                {q.kind === "open" && (
                  <>
                    Ответ: <strong>{answerText(q)}</strong>.{" "}
                  </>
                )}
                {r.taskOk ? `Верно! +${r.taskPoints}` : "Не справились"}
              </p>
            )}
          </div>
        )}
        <Side session={session} result={r} color="w" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- телефон

export function MovePicker({ board, color, sending, onMove, title = "Ваш ход!" }: { board: string; color: Color; sending: boolean; onMove: (path: number[]) => void; title?: string }) {
  const [path, setPath] = useState<number[]>([]);
  const movable = useMemo(() => [...new Set(legalMoves(board, color).map((m) => m.path[0] as number))], [board, color]);
  const targets = path.length > 0 ? nextTargets(board, color, path) : [];
  useEffect(() => setPath([]), [board]);

  function tap(cell: number) {
    if (sending) return;
    if (path.length === 0 || (path.length === 1 && movable.includes(cell))) {
      setPath(movable.includes(cell) ? [cell] : []);
      return;
    }
    if (!targets.includes(cell)) return;
    const next = [...path, cell];
    const done = completeMove(board, color, next);
    if (done) onMove(next);
    else setPath(next);
  }

  return (
    <div className="stack stack--tight checkers-picker">
      <div className="buzz__plate buzz__plate--glow" role="status">
        <strong>{title}</strong>
        <span>{path.length === 0 ? "Коснитесь шашки, которая светится" : targets.length > 0 ? "Теперь клетку, куда пойти" : "Отправляем…"}</span>
      </div>
      <CheckersBoard board={board} flip={color === "b"} size="phone" selected={path} targets={targets} movable={path.length <= 1 ? movable : []} onCell={tap} />
      {path.length > 0 && (
        <button type="button" className="btn btn--secondary btn--block" disabled={sending} onClick={() => setPath([])}>
          Выбрать другую шашку
        </button>
      )}
    </div>
  );
}

function QuestionForm({ q, sending, onAnswer }: { q: CheckersQuestion; sending: boolean; onAnswer: (v: number | string) => void }) {
  const [text, setText] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim()) onAnswer(text.trim());
  }
  if (q.kind === "choice") {
    return (
      <div className="stack stack--tight">
        {q.options.map((o, i) => (
          <button key={i} type="button" className="btn btn--secondary btn--block quiz-phone__option" disabled={sending} onClick={() => onAnswer(i)}>
            <span>{LETTERS[i]}</span> {o}
          </button>
        ))}
      </div>
    );
  }
  return (
    <form className="stack stack--tight" onSubmit={submit}>
      <input value={text} maxLength={120} placeholder="Ваш ответ" onChange={(e) => setText(e.target.value)} aria-label="Ваш ответ" />
      <button className="btn btn--block" type="submit" disabled={sending || !text.trim()}>
        Ответить
      </button>
    </form>
  );
}

export function CheckersPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<CheckersContent, CheckersAnswerValue>) {
  const r = parseCheckersResult(session.state.result);
  const { stage } = session.state;
  const q = currentQuestion(content, r);
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const mine = colorOfPid(r, pid);
  const me = session.leaderboard[pid];
  const noScreen = session.screenMode === "none";
  const sideName = mine === "w" ? "Белые" : mine === "b" ? "Чёрные" : "Болельщик";
  const nameOf = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? "") : "");
  const head = (
    <p className="eyebrow">
      Шашки · {sideName}
      {me ? ` · ${pointsLabel(me.score)}` : ""}
    </p>
  );
  const smallBoard = <CheckersBoard board={r.board} flip={mine === "b"} last={r.last} size="phone" />;

  if (r.mode === "over") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>{r.winner === pid ? "Победа на доске!" : r.winner ? "Партия окончена" : "Партия окончена — считаем очки"}</h2>
        {smallBoard}
      </div>
    );
  }

  if (!r.mover || stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Сейчас начнётся партия</h2>
        <p className="muted">Ходите по очереди. Потеряли шашку — получите вопрос: ответите верно — +{POINTS.task} очков.</p>
      </div>
    );
  }

  if (r.mode === "move" && stage === "question") {
    if (r.mover === pid && mine && role !== "member" && !myAnswer) {
      return (
        <div className="quiz-phone quiz-phone--center">
          {head}
          <MovePicker board={r.board} color={mine} sending={sending} onMove={(path) => onAnswer({ path })} />
        </div>
      );
    }
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <div className="buzz__plate" role="status">
          <strong>{r.mover === pid ? (role === "member" ? "Ходит ваш капитан" : "Ход отправлен") : <>Ходит <NameText name={nameOf(r.mover)} /></>}</strong>
          <span>{mine ? "Подсказывайте капитану и следите за доской" : "Смотрите на доску"}</span>
        </div>
        {(noScreen || r.mover === pid) && smallBoard}
      </div>
    );
  }

  if (r.mode === "task" && q) {
    const mineTask = r.victim === pid;
    if (stage === "question") {
      if (!mineTask) {
        return (
          <div className="quiz-phone quiz-phone--center">
            {head}
            <h2 className="quiz-phone__question">{q.text}</h2>
            <div className="buzz__plate" role="status">
              <strong>
                Отвечает <NameText name={nameOf(r.victim)} />
              </strong>
              <span>Они потеряли шашку — ответят верно, получат очки</span>
            </div>
          </div>
        );
      }
      const answered = myAnswer !== null && myAnswer !== undefined;
      return (
        <div className="quiz-phone">
          {head}
          <p className="eyebrow">Вы потеряли шашку — ответьте и заработайте +{POINTS.task}</p>
          <h2 className="quiz-phone__question">{q.text}</h2>
          {noScreen && q.imageId && <MediaImage className="quiz-phone__image" gameId={session.gameId} mediaId={q.imageId} variant="small" alt="" />}
          {role === "member" ? (
            <p className="muted">Отвечает капитан — подскажите ему.</p>
          ) : answered ? (
            <div className="buzz__plate buzz__plate--glow" role="status">
              <strong>Ответ принят</strong>
              <span>Ждём, что скажет ведущий</span>
            </div>
          ) : open ? (
            <QuestionForm q={q} sending={sending} onAnswer={(v) => onAnswer(v)} />
          ) : (
            <p className="muted">Время вышло.</p>
          )}
        </div>
      );
    }
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <p>
          Ответ: <strong>{answerText(q)}</strong>
        </p>
        <div className={mineTask && r.taskOk ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
          <strong>{mineTask ? (r.taskOk ? `Верно! +${r.taskPoints}` : "Не получилось") : r.taskOk ? "Соперник ответил верно" : "Соперник не справился"}</strong>
        </div>
      </div>
    );
  }

  // Ход показан
  return (
    <div className="quiz-phone quiz-phone--center">
      {head}
      <p>{r.points > 0 ? `Съели шашку: +${r.points} ${r.mover === pid ? "вам" : "сопернику"}` : r.last ? "Ход сделан" : "Ход пропущен"}</p>
      {smallBoard}
    </div>
  );
}
