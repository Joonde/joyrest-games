import { useEffect, useRef, useState, type FormEvent } from "react";
import { HallTimer } from "./HallTimer";
import { NameText } from "../NameText";
import { MediaImage } from "../media/MediaImage";
import { Confetti } from "./Confetti";
import { playSample, playSound, preloadSamples } from "./sound";
import {
  activeLevels,
  LEVEL_NAMES,
  levelAnswerText,
  levelKind,
  PENALTY_TITLES,
  penaltyFor,
  SUPER_LIMITS,
  superAnswerText,
  superOrderShown,
  votePercent,
  voteUndecided,
  type LevelVote,
  type SuperAnswer,
  type SuperGroup,
  type SuperLevel,
  type SuperPenalty,
  type SuperPickMode,
  type SuperStyle,
  type SuperVerdict,
  type SuperVote,
} from "../../core/supergame";
import { pointsLabel } from "../../core/results";

// Суперигра на экране зала, телефоне и пульте. Ход шага ведёт формат (квиз), здесь — только вид:
// заставка с лучами, четыре уровня с теми, кто их выбрал, ответы с плюсом и минусом.

const LEVEL_KEYS = ["bronze", "silver", "gold", "diamond"] as const;

/** Адрес нарисованной картинки уровня (Canva, public/super/art/web/, 384 px). Сундук после верного ответа — открытый, с золотом. */
export function levelArt(style: SuperStyle, level: number, open = false): string {
  const sheet = style === "chests" && open ? "chests-open" : style;
  return `/super/art/web/${sheet}-${LEVEL_KEYS[level] ?? "gold"}.webp`;
}

/** Все картинки оформления заранее: открытый сундук не должен мигать пустым местом при «Показать ответы». */
function useArtPreload(style: SuperStyle) {
  useEffect(() => {
    const imgs = LEVEL_KEYS.flatMap((_, i) => [levelArt(style, i), levelArt(style, i, true)]).map((src) => {
      const img = new Image();
      img.src = src;
      return img;
    });
    return () => {
      for (const img of imgs) img.src = "";
    };
  }, [style]);
}

/** Картинка уровня в оформлении: сундук, ключ, корона или кубок цвета металла уровня. Нет файла — простой рисунок. */
export function LevelIcon({ style, level, open = false }: { style: SuperStyle; level: number; open?: boolean }) {
  const src = levelArt(style, level, open);
  const [failed, setFailed] = useState<string | null>(null);
  if (failed !== src) {
    return <img className="super-icon super-icon--art" src={src} alt="" draggable={false} decoding="async" onError={() => setFailed(src)} />;
  }
  return <LevelSvg style={style} level={level} />;
}

function LevelSvg({ style, level }: { style: SuperStyle; level: number }) {
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
  /** Режим команд (по умолчанию): уровень выбирают капитаны; false — «каждый сам». */
  teams?: boolean;
  /** Перед суперигрой голосуют «Играем?» (настройка вопроса). */
  voteEnabled?: boolean;
  /** Голосование: идёт или итог. */
  vote?: SuperVote;
  /** Суперигру пропустили по итогам голосования. */
  skipped?: boolean;
  /** Трек какого уровня включил ведущий (null — тишина). */
  playing?: number | null;
  /** Как выбирают уровень: весь зал голосует (один уровень) или каждый свой. */
  pickMode?: SuperPickMode;
  /** Голосование «Какой уровень играем?»: идёт или итог. */
  levelVote?: LevelVote;
}

function votesLabel(n: number): string {
  return `${n} ${plural(n, "голос", "голоса", "голосов")}`;
}

/** Голосование за уровень на экране зала: уровни игры, сколько голосов у каждого, таймер. */
function LevelVoteScreen({ levels, style, penalty, vote, left, timeLimit, counter, cls }: { levels: SuperLevel[]; style: SuperStyle; penalty: SuperPenalty; vote: LevelVote; left: number | null; timeLimit: number; counter?: string; cls: string }) {
  const active = activeLevels(levels);
  const total = active.reduce((sum, i) => sum + (vote.counts[i] ?? 0), 0);
  const best = Math.max(0, ...active.map((i) => vote.counts[i] ?? 0));
  return (
    <div className={`super-screen super-screen--intro ${cls}`}>
      {counter && <span className="quiz-screen__counter">{counter}</span>}
      <span className="quiz-screen__badge">Суперигра · выбор уровня</span>
      <p className="super-vote__q">Какой уровень играем?</p>
      <ol className="super-levels super-levels--intro super-levels--vote" style={{ ["--n" as string]: active.length }}>
        {active.map((i) => {
          const l = levels[i];
          const n = vote.counts[i] ?? 0;
          const fine = l ? penaltyFor(penalty, i, l.points) : 0;
          return (
            <li key={i} className={`super-level super-level--${LEVEL_KEYS[i]}${n > 0 && n === best ? " is-picked" : ""}`}>
              <span className="super-level__icon" aria-hidden="true">
                <LevelIcon style={style} level={i} />
              </span>
              <span className="super-level__name">{LEVEL_NAMES[i]}</span>
              <span className="super-level__points">
                {pointsLabel(l?.points ?? 0)}
                {fine > 0 && <span className="super-level__fine">ошибка −{pointsLabel(fine)}</span>}
              </span>
              <span className="super-level__votes">{votesLabel(n)}</span>
            </li>
          );
        })}
      </ol>
      <p className="quiz-screen__hint">Голосуйте на телефонах: коснитесь уровня · проголосовали {total}</p>
      <HallTimer left={left} total={timeLimit} />
    </div>
  );
}

/** Голосование и его итог на экране зала: сколько проголосовало, проценты, решение. */
function VotePanel({ vote, left, timeLimit }: { vote: SuperVote; left: number | null; timeLimit: number }) {
  const total = vote.yes + vote.no;
  const yes = votePercent(vote.yes, vote.no);
  if (vote.phase === "open") {
    return (
      <div className="super-vote">
        <p className="super-vote__q">Играем суперигру?</p>
        <p className="super-vote__risk">Верный ответ — очки уровня. Ошибка — можно потерять очки, заработанные в раунде.</p>
        <p className="super-vote__count">
          Проголосовали: <strong>{total}</strong>
        </p>
        <p className="quiz-screen__hint">Голосуйте на телефонах: «За» или «Против»</p>
        <HallTimer left={left} total={timeLimit} />
      </div>
    );
  }
  const passed = vote.passed === true;
  const undecided = voteUndecided(vote);
  return (
    <div className="super-vote super-vote--done">
      {vote.coin && <p className="super-vote__risk">Голоса разделились поровну — монетка решила</p>}
      <p className={undecided ? "super-vote__verdict" : passed ? "super-vote__verdict is-yes" : "super-vote__verdict is-no"}>
        {undecided ? "Голоса поровну! Решит монетка" : passed ? "Играем суперигру!" : "Суперигру не играем"}
      </p>
      <div className="super-vote__bars" aria-label={`За ${yes}%, против ${total === 0 ? 0 : 100 - yes}%`}>
        <div className="super-vote__bar is-yes" style={{ ["--share" as string]: `${total === 0 ? 0 : yes}%` }}>
          <span>За</span>
          <strong>{total === 0 ? 0 : yes}%</strong>
          <span className="super-vote__n">{vote.yes}</span>
        </div>
        <div className="super-vote__bar is-no" style={{ ["--share" as string]: `${total === 0 ? 0 : 100 - yes}%` }}>
          <span>Против</span>
          <strong>{total === 0 ? 0 : 100 - yes}%</strong>
          <span className="super-vote__n">{vote.no}</span>
        </div>
      </div>
      <p className="quiz-screen__hint">Проголосовали: {total}</p>
    </div>
  );
}

/** Экран зала: заставка, выбор уровней, ответы. */
export function SuperScreen(props: SuperScreenProps) {
  const { stage, gameId, title, levels, style, penalty, picks, verdicts, names, left, timeLimit, burst, counter, teams = true, voteEnabled = false, vote, skipped = false, playing = null, pickMode = "each", levelVote } = props;
  const active = activeLevels(levels);
  const voteMode = pickMode === "vote";
  const chosen = levelVote?.phase === "done" && levelVote.level !== undefined && active.includes(levelVote.level) ? levelVote.level : null;
  // Музыка заставки и звук каждого нового выбора уровня.
  useEffect(() => preloadSamples(["superChest"]), []);
  useArtPreload(style);
  // Сокровищница на весь кадр (палитра «Вечер JoyRest» в любой теме сессии) и анимация по оформлению.
  const stageCls = `show-stage show-stage--evening super-screen--vault super-screen--${style}`;
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

  // «Всё равно пропустить» после выбора уровня — на экране итог «не играем», а не выбранный уровень.
  if (stage === "ready" && chosen !== null && vote?.passed !== false) {
    const l = levels[chosen];
    const fine = l ? penaltyFor(penalty, chosen, l.points) : 0;
    return (
      <div className={`super-screen super-screen--intro super-screen--chosen ${stageCls}`}>
        <div className="super-rays" aria-hidden="true" />
        <span className="quiz-screen__badge">Суперигра</span>
        <p className="super-chosen__eyebrow">{levelVote?.host ? "Играем уровень" : levelVote?.tie ? "Жребий выбрал уровень" : "Зал выбрал уровень"}</p>
        <div className={`super-chosen super-level--${LEVEL_KEYS[chosen]}`}>
          <span className="super-chosen__icon" aria-hidden="true">
            <LevelIcon style={style} level={chosen} />
            <span className="super-glint" style={{ animationDelay: "0.8s", ["--glint-mask" as string]: `url(${levelArt(style, chosen)})` }} />
          </span>
          <span className="super-level__name">{LEVEL_NAMES[chosen]}</span>
          <span className="super-level__points">
            {pointsLabel(l?.points ?? 0)}
            {fine > 0 && <span className="super-level__fine">ошибка −{pointsLabel(fine)}</span>}
          </span>
        </div>
        {levelVote && (
          <p className="quiz-screen__hint">
            {active.map((i) => `${LEVEL_NAMES[i]} — ${levelVote.counts[i] ?? 0}`).join(" · ")}
          </p>
        )}
      </div>
    );
  }

  if (stage === "ready") {
    return (
      <div className={`super-screen super-screen--intro ${stageCls}`}>
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
        {vote?.phase !== "done" && (
          <ol className="super-levels super-levels--intro" style={{ ["--n" as string]: active.length }}>
            {levels.map((l, i) => l.off ? null : (
              <li key={i} className={`super-level super-level--${LEVEL_KEYS[i]}`} style={{ animationDelay: `${0.4 + i * 0.25}s` }}>
                <span className="super-level__icon" aria-hidden="true">
                  <LevelIcon style={style} level={i} />
                  <span className="super-glint" style={{ animationDelay: `${1.6 + i * 0.4}s`, ["--glint-mask" as string]: `url(${levelArt(style, i)})` }} />
                </span>
                <span className="super-level__name">{LEVEL_NAMES[i]}</span>
                <span className="super-level__points">{pointsLabel(l.points)}</span>
              </li>
            ))}
          </ol>
        )}
        {vote?.phase === "done" ? (
          <VotePanel vote={vote} left={null} timeLimit={0} />
        ) : (
          <p className="quiz-screen__hint">
            {voteEnabled ? "Сначала голосуем: играем суперигру или нет · " : ""}
            {voteMode ? "Зал голосует, какой уровень играем" : `${teams ? "Капитаны выбирают" : "Каждый выбирает"} уровень на телефоне`} · {PENALTY_TITLES[penalty].toLowerCase()}
          </p>
        )}
      </div>
    );
  }

  if (stage === "question" && vote?.phase === "open") {
    return (
      <div className={`super-screen super-screen--intro ${stageCls}`}>
        {counter && <span className="quiz-screen__counter">{counter}</span>}
        <span className="quiz-screen__badge">Суперигра · голосование</span>
        <h2 className="super-screen__title">{title || "Суперигра"}</h2>
        <VotePanel vote={vote} left={left} timeLimit={timeLimit} />
      </div>
    );
  }

  if (stage === "question" && levelVote?.phase === "open") {
    return <LevelVoteScreen levels={levels} style={style} penalty={penalty} vote={levelVote} left={left} timeLimit={timeLimit} counter={counter} cls={stageCls} />;
  }

  if (stage === "reveal" && skipped) {
    return (
      <div className={`super-screen super-screen--intro ${stageCls}`}>
        <span className="quiz-screen__badge">Суперигра</span>
        <h2 className="super-screen__title">Суперигру не играем</h2>
        <p className="quiz-screen__hint">Зал решил не рисковать — очки раунда сохранены.</p>
        {vote && <VotePanel vote={{ ...vote, phase: "done" }} left={null} timeLimit={0} />}
      </div>
    );
  }

  const revealed = stage === "reveal";

  // Зал выбрал один уровень: на экране — одна картинка и её вопрос, после ответов — кто угадал.
  if (chosen !== null && voteMode) {
    const l = levels[chosen];
    const fine = l ? penaltyFor(penalty, chosen, l.points) : 0;
    const list = Object.entries(verdicts).filter(([, v]) => v.level === chosen);
    const won = revealed && list.some(([, v]) => v.right);
    const lost = revealed && list.length > 0 && !won;
    const answeredCount = Object.keys(picks).length;
    return (
      <div className={`${revealed ? "super-screen super-screen--reveal" : "super-screen"} super-screen--single ${stageCls}`}>
        {revealed && won && <Confetti burst={`super:${burst}`} count={90} />}
        <div className="quiz-screen__top">
          {counter && <span className="quiz-screen__counter">{counter}</span>}
          <span className="quiz-screen__badge">Суперигра · {LEVEL_NAMES[chosen]}</span>
          <span className="quiz-screen__answered">{revealed ? `Верно: ${list.filter(([, v]) => v.right).length} из ${list.length}` : `Ответили: ${answeredCount}`}</span>
          {!revealed && <HallTimer left={left} total={timeLimit} />}
        </div>
        <div className={`super-single super-level--${LEVEL_KEYS[chosen]}${won ? " is-won" : lost ? " is-lost" : ""}`}>
          <div className="super-single__art super-level">
            <span className="super-level__icon" aria-hidden="true">
              <LevelIcon style={style} level={chosen} open={won} />
            </span>
            <span className="super-level__name">{LEVEL_NAMES[chosen]}</span>
            <span className="super-level__points">
              {pointsLabel(l?.points ?? 0)}
              {fine > 0 && <span className="super-level__fine">ошибка −{pointsLabel(fine)}</span>}
            </span>
          </div>
          <div className="super-single__body">
            {l?.imageId && <MediaImage className="super-single__img" gameId={gameId} mediaId={l.imageId} variant="full" alt="" />}
            <p className={(l?.text.length ?? 0) > 120 ? "super-single__q is-long" : "super-single__q"}>{l?.text || (l?.trackId ? "Что звучит?" : "Что на картинке?")}</p>
            {!revealed && playing === chosen && <p className="super-screen__playing">♪ Звучит трек уровня</p>}
            {revealed && (
              <p className="super-single__answer">
                Ответ: <strong>{levelAnswerText(l)}</strong>
              </p>
            )}
            {revealed && (
              <div className="super-level__who super-single__who">
                {list.length === 0 ? (
                  <span className="super-level__empty">Ответов не было</span>
                ) : (
                  list.map(([pid, v]) => (
                    <span key={pid} className={v.right ? "super-chip is-right" : "super-chip is-wrong"}>
                      <NameText name={names[pid] ?? "Игрок"} />
                      <span className="super-chip__delta">
                        {v.right ? "✓" : "✕"} {signed(v.delta)}
                      </span>
                    </span>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const byLevel: string[][] = levels.map(() => []);
  for (const [pid, level] of Object.entries(revealed ? Object.fromEntries(Object.entries(verdicts).map(([p, v]) => [p, v.level])) : picks)) {
    byLevel[level]?.push(pid);
  }
  const anyRight = Object.values(verdicts).some((v) => v.right);

  return (
    <div className={`${revealed ? "super-screen super-screen--reveal" : "super-screen"} ${stageCls}`}>
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
          <HallTimer left={left} total={timeLimit} />
        )}
      </div>
      <h2 className="super-screen__head">
        {revealed ? "Ответы суперигры" : "Выберите уровень и ответьте"}
        {!revealed && playing !== null && levels[playing] && <span className="super-screen__playing">♪ Звучит трек уровня «{LEVEL_NAMES[playing]}»</span>}
      </h2>
      <ol className="super-levels" style={{ ["--n" as string]: active.length }}>
        {levels.map((l, i) => {
          if (l.off) return null;
          const who = byLevel[i] ?? [];
          const fine = penaltyFor(penalty, i, l.points);
          // После ответов: кто-то угадал — сундук открывается (монеты, свет), у других оформлений — блеск и искры;
          // выбрали, но никто не угадал — картинка тускнеет и вздрагивает.
          const won = revealed && who.some((pid) => verdicts[pid]?.right);
          const lost = revealed && who.length > 0 && !won;
          const state = won ? " is-won" : lost ? " is-lost" : "";
          return (
            <li key={i} className={`super-level super-level--${LEVEL_KEYS[i]}${who.length > 0 ? " is-picked" : ""}${state}`}>
              <span className="super-level__icon" aria-hidden="true">
                <LevelIcon style={style} level={i} open={won} />
                {won && (
                  <span className="super-burst">
                    {Array.from({ length: 12 }, (_, k) => (
                      <span
                        key={k}
                        style={{
                          ["--dx" as string]: `${Math.round(Math.cos((k / 12) * Math.PI * 2 - Math.PI / 2) * (60 + (k % 3) * 18))}%`,
                          ["--dy" as string]: `${Math.round(Math.sin((k / 12) * Math.PI * 2 - Math.PI / 2) * (55 + (k % 4) * 12) - 20)}%`,
                          animationDelay: `${0.2 + (k % 4) * 0.08}s`,
                        }}
                      />
                    ))}
                  </span>
                )}
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
                  <strong className="super-level__answer">{levelAnswerText(l)}</strong>
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
  /** Голосование «Играем?»: идёт или итог. */
  vote?: SuperVote;
  /** Монетка «играем ли» ещё крутится на экране зала — решение не выдаём. */
  coinSpinning?: boolean;
  /** Суперигру пропустили. */
  skipped?: boolean;
  /** Свой голос этого телефона (в командах голосует каждый телефон). */
  myVote?: "yes" | "no" | null;
  voteSending?: boolean;
  onVote?: (vote: "yes" | "no") => void;
  /** Как выбирают уровень: весь зал голосует (один уровень) или каждый свой. */
  pickMode?: SuperPickMode;
  /** Голосование «Какой уровень играем?»: идёт или итог. */
  levelVote?: LevelVote;
  /** Свой голос этого телефона за уровень. */
  myLevelVote?: number | null;
  onLevelVote?: (level: number) => void;
}

/** Ответ уровня по его формату: свой ответ, варианты, по порядку, число. */
function LevelAnswerForm({
  level,
  index,
  canAnswer,
  sending,
  onAnswer,
}: {
  level: SuperLevel;
  index: number;
  canAnswer: boolean;
  sending: boolean;
  onAnswer: (answer: SuperAnswer) => void;
}) {
  const kind = levelKind(level);
  const [text, setText] = useState("");
  const [order, setOrder] = useState<number[]>([]);
  const options = level.options ?? [];

  if (kind === "choice") {
    return (
      <div className="super-choices" role="group" aria-label="Варианты ответа">
        {options.map((o, i) => (
          <button key={i} type="button" className="btn btn--secondary btn--block super-choice" disabled={!canAnswer || sending} onClick={() => onAnswer({ level: index, text: "", choice: i })}>
            <span className="super-choice__letter">{LETTERS[i]}</span> {o}
          </button>
        ))}
      </div>
    );
  }

  if (kind === "order") {
    const shown = superOrderShown(level, index);
    const full = order.length === options.length;
    return (
      <div className="stack stack--tight">
        <p className="muted small">Коснитесь карточек по порядку: первая — 1, вторая — 2… Ошиблись — коснитесь ещё раз.</p>
        <div className="super-order">
          {shown.map((card) => {
            const at = order.indexOf(card);
            return (
              <button
                key={card}
                type="button"
                className={at >= 0 ? "btn btn--secondary btn--block super-order__card is-on" : "btn btn--secondary btn--block super-order__card"}
                disabled={!canAnswer || sending}
                aria-pressed={at >= 0}
                onClick={() => setOrder((cur) => (cur.includes(card) ? cur.filter((c) => c !== card) : [...cur, card]))}
              >
                <span className="super-order__n">{at >= 0 ? at + 1 : "·"}</span> {options[card]}
              </button>
            );
          })}
        </div>
        <button type="button" className="btn btn--block" disabled={!canAnswer || sending || !full} onClick={() => onAnswer({ level: index, text: "", order })}>
          Отправить порядок
        </button>
      </div>
    );
  }

  if (kind === "number") {
    const value = readNumber(text);
    return (
      <form
        className="stack stack--tight"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (value !== null && canAnswer) onAnswer({ level: index, text: "", guess: value });
        }}
      >
        <label className="field">
          Ваше число{level.unit ? ` (${level.unit})` : ""}
          <input inputMode="decimal" value={text} maxLength={20} autoComplete="off" enterKeyHint="send" disabled={!canAnswer} onChange={(e) => setText(e.target.value)} />
        </label>
        <button className="btn btn--block" type="submit" disabled={!canAnswer || sending || value === null}>
          Отправить число
        </button>
      </form>
    );
  }

  return (
    <form
      className="stack stack--tight"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (canAnswer && text.trim()) onAnswer({ level: index, text: text.trim().slice(0, SUPER_LIMITS.answer) });
      }}
    >
      <label className="field">
        Ваш ответ
        <input value={text} maxLength={SUPER_LIMITS.answer} autoComplete="off" enterKeyHint="send" disabled={!canAnswer} onChange={(e) => setText(e.target.value)} />
      </label>
      <button className="btn btn--block" type="submit" disabled={!canAnswer || sending || !text.trim()}>
        Отправить ответ
      </button>
    </form>
  );
}

const LETTERS = ["А", "Б", "В", "Г", "Д", "Е"];

/** Число из поля телефона: пробелы и запятая допустимы. */
function readNumber(text: string): number | null {
  const clean = text.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && Math.abs(n) <= SUPER_LIMITS.maxNumber ? n : null;
}

/** Телефон: голосование «Играем?» → выбор уровня → вопрос уровня и ответ (уровень можно сменить до отправки) → итог. */
export function SuperPhone(props: SuperPhoneProps) {
  const { stage, gameId, levels, style, penalty, role, mine, verdict, canAnswer, sending, open, left, showImages, onAnswer, vote, skipped = false, myVote = null, voteSending = false, onVote } = props;
  const { pickMode = "each", levelVote, myLevelVote = null, onLevelVote } = props;
  const [picked, setLevel] = useState<number | null>(null);
  const active = activeLevels(levels);
  const chosen = levelVote?.phase === "done" && levelVote.level !== undefined && active.includes(levelVote.level) ? levelVote.level : null;
  // Зал выбрал уровень — отвечают все на его вопрос, выбирать нечего.
  const fixed = pickMode === "vote" && chosen !== null ? chosen : null;
  const level = fixed ?? picked;
  const icon = <LevelIcon style={style} level={mine?.level ?? fixed ?? 2} />;

  if (stage === "question" && levelVote?.phase === "open") {
    return (
      <div className="quiz-phone super-phone">
        <p className="eyebrow">Суперигра · какой уровень играем?</p>
        <p className="muted small">Зал выбирает один уровень на всех: чем выше — тем больше очков и риск.</p>
        <div className="super-pick">
          {active.map((i) => {
            const l = levels[i];
            const fine = l ? penaltyFor(penalty, i, l.points) : 0;
            const on = myLevelVote === i;
            return (
              <button key={i} type="button" className={`super-pick__btn super-level--${LEVEL_KEYS[i]}${on ? " is-on" : ""}`} aria-pressed={on} disabled={!open || voteSending || !onLevelVote} onClick={() => onLevelVote?.(i)}>
                <span className="super-pick__icon" aria-hidden="true">
                  <LevelIcon style={style} level={i} />
                </span>
                <span className="super-pick__name">
                  {on ? "✓ " : ""}
                  {LEVEL_NAMES[i]}
                </span>
                <span className="super-pick__points">
                  +{pointsLabel(l?.points ?? 0)}
                  {fine > 0 ? ` · ошибка −${pointsLabel(fine)}` : ""}
                </span>
              </button>
            );
          })}
        </div>
        <p className="quiz-phone__status muted">
          {voteSending ? "Отправляем голос…" : !open ? "Время вышло" : myLevelVote !== null ? "Голос принят — до итога можно передумать" : left === null ? "" : `Осталось ${left} с`}
        </p>
      </div>
    );
  }

  if (stage === "ready" && chosen !== null && vote?.passed !== false) {
    const l = levels[chosen];
    return (
      <div className="quiz-phone quiz-phone--center super-phone">
        <p className="eyebrow">Суперигра · итог голосования</p>
        {props.coinSpinning ? (
          <h2 className="quiz-phone__question">🎡 Жребий выбирает уровень — смотрите на экран</h2>
        ) : (
          <>
            <p className="super-phone__icon" aria-hidden="true">
              <LevelIcon style={style} level={chosen} />
            </p>
            <h2 className="quiz-phone__question">Играем «{LEVEL_NAMES[chosen]}»</h2>
            <p className="muted">
              +{pointsLabel(l?.points ?? 0)} за верный ответ{penaltyFor(penalty, chosen, l?.points ?? 0) > 0 ? ` · ошибка −${pointsLabel(penaltyFor(penalty, chosen, l?.points ?? 0))}` : ""}. Вопрос — сейчас на экране и {role === "member" ? "у капитана" : "у вас"}.
            </p>
          </>
        )}
      </div>
    );
  }

  if (stage === "question" && vote?.phase === "open") {
    return (
      <div className="quiz-phone quiz-phone--center super-phone">
        <p className="eyebrow">Суперигра · голосование</p>
        <h2 className="quiz-phone__question">Играем суперигру?</h2>
        <p className="muted">Верный ответ — очки уровня. Ошибка — можно потерять очки, заработанные в раунде.</p>
        <div className="actions">
          <button type="button" className={myVote === "yes" ? "btn btn--block" : "btn btn--secondary btn--block"} aria-pressed={myVote === "yes"} disabled={!open || voteSending || !onVote} onClick={() => onVote?.("yes")}>
            {myVote === "yes" ? "✓ Вы за" : "Голосовать за"}
          </button>
          <button type="button" className={myVote === "no" ? "btn btn--block" : "btn btn--secondary btn--block"} aria-pressed={myVote === "no"} disabled={!open || voteSending || !onVote} onClick={() => onVote?.("no")}>
            {myVote === "no" ? "✓ Вы против" : "Голосовать против"}
          </button>
        </div>
        <p className="quiz-phone__status muted">
          {voteSending ? "Отправляем голос…" : !open ? "Время вышло" : myVote ? "Голос принят — до итога можно передумать" : left === null ? "" : `Осталось ${left} с`}
        </p>
      </div>
    );
  }

  if (stage === "ready" && vote?.phase === "done") {
    const yes = votePercent(vote.yes, vote.no);
    const total = vote.yes + vote.no;
    const verdictText = props.coinSpinning
      ? "🪙 Монетка крутится — смотрите на экран"
      : voteUndecided(vote)
        ? "Голоса поровну — решит монетка или ведущий"
        : vote.coin
          ? `Монетка решила: ${vote.passed ? "играем суперигру!" : "суперигру не играем"}`
          : vote.passed
            ? "Играем суперигру!"
            : "Суперигру не играем";
    return (
      <div className="quiz-phone quiz-phone--center super-phone">
        <p className="eyebrow">Суперигра · итог голосования</p>
        <h2 className="quiz-phone__question">{verdictText}</h2>
        <p className="muted">
          За — {total === 0 ? 0 : yes}% ({vote.yes}) · против — {total === 0 ? 0 : 100 - yes}% ({vote.no})
        </p>
      </div>
    );
  }

  if (stage === "reveal" && skipped) {
    return (
      <div className="quiz-phone quiz-phone--center super-phone">
        <p className="eyebrow">Суперигра</p>
        <h2 className="quiz-phone__question">Суперигру не играем</h2>
        <p className="muted">Очки раунда сохранены. Смотрите на экран.</p>
      </div>
    );
  }

  if (stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center super-phone">
        <p className="super-phone__icon" aria-hidden="true">
          {icon}
        </p>
        <h2 className="quiz-phone__question">Суперигра!</h2>
        <p className="muted">
          {pickMode === "vote"
            ? "Сейчас зал выберет уровень: чем выше — тем больше очков и риск."
            : role === "member"
              ? "Уровень выбирает капитан. Смотрите на экран."
              : "Сейчас вы выберете уровень: чем выше — тем больше очков и риск."}
        </p>
      </div>
    );
  }

  if (stage === "reveal") {
    const at = verdict?.level ?? mine?.level ?? -1;
    const lvl = levels[at];
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
            Правильный ответ: <strong>{levelAnswerText(lvl)}</strong>
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
        <p className="muted">«{superAnswerText(levels, mine)}» · ждём, когда ведущий покажет ответы</p>
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
        <p className="muted">{fixed !== null ? `Капитан отвечает на вопрос уровня «${LEVEL_NAMES[fixed]}». Подскажите ему!` : "Капитан выбирает уровень и отвечает. Подскажите ему!"}</p>
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
            if (l.off) return null;
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

  const current = levels[level];
  return (
    <div className="quiz-phone stack super-phone">
      <p className="eyebrow">
        Суперигра · {LEVEL_NAMES[level]} · +{pointsLabel(current?.points ?? 0)}
      </p>
      {current?.imageId && showImages && <MediaImage className="quiz-phone__image" gameId={gameId} mediaId={current.imageId} variant="small" alt="" />}
      <h2 className="quiz-phone__question">{current?.text || (current?.trackId ? "Что звучит?" : "Что на картинке?")}</h2>
      {current?.trackId && <p className="muted small">🎵 Музыку к вопросу ведущий включит на экране зала.</p>}
      {current && <LevelAnswerForm key={level} level={current} index={level} canAnswer={canAnswer} sending={sending} onAnswer={onAnswer} />}
      {fixed === null && (
        <button type="button" className="btn btn--secondary btn--block" disabled={sending} onClick={() => setLevel(null)}>
          Сменить уровень
        </button>
      )}
      {status && <p className="quiz-phone__status muted">{status}</p>}
    </div>
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
  only,
}: {
  levels: SuperLevel[];
  groups: SuperGroup[][];
  picksCount: number[];
  /** Только эти уровни (уровни игры или выбранный залом). */
  only?: number[];
  editable: boolean;
  busy: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <section className="stack stack--tight" aria-label="Ответы по уровням">
      <h3 className="host-quiz__subtitle">Ответы по уровням</h3>
      {editable && <p className="muted small">Опечатка? «Засчитать» до «Показать ответы».</p>}
      {levels.map((l, i) => {
        if (only ? !only.includes(i) : l.off) return null;
        const list = groups[i] ?? [];
        const n = picksCount[i] ?? 0;
        return (
          <div key={i} className="stack stack--tight">
            <p className="small">
              <strong>{LEVEL_NAMES[i]}</strong> · {pointsLabel(l.points)} · {n} {plural(n, "ответ", "ответа", "ответов")} · верно: {levelKind(l) === "open" ? l.answers.filter((a) => a.trim()).join(" / ") || "—" : levelAnswerText(l)}
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
                    ) : editable && levelKind(l) === "open" ? (
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
