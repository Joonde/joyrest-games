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
import { colorOfPid, currentQuestion, isRight, parseCheckersResult, type CheckersResult } from "./logic";
import { colorOf, completeMove, count, isDark, isKing, legalMoves, nextTargets, type Color } from "./rules";

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
  const now = useServerNow(250, stage === "question" && r.mode === "question");
  const left = stage === "question" && r.mode === "question" ? secondsLeft(session.state, now) : null;
  const moverName = r.mover ? (session.leaderboard[r.mover]?.name ?? "") : "";
  useSoundOnChange(stage === "reveal" && r.mode === "move" && (r.last?.captured.length ?? 0) > 0 ? `${step}:take` : "", "correct");
  useSoundOnChange(stage === "reveal" && r.mode === "question" && r.mover ? `${step}:turn` : "", "gong");
  const winnerName = r.winner ? (session.leaderboard[r.winner]?.name ?? "") : "";

  let banner: ReactNode = null;
  if (r.mode === "over") {
    banner = winnerName ? (
      <>
        Победа! <NameText name={winnerName} />
      </>
    ) : (
      "Партия окончена — побеждает больший счёт"
    );
  } else if (stage === "ready") banner = `Вопрос ${r.q + 1} из ${content.questions.length}`;
  else if (r.mode === "move" && stage === "question")
    banner = (
      <>
        Ходит <NameText name={moverName} />
      </>
    );
  else if (r.mode === "move" && stage === "reveal")
    banner = r.points > 0 ? `+${r.points} очков за взятие` : r.last ? "Ход сделан" : "Ход пропущен";
  else if (stage === "reveal")
    banner = r.mover ? (
      <>
        Ход получает <NameText name={moverName} />
      </>
    ) : (
      "Никто не ответил верно — хода нет"
    );

  const showQ = q && r.mode === "question" && (stage === "question" || stage === "reveal");
  return (
    <div className="checkers-screen">
      {r.mode === "over" && <Confetti burst={`checkers:${step}`} />}
      <div className="checkers-screen__board">
        <CheckersBoard board={r.board} last={r.last} />
      </div>
      <div className="checkers-screen__side">
        <Side session={session} result={r} color="b" />
        {banner && (
          <p className="checkers-screen__banner" role="status">
            {banner}
          </p>
        )}
        {showQ && q && (
          <div className="checkers-screen__question">
            <div className="row checkers-screen__qtop">
              <span className="quiz-screen__badge">Вопрос {r.q + 1}</span>
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
            {stage === "reveal" && q.kind === "open" && (
              <p>
                Ответ: <strong>{answerText(q)}</strong>
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

function MovePicker({ board, color, sending, onMove }: { board: string; color: Color; sending: boolean; onMove: (path: number[]) => void }) {
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
        <strong>Ваш ход!</strong>
        <span>{path.length === 0 ? "Коснитесь своей шашки, которая светится" : targets.length > 0 ? "Теперь клетку, куда пойти" : "Отправляем…"}</span>
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
  const sideName = mine === "w" ? "Белые" : mine === "b" ? "Чёрные" : "Зритель";
  const head = (
    <p className="eyebrow">
      Шашки · {sideName}
      {me ? ` · ${pointsLabel(me.score)}` : ""}
    </p>
  );
  const smallBoard = (noScreen || stage === "reveal") && <CheckersBoard board={r.board} flip={mine === "b"} last={r.last} size="phone" />;

  if (r.mode === "over") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>{r.winner === pid ? "Победа на доске!" : r.winner ? "Партия окончена" : "Партия окончена — считаем очки"}</h2>
        {smallBoard}
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
    const moverName = r.mover ? (session.leaderboard[r.mover]?.name ?? "") : "";
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <div className="buzz__plate" role="status">
          <strong>{r.mover === pid ? (role === "member" ? "Ходит ваш капитан" : "Ход отправлен") : <>Ходит <NameText name={moverName} /></>}</strong>
          <span>Смотрите на доску</span>
        </div>
        {noScreen && <CheckersBoard board={r.board} flip={mine === "b"} size="phone" />}
      </div>
    );
  }

  if (!q || stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Сейчас будет вопрос</h2>
        <p className="muted">Ответите верно и быстрее соперника — ваш ход на доске.</p>
        {smallBoard}
      </div>
    );
  }

  if (stage === "question") {
    const answered = myAnswer !== null && myAnswer !== undefined;
    return (
      <div className="quiz-phone">
        {head}
        <h2 className="quiz-phone__question">{q.text}</h2>
        {noScreen && q.imageId && <MediaImage className="quiz-phone__image" gameId={session.gameId} mediaId={q.imageId} variant="small" alt="" />}
        {role === "member" ? (
          <p className="muted">Отвечает капитан — подскажите ему.</p>
        ) : answered ? (
          <div className="buzz__plate buzz__plate--glow" role="status">
            <strong>Ответ принят</strong>
            <span>Кто ответит верно и быстрее — получит ход</span>
          </div>
        ) : open ? (
          <QuestionForm q={q} sending={sending} onAnswer={(v) => onAnswer(v)} />
        ) : (
          <p className="muted">Время вышло.</p>
        )}
      </div>
    );
  }

  // reveal вопроса или хода
  const right = myAnswer ? isRight(q, myAnswer.value) : false;
  return (
    <div className="quiz-phone quiz-phone--center">
      {head}
      {r.mode === "question" ? (
        <>
          <p>
            Ответ: <strong>{answerText(q)}</strong>
          </p>
          <div className={r.mover === pid ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
            <strong>{r.mover === pid ? "Ваш ход! Сейчас откроется доска" : r.mover ? "Ход у соперника" : right ? "Верно, но соперник был быстрее" : "Хода нет"}</strong>
          </div>
        </>
      ) : (
        <p>{r.points > 0 ? `+${r.points} очков ${r.mover === pid ? "вам" : "сопернику"}` : "Ход сделан"}</p>
      )}
      {smallBoard}
    </div>
  );
}
