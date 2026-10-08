import { useEffect, useRef, useState, type FormEvent } from "react";
import { NameText } from "../NameText";
import { MediaImage } from "../media/MediaImage";
import { Confetti } from "./Confetti";
import { playSample, playSound, preloadSamples } from "./sound";
import {
  LEVEL_NAMES,
  PENALTY_TITLES,
  penaltyFor,
  SUPER_LIMITS,
  type SuperAnswer,
  type SuperGroup,
  type SuperLevel,
  type SuperPenalty,
  type SuperStyle,
  type SuperVerdict,
} from "../../core/supergame";
import { pointsLabel } from "../../core/results";

// Суперигра на экране зала, телефоне и пульте. Ход шага ведёт формат (квиз), здесь — только вид:
// заставка с лучами, четыре уровня с теми, кто их выбрал, ответы с плюсом и минусом.

const LEVEL_KEYS = ["bronze", "silver", "gold", "diamond"] as const;

/** Картинка уровня в оформлении: сундук, ключ, корона или кубок цвета металла уровня. */
export function LevelIcon({ style, level }: { style: SuperStyle; level: number }) {
  const cls = `super-icon super-level--${LEVEL_KEYS[level] ?? "gold"}`;
  const common = { className: cls, viewBox: "0 0 64 64", "aria-hidden": true, focusable: false } as const;
  const fill = "var(--lvl)";
  const deep = "var(--lvl-deep)";
  if (style === "keys") {
    return (
      <svg {...common}>
        <circle cx="20" cy="22" r="13" fill={fill} stroke={deep} strokeWidth="3" />
        <circle cx="20" cy="22" r="5" fill="none" stroke={deep} strokeWidth="3" />
        <path d="M30 30l24 24M44 44l6-6M50 50l5-5" stroke={deep} strokeWidth="6" strokeLinecap="round" />
        <path d="M30 30l24 24" stroke={fill} strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (style === "crowns") {
    return (
      <svg {...common}>
        <path d="M8 48L6 18l15 13 11-19 11 19 15-13-2 30z" fill={fill} stroke={deep} strokeWidth="3" strokeLinejoin="round" />
        <rect x="8" y="48" width="48" height="8" rx="2" fill={deep} />
        <circle cx="32" cy="38" r="4" fill={deep} />
        <circle cx="6" cy="16" r="3" fill={fill} stroke={deep} strokeWidth="2" />
        <circle cx="32" cy="10" r="3" fill={fill} stroke={deep} strokeWidth="2" />
        <circle cx="58" cy="16" r="3" fill={fill} stroke={deep} strokeWidth="2" />
      </svg>
    );
  }
  if (style === "cups") {
    return (
      <svg {...common}>
        <path d="M16 8h32v14c0 11-7 18-16 18s-16-7-16-18z" fill={fill} stroke={deep} strokeWidth="3" strokeLinejoin="round" />
        <path d="M16 14H8c0 9 4 13 9 13M48 14h8c0 9-4 13-9 13" fill="none" stroke={deep} strokeWidth="3" />
        <path d="M28 40h8v8h-8z" fill={deep} />
        <rect x="18" y="48" width="28" height="8" rx="2" fill={fill} stroke={deep} strokeWidth="3" />
        <path d="M24 14v10" stroke="#fff" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M8 28c0-10 10-16 24-16s24 6 24 16z" fill={fill} stroke={deep} strokeWidth="3" strokeLinejoin="round" />
      <rect x="8" y="28" width="48" height="26" rx="3" fill={fill} stroke={deep} strokeWidth="3" />
      <path d="M8 36h48M20 14v40M44 14v40" stroke={deep} strokeWidth="3" />
      <rect x="27" y="30" width="10" height="12" rx="2" fill={deep} />
      <circle cx="32" cy="35" r="2" fill={fill} />
    </svg>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

function signed(n: number): string {
  return n > 0 ? `+${pointsLabel(n)}` : n < 0 ? `−${pointsLabel(-n)}` : "0";
}

export interface SuperScreenProps {
  stage: "ready" | "question" | "reveal";
  gameId: string | null;
  title: string;
  levels: SuperLevel[];
  style: SuperStyle;
  penalty: SuperPenalty;
  /** Кто какой уровень выбрал (во время выбора). */
  picks: Record<string, number>;
  /** Итоги после «Показать ответы». */
  verdicts: Record<string, SuperVerdict>;
  names: Record<string, string>;
  /** Таймер: секунды или null (не идёт), «Стоп» при 0. */
  left: number | null;
  timeLimit: number;
  /** Меняется на каждом новом показе (звуки и конфетти). */
  burst: string;
  counter?: string;
}

/** Экран зала: заставка, выбор уровней, ответы. */
export function SuperScreen(props: SuperScreenProps) {
  const { stage, gameId, title, levels, style, penalty, picks, verdicts, names, left, timeLimit, burst, counter } = props;
  // Музыка заставки и звук каждого нового выбора уровня.
  useEffect(() => preloadSamples(["superChest"]), []);
  const introKey = stage === "ready" ? burst : "";
  const lastIntro = useRef(introKey);
  useEffect(() => {
    if (introKey && lastIntro.current !== introKey) playSample("superChest", "treasure", 0.9);
    lastIntro.current = introKey;
  }, [introKey]);
  const pickCount = Object.keys(picks).length;
  const lastPicks = useRef(pickCount);
  useEffect(() => {
    if (stage === "question" && pickCount > lastPicks.current) playSound("sparkle");
    lastPicks.current = pickCount;
  }, [pickCount, stage]);
  const wrongCount = Object.values(verdicts).filter((v) => !v.right).length;
  const lastWrong = useRef(stage === "reveal" ? wrongCount : 0);
  useEffect(() => {
    // Ошибки — короткий «мимо» после фанфары верного ответа.
    if (stage === "reveal" && wrongCount > lastWrong.current) {
      const t = window.setTimeout(() => playSound("wrong"), 900);
      lastWrong.current = wrongCount;
      return () => window.clearTimeout(t);
    }
    if (stage !== "reveal") lastWrong.current = 0;
    return undefined;
  }, [stage, wrongCount]);

  if (stage === "ready") {
    return (
      <div className="super-screen super-screen--intro">
        <div className="super-rays" aria-hidden="true" />
        <div className="super-sparkles" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, animationDelay: `${(i % 7) * 0.35}s` }} />
          ))}
        </div>
        <span className="quiz-screen__badge">Суперигра</span>
        <h2 className="super-screen__title">
          {title || "Суперигра"}
        </h2>
        <ol className="super-levels super-levels--intro">
          {levels.map((l, i) => (
            <li key={i} className={`super-level super-level--${LEVEL_KEYS[i]}`} style={{ animationDelay: `${0.4 + i * 0.25}s` }}>
              <span className="super-level__icon" aria-hidden="true">
                <LevelIcon style={style} level={i} />
              </span>
              <span className="super-level__name">{LEVEL_NAMES[i]}</span>
              <span className="super-level__points">{pointsLabel(l.points)}</span>
            </li>
          ))}
        </ol>
        <p className="quiz-screen__hint">Капитаны выбирают уровень на телефоне · {PENALTY_TITLES[penalty].toLowerCase()}</p>
      </div>
    );
  }

  const revealed = stage === "reveal";
  const byLevel: string[][] = levels.map(() => []);
  for (const [pid, level] of Object.entries(revealed ? Object.fromEntries(Object.entries(verdicts).map(([p, v]) => [p, v.level])) : picks)) {
    byLevel[level]?.push(pid);
  }
  const anyRight = Object.values(verdicts).some((v) => v.right);

  return (
    <div className={revealed ? "super-screen super-screen--reveal" : "super-screen"}>
      {revealed && anyRight && <Confetti burst={`super:${burst}`} count={90} />}
      <div className="quiz-screen__top">
        {counter && <span className="quiz-screen__counter">{counter}</span>}
        <span className="quiz-screen__badge">Суперигра</span>
        {revealed ? (
          <span className="quiz-screen__answered">
            Верно: {Object.values(verdicts).filter((v) => v.right).length} из {Object.keys(verdicts).length}
          </span>
        ) : (
          <span className="quiz-screen__answered">Выбрали: {pickCount}</span>
        )}
        {!revealed && (
          <span className={left === 0 ? "quiz-screen__timer is-over" : "quiz-screen__timer"} role="timer">
            {left === null ? timeLimit : left === 0 ? "Стоп" : left}
          </span>
        )}
      </div>
      <h2 className="super-screen__head">{revealed ? "Ответы суперигры" : "Выберите уровень и ответьте"}</h2>
      <ol className="super-levels">
        {levels.map((l, i) => {
          const who = byLevel[i] ?? [];
          const fine = penaltyFor(penalty, i, l.points);
          return (
            <li key={i} className={`super-level super-level--${LEVEL_KEYS[i]}${who.length > 0 ? " is-picked" : ""}`}>
              <span className="super-level__icon" aria-hidden="true">
                <LevelIcon style={style} level={i} />
              </span>
              <span className="super-level__name">{LEVEL_NAMES[i]}</span>
              <span className="super-level__points">
                {pointsLabel(l.points)}
                {fine > 0 && <span className="super-level__fine"> · ошибка −{pointsLabel(fine)}</span>}
              </span>
              {revealed && (
                <span className="super-level__question">
                  {l.imageId && <MediaImage className="super-level__img" gameId={gameId} mediaId={l.imageId} variant="full" alt="" />}
                  {l.text && <span>{l.text}</span>}
                  <strong className="super-level__answer">{l.answers.find((a) => a.trim()) ?? "—"}</strong>
                </span>
              )}
              <span className="super-level__who">
                {who.length === 0 ? (
                  <span className="super-level__empty">{revealed ? "никто" : "—"}</span>
                ) : (
                  who.map((pid) => {
                    const v = verdicts[pid];
                    const cls = !revealed ? "super-chip is-new" : v?.right ? "super-chip is-right" : "super-chip is-wrong";
                    return (
                      <span key={pid} className={cls}>
                        <NameText name={names[pid] ?? "Игрок"} />
                        {revealed && v && <span className="super-chip__delta">{v.right ? "✓" : "✕"} {signed(v.delta)}</span>}
                      </span>
                    );
                  })
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export interface SuperPhoneProps {
  stage: "ready" | "question" | "reveal";
  gameId: string | null;
  levels: SuperLevel[];
  style: SuperStyle;
  penalty: SuperPenalty;
  role: "player" | "captain" | "member";
  /** Свой отправленный ответ. */
  mine: SuperAnswer | null;
  verdict: SuperVerdict | null;
  canAnswer: boolean;
  sending: boolean;
  open: boolean;
  left: number | null;
  /** Без экрана зала — вопрос и картинки на телефоне всегда. */
  showImages: boolean;
  onAnswer: (answer: SuperAnswer) => void;
}

/** Телефон: выбор уровня → вопрос уровня и ответ (уровень можно сменить до отправки) → итог. */
export function SuperPhone(props: SuperPhoneProps) {
  const { stage, gameId, levels, style, penalty, role, mine, verdict, canAnswer, sending, open, left, showImages, onAnswer } = props;
  const [level, setLevel] = useState<number | null>(null);
  const [text, setText] = useState("");
  const icon = <LevelIcon style={style} level={mine?.level ?? 2} />;

  if (stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center super-phone">
        <p className="super-phone__icon" aria-hidden="true">
          {icon}
        </p>
        <h2 className="quiz-phone__question">Суперигра!</h2>
        <p className="muted">{role === "member" ? "Уровень выбирает капитан. Смотрите на экран." : "Сейчас вы выберете уровень: чем выше — тем больше очков и риск."}</p>
      </div>
    );
  }

  if (stage === "reveal") {
    const lvl = verdict ? levels[verdict.level] : mine ? levels[mine.level] : undefined;
    const at = verdict?.level ?? mine?.level ?? -1;
    return (
      <div className="quiz-phone quiz-phone--center super-phone" aria-live="polite">
        <p className="eyebrow">Суперигра</p>
        {!verdict ? (
          <p className="quiz-phone__verdict">Ответа не было</p>
        ) : (
          <>
            <p className={verdict.right ? "quiz-phone__verdict is-right" : "quiz-phone__verdict is-wrong"}>{verdict.right ? "Верно!" : "Неверно"}</p>
            <p className={verdict.delta >= 0 ? "quiz-phone__plus" : "quiz-phone__minus"}>{signed(verdict.delta)}</p>
          </>
        )}
        {lvl && (
          <p className="muted">
            {LEVEL_NAMES[at]}: {lvl.text}
            <br />
            Правильный ответ: <strong>{lvl.answers.find((a) => a.trim()) ?? "—"}</strong>
          </p>
        )}
      </div>
    );
  }

  // Ответ уже отправлен.
  if (mine) {
    return (
      <div className="quiz-phone quiz-phone--center super-phone">
        <p className="eyebrow">Суперигра · {LEVEL_NAMES[mine.level]}</p>
        <p className="super-phone__icon" aria-hidden="true">
          {icon}
        </p>
        <p className="quiz-phone__status success">{role === "member" ? "Капитан ответил" : "Ответ принят"}</p>
        <p className="muted">«{mine.text}» · ждём, когда ведущий покажет ответы</p>
      </div>
    );
  }

  if (role === "member") {
    return (
      <div className="quiz-phone quiz-phone--center super-phone">
        <p className="eyebrow">Суперигра</p>
        <p className="super-phone__icon" aria-hidden="true">
          {icon}
        </p>
        <p className="muted">Капитан выбирает уровень и отвечает. Подскажите ему!</p>
      </div>
    );
  }

  const status = sending ? "Отправляем ответ…" : !open ? "Время вышло" : left === null ? "" : `Осталось ${left} с`;

  if (level === null) {
    return (
      <div className="quiz-phone super-phone">
        <p className="eyebrow">Суперигра · выберите уровень</p>
        <div className="super-pick">
          {levels.map((l, i) => {
            const fine = penaltyFor(penalty, i, l.points);
            return (
              <button key={i} type="button" className={`super-pick__btn super-level--${LEVEL_KEYS[i]}`} disabled={!canAnswer} onClick={() => setLevel(i)}>
                <span className="super-pick__icon" aria-hidden="true">
                  <LevelIcon style={style} level={i} />
                </span>
                <span className="super-pick__name">{LEVEL_NAMES[i]}</span>
                <span className="super-pick__points">
                  +{pointsLabel(l.points)}
                  {fine > 0 ? ` · ошибка −${pointsLabel(fine)}` : ""}
                </span>
              </button>
            );
          })}
        </div>
        {status && <p className="quiz-phone__status muted">{status}</p>}
      </div>
    );
  }

  const chosen = levels[level];
  function submit(event: FormEvent) {
    event.preventDefault();
    if (level !== null && canAnswer && text.trim()) onAnswer({ level, text: text.trim().slice(0, SUPER_LIMITS.answer) });
  }
  return (
    <form className="quiz-phone stack super-phone" onSubmit={submit}>
      <p className="eyebrow">
        Суперигра · {LEVEL_NAMES[level]} · +{pointsLabel(chosen?.points ?? 0)}
      </p>
      {chosen?.imageId && showImages && <MediaImage className="quiz-phone__image" gameId={gameId} mediaId={chosen.imageId} variant="small" alt="" />}
      <h2 className="quiz-phone__question">{chosen?.text || "Что на картинке?"}</h2>
      <label className="field">
        Ваш ответ
        <input value={text} maxLength={SUPER_LIMITS.answer} autoComplete="off" enterKeyHint="send" disabled={!canAnswer} onChange={(e) => setText(e.target.value)} />
      </label>
      <button className="btn btn--block" type="submit" disabled={!canAnswer || !text.trim()}>
        Отправить ответ
      </button>
      <button type="button" className="btn btn--secondary btn--block" disabled={sending} onClick={() => setLevel(null)}>
        Сменить уровень
      </button>
      {status && <p className="quiz-phone__status muted">{status}</p>}
    </form>
  );
}

/** Пульт: ответы по уровням, опечатку можно засчитать до показа ответов. */
export function SuperHostAnswers({
  levels,
  groups,
  picksCount,
  editable,
  busy,
  onToggle,
}: {
  levels: SuperLevel[];
  groups: SuperGroup[][];
  picksCount: number[];
  editable: boolean;
  busy: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <section className="stack stack--tight" aria-label="Ответы по уровням">
      <h3 className="host-quiz__subtitle">Ответы по уровням</h3>
      {editable && <p className="muted small">Опечатка? «Засчитать» до «Показать ответы».</p>}
      {levels.map((l, i) => {
        const list = groups[i] ?? [];
        const n = picksCount[i] ?? 0;
        return (
          <div key={i} className="stack stack--tight">
            <p className="small">
              <strong>{LEVEL_NAMES[i]}</strong> · {pointsLabel(l.points)} · {n} {plural(n, "ответ", "ответа", "ответов")} · верно: {l.answers.filter((a) => a.trim()).join(" / ") || "—"}
            </p>
            {list.length > 0 && (
              <ul className="open-answers">
                {list.map((g) => (
                  <li key={g.key} className={`open-answers__item open-answers__item--${g.status}`}>
                    <span className="open-answers__text">
                      {g.text} <span className="muted">× {g.count}</span>
                    </span>
                    {g.status === "correct" ? (
                      <span className="open-answers__mark">Верно</span>
                    ) : editable ? (
                      <button
                        type="button"
                        className={g.status === "accepted" ? "btn btn--secondary open-answers__btn" : "btn btn--quiet open-answers__btn"}
                        aria-pressed={g.status === "accepted"}
                        disabled={busy}
                        onClick={() => onToggle(g.key)}
                      >
                        {g.status === "accepted" ? "Засчитано ✓" : "Засчитать"}
                      </button>
                    ) : (
                      <span className="open-answers__mark">{g.status === "accepted" ? "Засчитано" : "Неверно"}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
