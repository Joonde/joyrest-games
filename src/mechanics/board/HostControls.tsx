import { useEffect } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { useHostRun } from "../../components/live/useHostRun";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { HostControlsProps } from "../types";
import { allCells, CELL_MARKS, CELL_TITLES, findCell, roundCategories, roundsOf, type BoardContent } from "./content";
import { armBuzz, boardBack, boardBuzzSync, boardPrimary, boardReveal, boardWrong, CAT_MAX, catGiveOf, collectBets, nextRound, openCell, parseBoardResult, replayCell, roundCells, setCat, startAuction, startCatQuestion, toBoard } from "./logic";

/** Момент игры для повтора касания: без нажатий кнопки и выбора «Кота в мешке» (их пишет фон пульта). */
function boardMoment(s: Session): string {
  const r = parseBoardResult(s.state.result);
  return JSON.stringify([r.mode, r.cell, r.opened.length, r.round, r.catStep, r.armed, r.picker]);
}

/**
 * Пульт «Ставки на знания»: поле с метками клеток (видит только ведущий) → касание клетки → кнопка
 * «кто первый» у гостей → «Верно» / «Неверно» → «К полю» (клетка гаснет). Крупная кнопка
 * «Таблица очков на экран» — в любой момент, потом «Убрать таблицу».
 */
export function BoardHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<BoardContent>) {
  const { busy, error, setError, latest, run, quiet } = useHostRun(session, control, rehearsal, { moment: boardMoment });
  const { stage, step } = session.state;
  const result = parseBoardResult(session.state.result);
  const found = findCell(content, result.cell);
  const cell = found?.cell ?? null;
  const timed = stage === "question" && ((result.armed && !result.catStep) || result.mode === "auction");
  const now = useServerNow(250, timed);
  const left = timed ? secondsLeft(session.state, now) : null;

  // Пришло нажатие — слово первому, кто ещё не ошибся (пишет любой открытый пульт, `expect` их мирит).
  const syncKey = stage === "question" && result.mode === "buzz" ? answers.filter((a) => a.step === step).map((a) => `${a.pid}:${a.submittedAt ?? 0}`).sort().join(",") : "";
  useEffect(() => {
    if (!syncKey || busy) return;
    void quiet((cur) => boardBuzzSync(cur, answers));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт при новых нажатиях и смене слова
  }, [syncKey, result.buzz.current, result.buzz.order.length, busy]);

  // «Кот в мешке»: выбор того, кто выбирал клетку, сразу на экран (ведущий может поправить).
  const catGive = stage === "question" && result.mode === "bet" ? catGiveOf(session, answers) : null;
  useEffect(() => {
    if (!catGive || busy || catGive === result.catTo) return;
    const price = result.catPrice > 0 ? result.catPrice : (cell?.points ?? 0);
    void quiet((cur) => setCat(cur, catGive, price));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- новый выбор игрока (и после записи ведущего)
  }, [catGive, busy]);

  // «Аукцион»: экран показывает, сколько ставок сделано, — пульт пишет счётчик не чаще раза в 2 секунды.
  const betCount = stage === "question" && result.mode === "auction" ? Object.keys(collectBets(answers, step)).length : -1;
  useEffect(() => {
    if (betCount < 0 || betCount === (session.state.answered ?? 0) || rehearsal) return;
    const timer = window.setTimeout(() => {
      const { phase, step: atStep, stage: atStage } = latest.current.state;
      void control.apply({ state: { answered: betCount }, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    }, 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при новом числе ставок
  }, [betCount]);

  // «Верно» / «Неверно» — тому, кто отвечал, когда ведущий нажал: повтор по свежей игре не тронет следующего.
  const sameSpeaker = (s: Session) => parseBoardResult(s.state.result).buzz.current === result.buzz.current;
  const nameOf = (pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? participants.find((p) => p.id === pid)?.name ?? "Игрок") : "");
  const peek = session.state.peek ?? null;
  const rounds = roundsOf(content);
  const total = roundCells(content, result.round).length;
  const played = roundCells(content, result.round).filter(({ cell: c }) => result.opened.includes(c.id)).length;
  const fieldCats = roundCategories(content, result.round);
  const primary = boardPrimary(session, content);
  const backPlan = boardBack(session, content);

  const peekButton = session.screenMode !== "none" && (
    <button
      type="button"
      className={peek === "total" ? "btn btn--block board-host__peek is-on" : "btn btn--block board-host__peek"}
      aria-pressed={peek === "total"}
      onClick={() => void control.apply({ state: { peek: peek === "total" ? null : "total" } }).catch(() => setError("Не получилось. Проверьте интернет."))}
    >
      {peek === "total" ? "Убрать таблицу с экрана" : "Таблица очков на экран"}
    </button>
  );

  const backButton = (
    <button type="button" className="btn btn--secondary btn--block" disabled={busy || backPlan === null} onClick={() => backPlan && void run((s) => boardBack(s, content)?.change ?? null, backPlan.clear)}>
      Назад
    </button>
  );

  const errorLine = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );

  if (stage === "podium") {
    return (
      <div className="stack host-quiz">
        <p className="eyebrow">Награждение</p>
        <PodiumHostList session={session} />
        {errorLine}
        <div className="actions">
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => (primary === "finish" ? control.requestFinish() : void run((s) => podiumNext(s)))}>
            {primary === "finish" ? "Завершить игру" : "Открыть следующее место"}
          </button>
          {backButton}
        </div>
      </div>
    );
  }

  const endButton =
    primary === "nextRound" ? (
      <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => nextRound(s, content))}>
        Раунд {result.round} сыгран — следующий раунд
      </button>
    ) : (
      (primary === "podium" || primary === "finish") && (
        <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => (primary === "podium" ? void run((s) => awardNow(s)) : control.requestFinish())}>
          {primary === "podium" ? "Все клетки сыграны — награждение" : "Завершить игру"}
        </button>
      )
    );

  if (stage === "ready" || !cell) {
    return (
      <div className="stack host-quiz board-host">
        <p className="eyebrow">
          Ставка на знания{rounds > 1 ? ` · раунд ${result.round} из ${rounds}` : ""} · сыграно {played} из {total}
        </p>
        {peekButton}
        <p className="muted small">
          {result.picker ? (
            <>
              Выбирает <NameText name={nameOf(result.picker)} />. Коснитесь клетки, которую назвали.
            </>
          ) : (
            "Коснитесь клетки, чтобы открыть вопрос. Метки ♪, фото и «кот» видите только вы."
          )}
        </p>
        {/* На телефоне в ряд помещается 6 клеток; шире поле — листается вбок, говорим об этом. */}
        {Math.max(1, ...fieldCats.map((c) => c.cells.length)) > 6 && <p className="board-host__scroll-hint">Поле шире экрана — листайте клетки вбок →</p>}
        <div className="board-host__grid" style={{ ["--board-cols" as string]: Math.max(1, ...fieldCats.map((c) => c.cells.length)) }}>
          {fieldCats.map((category) => (
            <div key={category.id} className="board-host__row">
              <span className="board-host__title line-clamp">{category.title || "Категория"}</span>
              {category.cells.map((c) => {
                const opened = result.opened.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`board-host__cell${opened ? " is-opened" : ""}${c.kind === "cat" || c.kind === "auction" ? " is-cat" : ""}`}
                    disabled={busy || opened}
                    aria-label={`${category.title}, ${c.points}, ${CELL_TITLES[c.kind]}${opened ? ", сыграна" : ""}`}
                    onClick={() => void run((s) => openCell(s, content, c.id))}
                  >
                    <span>{opened ? "—" : c.points}</span>
                    {!opened && CELL_MARKS[c.kind] && <small>{CELL_MARKS[c.kind]}</small>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {errorLine}
        <div className="actions">
          {endButton}
          {backButton}
        </div>
      </div>
    );
  }

  const header = (
    <div className="stack stack--tight">
      <p className="eyebrow">
        {found?.category.title || "Ставка на знания"} · {cell.points} · {CELL_TITLES[cell.kind]}
      </p>
      <p className="host-quiz__question">{cell.text || (cell.trackId ? "Узнайте песню" : "—")}</p>
      <p className="muted small">
        Верный ответ: <strong className="host-quiz__answer">{cell.answer || "—"}</strong>
      </p>
    </div>
  );

  if (stage === "question" && result.mode === "auction") {
    const bets = collectBets(answers, step);
    return (
      <div className="stack host-quiz board-host">
        {header}
        <p className="muted small">Аукцион: гости ставят очки на телефонах. Больше всех — отвечает один (при равных — кто раньше). Верно — плюс ставка, неверно — минус. Ставок нет — отвечает выбиравший клетку.</p>
        <div className="host-quiz__live" aria-live="polite">
          <span className={left === 0 ? "host-quiz__timer is-over" : "host-quiz__timer"} role="timer">
            {left === null ? "∞" : left === 0 ? "Время вышло" : `${left} с`}
          </span>
          <span>
            Ставок: <strong>{Object.keys(bets).length}</strong>
          </span>
        </div>
        {Object.keys(bets).length > 0 && (
          <ul className="buzz-queue buzz-queue--plain">
            {Object.entries(bets)
              .sort((a, b) => b[1] - a[1])
              .map(([pid, bet]) => (
                <li key={pid}>
                  <span className="buzz-queue__name">
                    <NameText name={nameOf(pid)} />
                  </span>
                  <span className="buzz-queue__state">{bet}</span>
                </li>
              ))}
          </ul>
        )}
        {errorLine}
        <div className="actions">
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(async (s) => startAuction(s, content, await control.freshAnswers(step).catch(() => answers)))}>
            Ставки сделаны — показать вопрос
          </button>
          {backButton}
        </div>
      </div>
    );
  }

  if (stage === "question" && result.mode === "bet") {
    // «Кот в мешке»: выбравший клетку отдаёт вопрос другому игроку (с телефона или называет ведущему); ставок нет.
    const pool = Object.keys(session.leaderboard).filter((pid) => pid !== result.pickerBefore || Object.keys(session.leaderboard).length < 2);
    const prices = [...new Set([...allCells(content).map(({ cell: c }) => c.points), cell.points])].filter((n) => n > 0).sort((a, b) => a - b);
    const price = result.catPrice > 0 ? result.catPrice : cell.points;
    return (
      <div className="stack host-quiz board-host">
        {result.catTo && (
          <p className="mil-host-live" role="status">
            🐱 {result.pickerBefore ? <><NameText name={nameOf(result.pickerBefore)} /> отдаёт вопрос: </> : "Вопрос достаётся: "}
            <strong>
              <NameText name={nameOf(result.catTo)} />
            </strong>
          </p>
        )}
        {header}
        <p className="muted small">
          Кот в мешке! {result.pickerBefore ? <><NameText name={nameOf(result.pickerBefore)} /> выбирает на телефоне, кому отдать вопрос (себе нельзя) — или назовёт вам, коснитесь имени.</> : "Отдайте вопрос одному игроку."} Ставок нет: он обязан ответить, верно — плюс цена и право выбора, неверно — минус цена.
        </p>
        <fieldset className="stack stack--tight">
          <legend>Кому достаётся вопрос</legend>
          <div className="board-cat__who">
            {pool.map((pid) => (
              <button key={pid} type="button" className="pick-chip" aria-pressed={result.catTo === pid} disabled={busy} onClick={() => void run((s) => setCat(s, pid, price))}>
                <NameText name={nameOf(pid)} />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="stack stack--tight">
          <legend>Цена вопроса</legend>
          <div className="row">
            {prices.map((n) => (
              <button key={n} type="button" className="pick-chip" aria-pressed={price === n} disabled={busy} onClick={() => void run((s) => setCat(s, result.catTo, n))}>
                {n}
              </button>
            ))}
          </div>
          <label className="field">
            Своя цена (1–{CAT_MAX})
            <input type="number" inputMode="numeric" min={1} max={CAT_MAX} defaultValue={price} key={price} onBlur={(e) => Number(e.target.value) !== price && void run((s) => setCat(s, result.catTo, Number(e.target.value)))} />
          </label>
        </fieldset>
        {errorLine}
        <div className="actions">
          <button
            type="button"
            className="btn btn--block host-quiz__primary"
            disabled={busy || !result.catTo}
            onClick={() => void run((s) => startCatQuestion(s, content))}
          >
            {result.catTo ? `Показать вопрос — отвечает ${nameOf(result.catTo)}, цена ${price}` : "Выберите, кому отдать вопрос"}
          </button>
          {backButton}
        </div>
      </div>
    );
  }

  const speaking = stage === "question" ? result.buzz.current : null;
  return (
    <div className="stack host-quiz board-host">
      {/* Кто нажал первым — сразу сверху, над текстом вопроса (14 октября 2026). */}
      {speaking && (
        <div className="host-buzz" role="status" aria-live="assertive">
          <span className="host-buzz__label">Отвечает{result.catStep && result.bets[speaking] ? ` · ставка ${result.bets[speaking]}` : ""}</span>
          <span className="host-buzz__name">
            <NameText name={nameOf(speaking)} />
          </span>
          <div className="host-buzz__verdict">
            <button type="button" className="btn" disabled={busy} onClick={() => void run((s) => (sameSpeaker(s) ? boardReveal(s, content, participants, true) : null))}>
              Верно
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              // У «Кота в мешке» отвечает один — «Неверно» сразу показывает ответ (минус цена).
              onClick={() => void run((s) => (!sameSpeaker(s) ? null : parseBoardResult(s.state.result).catStep ? boardReveal(s, content, participants, false) : boardWrong(s, content)))}
            >
              Неверно
            </button>
          </div>
        </div>
      )}
      {header}
      {peekButton}
      {stage === "question" && !result.armed && (
        <div className="board-host__arm">
          <p>Прочитайте вопрос вслух. Кнопки у гостей пока не активны — фальстарта не будет.</p>
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => armBuzz(s, content))}>
            Запустить отсчёт · {content.buzzTime} с
          </button>
        </div>
      )}
      {stage === "question" && result.armed && !speaking && left !== null && (
        <div className="host-quiz__live" aria-live="polite">
          <span className={left === 0 ? "host-quiz__timer is-over" : "host-quiz__timer"} role="timer">
            {left === 0 ? "Время вышло" : `${left} с`}
          </span>
        </div>
      )}
      {stage === "question" && result.armed && !speaking && (
        <p className="muted">
          {rehearsal ? "Репетиция: гостей нет — проверьте ход кнопками." : `Ждём нажатия. Нажали: ${result.buzz.order.length}`}
          {content.penalty && cell.kind !== "cat" ? ` · неверный ответ: −${cell.points}` : ""}
        </p>
      )}
      {stage === "reveal" && (
        <p className="success">
          {result.buzz.winner ? (
            <>
              Верно ответил(а) <NameText name={nameOf(result.buzz.winner)} />
            </>
          ) : (
            "Никто не ответил верно"
          )}
        </p>
      )}
      {result.buzz.order.length > 0 && (
        <section className="stack stack--tight" aria-label="Очередь нажатий">
          <h3 className="host-quiz__subtitle">Очередь нажатий</h3>
          <ol className="buzz-queue">
            {result.buzz.order.map((pid, i) => {
              const out = result.buzz.out.includes(pid);
              const active = result.buzz.current === pid || result.buzz.winner === pid;
              return (
                <li key={pid} className={out ? "is-out" : active ? "is-now" : undefined}>
                  <span className="buzz-queue__n">{i + 1}</span>
                  <span className="buzz-queue__name">
                    <NameText name={nameOf(pid)} />
                  </span>
                  <span className="buzz-queue__state">{result.buzz.winner === pid ? "верно" : result.buzz.current === pid ? "отвечает" : out ? "мимо ✕" : "ждёт"}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {errorLine}
      <div className="actions">
        {stage === "question" && result.armed && (
          <button type="button" className={speaking ? "btn btn--quiet btn--block" : "btn btn--block host-quiz__primary"} disabled={busy} onClick={() => void run((s) => boardReveal(s, content, participants, false))}>
            Никто не угадал — показать ответ
          </button>
        )}
        {stage === "reveal" && primary === "toBoard" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => toBoard(s))}>
            К полю
          </button>
        )}
        {stage === "reveal" && endButton}
        {cell.trackId && session.screenMode !== "none" && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run((s) => replayCell(s))}>
            ♪ Повторить фрагмент
          </button>
        )}
        {backButton}
      </div>
    </div>
  );
}
