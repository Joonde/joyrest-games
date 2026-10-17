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
import { LETTERS, levelsOf, LIFELINES, lifelineTitle, pointsAt, type LifelineId, type MillionaireContent, type MillionaireQuestion } from "./content";
import { LifelineIcon, MillionaireEmblem } from "./icons";
import { showStageClass } from "../showLook";
import { ladderWindow, levelToPlay, lifelineState, parseMillionaireResult, questionOf, type MillionaireResult } from "./logic";

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

/** Полоски команд: деления лестницы, несгораемые отмечены, у той, чей ход, — подсветка. */
export const SCREEN_LADDERS = 3;

function Bar({ session, content, result, pid, style }: { session: Session; content: MillionaireContent; result: MillionaireResult; pid: string; style?: CSSProperties }) {
  const level = result.levels[pid] ?? 0;
  const active = pid === result.turn && result.mode !== "over";
  return (
    <div style={{ ["--team" as string]: colorOf(session, result, pid), ...style }} className={`mil-bar${active ? " is-turn" : ""}${level >= levelsOf(content) ? " is-top" : ""}${result.out.includes(pid) ? " is-out" : ""}${result.skip.includes(pid) ? " is-skip" : ""}`}>
      <span className="mil-bar__points">{shortPoints(pointsAt(content, level))}</span>
      <ol className="mil-bar__steps" style={{ ["--levels" as string]: levelsOf(content) } as CSSProperties} aria-label={`${nameOf(session, pid)}: ступень ${level} из ${levelsOf(content)}`}>
        {Array.from({ length: levelsOf(content) }, (_, i) => levelsOf(content) - i).map((n) => (
          <li key={n} className={`mil-step${n <= level ? " is-on" : ""}${content.safe.includes(n) ? " is-safe" : ""}${active && n === level + 1 ? " is-next" : ""}`}>
            <span aria-hidden="true">{n}</span>
          </li>
        ))}
      </ol>
      <span className="mil-bar__name">
        {level >= levelsOf(content) ? "👑 " : ""}
        <NameText name={nameOf(session, pid)} />
        {result.out.includes(pid) && <span className="mil-bar__tag"> · выбыл</span>}
        {result.skip.includes(pid) && <span className="mil-bar__tag"> · пропуск хода</span>}
      </span>
    </div>
  );
}

/**
 * Полоски. Экран зала (`carousel`): команд больше трёх — карусель (решение владельца 14 октября 2026): команда хода
 * в центре, прошлая и следующая — по бокам вполоборота, остальные за ними; сменился ход — карусель поворачивается.
 * Подсказки команд на экране — над вопросом (`LifelineBoard`), не под полосками.
 */
export function LadderBars({ session, content, result, carousel = false }: { session: Session; content: MillionaireContent; result: MillionaireResult; carousel?: boolean }) {
  const ring = result.order.filter((p) => !result.out.includes(p));
  if (!carousel || ring.length <= SCREEN_LADDERS) {
    const list = carousel ? ring : result.order;
    return (
      <div className={list.length > 8 ? "mil-bars is-many" : "mil-bars"} style={{ gridTemplateColumns: `repeat(${Math.max(1, list.length)}, minmax(0, 1fr))` }}>
        {list.map((pid) => (
          <Bar key={pid} session={session} content={content} result={result} pid={pid} />
        ))}
      </div>
    );
  }
  const n = ring.length;
  const at = Math.max(0, result.turn ? ring.indexOf(result.turn) : 0);
  const shown = ladderWindow(result, SCREEN_LADDERS);
  const waiting = ring.filter((p) => !shown.includes(p));
  return (
    <div className="mil-bars-window">
      <div className="mil-carousel" aria-label="Лестницы команд по кругу">
        {ring.map((pid, k) => {
          let rel = (((k - at) % n) + n) % n;
          if (rel > n / 2) rel -= n;
          const far = Math.abs(rel);
          return (
            <Bar
              key={pid}
              session={session}
              content={content}
              result={result}
              pid={pid}
              style={{ ["--rel" as string]: rel, ["--far" as string]: Math.min(far, 2), ["--dir" as string]: Math.sign(rel), zIndex: 10 - far, opacity: far === 0 ? 1 : far === 1 ? 0.6 : 0 }}
            />
          );
        })}
      </div>
      {waiting.length > 0 && (
        <p className="mil-bars-window__more">
          Дальше:{" "}
          {waiting.map((p, i) => (
            <span key={p}>
              {i > 0 ? ", " : ""}
              <NameText name={nameOf(session, p)} />
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** Больше стольких участников — над вопросом только подсказки того, кто ходит (остальные — на их телефонах). */
const LIFEBOARD_MAX = 8;

/**
 * Подсказки всех команд над вопросом: у каждой — свои значки, взятые перечёркнуты; команда хода подсвечена.
 * Большой праздник (больше `LIFEBOARD_MAX`, решение 17 октября 2026 по проверке Ревизора на 10 командах и 40 гостях): таблица
 * подсказок всех занимала полэкрана, имена сжимались до смайлика, вопрос уезжал за край — показываем только того, кто ходит.
 */
function LifelineBoard({ session, content, result }: { session: Session; content: MillionaireContent; result: MillionaireResult }) {
  if (content.lifelines.length === 0 || result.order.length === 0) return null;
  const alive = result.order.filter((p) => !result.out.includes(p));
  const list = alive.length > LIFEBOARD_MAX ? alive.filter((p) => p === result.turn) : alive;
  if (list.length === 0) return null;
  return (
    <ul className={`mil-lifeboard${list.length > 4 ? " is-many" : ""}${list.length === 1 ? " is-one" : ""}`} aria-label="Подсказки команд">
      {list.map((pid) => (
        <li key={pid} className={pid === result.turn ? "mil-lifeboard__team is-turn" : "mil-lifeboard__team"} style={{ ["--team" as string]: colorOf(session, result, pid) } as CSSProperties}>
          <span className="mil-lifeboard__name">
            <NameText name={nameOf(session, pid)} />
          </span>
          <LifelineRow content={content} used={result.used[pid] ?? []} />
        </li>
      ))}
    </ul>
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
              {/* Плашка-шестиугольник оформления «Студия» / «Вечер JoyRest» (в «Классике» скрыта). */}
              <span className="mil-option__plate" aria-hidden="true" />
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
function useMillionaireSounds(session: Session, r: MillionaireResult, top: number) {
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
        if ((r.levels[r.turn ?? ""] ?? 0) >= top) playSound("fanfare");
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
  }, [step, stage, r.mode, r.outcome, r.flash, r.locked, r.levels, r.turn, top]);
}

export function MillionaireScreenView({ session, content }: ViewProps<MillionaireContent>) {
  const r = parseMillionaireResult(session.state.result);
  const { stage, step } = session.state;
  const q = questionOf(content, r);
  const now = useServerNow(250, r.callEndsAt !== null || (stage === "question" && session.state.timeLimit !== null));
  const team = nameOf(session, r.turn);
  const level = levelToPlay(r, r.turn);
  const left = stage === "question" && session.state.timeLimit !== null ? secondsLeft(session.state, now) : null;
  // Время на ответ — тикают последние 10 секунд; голосование зала — последние 5.
  useCountdownSounds(left, r.mode === "audience" ? 5 : 10);
  const answerLeft = r.mode === "question" && !r.locked ? left : null;
  useMillionaireSounds(session, r, levelsOf(content));

  const flash = r.flash ? LIFELINES.find((l) => l.id === r.flash) : null;
  const top = r.outcome === "right" && (r.levels[r.turn ?? ""] ?? 0) >= levelsOf(content);
  const audience = r.mode === "audience" && stage === "question";

  return (
    <div className={`mil-screen${audience ? " mil-screen--audience" : ""}${r.order.length === 0 ? " mil-screen--intro" : ""}${showStageClass(content.look)}`}>
      {stage === "reveal" && r.outcome === "right" && <Confetti burst={`mil:${step}:${r.q}`} count={top ? 120 : 70} />}
      {stage === "reveal" && r.outcome === "right" && <span key={`glow:${step}`} className="mil-burst" aria-hidden="true" />}
      <section className="mil-screen__main">
        {r.order.length === 0 ? (
          <>
            <MillionaireEmblem className="mil-emblem" />
            <span className="quiz-screen__badge mil-screen__badge">Кто хочет стать миллионером</span>
            <h2 className="mil-screen__title">Скоро начнём!</h2>
            <p className="mil-screen__note">{levelsOf(content)} вопросов, {session.playMode === "solo" ? "у каждого игрока" : "у каждой команды"} своя лестница. Несгораемые ступени: {content.safe.join(" и ")}.</p>
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
            <LifelineBoard session={session} content={content} result={r} />
          </>
        ) : q ? (
          <>
            <p className="mil-screen__who">
              <NameText name={team} /> · вопрос {level} — {pointsLabel(pointsAt(content, level))}
              {answerLeft !== null && (
                <span className={`mil-timer${answerLeft <= 10 ? " is-low" : ""}${answerLeft === 0 ? " is-out" : ""}`} role="timer" aria-label={`Осталось ${answerLeft} с`}>
                  {answerLeft === 0 ? "Время вышло" : `${answerLeft} с`}
                </span>
              )}
            </p>
            {!audience && <LifelineBoard session={session} content={content} result={r} />}
            {flash && (
              <p key={`${step}:${flash.id}`} className="mil-flash" role="status">
                <LifelineIcon id={flash.id} /> {flash.title}
              </p>
            )}
            {audience && r.qrBig && audienceRepo && (
              <div className="mil-qr-big" role="dialog" aria-label="QR-код для голосования зала">
                <QrCode value={voteUrl(session.code)} label="QR-код: голосовать в помощи зала" />
                <div className="mil-qr-big__text">
                  <p className="mil-audience__title">Помощь зала</p>
                  <p>Наведите камеру и выберите ответ</p>
                  <p className="mil-audience__count">
                    {r.votes} {votesWord(r.votes)}
                    {left !== null ? ` · ${left} с` : ""}
                  </p>
                </div>
              </div>
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
          </>
        ) : null}
      </section>
      {r.order.length > 0 && (
        <section className="mil-screen__bars" aria-label="Лестницы команд">
          <LadderBars session={session} content={content} result={r} carousel />
        </section>
      )}
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
      Миллионер{r.order.includes(pid) ? ` · ступень ${myLevel} из ${levelsOf(content)} · ${pointsLabel(pointsAt(content, myLevel))}` : ""}
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

  // Ходит другая команда: телефон только наблюдает — ни одной кнопки, понятно, что нажимать ничего не надо
  // (решение владельца 14 октября 2026).
  if (!mine) {
    const out = r.out.includes(pid);
    return (
      <div className="quiz-phone mil-watch">
        {head}
        <div className="mil-watch__plate" role="status">
          <span className="mil-watch__eye" aria-hidden="true">
            👀
          </span>
          <strong>
            Отвечает <NameText name={nameOf(session, r.turn)} />
          </strong>
          <span>{out ? "Вы выбыли из игры — болейте за других!" : "Сейчас не ваш ход — вы наблюдаете. Нажимать ничего не нужно, смотрите на экран."}</span>
        </div>
        <p className="muted small mil-watch__level">
          Вопрос {levelToPlay(r, r.turn)} — {pointsLabel(pointsAt(content, levelToPlay(r, r.turn)))}
        </p>
        <div className="mil-watch__question" aria-label={session.playMode === "solo" ? "Вопрос другого игрока" : "Вопрос другой команды"}>
          <QuestionCard question={q} result={r} reveal={stage === "reveal"} size="phone" />
        </div>
        {stage === "reveal" && <p className={r.outcome === "right" ? "success" : "muted"}>{r.outcome === "right" ? "Они ответили верно!" : r.outcome === "saved" ? "Ошибка, но их спасло право на ошибку" : "Они ошиблись"}</p>}
        {r.order.includes(pid) && !out && <p className="muted small">Ваш ход — когда ведущий передаст его вам: телефон покажет «Ваш вопрос».</p>}
      </div>
    );
  }

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
          {role === "member" ? "" : session.playMode === "solo" ? " — позвоните другу или выберите гостя из зала" : " — выберите одного из команды и поговорите наедине"}
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
          <LadderBars session={session} content={content} result={r} />
        </div>
      )}
    </div>
  );
}
