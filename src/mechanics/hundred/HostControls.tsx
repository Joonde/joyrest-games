// Пульт «100 к 1»: ведущий видит все ответы табло с синонимами и открывает их касанием; «✕ Нет на табло» —
// крестик; «Играют …» после розыгрыша; «Большая игра» — ответы игроков касанием; «Весь зал» — нераспознанные
// ответы гостей и табло по одному ответу. «Назад» — одно действие вместе с очками.
import { useEffect, useRef, useState } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { leaderboardAdditions } from "../../core/leaderboard";
import { podiumNext } from "../../core/podium";
import { resultKey, secondsLeft } from "../../core/session";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { answerPoints, HUNDRED_LIMITS, multiplierOf, ranked, ROUND_TITLES, sourceLine, type HundredContent, type HundredQuestion, type RoundKind } from "./content";
import {
  armFace,
  bigEnter,
  bigFinish,
  bigSecond,
  bigStart,
  bigTotal,
  choosePlaying,
  defaultPair,
  hallClose,
  hallAccept,
  hallNumber,
  hallOpen,
  hallOpenNext,
  hitsOf,
  hundredAward,
  hundredBack,
  hundredBuzzSync,
  hundredPrimary,
  missAnswer,
  nextQuestion,
  openAnswer,
  opponentOf,
  orderedIds,
  parseHundredResult,
  questionOf,
  roundOf,
  setBigTeam,
  setPair,
  showRest,
  startFace,
  type HundredResult,
} from "./logic";
import { unmatchedWords } from "./match";

function AnswerList({ question, kind, r, disabled, hall, onTap }: { question: HundredQuestion; kind: RoundKind; r: HundredResult; disabled: boolean; hall: boolean; onTap: (id: string) => void }) {
  return (
    <ol className="hd-host__list" aria-label="Ответы табло">
      {ranked(question).map((a, i) => {
        const open = r.opened.includes(a.id);
        const shown = r.shown.includes(a.id);
        return (
          <li key={a.id}>
            <button type="button" className={`hd-host__row${open ? " is-open" : ""}${shown ? " is-shown" : ""}`} disabled={disabled || open || shown} onClick={() => onTap(a.id)}>
              <span className="hd-host__n">{open || shown ? "✓" : i + 1}</span>
              <span className="hd-host__text">
                <strong>{a.text}</strong>
                {a.synonyms.length > 0 && <small>ещё: {a.synonyms.join(", ")}</small>}
                {(open || shown) && <small>{shown ? "открыто без очков" : hall ? `открыто · угадали: ${hitsOf(r, a.id)}` : "открыто"}</small>}
              </span>
              <span className="hd-host__points">{answerPoints(kind, question, a.id)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function HundredHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<HundredContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Session>(session);
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    latest.current = session;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);
  const { stage, step } = session.state;
  const r = parseHundredResult(session.state.result);
  const round = roundOf(content, r);
  const question = questionOf(content, r);
  const timed = stage === "question" && session.state.timeLimit !== null;
  const now = useServerNow(250, timed);
  const left = timed ? secondsLeft(session.state, now) : null;

  // Нажатия «Жми первым!» — слово первому из играющей пары (пишет любой открытый пульт, `expect` их мирит).
  const syncKey = stage === "question" && r.mode === "face" && r.armed ? answers.filter((a) => a.step === step).map((a) => `${a.pid}:${a.submittedAt ?? 0}`).sort().join(",") : "";
  useEffect(() => {
    if (!syncKey || busy) return;
    const change = hundredBuzzSync(latest.current, answers);
    if (!change) return;
    const { phase, step: atStep, stage: atStage } = latest.current.state;
    void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт при новых нажатиях и смене слова
  }, [syncKey, r.buzz.current, r.buzz.order.length, busy]);

  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: SessionChange | null | (() => Promise<SessionChange | null>), clear?: number[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    const seen = resultKey(session.state.result);
    try {
      const change = typeof make === "function" ? await make() : make;
      if (!change) return;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      const cur = latest.current.state;
      if (clear && clear.length > 0 && (cur.step !== atStep || cur.stage !== atStage || cur.phase !== phase || resultKey(cur.result) !== seen)) return;
      for (const s of clear ?? []) await control.clearAnswers(s);
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage, result: seen } });
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  /** Свежие ответы зала с сервера перед начислением очков. */
  const withAnswers = (make: (list: Answer[]) => SessionChange | null) => async () => make(await control.freshAnswers(step).catch(() => answers));

  // «Каждый сам»: лидер играет «Большую игру» сам в два захода (вместо двух игроков команды).
  const solo = session.playMode === "solo";
  const bigWho = (n: number) => (solo ? `${n === 0 ? "первый" : "второй"} заход` : `${n === 0 ? "первый" : "второй"} игрок`);
  const nameOf = (pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? participants.find((p) => p.id === pid)?.name ?? (solo ? "Игрок" : "Команда")) : "");
  const peek = session.state.peek ?? null;
  const backPlan = hundredBack(session, content, answers);
  const primary = hundredPrimary(session, content);
  const board = { ...session.leaderboard, ...leaderboardAdditions(session.leaderboard, participants, session.playMode) };
  const ordered = orderedIds({ ...session, leaderboard: board }, participants);

  const peekButton = session.screenMode !== "none" && (
    <button
      type="button"
      className={peek === "total" ? "btn btn--secondary btn--block is-on" : "btn btn--secondary btn--block"}
      aria-pressed={peek === "total"}
      onClick={() => void control.apply({ state: { peek: peek === "total" ? null : "total" } }).catch(() => setError("Не получилось. Проверьте интернет."))}
    >
      {peek === "total" ? "Убрать таблицу с экрана" : "Таблица очков на экран"}
    </button>
  );
  const backButton = (
    <button type="button" className="btn btn--secondary btn--block" disabled={busy || backPlan === null} onClick={() => backPlan && void run(backPlan.change, backPlan.clear)}>
      Назад
    </button>
  );
  const errorLine = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );
  const nextButton = (label: string) =>
    primary === "award" ? (
      <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(hundredAward(session))}>
        Все раунды сыграны — награждение
      </button>
    ) : (
      <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(() => Promise.resolve(nextQuestion(latest.current, content, participants)))}>
        {label}
      </button>
    );

  if (stage === "podium") {
    return (
      <div className="stack host-quiz">
        <p className="eyebrow">Награждение</p>
        <PodiumHostList session={session} />
        {errorLine}
        <div className="actions">
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => (primary === "finish" ? control.requestFinish() : void run(podiumNext(session)))}>
            {primary === "finish" ? "Завершить игру" : "Открыть следующее место"}
          </button>
          {backButton}
        </div>
      </div>
    );
  }

  if (!round || !question) {
    return (
      <div className="stack host-quiz">
        <p className="muted">В игре нет вопросов.</p>
        <div className="actions">
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(hundredAward(session))}>
            Награждение
          </button>
          {backButton}
        </div>
      </div>
    );
  }

  const mult = multiplierOf(round.kind);
  const roundNo = `раунд ${r.round + 1} из ${content.rounds.length}`;
  const hall = content.mode === "hall";
  const timer = left !== null && (
    <span className={left === 0 ? "host-quiz__timer is-over" : "host-quiz__timer"} role="timer">
      {left === 0 ? "Время вышло" : `${left} с`}
    </span>
  );
  const head = (
    <div className="stack stack--tight">
      <p className="eyebrow">
        {hall ? `Весь зал · вопрос ${hallNumber(content, r).n} из ${hallNumber(content, r).total}` : `${ROUND_TITLES[round.kind]} · ${roundNo}`}
        {!hall && round.kind !== "big" && r.mode !== "intro" ? ` · банк ${r.bank}${mult > 1 ? ` × ${mult}` : ""}` : ""}
      </p>
      <p className="host-quiz__question">{question.text}</p>
      <p className="muted small">{sourceLine(question)}</p>
    </div>
  );

  // ---------------------------------------------------------------- заставка
  if (r.mode === "intro") {
    const big = round.kind === "big" && !hall;
    const pair = r.pair.length > 0 ? r.pair : defaultPair(content, ordered, r.round);
    const team = r.big.team ?? null;
    return (
      <div className="stack host-quiz hd-host">
        <p className="eyebrow">
          {hall ? `Весь зал · вопрос ${hallNumber(content, r).n} из ${hallNumber(content, r).total}` : `${ROUND_TITLES[round.kind]} · ${roundNo}`}
        </p>
        <p className="muted small">На экране — заставка раунда{round.kind === "reverse" ? ": в «Игре наоборот» дороже самые редкие ответы (15 … 240)" : mult > 1 ? `: очки ×${mult}` : ""}.</p>
        {!hall && !big && ordered.length > 2 && (
          <fieldset className="stack stack--tight">
            <legend>Кто играет раунд (двое)</legend>
            <div className="row">
              {ordered.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="pick-chip"
                  aria-pressed={pair.includes(p)}
                  disabled={busy}
                  onClick={() => {
                    const next = pair.includes(p) ? pair.filter((x) => x !== p) : [...pair, p].slice(-2);
                    void run(setPair(session, participants, next));
                  }}
                >
                  <NameText name={nameOf(p)} />
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {!hall && !big && (
          <p>
            Играют: {pair.length > 0 ? pair.map((p, i) => <span key={p}>{i > 0 ? " и " : ""}<NameText name={nameOf(p)} /></span>) : "ждём гостей"}
          </p>
        )}
        {big && (
          <fieldset className="stack stack--tight">
            <legend>Кто играет «Большую игру» (по умолчанию — лидер)</legend>
            <div className="row">
              {ordered.map((p) => (
                <button key={p} type="button" className="pick-chip" aria-pressed={team === p} disabled={busy} onClick={() => void run(setBigTeam(session, participants, p))}>
                  <NameText name={nameOf(p)} /> · {session.leaderboard[p]?.score ?? 0}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {peekButton}
        {errorLine}
        <div className="actions">
          <button
            type="button"
            className="btn btn--block host-quiz__primary"
            disabled={busy || (!hall && !big && pair.length === 0)}
            onClick={() => void run(() => Promise.resolve(hall ? hallOpen(latest.current, content, participants) : big ? bigStart(latest.current, content, participants) : startFace(latest.current, content, participants)))}
          >
            {hall ? `Открыть вопрос · ${content.hallTime} с` : big ? `${solo ? "Запустить таймер · первый заход" : "Запустить таймер первому игроку"} · ${content.bigTimes[0]} с` : "Показать вопрос"}
          </button>
          {backButton}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- «Большая игра»
  if (r.mode === "big" || r.mode === "bigDone") {
    const p = r.big.player;
    const total = bigTotal(r.big);
    return (
      <div className="stack host-quiz hd-host">
        <p className="eyebrow">
          Большая игра · <NameText name={nameOf(r.big.team)} /> · {r.mode === "bigDone" ? "итог" : bigWho(p)}
        </p>
        <div className="host-quiz__live" aria-live="polite">
          {timer}
          <span>
            Очки: <strong>{total}</strong> из {content.bigGoal}
          </span>
        </div>
        {r.big.repeat !== null && (
          <p className="mil-host-live" role="alert">
            {solo ? "Повтор своего ответа из первого захода" : "Повтор ответа первого игрока"} в вопросе {r.big.repeat + 1} — «Повтор, другой ответ!»
          </p>
        )}
        {r.mode === "big" && (
          <p className="muted small">
            Игрок отвечает вслух — коснитесь его ответа под вопросом или «Нет на табло».{" "}
            {solo ? "Во втором заходе свои ответы из первого повторять нельзя." : "Ответ первого игрока второму повторять нельзя."}
          </p>
        )}
        {round.questions.map((q, i) => {
          const mine = r.big.cells[p][i];
          const first = r.big.cells[0][i];
          return (
            <section key={q.id} className="stack stack--tight hd-host__big">
              <h3 className="host-quiz__subtitle">
                {i + 1}. {q.text}
              </h3>
              <p className="muted small">
                {p === 1 || r.mode === "bigDone" ? `Первый: ${first ? `${first.text} · ${first.points}` : "—"}` : ""}
                {p === 1 || r.mode === "bigDone" ? ` · второй: ${r.big.cells[1][i] ? `${r.big.cells[1][i]?.text} · ${r.big.cells[1][i]?.points}` : "—"}` : mine ? `Ответ: ${mine.text} · ${mine.points}` : ""}
              </p>
              {r.mode === "big" && (
                <div className="row">
                  {ranked(q).map((a) => (
                    <button key={a.id} type="button" className="pick-chip" aria-pressed={mine?.answer === a.id} disabled={busy || (p === 1 && first?.answer === a.id)} title={a.synonyms.length > 0 ? `ещё: ${a.synonyms.join(", ")}` : undefined} onClick={() => void run(bigEnter(session, content, participants, i, a.id))}>
                      {a.text} · {a.points}
                    </button>
                  ))}
                  <button type="button" className="pick-chip" aria-pressed={Boolean(mine) && mine?.answer === null} disabled={busy} onClick={() => void run(bigEnter(session, content, participants, i, null))}>
                    ✕ Нет на табло
                  </button>
                </div>
              )}
            </section>
          );
        })}
        {r.mode === "bigDone" && (
          <p className="success">
            {total >= content.bigGoal ? `Цель взята! ${total} + бонус ${content.bigBonus}` : `${total} из ${content.bigGoal}`} → <NameText name={nameOf(r.winner)} /> +{r.award}
          </p>
        )}
        {peekButton}
        {errorLine}
        <div className="actions">
          {primary === "bigStart" && (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(() => Promise.resolve(bigStart(latest.current, content, participants)))}>
              {solo ? `Запустить таймер · ${bigWho(p)}` : `Запустить таймер ${p === 0 ? "первому" : "второму"} игроку`} · {content.bigTimes[p]} с
            </button>
          )}
          {(primary === "bigSecond" || (r.mode === "big" && p === 0 && primary === "bigEnter")) && (
            <button type="button" className={primary === "bigSecond" ? "btn btn--block host-quiz__primary" : "btn btn--quiet btn--block"} disabled={busy} onClick={() => void run(bigSecond(session, participants))}>
              {solo ? "Первый заход окончен — второй заход" : "Первый игрок ответил — второй игрок"}
            </button>
          )}
          {(primary === "bigFinish" || (r.mode === "big" && p === 1 && primary === "bigEnter")) && (
            <button type="button" className={primary === "bigFinish" ? "btn btn--block host-quiz__primary" : "btn btn--quiet btn--block"} disabled={busy} onClick={() => void run(bigFinish(session, content, participants))}>
              Подвести итог Большой игры
            </button>
          )}
          {r.mode === "bigDone" && (primary === "award" || primary === "next") && nextButton("Следующий раунд")}
          {backButton}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- «Весь зал»
  if (r.mode === "hall" || r.mode === "hallCheck") {
    const odd = r.mode === "hallCheck" ? unmatchedWords(question, answers.filter((a) => a.step === step), r.accepted) : [];
    return (
      <div className="stack host-quiz hd-host">
        {head}
        {r.mode === "hall" ? (
          <>
            <div className="host-quiz__live" aria-live="polite">
              {timer}
              <span>
                Ответили: <strong>{answers.filter((a) => a.step === step).length}</strong>
              </span>
            </div>
            <p className="muted small">Гости пишут до трёх ответов на телефонах. Время вышло или все ответили — «Закрыть ответы».</p>
          </>
        ) : (
          <>
            {odd.length > 0 && (
              <section className="stack stack--tight" aria-label="Нераспознанные ответы">
                <h3 className="host-quiz__subtitle">Не распознано — засчитать?</h3>
                <p className="muted small">Например, «конверт» — это «деньги в конверте». Засчитанный ответ приносит очки, когда его строка открыта.</p>
                <ul className="hd-host__odd">
                  {odd.slice(0, 30).map((u) => (
                    <li key={u.key}>
                      <span>
                        «{u.label}» · {u.count}
                      </span>
                      <select
                        aria-label={`Засчитать «${u.label}» как`}
                        value=""
                        disabled={busy}
                        onChange={(e) => {
                          const to = e.target.value;
                          if (to) void run(withAnswers((list) => hallAccept(latest.current, content, participants, list, u.key, to === "-" ? "" : to)));
                        }}
                      >
                        <option value="">Засчитать как…</option>
                        {ranked(question).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.text}
                          </option>
                        ))}
                        <option value="-">Не засчитывать</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="muted small">Касание строки открывает её на табло, угадавшие сразу получают очки{mult > 1 ? ` ×${mult}` : ""}.</p>
          </>
        )}
        {r.mode === "hallCheck" && <AnswerList question={question} kind={round.kind} r={r} disabled={busy} hall onTap={(id) => void run(withAnswers((list) => openAnswer(latest.current, content, participants, id, list)))} />}
        {peekButton}
        {errorLine}
        <div className="actions">
          {r.mode === "hall" && (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(hallClose(session, participants))}>
              Закрыть ответы
            </button>
          )}
          {primary === "hallRows" && (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(withAnswers((list) => hallOpenNext(latest.current, content, participants, list)))}>
              Открыть следующий ответ (от редкого)
            </button>
          )}
          {r.mode === "hallCheck" && (primary === "next" || primary === "award") && nextButton("Следующий вопрос")}
          {backButton}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- классика: розыгрыш, ход, шанс, итог
  const opponent = opponentOf(r);
  const speaking = r.mode === "face" ? r.buzz.current : null;
  return (
    <div className="stack host-quiz hd-host">
      {speaking && (
        <div className="host-buzz" role="status" aria-live="assertive">
          <span className="host-buzz__label">Первым нажал</span>
          <span className="host-buzz__name">
            <NameText name={nameOf(speaking)} />
          </span>
        </div>
      )}
      {head}
      {r.mode === "face" && !r.armed && (
        <div className="board-host__arm">
          <p>Прочитайте вопрос вслух. Кнопки у {solo ? "игроков" : "капитанов"} пока не активны — фальстарта не будет.</p>
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(() => Promise.resolve(armFace(latest.current, content, participants)))}>
            Запустить отсчёт · {content.buzzTime} с
          </button>
        </div>
      )}
      {r.mode === "face" && r.armed && (
        <div className="host-quiz__live" aria-live="polite">
          {timer}
          <span>{rehearsal ? "Репетиция: нажатий нет — назначьте, кто играет" : `Нажали: ${r.buzz.order.length}`}</span>
        </div>
      )}
      {r.mode === "play" && (
        <p className="mil-host-live" role="status">
          Ход: <NameText name={nameOf(r.playing)} /> · ошибки {"✕".repeat(r.strikes)}
          {"·".repeat(Math.max(0, HUNDRED_LIMITS.strikes - r.strikes))}
        </p>
      )}
      {r.mode === "steal" && (
        <p className="mil-host-live" role="status">
          Шанс для <NameText name={nameOf(opponent)} />: один ответ. Есть на табло — банк их, нет — банк <NameText name={nameOf(r.playing)} />.
        </p>
      )}
      {r.mode === "done" && (
        <p className="success">
          {r.winner ? (
            <>
              Банк {r.bank}
              {mult > 1 ? ` × ${mult}` : ""} = {r.award} → <NameText name={nameOf(r.winner)} />
            </>
          ) : (
            "Банк никому"
          )}
        </p>
      )}
      {(r.mode === "face" || r.mode === "play" || r.mode === "steal") && (
        <p className="muted small">
          {r.mode === "face" ? (solo ? "Игрок" : "Капитан") + " называет ответ вслух. Есть на табло — коснитесь его, нет — «Нет на табло» (слово следующему нажавшему)." : "Игрок называет ответ вслух. Есть на табло — коснитесь его, нет — «Нет на табло»."}
        </p>
      )}
      <AnswerList question={question} kind={round.kind} r={r} disabled={busy} hall={false} onTap={(id) => void run(openAnswer(session, content, participants, id))} />
      {r.mode === "done" && <p className="muted small">Касание закрытой строки открывает её на табло без очков.</p>}
      {peekButton}
      {errorLine}
      <div className="actions">
        {(r.mode === "face" || r.mode === "play" || r.mode === "steal") && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(missAnswer(session, content, participants))}>
            {r.mode === "steal" ? `✕ Нет на табло — банк ${nameOf(r.playing)}` : "✕ Нет на табло"}
          </button>
        )}
        {r.mode === "face" &&
          r.pair.map((p) => (
            <button key={p} type="button" className={p === speaking ? "btn btn--block host-quiz__primary" : "btn btn--secondary btn--block"} disabled={busy} onClick={() => void run(choosePlaying(session, participants, p))}>
              Играют {nameOf(p)}
            </button>
          ))}
        {r.mode === "done" && primary === "rest" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(showRest(session, content, participants))}>
            Открыть остальные ответы
          </button>
        )}
        {r.mode === "done" && primary !== "rest" && nextButton("Следующий раунд")}
        {r.mode === "done" && primary === "rest" && (
          <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void run(() => Promise.resolve(nextQuestion(latest.current, content, participants) ?? hundredAward(latest.current)))}>
            Дальше без остальных ответов
          </button>
        )}
        {backButton}
      </div>
      {r.mode === "play" && opponent && (
        <p className="muted small">
          После {HUNDRED_LIMITS.strikes} ошибок — «Шанс для <NameText name={nameOf(opponent)} />»
        </p>
      )}
    </div>
  );
}
