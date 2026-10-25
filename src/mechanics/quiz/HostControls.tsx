import { useEffect, useRef, useState } from "react";
import { OrderNumberHost } from "./orderNumber";
import { scoringParticipants } from "../../core/leaderboard";
import { secondsLeft } from "../../core/session";
import { useServerNow } from "../../components/live/useServerNow";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { correctSet, drawEffectOfSettings, raceBonusOf, KIND_TITLES, roundAt, roundTitle, settingsOf, usesAnswers, usesOptions, type QuizContent } from "./content";
import { clock } from "../../data";
import { resultKey } from "../../core/session";
import type { DrawEffect } from "../../core/draw";
import { auctionSync, closeBets, isAuctionDraw, parseBet, QUIZ_AUCTION_HOLD_MS } from "./auction";
import { AuctionHostPanel } from "./auctionViews";
import { NameText } from "../../components/NameText";
import { PodiumHostList } from "../../components/live/Podium";
import { podiumNext, startPodium } from "../../core/podium";
import {
  actionLabel,
  back,
  buzzRightAnswer,
  buzzSync,
  buzzWrongAnswer,
  extraAction,
  nextQuestion,
  primaryAction,
  replayTrack,
  reveal,
  showBoard,
  showQuestion,
  showTotal,
  closeSuperVote,
  openSuperVote,
  overrideSuperVote,
  playLevelTrack,
  skipSuper,
  superSync,
  superSkipped,
  superVoteOf,
  superVoteSync,
  toggleAccepted,
  type QuizAction,
} from "./flow";
import { auctionAnswers, groupOpenAnswers, parseResult } from "./logic";
import { correctText, LETTERS } from "./views";
import { SuperHostAnswers } from "../../components/live/SuperGame";
import { LEVEL_NAMES, parseSuperAnswer, superGroups, tallySuperVote, votePercent } from "../../core/supergame";

/**
 * Пульт квиза: одна главная кнопка на каждом этапе («Показать вопрос» → «Показать ответ» →
 * «Таблица» → «Следующий вопрос»), «Назад» на шаг, таймер, кто ответил и кто ещё нет,
 * открытые ответы гостей с засчитыванием похожих одним касанием.
 */
export function QuizHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<QuizContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  // Последняя сессия, которую видит пульт: кнопка ждёт, пока своё изменение не придёт обратно.
  const latest = useRef<Session>(session);
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    latest.current = session;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);
  const { stage, step } = session.state;
  const now = useServerNow(250, stage === "question");
  const q = content.questions[step];

  // Гонка: пришло нажатие — слово первому, кто ещё не ошибся. Пишет любой открытый пульт;
  // одинаковый расчёт и `expect` не дают двум пультам поспорить.
  const syncKey = q?.kind === "buzz" && stage === "question" ? answers.filter((a) => a.step === step).map((a) => `${a.pid}:${a.submittedAt ?? 0}`).sort().join(",") : "";
  const buzzCurrent = (session.state.result as { buzz?: { current?: unknown; order?: unknown[] } } | null)?.buzz;
  useEffect(() => {
    if (!syncKey || busy) return;
    const change = buzzSync(latest.current, answers);
    if (!change) return;
    const { phase, step: atStep, stage: atStage } = latest.current.state;
    void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт только при новых нажатиях и смене слова
  }, [syncKey, buzzCurrent?.current, buzzCurrent?.order?.length, busy]);

  // Суперигра: кто какой уровень выбрал — на экран зала (без текста ответов).
  const superKey = q?.kind === "super" && stage === "question" ? answers.filter((a) => a.step === step).map((a) => `${a.pid}:${parseSuperAnswer(a.value)?.level ?? "-"}`).sort().join(",") : "";
  useEffect(() => {
    if (!superKey || busy) return;
    const change = superSync(latest.current, content, answers);
    if (!change) return;
    const { phase, step: atStep, stage: atStage } = latest.current.state;
    void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт только при новых выборах
  }, [superKey, busy]);

  // Голосование «Играем суперигру?»: сколько «за» и «против» — на экран зала.
  const voteOpen = q?.kind === "super" && stage === "question" && superVoteOf(session)?.phase === "open";
  const voteKey = voteOpen ? answers.filter((a) => a.step === step).map((a) => `${a.pid}:${JSON.stringify(a.value)}:${a.submittedAt ?? 0}`).sort().join(",") : "";
  useEffect(() => {
    if (!voteKey || busy) return;
    const change = superVoteSync(latest.current, answers);
    if (!change) return;
    const { phase, step: atStep, stage: atStage } = latest.current.state;
    void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт только при новых голосах
  }, [voteKey, busy]);

  // Аукцион: кто уже поставил — на экран (без сумм).
  const auctionPhase = q?.kind === "auction" ? parseResult(session.state.result).auction?.phase : undefined;
  const auctionKey = q?.kind === "auction" && stage === "question" && auctionPhase === "bets" ? answers.filter((a) => a.step === step && parseBet(a.value) !== null).map((a) => `${a.pid}:${a.submittedAt ?? 0}`).sort().join(",") : "";
  useEffect(() => {
    if (!auctionKey || busy || !q) return;
    const change = auctionSync(latest.current, q, answers);
    if (!change) return;
    const { phase, step: atStep, stage: atStage } = latest.current.state;
    void control.apply({ ...change, expect: { phase, step: atStep, stage: atStage, result: resultKey(latest.current.state.result) } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт только при новых ставках
  }, [auctionKey, busy]);

  // Эффект жребия: из настроек игры, ведущий меняет на пульте (помнит это устройство).
  const effectKey = `joyrest.quiz.draw.${session.id}`;
  const [drawEffect, setDrawEffectState] = useState<DrawEffect>(() => {
    try {
      const v = window.localStorage.getItem(effectKey);
      if (v === "coin" || v === "wheel" || v === "reel") return v;
    } catch {
      // нет хранилища — из настроек игры
    }
    return drawEffectOfSettings(content);
  });
  const setDrawEffect = (v: DrawEffect) => {
    setDrawEffectState(v);
    try {
      window.localStorage.setItem(effectKey, v);
    } catch {
      // не запомнилось — не страшно
    }
  };

  // Жребий «Аукциона» докрутился и постоял — убираем сами, на экране вопрос.
  const drawSlideNow = isAuctionDraw(session) ? session.state.slide : null;
  useEffect(() => {
    if (!drawSlideNow) return;
    const wait = Math.max(0, (drawSlideNow.endsAt ?? 0) + QUIZ_AUCTION_HOLD_MS - (Date.now() + clock.offset()));
    const id = drawSlideNow.id;
    const timer = window.setTimeout(() => {
      if (latest.current.state.slide?.id !== id) return;
      void control.apply({ state: { slide: null }, expect: { slide: id } }).catch(() => undefined);
    }, wait);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- новый слайд жребия
  }, [drawSlideNow?.id]);

  if (!q) return <p className="muted">В игре нет вопросов.</p>;

  const total = content.questions.length;
  const round = roundAt(content, step);
  const next = content.questions[step + 1];
  const nextRound = next?.round ? `новый раунд «${next.round}»` : null;
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const result = parseResult(session.state.result);
  const stepAnswers = answers.filter((a) => a.step === step);
  // Аукцион: после ставок ответы — только свежие (ставки того же шага — не ответы).
  const own = q.kind === "auction" && result.auction && result.auction.phase !== "bets" ? auctionAnswers(stepAnswers, session.state.startedAt) : stepAnswers;
  const answeredIds = new Set(own.map((a) => a.pid));
  // Кто должен ответить: все в таблице и те, кого пульт ещё не успел в неё внести.
  // Участники, добавленные ведущим вручную (без телефона), не отвечают — их не ждём.
  const known = new Set(participants.map((p) => p.id));
  const expected = new Map(
    Object.entries(session.leaderboard)
      .filter(([id]) => rehearsal || known.has(id))
      .map(([id, e]) => [id, e.name]),
  );
  for (const p of scoringParticipants(participants, session.playMode)) if (!expected.has(p.id)) expected.set(p.id, p.name);
  const missing = [...expected.entries()].filter(([id]) => !answeredIds.has(id)).map(([, name]) => name);
  const action = primaryAction(session, content);
  const superVote = q?.kind === "super" ? superVoteOf(session) : undefined;
  // Пока голосуют — счёт по ответам, пришедшим на пульт (на экране — то же через минуту синхронизации).
  const liveVote = superVote?.phase === "open" ? tallySuperVote(stepAnswers, typeof session.state.startedAt === "number" ? session.state.startedAt : null) : { yes: superVote?.yes ?? 0, no: superVote?.no ?? 0 };

  /** Новое состояние пришло (или прошло 3 с) — кнопку можно нажимать снова. */
  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: SessionChange | (() => Promise<SessionChange | null>), afterClear?: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Изменение — только если игра всё ещё там, где её видит этот пульт (второй пульт, двойное касание).
    const { phase, step: atStep, stage: atStage } = session.state;
    try {
      const change = typeof make === "function" ? await make() : make;
      if (!change) return;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage, ...(change.expect ?? {}) } });
      // Ответы убираем после закрытия вопроса: новые гости уже не успеют ответить.
      if (afterClear !== undefined) await control.clearAnswers(afterClear);
      await arrived;
    } catch (e) {
      // Игра уже ушла вперёд — пульт сейчас покажет, где она; ничего не делаем.
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) {
        setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Очки — по свежему списку ответов с сервера: ответ последней секунды мог ещё не дойти до пульта. */
  async function revealChange(): Promise<SessionChange> {
    let all: Answer[] = own;
    try {
      const fresh = await control.freshAnswers(step);
      const byId = new Map(own.map((a) => [a.id, a]));
      for (const a of fresh) if (a.step === step) byId.set(a.id, a);
      all = [...byId.values()];
    } catch {
      // Нет связи — считаем по тому, что уже пришло.
    }
    return reveal(latest.current, content, all, participants);
  }

  /** «Ставки сделаны» — по свежим ставкам с сервера и свежей сессии; второй пульт не повторит жребий. */
  async function closeChange(): Promise<SessionChange | null> {
    let all: Answer[] = stepAnswers;
    try {
      all = await control.freshAnswers(step);
    } catch {
      // Нет связи — по тому, что уже пришло.
    }
    const cur = latest.current;
    const curQ = content.questions[cur.state.step];
    if (!curQ) return null;
    const change = closeBets(cur, curQ, all, {
      id: `auc${Math.random().toString(36).slice(2, 12)}`,
      now: Date.now() + clock.offset(),
      effect: drawEffect,
      name: (pid) => cur.leaderboard[pid]?.name ?? participants.find((p) => p.id === pid)?.name ?? "Игрок",
    });
    return change ? { ...change, expect: { result: resultKey(cur.state.result) } } : null;
  }

  /** «Подвести итог голосования» — по свежим голосам с сервера; голоса шага стираются, дальше — уровни или пропуск. */
  async function voteDoneChange(): Promise<SessionChange> {
    let all: Answer[] = stepAnswers;
    try {
      all = await control.freshAnswers(step);
    } catch {
      // Нет связи — по тому, что уже пришло.
    }
    return closeSuperVote(latest.current, all);
  }

  function perform(action: QuizAction) {
    if (action === "vote") void run(openSuperVote(session, content));
    if (action === "voteDone") void run(voteDoneChange, step);
    if (action === "skip") void run(skipSuper(session));
    if (action === "show") void run(showQuestion(session, content));
    if (action === "reveal" && q?.kind === "auction" && result.auction?.phase === "bets") {
      void run(closeChange);
      return;
    }
    if (action === "reveal") void run(revealChange);
    if (action === "board") void run(showBoard(session, content));
    if (action === "total") void run(showTotal(session));
    if (action === "next") void run(nextQuestion(session, content));
    if (action === "podium") void run(startPodium(session));
    if (action === "podiumNext") void run(podiumNext(session));
    if (action === "finish") control.requestFinish();
  }

  const onPrimary = () => perform(action);
  const extra = extraAction(session, content);
  const backPlan = back(session, content);
  const groups = q.kind === "open" || (q.kind === "auction" && usesAnswers(q)) ? groupOpenAnswers(q, own, result.accepted) : [];
  const pictureGroups = q.kind === "pictures" ? (q.pictures ?? []).map((_, i) => groupOpenAnswers(q, own, result.accepted, i)) : [];
  const buzz = result.buzz ?? null;
  const nameOf = (pid: string) => session.leaderboard[pid]?.name ?? participants.find((p) => p.id === pid)?.name ?? "Игрок";
  const speaking = q.kind === "buzz" && stage === "question" && buzz?.current ? buzz.current : null;

  /** «Верно» по свежим ответам: победитель получает очки и деления. */
  async function rightChange(): Promise<SessionChange> {
    let all: Answer[] = own;
    try {
      all = await control.freshAnswers(step);
    } catch {
      // Нет связи — по тому, что уже пришло.
    }
    return buzzRightAnswer(latest.current, content, all, participants);
  }

  /**
   * «Неверно» — по свежей сессии (нажатия, пришедшие после отрисовки, не теряются) и только тому, кто отвечал,
   * когда ведущий нажал: слово уже перешло (второй пульт) — ничего не делаем.
   */
  async function wrongChange(): Promise<SessionChange | null> {
    const cur = latest.current;
    return parseResult(cur.state.result).buzz?.current === speaking ? buzzWrongAnswer(cur) : null;
  }

  // Кто отвечает голосом — первым делом сверху пульта, а не под текстом вопроса (14 октября 2026).
  const speakingBlock = (
    <>
      {speaking && (
        <div className="host-buzz" role="status" aria-live="assertive">
          <span className="host-buzz__label">Отвечает</span>
          <span className="host-buzz__name">
            <NameText name={nameOf(speaking)} />
          </span>
          <div className="host-buzz__verdict">
            <button type="button" className="btn" disabled={busy} onClick={() => void run(rightChange)}>
              Верно
            </button>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run(wrongChange)}>
              Неверно
            </button>
          </div>
        </div>
      )}
    </>
  );
  const buttons = (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className={speaking ? "btn btn--quiet btn--block" : "btn btn--block host-quiz__primary"} disabled={busy} onClick={onPrimary}>
          {q.kind === "buzz" && action === "reveal" ? "Никто не угадал — показать ответ" : actionLabel(session, content, action)}
        </button>
        {q.trackId && session.screenMode !== "none" && (stage === "question" || stage === "reveal") && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(replayTrack(session))}>
            ♪ Повторить фрагмент
          </button>
        )}
        {extra && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => perform(extra)}>
            Показать таблицу
          </button>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={busy || backPlan === null}
          onClick={() => backPlan && void run(backPlan.change, backPlan.clearAnswers)}
        >
          Назад
        </button>
      </div>
    </>
  );

  if (stage === "podium") {
    return (
      <div className="stack host-quiz">
        <div className="stack stack--tight">
          <p className="eyebrow">Награждение</p>
          <p className="muted small">Открывайте места по одному: экран покажет их с третьего по первое.</p>
        </div>
        <PodiumHostList session={session} />
        {buttons}
      </div>
    );
  }

  return (
    <div className="stack host-quiz">
      {speakingBlock}
      <div className="stack stack--tight">
        {round && <p className="eyebrow">{roundTitle(round)}</p>}
        <p className="eyebrow">
          Вопрос {step + 1} из {total} · {KIND_TITLES[q.kind]}
          {q.kind === "super" ? "" : ` · ${q.points} очк.`}
        </p>
        <p className="host-quiz__question">{q.text}</p>
        <p className="muted small">
          Верный ответ: <strong className="host-quiz__answer">{correctText(q) || "—"}</strong>
        </p>
        {q.kind === "auction" && (
          <AuctionHostPanel session={session} q={q} auction={result.auction} answers={stepAnswers} expected={expected.size} effect={drawEffect} onEffect={setDrawEffect} rehearsal={rehearsal} />
        )}
        {q.note?.trim() && (
          <p className="host-note">
            <span className="host-note__label">Заметка</span>
            {q.note}
          </p>
        )}
      </div>

      {q.kind === "super" && superVote && (
        <section className="stack stack--tight host-super-vote" aria-label="Голосование за суперигру" aria-live="polite">
          <h3 className="host-quiz__subtitle">{superVote.phase === "open" ? "Голосование: играем суперигру?" : superVote.passed ? "Итог: играем суперигру" : "Итог: суперигру не играем"}</h3>
          <p>
            За — <strong>{liveVote.yes}</strong> · против — <strong>{liveVote.no}</strong> · проголосовали {liveVote.yes + liveVote.no}
            {liveVote.yes + liveVote.no > 0 ? ` · за ${votePercent(liveVote.yes, liveVote.no)}%` : ""}
          </p>
          {superVote.phase === "open" && <p className="muted small">Играем, если «за» больше, чем «против». Голос можно поменять до итога.</p>}
          {superVote.phase === "done" && stage === "ready" && (
            <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => {
                const c = overrideSuperVote(session, !superVote.passed);
                if (c) void run(c);
              }}>
              {superVote.passed ? "Всё равно пропустить суперигру" : "Всё равно играть суперигру"}
            </button>
          )}
        </section>
      )}

      {q.kind === "super" && stage === "question" && !voteOpen && (q.levels ?? []).some((l) => l.trackId) && session.screenMode !== "none" && (
        <section className="stack stack--tight" aria-label="Музыка уровней">
          <h3 className="host-quiz__subtitle">Музыка уровней на экран зала</h3>
          <div className="actions">
            {(q.levels ?? []).map((l, i) =>
              l.trackId ? (
                <button key={i} type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(playLevelTrack(session, i))}>
                  ▶ Трек: {LEVEL_NAMES[i]}
                </button>
              ) : null,
            )}
          </div>
        </section>
      )}

      {stage === "question" && !voteOpen && (
        <div className="host-quiz__live" aria-live="polite">
          <span className={left === 0 ? "host-quiz__timer is-over" : "host-quiz__timer"} role="timer">
            {left === null ? "∞" : left === 0 ? "Время вышло" : `${left} с`}
          </span>
          <span>
            {rehearsal ? (
              "Репетиция: гостей нет"
            ) : (
              <>
                {q.kind === "buzz" ? "Нажали" : "Ответили"}: <strong>{own.length}</strong> из {expected.size}
              </>
            )}
          </span>
        </div>
      )}

      {stage === "question" && !voteOpen && missing.length > 0 && !rehearsal && q.kind !== "buzz" && q.kind !== "auction" && (
        <div className="stack stack--tight">
          <button type="button" className="btn btn--quiet host-quiz__toggle" aria-expanded={showMissing} onClick={() => setShowMissing((v) => !v)}>
            {showMissing ? "Скрыть, кто ещё не ответил" : `Ещё не ответили: ${missing.length}`}
          </button>
          {showMissing && <p className="muted small host-quiz__missing">{missing.join(", ")}</p>}
        </div>
      )}
      {stage === "question" && !voteOpen && missing.length === 0 && expected.size > 0 && q.kind !== "buzz" && q.kind !== "auction" && <p className="success">Ответили все!</p>}

      {groups.length > 0 && (stage === "question" || stage === "reveal") && (
        <section className="stack stack--tight" aria-label="Ответы гостей">
          <h3 className="host-quiz__subtitle">Ответы гостей</h3>
          {stage === "question" && (
            <p className="muted small">Похожий ответ с опечаткой? Нажмите «Засчитать» до показа ответа.</p>
          )}
          <ul className="open-answers">
            {groups.map((g) => (
              <li key={g.key} className={`open-answers__item open-answers__item--${g.status}`}>
                <span className="open-answers__text">
                  {g.text} <span className="muted">× {g.count}</span>
                </span>
                {g.status === "correct" ? (
                  <span className="open-answers__mark">Верно</span>
                ) : stage === "question" ? (
                  <button
                    type="button"
                    className={g.status === "accepted" ? "btn btn--secondary open-answers__btn" : "btn btn--quiet open-answers__btn"}
                    aria-pressed={g.status === "accepted"}
                    disabled={busy}
                    onClick={() => void run(toggleAccepted(session, g.key))}
                  >
                    {g.status === "accepted" ? "Засчитано ✓" : "Засчитать"}
                  </button>
                ) : (
                  <span className="open-answers__mark">{g.status === "accepted" ? "Засчитано" : "Неверно"}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {q.kind === "super" && !voteOpen && !superSkipped(session) && (stage === "question" || stage === "reveal") && (
        <SuperHostAnswers
          levels={q.levels ?? []}
          groups={superGroups(q.levels ?? [], own, result.accepted)}
          picksCount={(q.levels ?? []).map((_, i) => own.filter((a) => parseSuperAnswer(a.value)?.level === i).length)}
          editable={stage === "question"}
          busy={busy}
          onToggle={(key) => void run(toggleAccepted(session, key))}
        />
      )}

      {q.kind === "buzz" && buzz && buzz.order.length > 0 && (
        <section className="stack stack--tight" aria-label="Очередь нажатий">
          <h3 className="host-quiz__subtitle">Очередь нажатий</h3>
          <p className="muted small">«Неверно» передаёт слово следующему; ошибившийся в этом вопросе больше не отвечает.</p>
          <ol className="buzz-queue">
            {buzz.order.map((pid, i) => {
              const out = buzz.out.includes(pid);
              const active = buzz.current === pid || buzz.winner === pid;
              return (
                <li key={pid} className={out ? "is-out" : active ? "is-now" : undefined}>
                  <span className="buzz-queue__n">{i + 1}</span>
                  <span className="buzz-queue__name">
                    <NameText name={nameOf(pid)} />
                  </span>
                  <span className="buzz-queue__state">{buzz.winner === pid ? "верно" : buzz.current === pid ? "отвечает" : out ? "мимо ✕" : "ждёт"}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {q.kind === "buzz" && (
        <p className="muted small">
          Гонка до {settingsOf(content).raceTarget} · этот вопрос даёт {q.steps ?? 1} {(q.steps ?? 1) === 1 ? "деление" : "деления"}
          {raceBonusOf(content) > 0 ? ` · первому на финише +${raceBonusOf(content)} очков` : ""}
        </p>
      )}

      {q.kind === "pictures" && (stage === "question" || stage === "reveal") && pictureGroups.some((g) => g.length > 0) && (
        <section className="stack stack--tight" aria-label="Ответы гостей по картинкам">
          <h3 className="host-quiz__subtitle">Ответы по картинкам</h3>
          {stage === "question" && <p className="muted small">Опечатка? «Засчитать» до показа ответа.</p>}
          {pictureGroups.map((list, i) =>
            list.length === 0 ? null : (
              <div key={i} className="stack stack--tight">
                <p className="small">
                  <strong>{i + 1}.</strong> {(q.pictures?.[i]?.answers ?? []).find((a) => a.trim()) ?? "—"}
                </p>
                <ul className="open-answers">
                  {list.map((g) => (
                    <li key={g.key} className={`open-answers__item open-answers__item--${g.status}`}>
                      <span className="open-answers__text">
                        {g.text} <span className="muted">× {g.count}</span>
                      </span>
                      {g.status === "correct" ? (
                        <span className="open-answers__mark">Верно</span>
                      ) : stage === "question" ? (
                        <button
                          type="button"
                          className={g.status === "accepted" ? "btn btn--secondary open-answers__btn" : "btn btn--quiet open-answers__btn"}
                          aria-pressed={g.status === "accepted"}
                          disabled={busy}
                          onClick={() => void run(toggleAccepted(session, g.key))}
                        >
                          {g.status === "accepted" ? "Засчитано ✓" : "Засчитать"}
                        </button>
                      ) : (
                        <span className="open-answers__mark">{g.status === "accepted" ? "Засчитано" : "Неверно"}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </section>
      )}

      {stage === "reveal" && (q.kind === "order" || q.kind === "number") && <OrderNumberHost q={q} own={own} leaderboard={session.leaderboard} />}
      {stage === "reveal" && usesOptions(q) && q.kind !== "buzz" && q.kind !== "pictures" && q.kind !== "super" && q.kind !== "order" && q.kind !== "number" && (
        <ul className="host-quiz__dist">
          {q.options.map((o, i) => (
            <li key={i} className={correctSet(q).includes(i) ? "is-correct" : undefined}>
              {LETTERS[i]}. {o} — <strong>{result.counts[i] ?? 0}</strong>
            </li>
          ))}
        </ul>
      )}
      {stage === "reveal" && (
        <p className="muted small">
          Верно ответили: {result.correct} из {result.total}
        </p>
      )}

      {buttons}

      {/* Следующий вопрос заранее — чтобы подготовить подводку, пока зал смотрит ответ и таблицу. */}
      {(stage === "reveal" || stage === "board") && next && (
        <section className="host-next" aria-label="Следующий вопрос">
          <p className="eyebrow">
            Дальше · вопрос {step + 2} из {total}
            {nextRound ? ` · ${nextRound}` : ""}
          </p>
          <p className="host-next__text">{next.text || "Без текста"}</p>
          {next.note?.trim() && <p className="muted small">Заметка: {next.note}</p>}
        </section>
      )}
    </div>
  );
}
