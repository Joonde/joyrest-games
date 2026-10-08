// «Кто хочет стать миллионером»: на экране зала — полоска-лестница у каждой команды (поднимается за
// верный ответ, падает до несгораемой за ошибку) и вопрос с вариантами A–D; подсказки команды — значками
// под её полоской, использованная перечёркнута. Телефон: капитан выбирает вариант и просит подсказку,
// остальные голосуют в «Помощи зала».
import { useEffect, useRef } from "react";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { LETTERS, LEVELS, LIFELINES, pointsAt, type LifelineId, type MillionaireContent, type MillionaireQuestion } from "./content";
import { levelToPlay, lifelineState, parseMillionaireResult, questionOf, type MillionaireResult } from "./logic";

export type MillionaireAnswerValue = { choice: number } | { vote: number };

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

/** Значки подсказок команды: использованные перечёркнуты и погашены. */
export function LifelineRow({ content, used, size = "screen" }: { content: MillionaireContent; used: LifelineId[]; size?: "screen" | "phone" }) {
  return (
    <ul className={`mil-lifelines mil-lifelines--${size}`} aria-label="Подсказки">
      {LIFELINES.filter((l) => content.lifelines.includes(l.id)).map((l) => {
        const gone = used.includes(l.id);
        return (
          <li key={l.id} className={gone ? "mil-lifeline is-used" : "mil-lifeline"} title={l.title} aria-label={`${l.title}${gone ? " — использована" : ""}`}>
            <span aria-hidden="true">{l.icon}</span>
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

/** Вопрос с вариантами: погашенные пустые, проценты зала, верный и выбранный при показе ответа. */
function QuestionCard({ question, result, reveal, size = "screen" }: { question: MillionaireQuestion; result: MillionaireResult; reveal: boolean; size?: "screen" | "phone" }) {
  return (
    <div className={`mil-question mil-question--${size}`}>
      <p className="mil-question__text">{question.text}</p>
      <ol className="mil-options">
        {question.options.map((text, i) => {
          const gone = result.removed.includes(i) && !(reveal && result.outcome === "saved" && result.pick === i);
          const right = reveal && result.outcome !== "saved" && i === question.correct;
          const wrong = reveal && result.pick === i && result.outcome !== "right";
          return (
            <li key={i} className={`mil-option${gone ? " is-gone" : ""}${right ? " is-right" : ""}${wrong ? " is-wrong" : ""}${result.pick === i ? " is-picked" : ""}`}>
              <span className="mil-option__letter">{LETTERS[i]}</span>
              <span className="mil-option__text">{gone ? "" : text}</span>
              {result.audience && !gone && <span className="mil-option__pct" style={{ ["--pct" as string]: `${result.audience[i] ?? 0}%` }}>{result.audience[i] ?? 0}%</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
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

  const prev = useRef(`${step}:${r.mode}:${r.outcome}:${r.flash}`);
  useEffect(() => {
    const key = `${step}:${r.mode}:${r.outcome}:${r.flash}`;
    if (prev.current !== key) {
      if (r.outcome === "right") playSound((r.levels[r.turn ?? ""] ?? 0) >= LEVELS ? "fanfare" : "correct");
      else if (r.outcome === "wrong") playSound("wrong");
      else if (r.outcome === "saved") playSound("gong");
      else if (r.flash) playSound("whoosh");
      else if (r.mode === "question" && stage === "question") playSound("drumroll");
    }
    prev.current = key;
  }, [step, r.mode, r.outcome, r.flash, r.levels, r.turn, stage]);

  const flash = r.flash ? LIFELINES.find((l) => l.id === r.flash) : null;
  const top = r.outcome === "right" && (r.levels[r.turn ?? ""] ?? 0) >= LEVELS;

  return (
    <div className="mil-screen">
      {top && <Confetti burst={`mil:${step}`} />}
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
          </>
        ) : q ? (
          <>
            <p className="mil-screen__who">
              <NameText name={team} /> · вопрос {level} — {pointsLabel(pointsAt(content, level))}
            </p>
            {flash && (
              <p key={`${step}:${flash.id}`} className="mil-flash" role="status">
                <span aria-hidden="true">{flash.icon}</span> {flash.title}
              </p>
            )}
            <QuestionCard question={q} result={r} reveal={stage === "reveal"} />
            {r.mode === "audience" && (
              <p className="mil-screen__note mil-screen__note--big">
                👥 Зал голосует на телефонах{left !== null ? ` · ${left} с` : ""}
              </p>
            )}
            {r.callEndsAt !== null && r.callEndsAt > now && stage === "question" && <p className="mil-call">📞 Звонок другу · {clockLeft(r.callEndsAt - now)}</p>}
            {r.tip && stage === "question" && <p className="mil-screen__note">💡 Совет ведущего</p>}
            {r.shield && stage === "question" && <p className="mil-screen__note">🛡 Право на ошибку включено</p>}
            {stage === "reveal" && (
              <p className={`mil-outcome mil-outcome--${r.outcome ?? "none"}`}>
                {r.outcome === "right" ? (top ? "Миллионер! 👑" : "Верно!") : r.outcome === "saved" ? "Неверно — но спасает право на ошибку" : "Неверно"}
              </p>
            )}
          </>
        ) : null}
      </section>
      <section className="mil-screen__bars" aria-label="Лестницы команд">
        <LadderBars session={session} content={content} result={r} />
      </section>
    </div>
  );
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
          <p className="muted">Скоро на экране — проценты по вариантам.</p>
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
  const canAnswer = mine && role !== "member" && stage === "question" && open && !myAnswer && r.mode === "question";
  const callLeft = r.callEndsAt !== null && r.callEndsAt > now ? r.callEndsAt - now : 0;
  const askable = mine && teams && role === "captain" && stage === "question" && !myAnswer && personal && !personal.value;

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
                <button key={i} type="button" className="btn btn--secondary mil-phone-option" disabled={sending} onClick={() => onAnswer({ choice: i })}>
                  <span className="mil-option__letter">{LETTERS[i]}</span> {text}
                </button>
              ),
            )}
          </div>
        </>
      )}
      {mine && answered?.choice !== undefined && stage === "question" && <p className="success">Ответ {LETTERS[answered.choice]} отправлен — ждём ведущего</p>}
      {mine && callLeft > 0 && stage === "question" && (
        <p className="mil-call mil-call--phone">
          📞 Звонок другу · {clockLeft(callLeft)}
          {role !== "member" ? " — выберите одного из команды и поговорите наедине" : ""}
        </p>
      )}
      {mine && stage === "reveal" && (
        <p className={r.outcome === "right" ? "success" : "error"}>{r.outcome === "right" ? "Верно!" : r.outcome === "saved" ? "Неверно, но право на ошибку спасает — ещё попытка" : "Неверно"}</p>
      )}
      {mine && (
        <section className="stack stack--tight">
          <p className="eyebrow">Подсказки</p>
          {askable ? (
            <div className="mil-phone-lifelines">
              {LIFELINES.filter((l) => content.lifelines.includes(l.id)).map((l) => {
                const gone = used.includes(l.id);
                const check = lifelineState(session, content, l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={gone ? "btn btn--quiet mil-phone-lifeline is-used" : "btn btn--secondary mil-phone-lifeline"}
                    disabled={!check.ok || (personal?.sending ?? false)}
                    title={check.reason}
                    onClick={() => personal?.send({ lifeline: l.id })}
                    aria-label={`${l.title}${gone ? " — использована" : !check.ok ? ` — ${check.reason ?? "нельзя"}` : ""}`}
                  >
                    <span aria-hidden="true">{l.icon}</span> {l.short}
                  </button>
                );
              })}
            </div>
          ) : (
            <LifelineRow content={content} used={used} size="phone" />
          )}
          {mine && teams && personal?.value && stage === "question" && <p className="muted small">Подсказка запрошена — ведущий её включает.</p>}
          {mine && !teams && stage === "question" && <p className="muted small">Нужна подсказка — скажите ведущему.</p>}
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
