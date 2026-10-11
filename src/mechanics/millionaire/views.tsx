// «Кто хочет стать миллионером»: на экране зала — полоска-лестница у каждой команды (поднимается за
// верный ответ, падает до несгораемой за ошибку) и вопрос с вариантами A–D; подсказки команды, чей ход, —
// крупными плитками с подписями, у остальных — значками под полоской (использованная перечёркнута).
// Выбор команды подсвечивается оранжевым, «окончательный ответ» — заливкой, верный — бегущей зелёной
// радужной рамкой с салютом. «Помощь зала» — QR на экране: голосуют и гости вне игры, проценты растут сами.
// Телефон: игрок выбирает вариант (до фиксации можно передумать) и просит подсказку — ведущий подтверждает.
import { useEffect, useRef, type CSSProperties } from "react";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { Confetti } from "../../components/live/Confetti";
import { playSample, playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { voteUrl } from "../../components/links";
import { NameText } from "../../components/NameText";
import { QrCode } from "../../components/QrCode";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import { audienceRepo, type Session } from "../../data";
import type { PlayerViewProps, ViewProps } from "../types";
import { LETTERS, LEVELS, LIFELINES, lifelineTitle, pointsAt, type LifelineId, type MillionaireContent, type MillionaireQuestion } from "./content";
import { LifelineIcon } from "./icons";
import { levelToPlay, lifelineState, parseMillionaireResult, questionOf, type MillionaireResult } from "./logic";

export type MillionaireAnswerValue = { choice: number } | { vote: number } | { lifeline: LifelineId; n: string };

const TEAM_COLORS = ["#E3AA9C", "#E3C68C", "#A3C2AA", "#D2A0AC", "#B3AADD", "#9FC3D6", "#E0B3A0", "#C9C08F"];

function colorOf(session: Session, r: MillionaireResult, pid: string): string {
  const index = session.leaderboard[pid]?.colorIndex ?? Math.max(0, r.order.indexOf(pid));
  return TEAM_COLORS[index % TEAM_COLORS.length] ?? "#E3C68C";
}

const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "") : "");

/** Сколько осталось до конца звонка, «0:45». */
function clockLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Коротко для полоски: «1 млн», «500 тыс.», «3 000». */
export function shortPoints(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1)).toLocaleString("ru-RU")} млн`;
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString("ru-RU")} тыс.`;
  return n.toLocaleString("ru-RU");
}

/** Значки подсказок команды под её полоской: использованные перечёркнуты и погашены. */
export function LifelineRow({ content, used, size = "screen" }: { content: MillionaireContent; used: LifelineId[]; size?: "screen" | "phone" }) {
  return (
    <ul className={`mil-lifelines mil-lifelines--${size}`} aria-label="Подсказки">
      {LIFELINES.filter((l) => content.lifelines.includes(l.id)).map((l) => {
        const gone = used.includes(l.id);
        return (
          <li key={l.id} className={gone ? "mil-lifeline is-used" : "mil-lifeline"} title={l.title} aria-label={`${l.title}${gone ? " — использована" : ""}`}>
            <LifelineIcon id={l.id} />
          </li>
        );
      })}
    </ul>
  );
}

/** Подсказки команды, чей ход, — крупные плитки с подписью (экран зала). Взятая сейчас — светится. */
function LifelineTray({ content, used, active }: { content: MillionaireContent; used: LifelineId[]; active: LifelineId | null }) {
  const list = LIFELINES.filter((l) => content.lifelines.includes(l.id));
  if (list.length === 0) return null;
  return (
    <ul className="mil-tray" aria-label="Подсказки команды">
      {list.map((l) => {
        const gone = used.includes(l.id);
        return (
          <li key={l.id} className={`mil-tray__item${gone ? " is-used" : ""}${active === l.id ? " is-active" : ""}`} aria-label={`${l.title}${gone ? " — использована" : ""}`}>
            <span className="mil-tray__icon">
              <LifelineIcon id={l.id} />
            </span>
            <span className="mil-tray__label">{l.title}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Полоски команд: 12 делений, несгораемые отмечены, у той, чей ход, — подсветка. */
export function LadderBars({ session, content, result, compact = false }: { session: Session; content: MillionaireContent; result: MillionaireResult; compact?: boolean }) {
  return (
    <div className="mil-bars" style={{ gridTemplateColumns: `repeat(${Math.max(1, result.order.length)}, minmax(0, 1fr))` }}>
      {result.order.map((pid) => {
        const level = result.levels[pid] ?? 0;
        const active = pid === result.turn && result.mode !== "over";
        return (
          <div key={pid} className={`mil-bar${active ? " is-turn" : ""}${level >= LEVELS ? " is-top" : ""}`} style={{ ["--team" as string]: colorOf(session, result, pid) }}>
            <span className="mil-bar__points">{shortPoints(pointsAt(content, level))}</span>
            <ol className="mil-bar__steps" aria-label={`${nameOf(session, pid)}: ступень ${level} из ${LEVELS}`}>
              {Array.from({ length: LEVELS }, (_, i) => LEVELS - i).map((n) => (
                <li key={n} className={`mil-step${n <= level ? " is-on" : ""}${content.safe.includes(n) ? " is-safe" : ""}${active && n === level + 1 ? " is-next" : ""}`} />
              ))}
            </ol>
            <span className="mil-bar__name">
              {level >= LEVELS ? "👑 " : ""}
              <NameText name={nameOf(session, pid)} />
            </span>
            {!compact && <LifelineRow content={content} used={result.used[pid] ?? []} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Вопрос с вариантами. Выбор команды — оранжевая бегущая рамка, «окончательный ответ» — оранжевая заливка;
 * при показе ответа верный загорается зелёной радужной рамкой, неверный выбор — красным.
 */
function QuestionCard({ question, result, reveal, size = "screen", mine = null }: { question: MillionaireQuestion; result: MillionaireResult; reveal: boolean; size?: "screen" | "phone"; mine?: number | null }) {
  const chosen = mine ?? result.chosen;
  return (
    <div className={`mil-question mil-question--${size}`}>
      <p className="mil-question__text">{question.text}</p>
      <ol className="mil-options">
        {question.options.map((text, i) => {
          const gone = result.removed.includes(i) && !(reveal && result.outcome === "saved" && result.pick === i);
          const right = reveal && result.outcome !== "saved" && i === question.correct;
          const wrong = reveal && result.pick === i && result.outcome !== "right";
          const isChosen = !reveal && chosen === i && !result.locked && !gone;
          const isLocked = (!reveal && result.locked && result.chosen === i) || (reveal && result.pick === i && !right);
          const pct = result.audience && !gone ? (result.audience[i] ?? 0) : null;
          return (
            <li
              key={i}
              className={`mil-option${gone ? " is-gone" : ""}${right ? " is-right" : ""}${wrong ? " is-wrong" : ""}${isChosen ? " is-chosen" : ""}${isLocked ? " is-locked" : ""}`}
              style={pct !== null ? ({ "--pct": `${pct}%` } as CSSProperties) : undefined}
            >
              {right && <span className="mil-option__glow" aria-hidden="true" />}
              {pct !== null && <span className="mil-option__bar" aria-hidden="true" />}
              <span className="mil-option__letter">{LETTERS[i]}</span>
              <span className="mil-option__text">{gone ? "" : text}</span>
              {pct !== null && <span className="mil-option__pct">{pct}%</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Звуки экрана: вопрос, «окончательный ответ», верно / неверно, подсказка — свои файлы, иначе синтез. */
function useMillionaireSounds(session: Session, r: MillionaireResult) {
  const { step, stage } = session.state;
  const prev = useRef<{ step: number; mode: string; outcome: string | null; flash: string | null; locked: boolean } | null>(null);
  useEffect(() => {
    const now = { step, mode: r.mode, outcome: r.outcome, flash: r.flash, locked: r.locked };
    const was = prev.current;
    prev.current = now;
    // Экран открыли посреди игры — не играем то, что уже было.
    if (!was) return;
    if (r.outcome !== was.outcome && r.outcome) {
      if (r.outcome === "right") {
        playSample("milRight", "correct");
        if ((r.levels[r.turn ?? ""] ?? 0) >= LEVELS) playSound("fanfare");
      } else if (r.outcome === "wrong") playSample("milWrong", "wrong");
      else playSound("gong");
      return;
    }
    if (r.locked && !was.locked) {
      playSample("milLock", "drumroll");
      return;
    }
    if (r.flash && (r.flash !== was.flash || step !== was.step)) {
      playSample("milLifeline", "whoosh");
      return;
    }
    if (stage === "question" && r.mode === "question" && step !== was.step && !r.flash) playSample("milQuestion", "drumroll");
  }, [step, stage, r.mode, r.outcome, r.flash, r.locked, r.levels, r.turn]);
}

export function MillionaireScreenView({ session, content }: ViewProps<MillionaireContent>) {
  const r = parseMillionaireResult(session.state.result);
  const { stage, step } = session.state;
  const q = questionOf(content, r);
  const now = useServerNow(250, r.callEndsAt !== null || (r.mode === "audience" && stage === "question"));
  const team = nameOf(session, r.turn);
  const level = levelToPlay(r, r.turn);
  const left = r.mode === "audience" ? secondsLeft(session.state, now) : null;
  useCountdownSounds(left);
  useMillionaireSounds(session, r);

  const flash = r.flash ? LIFELINES.find((l) => l.id === r.flash) : null;
  const top = r.outcome === "right" && (r.levels[r.turn ?? ""] ?? 0) >= LEVELS;
  const audience = r.mode === "audience" && stage === "question";
  const used = r.turn ? (r.used[r.turn] ?? []) : [];

  return (
    <div className={`mil-screen${audience ? " mil-screen--audience" : ""}`}>
      {stage === "reveal" && r.outcome === "right" && <Confetti burst={`mil:${step}:${r.q}`} count={top ? 120 : 70} />}
      {stage === "reveal" && r.outcome === "right" && <span key={`glow:${step}`} className="mil-burst" aria-hidden="true" />}
      <section className="mil-screen__main">
        {r.order.length === 0 ? (
          <>
            <span className="quiz-screen__badge">Кто хочет стать миллионером</span>
            <h2 className="mil-screen__title">Скоро начнём!</h2>
            <p className="mil-screen__note">12 вопросов, у каждой команды своя лестница. Несгораемые ступени: {content.safe.join(" и ")}.</p>
          </>
        ) : r.mode === "over" ? (
          <h2 className="mil-screen__title">Игра окончена!</h2>
        ) : stage === "ready" ? (
          <>
            <p className="mil-screen__who">
              Ход: <NameText name={team} />
            </p>
            <h2 className="mil-screen__title">Вопрос {level} — {pointsLabel(pointsAt(content, level))}</h2>
            {content.safe.includes(level) && <p className="mil-screen__note">Несгораемая ступень</p>}
            <LifelineTray content={content} used={used} active={null} />
          </>
        ) : q ? (
          <>
            <p className="mil-screen__who">
              <NameText name={team} /> · вопрос {level} — {pointsLabel(pointsAt(content, level))}
            </p>
            {flash && (
              <p key={`${step}:${flash.id}`} className="mil-flash" role="status">
                <LifelineIcon id={flash.id} /> {flash.title}
              </p>
            )}
            <div className={audience ? "mil-audience" : undefined}>
              <QuestionCard question={q} result={r} reveal={stage === "reveal"} />
              {audience && (
                <aside className="mil-audience__qr">
                  {audienceRepo && <QrCode value={voteUrl(session.code)} label="QR-код: голосовать в помощи зала" />}
                  <p className="mil-audience__title">Помощь зала</p>
                  <p className="mil-audience__hint">{audienceRepo ? "Наведите камеру и голосуйте" : "Голосуйте на телефонах"}</p>
                  <p className="mil-audience__count">
                    {r.votes} {votesWord(r.votes)}
                    {left !== null ? ` · ${left} с` : ""}
                  </p>
                </aside>
              )}
            </div>
            {r.callEndsAt !== null && r.callEndsAt > now && stage === "question" && <p className="mil-call">📞 Звонок другу · {clockLeft(r.callEndsAt - now)}</p>}
            {r.tip && stage === "question" && (
              <div className="mil-tip" role="status">
                <span className="mil-tip__icon">
                  <LifelineIcon id="host" />
                </span>
                <div>
                  <p className="mil-tip__title">Совет ведущего</p>
                  <p className="mil-tip__text">{r.tipText ?? "Слушаем ведущего — он наведёт на верную мысль"}</p>
                </div>
              </div>
            )}
            {r.shield && stage === "question" && <p className="mil-screen__note">🛡 Право на ошибку включено</p>}
            {stage === "question" && r.mode === "question" && r.locked && <p className="mil-screen__note mil-screen__note--big">Окончательный ответ — {LETTERS[r.chosen ?? 0]}</p>}
            {stage === "reveal" && (
              <p className={`mil-outcome mil-outcome--${r.outcome ?? "none"}`}>
                {r.outcome === "right" ? (top ? "Миллионер! 👑" : "Верно!") : r.outcome === "saved" ? "Неверно — но спасает право на ошибку" : "Неверно"}
              </p>
            )}
            {stage === "question" && !audience && <LifelineTray content={content} used={used} active={r.flash} />}
          </>
        ) : null}
      </section>
      <section className="mil-screen__bars" aria-label="Лестницы команд">
        <LadderBars session={session} content={content} result={r} />
      </section>
    </div>
  );
}

function votesWord(n: number): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return "голос";
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return "голоса";
  return "голосов";
}

function nonce(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Что телефон уже попросил: подсказка и её номер (отказ ведущего — по номеру). */
function askOf(value: unknown): { id: LifelineId; n: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  return typeof v.lifeline === "string" && LIFELINES.some((l) => l.id === v.lifeline) ? { id: v.lifeline as LifelineId, n: typeof v.n === "string" ? v.n : "" } : null;
}

export function MillionairePlayerView({ session, content, pid, role, myAnswer, sending, onAnswer, personal }: PlayerViewProps<MillionaireContent, MillionaireAnswerValue>) {
  const r = parseMillionaireResult(session.state.result);
  const { stage } = session.state;
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const q = questionOf(content, r);
  const mine = r.turn === pid;
  const myLevel = r.levels[pid] ?? 0;
  const teams = session.playMode === "teams";
  const head = (
    <p className="eyebrow">
      Миллионер{r.order.includes(pid) ? ` · ступень ${myLevel} из ${LEVELS} · ${pointsLabel(pointsAt(content, myLevel))}` : ""}
    </p>
  );
  const used = r.used[pid] ?? [];

  if (r.order.length === 0 || stage === "ready" || r.mode === "over") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        {r.mode === "over" ? (
          <h2>Игра окончена</h2>
        ) : r.order.length === 0 ? (
          <h2>Скоро начнём!</h2>
        ) : mine ? (
          <>
            <h2>Ваш ход!</h2>
            <p className="muted">Вопрос {levelToPlay(r, pid)} — {pointsLabel(pointsAt(content, levelToPlay(r, pid)))}</p>
          </>
        ) : (
          <h2>
            Ход: <NameText name={nameOf(session, r.turn)} />
          </h2>
        )}
        {r.order.includes(pid) && <LifelineRow content={content} used={used} size="phone" />}
      </div>
    );
  }

  // Помощь зала: голосуют все, кроме команды, чей ход. В командах — свой голос телефона.
  if (r.mode === "audience" && q) {
    if (mine) {
      return (
        <div className="quiz-phone quiz-phone--center">
          {head}
          <h2>Зал голосует</h2>
          <p className="muted">Смотрите на экран — проценты растут прямо сейчас.</p>
        </div>
      );
    }
    const voted = teams ? personal?.value : myAnswer;
    const busy = teams ? (personal?.sending ?? false) : sending;
    const vote = (i: number) => (teams ? personal?.send({ vote: i }) : onAnswer({ vote: i }));
    return (
      <div className="quiz-phone">
        {head}
        <h2>Помощь зала</h2>
        <p className="muted">Как думаете, какой ответ верный?</p>
        <p className="mil-question__text">{q.text}</p>
        {voted ? (
          <p className="success">Голос принят: {LETTERS[(voted.value as { vote?: number })?.vote ?? 0]}</p>
        ) : (
          <div className="mil-phone-options">
            {q.options.map((text, i) =>
              r.removed.includes(i) ? null : (
                <button key={i} type="button" className="btn btn--secondary mil-phone-option" disabled={busy || !open} onClick={() => vote(i)}>
                  <span className="mil-option__letter">{LETTERS[i]}</span> {text}
                </button>
              ),
            )}
          </div>
        )}
      </div>
    );
  }

  if (!q) return <div className="quiz-phone quiz-phone--center">{head}</div>;
  const answered = myAnswer?.value as { choice?: number } | undefined;
  const myChoice = typeof answered?.choice === "number" ? answered.choice : null;
  const canAnswer = mine && role !== "member" && stage === "question" && open && r.mode === "question" && !r.locked;
  const callLeft = r.callEndsAt !== null && r.callEndsAt > now ? r.callEndsAt - now : 0;
  // Просить подсказку может игрок (solo) или капитан своим ответом телефона (команды).
  const asker = mine && stage === "question" && r.mode === "question" && !r.locked && (teams ? role === "captain" && personal !== undefined : role !== "member");
  const ask = askOf(teams ? personal?.value?.value : myAnswer?.value);
  const pendingAsk = ask && ask.n !== r.refused ? ask : null;
  const refusedAsk = ask && ask.n === r.refused ? ask : null;
  const requestLifeline = (id: LifelineId) => {
    const value = { lifeline: id, n: nonce() };
    if (teams) personal?.send(value);
    else onAnswer(value);
  };

  return (
    <div className="quiz-phone">
      {head}
      <div className={mine ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
        <strong>
          {mine ? (role === "member" ? "Отвечает ваш капитан" : "Ваш вопрос") : <>Отвечает <NameText name={nameOf(session, r.turn)} /></>}
        </strong>
        <span>
          Вопрос {levelToPlay(r, r.turn)} — {pointsLabel(pointsAt(content, levelToPlay(r, r.turn)))}
        </span>
      </div>
      {stage === "reveal" || !canAnswer ? (
        <QuestionCard question={q} result={r} reveal={stage === "reveal"} size="phone" />
      ) : (
        <>
          <p className="mil-question__text">{q.text}</p>
          <div className="mil-phone-options">
            {q.options.map((text, i) =>
              r.removed.includes(i) ? null : (
                <button
                  key={i}
                  type="button"
                  className={`btn btn--secondary mil-phone-option${myChoice === i ? " is-chosen" : ""}`}
                  aria-pressed={myChoice === i}
                  disabled={sending || myChoice === i}
                  onClick={() => onAnswer({ choice: i })}
                >
                  <span className="mil-option__letter">{LETTERS[i]}</span> {text}
                </button>
              ),
            )}
          </div>
        </>
      )}
      {mine && stage === "question" && r.mode === "question" && (
        <p className={r.locked ? "mil-phone-status is-locked" : myChoice !== null ? "mil-phone-status is-chosen" : "mil-phone-status"} role="status">
          {r.locked
            ? `Окончательный ответ — ${LETTERS[r.chosen ?? 0]}. Ждём!`
            : myChoice !== null || r.chosen !== null
              ? `Выбран ${LETTERS[myChoice ?? r.chosen ?? 0]}. Ведущий спросит: «Это окончательный ответ?» — можно передумать`
              : role === "member"
                ? "Капитан выбирает ответ"
                : "Выберите ответ"}
        </p>
      )}
      {mine && callLeft > 0 && stage === "question" && (
        <p className="mil-call mil-call--phone">
          📞 Звонок другу · {clockLeft(callLeft)}
          {role !== "member" ? " — выберите одного из команды и поговорите наедине" : ""}
        </p>
      )}
      {mine && r.tip && stage === "question" && <p className="mil-phone-status">💡 Совет ведущего — слушайте ведущего{r.tipText ? `: ${r.tipText}` : ""}</p>}
      {mine && stage === "reveal" && (
        <p className={r.outcome === "right" ? "success" : "error"}>{r.outcome === "right" ? "Верно!" : r.outcome === "saved" ? "Неверно, но право на ошибку спасает — ещё попытка" : "Неверно"}</p>
      )}
      {mine && (
        <section className="stack stack--tight">
          <p className="eyebrow">Подсказки</p>
          <div className="mil-phone-lifelines">
            {LIFELINES.filter((l) => content.lifelines.includes(l.id)).map((l) => {
              const gone = used.includes(l.id);
              const check = lifelineState(session, content, l.id);
              const asked = pendingAsk?.id === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  className={`mil-phone-lifeline${gone ? " is-used" : ""}${asked ? " is-asked" : ""}`}
                  disabled={!asker || gone || !check.ok || asked || (teams ? (personal?.sending ?? false) : sending)}
                  title={check.reason}
                  onClick={() => requestLifeline(l.id)}
                  aria-label={`${l.title}${gone ? " — использована" : asked ? " — ждём ведущего" : !check.ok ? ` — ${check.reason ?? "нельзя"}` : ""}`}
                >
                  <span className="mil-phone-lifeline__icon">
                    <LifelineIcon id={l.id} />
                  </span>
                  <span className="mil-phone-lifeline__label">{l.title}</span>
                </button>
              );
            })}
          </div>
          {pendingAsk && stage === "question" && <p className="muted small">Просьба «{lifelineTitle(pendingAsk.id)}» у ведущего — он переспросит и включит.</p>}
          {!pendingAsk && refusedAsk && stage === "question" && <p className="muted small">Ведущий не включил «{lifelineTitle(refusedAsk.id)}». Можно попросить другую.</p>}
          {!pendingAsk && !refusedAsk && asker && <p className="muted small">Коснитесь подсказки — ведущий переспросит и подтвердит.</p>}
        </section>
      )}
      {session.screenMode === "none" && (
        <div className="mil-phone-bars">
          <LadderBars session={session} content={content} result={r} compact />
        </div>
      )}
    </div>
  );
}
