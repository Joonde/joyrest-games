// «Ставка на знания»: экран зала (поле, вопрос, кот в мешке, ответ) и телефон гостя (кнопка, ставка).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BuzzButton } from "../../components/live/BuzzButton";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { useServerNow } from "../../components/live/useServerNow";
import { MediaImage, preloadMedia } from "../../components/media/MediaImage";
import { preloadTrack, useFragment } from "../../components/music/useFragment";
import { NameText } from "../../components/NameText";
import { buzzPhone, isBuzz } from "../../core/buzz";
import { placeOf } from "../../core/leaderboard";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { allCells, findCell, roundCategories, roundsOf, type BoardCell, type BoardContent } from "./content";
import { maxBet, parseBoardResult, type BoardResult } from "./logic";
import { showStageClass } from "../showLook";

/** Ответ гостя: нажатие кнопки или ставка в «Коте в мешке». */
export type BoardAnswerValue = { buzz: true } | { bet: number } | { give: string };

function useSoundOnChange(value: string, sound: Parameters<typeof playSound>[0]) {
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current !== value && value !== "") playSound(sound);
    previous.current = value;
  }, [value, sound]);
}

function playing(session: Session, content: BoardContent) {
  const result = parseBoardResult(session.state.result);
  const found = findCell(content, result.cell);
  return { result, cell: found?.cell ?? null, category: found?.category ?? null };
}

/** Кот в мешке — свой рисунок: мешок шевелится, из него выглядывает кот (только CSS-движение). */
export function CatInBag({ small = false }: { small?: boolean }) {
  return (
    <svg className={small ? "cat-bag cat-bag--small" : "cat-bag"} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="catBagFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E3C68C" />
          <stop offset="1" stopColor="#B08A55" />
        </linearGradient>
        <linearGradient id="catFur" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F3DFAE" />
          <stop offset="1" stopColor="#E3AA9C" />
        </linearGradient>
      </defs>
      <g className="cat-bag__cat">
        <path d="M62 78 L70 38 L92 64 Z" fill="url(#catFur)" stroke="#221E1B" strokeWidth="4" strokeLinejoin="round" />
        <path d="M138 78 L130 38 L108 64 Z" fill="url(#catFur)" stroke="#221E1B" strokeWidth="4" strokeLinejoin="round" />
        <path d="M70 46 L76 66 L86 62 Z" fill="#D2A0AC" />
        <path d="M130 46 L124 66 L114 62 Z" fill="#D2A0AC" />
        <ellipse cx="100" cy="92" rx="46" ry="38" fill="url(#catFur)" stroke="#221E1B" strokeWidth="4" />
        <g className="cat-bag__eyes">
          <ellipse cx="82" cy="88" rx="7" ry="9" fill="#221E1B" />
          <ellipse cx="118" cy="88" rx="7" ry="9" fill="#221E1B" />
          <circle cx="84.5" cy="85" r="2.6" fill="#FBF6F1" />
          <circle cx="120.5" cy="85" r="2.6" fill="#FBF6F1" />
        </g>
        <path d="M95 102 L105 102 L100 108 Z" fill="#C49E96" stroke="#221E1B" strokeWidth="2" strokeLinejoin="round" />
        <path d="M100 108 Q94 116 88 112 M100 108 Q106 116 112 112" fill="none" stroke="#221E1B" strokeWidth="3" strokeLinecap="round" />
        <path d="M62 100 L40 96 M62 106 L40 110 M138 100 L160 96 M138 106 L160 110" stroke="#221E1B" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <g className="cat-bag__bag">
        <path d="M34 118 Q100 104 166 118 Q178 160 156 186 Q100 198 44 186 Q22 160 34 118 Z" fill="url(#catBagFill)" stroke="#221E1B" strokeWidth="4" strokeLinejoin="round" />
        <path d="M40 124 Q100 112 160 124" fill="none" stroke="#221E1B" strokeWidth="4" strokeLinecap="round" />
        <path d="M60 128 Q64 132 58 138 M140 128 Q136 132 142 138" fill="none" stroke="#221E1B" strokeWidth="3" strokeLinecap="round" />
        <text x="100" y="168" textAnchor="middle" fontFamily="'Cormorant Garamond', serif" fontWeight="700" fontSize="30" fill="#221E1B">?</text>
      </g>
    </svg>
  );
}

/** Поле: строки — категории, колонки — стоимость. Сыгранные клетки погасли, играющая светится. */
export function BoardGrid({ content, result, small = false }: { content: BoardContent; result: BoardResult; small?: boolean }) {
  const categories = roundCategories(content, result.round);
  const columns = Math.max(1, ...categories.map((c) => c.cells.length));
  return (
    <div className={small ? "board-grid board-grid--small" : "board-grid"} style={{ ["--board-cols" as string]: columns }} role="table" aria-label="Поле «Ставки на знания»">
      {categories.map((category) => (
        <div key={category.id} className="board-grid__row" role="row">
          <div className="board-grid__title" role="rowheader">
            <span className="line-clamp">{category.title || "Категория"}</span>
          </div>
          {category.cells.map((cell) => {
            const opened = result.opened.includes(cell.id);
            const current = result.cell === cell.id;
            return (
              <div
                key={cell.id}
                role="cell"
                className={`board-grid__cell${opened ? " is-opened" : ""}${current ? " is-current" : ""}`}
                aria-label={opened ? `${category.title}, ${cell.points}: сыграна` : `${category.title}, ${cell.points}`}
              >
                {opened ? "" : cell.points}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Музыка и картинки клетки на экране зала: угадывание при открытии, припев при верном ответе. */
function useCellMedia(session: Session, content: BoardContent, cell: BoardCell | null, result: BoardResult) {
  const { stage, step } = session.state;
  // Заранее — картинки и треки всех клеток, что ещё не сыграны (поле небольшое).
  useEffect(() => {
    const left = allCells(content).filter(({ cell: c }) => !result.opened.includes(c.id));
    preloadMedia(session.gameId, left.map(({ cell: c }) => c.imageId), "full");
    left.slice(0, 6).forEach(({ cell: c }) => preloadTrack(c.trackId));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- раз на открытие поля
  }, [session.gameId, result.opened.length]);
  const music = cell && cell.trackId && result.mode === "buzz" ? cell : null;
  const chorus = stage === "reveal" && Boolean(result.buzz.winner) && music?.chorusStart !== null && music?.chorusStart !== undefined;
  // Ключ — клетка, а не шаг: «Запустить отсчёт» (новый шаг) не перезапускает фрагмент.
  const key = !music ? null : stage === "question" ? `q:${result.openStep ?? step}:${result.cell}:${result.replay}` : stage === "reveal" ? `r:${step}:${result.replay}` : null;
  useFragment(
    music?.trackId ?? null,
    chorus ? (music?.chorusStart ?? 0) : (music?.trackStart ?? 0),
    chorus ? (music?.chorusLength ?? 10) : stage === "reveal" ? Math.max(20, music?.trackLength ?? 0) : (music?.trackLength ?? 15),
    key,
    { options: { fadeIn: music?.fadeIn ?? 0, fadeOut: music?.fadeOut ?? 0 }, chorus: chorus ? music?.join : undefined, paused: stage === "question" && Boolean(result.buzz.current) },
  );
}

export function BoardScreenView({ session, content }: ViewProps<BoardContent>) {
  const { stage, step } = session.state;
  const { result, cell, category } = playing(session, content);
  const counting = stage === "question" && result.armed && !result.catStep && !result.buzz.current;
  const now = useServerNow(250, counting);
  const left = counting ? secondsLeft(session.state, now) : null;
  useCountdownSounds(left);
  useSoundOnChange(stage === "question" && result.armed && !result.catStep ? `${step}:armed` : "", "whoosh");
  useCellMedia(session, content, cell, result);
  useSoundOnChange(result.buzz.current ?? "", "gong");
  useSoundOnChange(stage === "reveal" && result.buzz.winner ? `${step}:win` : "", "correct");
  useSoundOnChange(stage === "question" && (result.mode === "bet" || result.mode === "auction") ? `${step}:cat` : "", "whoosh");
  useSoundOnChange(stage === "ready" ? `round:${result.round}` : "", "fanfare");
  const auctionNow = useServerNow(250, stage === "question" && result.mode === "auction");
  const auctionLeft = stage === "question" && result.mode === "auction" ? secondsLeft(session.state, auctionNow) : null;
  const name = (pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? null) : null);
  // Оформление «Студия» / «Вечер JoyRest» — фон-картинка и плашки телешоу (только вид, src/styles.css).
  const look = showStageClass(content.look);

  if (stage === "ready" || !cell) {
    const picker = name(result.picker);
    return (
      <div className={`board-screen${look}`}>
        <div className="board-screen__top">
          <span className="quiz-screen__badge">{roundsOf(content) > 1 ? `Ставка на знания · раунд ${result.round}` : "Ставка на знания"}</span>
          {picker ? (
            <span className="board-screen__picker">
              Выбирает: <NameText name={picker} />
            </span>
          ) : (
            <span className="board-screen__picker">Ведущий выбирает первую клетку</span>
          )}
        </div>
        <BoardGrid content={content} result={result} />
      </div>
    );
  }

  const head = (
    <div className="board-screen__top">
      <span className="quiz-screen__badge">{category?.title || "Ставка на знания"}</span>
      <span className="board-screen__points">
        {cell.kind === "cat" || cell.kind === "auction"
          ? `${cell.kind === "cat" ? "Кот в мешке" : "Аукцион"}${result.catStep && result.catTo ? ` · ${result.catPrice} очков` : ""}`
          : `${cell.points} очков`}
      </span>
    </div>
  );

  if (stage === "question" && result.mode === "auction") {
    // Сколько ставок сделано — пишет пульт (`answered`): экран ставок не видит.
    return (
      <div className={`board-screen board-screen--cat${look}`}>
        {head}
        <h2 className="board-screen__cat-title" data-shine="on">
          Аукцион!
        </h2>
        <p className="board-screen__hint">Ставьте очки на телефонах: на сколько играете. Кто поставит больше всех — отвечает на сложный вопрос. Верно — ставка ваша, неверно — минус ставка.</p>
        {auctionLeft !== null && (
          <span className={auctionLeft === 0 ? "board-screen__count is-over" : "board-screen__count"} role="timer">
            {auctionLeft === 0 ? "Ставки сделаны" : auctionLeft}
          </span>
        )}
        <p className="board-screen__hint">Ставок: {session.state.answered ?? 0}</p>
      </div>
    );
  }

  if (stage === "question" && result.mode === "bet") {
    const to = name(result.catTo);
    return (
      <div className={`board-screen board-screen--cat${look}`}>
        {head}
        <CatInBag />
        <h2 className="board-screen__cat-title" data-shine="on">
          Кот в мешке!
        </h2>
        {to ? (
          <p className="board-screen__cat-to" role="status">
            Вопрос достаётся: <NameText name={to} /> · цена {result.catPrice}
          </p>
        ) : (
          <p className="board-screen__hint">
            {name(result.pickerBefore) ? <><NameText name={name(result.pickerBefore) ?? ""} /> выбирает, кому отдать вопрос.</> : "Ведущий отдаёт вопрос одному игроку."} Он обязан ответить: верно — плюс цена, неверно — минус.
          </p>
        )}
      </div>
    );
  }

  const speaker = name(result.buzz.current);
  const winner = name(result.buzz.winner);
  const revealed = stage === "reveal";
  const confetti = revealed && winner && cell.confetti ? <Confetti burst={`board:${step}`} /> : null;
  return (
    <div className={`board-screen board-screen--question${cell.imageId ? " board-screen--image" : ""}${look}`}>
      {confetti}
      {head}
      <h2 className="board-screen__question">
        {cell.trackId && (
          <span className="quiz-screen__note" aria-hidden="true">
            ♪{" "}
          </span>
        )}
        {cell.text || (cell.trackId ? "Угадайте мелодию" : "Вопрос")}
      </h2>
      {cell.imageId && <MediaImage className="board-screen__image" gameId={session.gameId} mediaId={cell.imageId} variant="full" alt="" />}
      {revealed ? (
        <div className="board-screen__answer" role="status">
          {winner ? (
            <>
              <span className="board-screen__answer-who">
                Верно — <NameText name={winner} />
              </span>
              <strong>{cell.answer || "—"}</strong>
            </>
          ) : (
            <>
              <span className="board-screen__answer-who">Никто не ответил. Правильный ответ:</span>
              <strong>{cell.answer || "—"}</strong>
            </>
          )}
        </div>
      ) : speaker ? (
        <div className="board-screen__speaker" role="status" aria-live="assertive">
          <span>Отвечает</span>
          <strong>
            <NameText name={speaker} />
          </strong>
        </div>
      ) : !result.armed ? (
        <p className="board-screen__hint board-screen__hint--wait">Слушаем вопрос — кнопки включатся, когда ведущий запустит отсчёт</p>
      ) : (
        <div className="board-screen__go">
          {left !== null && (
            <span className={left === 0 ? "board-screen__count is-over" : "board-screen__count"} role="timer">
              {left === 0 ? "Время вышло" : left}
            </span>
          )}
          <p className="board-screen__hint">Знаете ответ — жмите кнопку на телефоне! Нажали: {result.buzz.order.length}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- телефон

function BetForm({ max, points, sending, onBet }: { max: number; points: number; sending: boolean; onBet: (bet: number) => void }) {
  const [value, setValue] = useState(String(Math.min(points, max)));
  const n = Math.round(Number(value));
  const valid = Number.isFinite(n) && n >= 1 && n <= max;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) onBet(n);
  }
  const quick = [...new Set([points, Math.max(1, Math.round(max / 2)), max])].filter((x) => x >= 1 && x <= max).sort((a, b) => a - b);
  return (
    <form className="stack bet-form" onSubmit={submit}>
      <label className="field">
        <span className="field__label">Ваша ставка — от 1 до {max}</span>
        <input type="number" inputMode="numeric" min={1} max={max} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="row bet-form__quick">
        {quick.map((x) => (
          <button key={x} type="button" className="pick-chip" aria-pressed={n === x} onClick={() => setValue(String(x))}>
            {x === max ? `Всё: ${x}` : x}
          </button>
        ))}
      </div>
      <button className="btn btn--block" type="submit" disabled={!valid || sending}>
        {sending ? "Отправляем…" : `Поставить ${valid ? n : ""}`}
      </button>
    </form>
  );
}

export function BoardPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<BoardContent, BoardAnswerValue>) {
  const { stage } = session.state;
  const { result, cell, category } = playing(session, content);
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const me = session.leaderboard[pid];
  const noScreen = session.screenMode === "none";
  const place = placeOf(session.leaderboard, pid);
  const scoreLine = me ? (
    <p className="muted small">
      Ваш счёт: {pointsLabel(me.score)}
      {place ? ` · ${place.place} место из ${place.total}` : ""}
    </p>
  ) : null;

  if (stage === "ready" || !cell) {
    const mine = result.picker === pid;
    return (
      <div className="quiz-phone quiz-phone--center">
        <p className="eyebrow">Ставка на знания</p>
        {mine ? (
          <div className="buzz__plate buzz__plate--glow" role="status">
            <strong>Вы выбираете клетку!</strong>
            <span>Назовите ведущему категорию и стоимость</span>
          </div>
        ) : (
          <h2>{result.picker && session.leaderboard[result.picker] ? <>Выбирает <NameText name={session.leaderboard[result.picker]?.name ?? ""} /></> : "Ведущий выбирает клетку"}</h2>
        )}
        {noScreen ? <BoardGrid content={content} result={result} small /> : <p className="muted">Смотрите на экран зала</p>}
        {scoreLine}
      </div>
    );
  }

  const title = (
    <p className="eyebrow">
      {category?.title || "Ставка на знания"} · {cell.kind === "cat" ? "Кот в мешке" : `${cell.points} очков`}
    </p>
  );

  if (stage === "question" && result.mode === "auction") {
    const placed = myAnswer && typeof myAnswer.value === "object" && myAnswer.value !== null ? (myAnswer.value as { bet?: unknown }).bet : undefined;
    const max = maxBet(me?.score ?? 0, cell.points);
    return (
      <div className="quiz-phone quiz-phone--center">
        {title}
        <h2>Аукцион!</h2>
        {role === "member" ? (
          <div className="buzz__plate" role="status">
            <strong>Ставку делает капитан</strong>
            <span>Подскажите ему, сколько ставить</span>
          </div>
        ) : typeof placed === "number" ? (
          <div className="buzz__plate buzz__plate--glow" role="status">
            <strong>Ставка принята: {Math.min(placed, max)}</strong>
            <span>Больше всех — отвечаете на вопрос</span>
          </div>
        ) : open ? (
          <BetForm max={max} points={cell.points} sending={sending} onBet={(bet) => onAnswer({ bet: Math.min(bet, max) })} />
        ) : (
          <p className="muted">Ставки закрыты.</p>
        )}
        {scoreLine}
      </div>
    );
  }

  if (stage === "question" && result.mode === "bet") {
    const me2 = result.catTo === pid;
    const giver = result.pickerBefore === pid && role !== "member";
    const gave = myAnswer && typeof myAnswer.value === "object" && myAnswer.value !== null ? (myAnswer.value as { give?: unknown }).give : undefined;
    const others = Object.keys(session.leaderboard).filter((p) => p !== pid);
    if (giver && !result.catTo) {
      return (
        <div className="quiz-phone">
          {title}
          <CatInBag small />
          <h2>Кот в мешке! Кому отдаёте вопрос?</h2>
          <p className="muted small">Тот, кого выберете, обязан ответить. Верно — плюс {result.catPrice || cell.points}, неверно — минус.</p>
          <div className="stack stack--tight">
            {others.map((p) => (
              <button key={p} type="button" className={gave === p ? "btn btn--block" : "btn btn--secondary btn--block"} disabled={sending || typeof gave === "string"} onClick={() => onAnswer({ give: p })}>
                <NameText name={session.leaderboard[p]?.name ?? ""} />
              </button>
            ))}
          </div>
          {typeof gave === "string" && <p className="success">Выбрано — ведущий объявит. Передумали — скажите ведущему.</p>}
          {scoreLine}
        </div>
      );
    }
    return (
      <div className="quiz-phone quiz-phone--center">
        {title}
        <CatInBag small />
        <h2>Кот в мешке!</h2>
        <div className={me2 ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
          {me2 ? (
            <>
              <strong>Вопрос достаётся вам!</strong>
              <span>Цена {result.catPrice} — отвечать обязательно</span>
            </>
          ) : result.catTo ? (
            <>
              <strong>
                Отвечает <NameText name={session.leaderboard[result.catTo]?.name ?? ""} />
              </strong>
              <span>Цена {result.catPrice}</span>
            </>
          ) : (
            <>
              <strong>{result.pickerBefore && session.leaderboard[result.pickerBefore] ? <><NameText name={session.leaderboard[result.pickerBefore]?.name ?? ""} /> выбирает, кому отдать вопрос</> : "Ведущий отдаёт вопрос"}</strong>
              <span>Кому достанется — тот и отвечает</span>
            </>
          )}
        </div>
        {scoreLine}
      </div>
    );
  }

  const pressed = myAnswer !== null && myAnswer !== undefined && isBuzz(myAnswer.value);
  // В «Коте в мешке» отвечает только тот, кому отдали вопрос; кнопки ни у кого нет.
  const noBet = result.catStep && !result.bets[pid];
  const phone = buzzPhone(result.buzz, pid, pressed, open && result.armed && role !== "member" && !noBet);
  const waiting = stage === "question" && !result.armed;
  const speakerId = result.buzz.winner ?? result.buzz.current;
  const speaker = speakerId ? (session.leaderboard[speakerId]?.name ?? null) : null;
  const myBet = result.bets[pid];
  return (
    <div className="quiz-phone quiz-phone--center">
      {title}
      {noScreen && <h2 className="quiz-phone__question">{cell.text || "Угадайте мелодию"}</h2>}
      {noScreen && cell.imageId && <MediaImage className="quiz-phone__image" gameId={session.gameId} mediaId={cell.imageId} variant="small" alt="" />}
      {result.catStep && stage === "question" ? (
        <div className="buzz">
          <div className={myBet ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
            <strong>{myBet ? "Отвечаете вы — говорите ведущему!" : speaker ? <>Отвечает <NameText name={speaker} /></> : "Ведущий выбирает, кто отвечает"}</strong>
            <span>
              {cell.kind === "auction" ? "Аукцион" : "Кот в мешке"} · цена {result.catPrice || myBet || cell.points}
            </span>
          </div>
        </div>
      ) : waiting && role !== "member" ? (
        <div className="buzz">
          <div className="buzz__plate" role="status">
            <strong>Слушайте вопрос</strong>
            <span>Кнопка включится, когда ведущий запустит отсчёт — нажатие раньше не засчитается</span>
          </div>
        </div>
      ) : role === "member" ? (
        <div className="buzz">
          <div className="buzz__plate" role="status">
            <strong>Кнопку жмёт капитан</strong>
            <span>{speaker ? `Отвечает ${speaker}` : "Подскажите капитану ответ"}</span>
          </div>
        </div>
      ) : (
        <BuzzButton state={phone.state} place={phone.place} speaker={speaker} sending={sending} onPress={() => onAnswer({ buzz: true })} />
      )}
      {stage === "reveal" && (
        <p>
          Правильный ответ: <strong>{cell.answer || "—"}</strong>
        </p>
      )}
      {scoreLine}
    </div>
  );
}

