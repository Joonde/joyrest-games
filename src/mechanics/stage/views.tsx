// «Just Dance / Караоке на поле»: поле плиток, переворот плитки с фигурками, видео (на весь экран по кнопке пульта),
// зрительская симпатия и батл с перетягиванием каната — на экране зала; сердце «Подарить» и голос — на телефоне.
import { useEffect, useRef, type CSSProperties } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import { teamColorVar } from "../../themes/registry";
import type { PlayerViewProps, ViewProps } from "../types";
import { tileOf, tilesOf, VARIANT_TITLES, type StageContent, type StageTile } from "./content";
import { Dancer, Dancers } from "./figures";
import { parseStageResult, turnPid, type StageResult } from "./logic";
import { StageVideo } from "./video";
import { versusOf, whoOf } from "./who";
import "./stage.css";

/** Ответ телефона: подарить симпатию или голос в батле. */
export type StageAnswerValue = { gift: true } | { vote: string };

const nameOf = (session: Session, p: string | null) => (p ? (session.leaderboard[p]?.name ?? "") : "");
const sideStyle = (session: Session, p: string | null): CSSProperties | undefined => {
  const c = p ? session.leaderboard[p]?.colorIndex : undefined;
  return c === undefined ? undefined : ({ "--team-color": teamColorVar(c) } as CSSProperties);
};

/** Подпись плитки: кто выходит или кто против кого. */
export function tileLabel(tile: StageTile): string {
  return tile.kind === "battle" ? versusOf(tile.vs).label : whoOf(tile.who).label;
}
export function tileShort(tile: StageTile): string {
  return tile.kind === "battle" ? versusOf(tile.vs).short : whoOf(tile.who).short;
}

/** Поле: строки-категории, плитки по возрастанию очков. На пульте плитки можно коснуться. */
export function StageField({ content, result, onPick, disabled, compact }: { content: StageContent; result: StageResult; onPick?: (id: string) => void; disabled?: boolean; compact?: boolean }) {
  const cols = Math.max(1, ...content.categories.map((c) => tilesOf(content, c.id).length));
  return (
    <div className={compact ? "stage-field stage-field--compact" : "stage-field"} style={{ "--cols": cols } as CSSProperties} role="table" aria-label="Поле">
      {content.categories.map((cat, ci) => (
        <div key={cat.id} className="stage-field__row" role="row" data-tone={ci % 4}>
          <span className="stage-field__cat" role="rowheader">
            {cat.title || `Категория ${ci + 1}`}
          </span>
          {tilesOf(content, cat.id).map((tile) => {
            const played = result.played.includes(tile.id);
            const current = result.tile === tile.id;
            const cls = `stage-tile${played ? " is-played" : ""}${current ? " is-current" : ""}${tile.kind === "battle" ? " is-battle" : ""}`;
            const body = played ? (
              <span className="stage-tile__who">{tileShort(tile)}</span>
            ) : (
              <>
                <span className="stage-tile__points">{tile.points}</span>
                {tile.kind === "battle" && <span className="stage-tile__tag">батл</span>}
              </>
            );
            return onPick && !played ? (
              <button key={tile.id} type="button" role="cell" className={cls} disabled={disabled} onClick={() => onPick(tile.id)} aria-label={`${cat.title}: ${tile.points}${tile.kind === "battle" ? ", батл" : ""}`}>
                {body}
              </button>
            ) : (
              <div key={tile.id} role="cell" className={cls} aria-label={`${cat.title}: ${tile.points}${played ? `, сыграна: ${tileLabel(tile)}` : ""}`}>
                {body}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TeamsStrip({ session }: { session: Session }) {
  const entries = Object.entries(session.leaderboard).sort((a, b) => b[1].score - a[1].score).slice(0, 8);
  if (entries.length === 0) return null;
  return (
    <div className="stage-teams">
      {entries.map(([p, e]) => (
        <div key={p} className="stage-teams__one" style={sideStyle(session, p)}>
          <span className="stage-teams__name">
            <NameText name={e.name} />
          </span>
          <strong>{e.score}</strong>
        </div>
      ))}
    </div>
  );
}

/** Перевёрнутая плитка: кто выходит, трек, задание. */
function TileCard({ content, tile, session, r }: { content: StageContent; tile: StageTile; session: Session; r: StageResult }) {
  const karaoke = content.variant === "karaoke";
  const cat = content.categories.find((c) => c.id === tile.cat);
  if (tile.kind === "battle") {
    const vs = versusOf(tile.vs);
    return (
      <div className="stage-card stage-card--battle">
        <div className="stage-card__top">
          <span>{cat?.title ?? "Батл"}</span>
          <strong>{tile.points}</strong>
        </div>
        <div className="stage-card__vs">
          <Dancers figs={vs.left} karaoke={karaoke} />
          <span className="stage-card__vs-mark">VS</span>
          <Dancers figs={vs.right} karaoke={karaoke} />
        </div>
        <p className="stage-card__who">{vs.label}</p>
        <p className="stage-card__sides">
          <span style={sideStyle(session, r.performer)}>
            <NameText name={nameOf(session, r.performer)} />
          </span>
          {" против "}
          <span style={sideStyle(session, r.opponent)}>
            <NameText name={nameOf(session, r.opponent)} />
          </span>
        </p>
        {tile.title && <p className="stage-card__track">{karaoke ? "Песня" : "Трек"}: {tile.title}</p>}
        {tile.note && <p className="stage-card__note">{tile.note}</p>}
      </div>
    );
  }
  const who = whoOf(tile.who);
  return (
    <div className={karaoke ? "stage-card stage-card--karaoke" : "stage-card"}>
      <div className="stage-card__top">
        <span>{cat?.title ?? ""}</span>
        <strong>{tile.points}</strong>
      </div>
      <Dancers figs={who.figs} karaoke={karaoke} className="stage-card__dancers" />
      <p className="stage-card__who">
        {karaoke ? "Поют" : "Танцуют"}: {who.label}
      </p>
      {tile.title && <p className="stage-card__track">{karaoke ? "Песня" : "Трек"}: {tile.title}</p>}
      {tile.note && <p className="stage-card__note">{tile.note}</p>}
    </div>
  );
}

function Heart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 22" aria-hidden="true">
      <path d="M12 21 2.6 11.7A5.6 5.6 0 0 1 12 4.1a5.6 5.6 0 0 1 9.4 7.6z" fill="currentColor" />
    </svg>
  );
}

function GiftMeter({ content, r }: { content: StageContent; r: StageResult }) {
  if (content.gift <= 0) return null;
  const total = r.gifts.length * content.gift;
  return (
    <div className="stage-gift" role="status">
      <div className="stage-gift__hearts" aria-hidden="true">
        {r.gifts.slice(-6).map((g, i) => (
          <span key={g} style={{ left: `${(i * 17) % 80}%`, animationDelay: `${(i * 0.4) % 2.4}s` }}>
            <Heart className="stage-gift__heart" />
          </span>
        ))}
      </div>
      <div className="stage-gift__text">
        <span className="stage-gift__label">Зрительская симпатия</span>
        <strong>+{total}</strong>
        <span className="stage-gift__hint">{r.gifts.length > 0 ? `Подарили: ${r.gifts.length}` : `Понравилось? Подарите ${content.gift} своих очков с телефона`}</span>
      </div>
    </div>
  );
}

/** Перетягивание каната: узел едет к тому, за кого больше голосов. */
function TugOfWar({ session, r, content, left: timeLeft }: { session: Session; r: StageResult; content: StageContent; left: number | null }) {
  const a = r.performer ? (r.votes[r.performer] ?? 0) : 0;
  const b = r.opponent ? (r.votes[r.opponent] ?? 0) : 0;
  const total = a + b;
  // Узел: 50% — поровну; к стороне с большим числом голосов (не дальше 15% от края).
  const knot = total === 0 ? 50 : Math.min(85, Math.max(15, 50 - ((a - b) / total) * 35));
  const tile = tileOf(content, r.tile);
  const vs = tile ? versusOf(tile.vs) : null;
  const karaoke = content.variant === "karaoke";
  const share = (n: number) => (total === 0 ? 50 : Math.round((n * 100) / total));
  const winner = r.mode === "result" ? r.winner : null;
  return (
    <div className="stage-tug">
      <div className="stage-tug__head">
        <span className="stage-tug__badge">Батл · {tile?.points ?? 0}</span>
        <span className="stage-tug__timer" role="timer">
          {r.mode === "vote" ? (timeLeft === null ? "Голосует зал" : timeLeft === 0 ? "Голосование закрыто" : `Голосует зал · ${timeLeft} с`) : r.outcome === "tie" ? "Ничья — очки пополам" : "Итог батла"}
        </span>
      </div>
      <div className="stage-tug__names">
        <span className={winner === r.performer ? "is-win" : ""} style={sideStyle(session, r.performer)}>
          <small>{vs?.leftLabel ?? ""}</small>
          <NameText name={nameOf(session, r.performer)} />
        </span>
        <span className="stage-tug__vs">VS</span>
        <span className={winner === r.opponent ? "is-win" : ""} style={sideStyle(session, r.opponent)}>
          <small>{vs?.rightLabel ?? ""}</small>
          <NameText name={nameOf(session, r.opponent)} />
        </span>
      </div>
      <div className="stage-tug__field">
        <div className="stage-tug__center" aria-hidden="true" />
        <div className="stage-tug__rope" style={{ "--knot": `${knot}%` } as CSSProperties}>
          <span className="stage-tug__line" />
          <span className="stage-tug__knot" />
          <span className="stage-tug__spark" />
          <span className="stage-tug__puller stage-tug__puller--left">
            <Dancer kind={vs?.left[0] ?? "a"} pose="pull" mic={karaoke} />
          </span>
          <span className="stage-tug__puller stage-tug__puller--right">
            <Dancer kind={vs?.right[0] ?? "a"} pose="pull" mirror mic={karaoke} />
          </span>
        </div>
      </div>
      <div className="stage-tug__bar">
        <span style={{ flexBasis: `${share(a)}%` }}>
          {share(a)}% · {a}
        </span>
        <span style={{ flexBasis: `${share(b)}%` }}>
          {b} · {share(b)}%
        </span>
      </div>
    </div>
  );
}

export function StageScreenView({ session, content }: ViewProps<StageContent>) {
  const r = parseStageResult(session.state.result);
  const { stage, step } = session.state;
  const tile = tileOf(content, r.tile);
  const now = useServerNow(250, r.mode === "vote" && stage === "question");
  const left = r.mode === "vote" && stage === "question" ? secondsLeft(session.state, now) : null;
  const karaoke = content.variant === "karaoke";
  const title = VARIANT_TITLES[content.variant];

  const previous = useRef(`${step}:${r.mode}:${r.gifts.length}`);
  useEffect(() => {
    const key = `${step}:${r.mode}:${r.gifts.length}`;
    const [ps, pm, pg] = previous.current.split(":");
    if (ps === String(step) && pm === r.mode && Number(pg) < r.gifts.length) playSound("sparkle");
    if (previous.current !== key && pm !== r.mode) {
      if (r.mode === "perform") playSound("drumroll");
      if (r.mode === "result" && Object.values(r.scores).some((n) => n > 0)) playSound("applause");
    }
    previous.current = key;
  }, [step, r.mode, r.gifts.length, r.scores]);

  if (stage === "ready") {
    return (
      <div className={`stage-screen stage-screen--intro${karaoke ? " is-karaoke" : ""}`}>
        <Equalizer />
        <h2 className="stage-screen__brand">{title}</h2>
        <Dancers figs={karaoke ? ["w", "m"] : ["m", "w", "a", "w", "m"]} karaoke={karaoke} className="stage-screen__intro-dancers" />
        <p className="stage-screen__lead">Команды по очереди называют категорию и очки — плитка переворачивается и показывает, кто выходит {karaoke ? "петь" : "танцевать"}.</p>
      </div>
    );
  }

  if (r.mode === "pick" || !tile) {
    const who = nameOf(session, turnPid(r));
    return (
      <div className={`stage-screen${karaoke ? " is-karaoke" : ""}`}>
        <Equalizer />
        <div className="stage-screen__top">
          <h2 className="stage-screen__brand stage-screen__brand--small">{title}</h2>
          {who && (
            <span className="stage-screen__turn" style={sideStyle(session, turnPid(r))}>
              Выбирают: <NameText name={who} />
            </span>
          )}
        </div>
        <StageField content={content} result={r} />
        <TeamsStrip session={session} />
      </div>
    );
  }

  if (tile.kind === "battle" && (r.mode === "vote" || r.mode === "result")) {
    return (
      <div className={`stage-screen stage-screen--battle${karaoke ? " is-karaoke" : ""}`}>
        {r.mode === "result" && r.outcome && <Confetti burst={`stage:${step}`} />}
        <TugOfWar session={session} r={r} content={content} left={left} />
        {r.mode === "result" && (
          <div className="stage-screen__scores">
            {Object.entries(r.scores).map(([p, n]) => (
              <span key={p} style={sideStyle(session, p)}>
                <NameText name={nameOf(session, p)} /> <strong>+{n}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (r.mode === "result") {
    const gain = r.performer ? (r.scores[r.performer] ?? 0) : 0;
    return (
      <div className={`stage-screen stage-screen--result${karaoke ? " is-karaoke" : ""}`}>
        {gain > 0 && <Confetti burst={`stage:${step}`} />}
        <TileCard content={content} tile={tile} session={session} r={r} />
        <div className="stage-result">
          <span className="stage-result__name" style={sideStyle(session, r.performer)}>
            <NameText name={nameOf(session, r.performer)} />
          </span>
          <strong className="stage-result__points">{r.outcome === "skip" ? "Не вышли" : `+${gain}`}</strong>
          {r.gifts.length > 0 && r.outcome === "done" && (
            <span className="stage-result__gift">
              <Heart className="stage-result__heart" /> из них симпатия зала: +{r.gifts.length * content.gift}
            </span>
          )}
        </div>
      </div>
    );
  }

  const hasVideo = tile.video.source !== "none" && !(tile.video.source === "link" && !tile.video.url.trim());
  const performer = nameOf(session, r.performer);
  if (r.full && hasVideo) {
    return (
      <div className="stage-screen stage-screen--full">
        <div className="stage-full__video">
          <StageVideo tile={tile} video={r.video} />
        </div>
        <span className="stage-full__badge" style={sideStyle(session, r.performer)}>
          {tile.kind === "battle" ? (
            <>
              <NameText name={performer} /> против <NameText name={nameOf(session, r.opponent)} />
            </>
          ) : (
            <>
              <NameText name={performer} /> · {tileLabel(tile)} · {tile.points}
            </>
          )}
        </span>
        {tile.kind !== "battle" && content.gift > 0 && r.gifts.length > 0 && (
          <span className="stage-full__gift">
            <Heart className="stage-full__heart" /> +{r.gifts.length * content.gift}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`stage-screen stage-screen--perform${karaoke ? " is-karaoke" : ""}`}>
      <div className="stage-perform__side">
        <TileCard content={content} tile={tile} session={session} r={r} />
        {tile.kind !== "battle" && (
          <span className="stage-perform__on" style={sideStyle(session, r.performer)}>
            На сцене: <NameText name={performer} />
          </span>
        )}
      </div>
      <div className="stage-perform__main">
        {hasVideo ? (
          <div className="stage-video">
            <StageVideo tile={tile} video={r.video} />
          </div>
        ) : (
          <div className={r.video.paused ? "stage-spot is-paused" : "stage-spot"}>
            <Equalizer />
            <p className="stage-spot__text">{karaoke ? "Поём!" : "Танцуем!"}</p>
          </div>
        )}
        {tile.kind !== "battle" && <GiftMeter content={content} r={r} />}
      </div>
    </div>
  );
}

function Equalizer() {
  return (
    <div className="stage-eq" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <span key={i} style={{ animationDelay: `${((i * 137) % 1000) / 1000}s`, height: `${30 + ((i * 37) % 70)}%` }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- телефон

export function StagePlayerView({ session, content, pid, role, myAnswer, sending, onAnswer, personal }: PlayerViewProps<StageContent, StageAnswerValue>) {
  const r = parseStageResult(session.state.result);
  const { stage } = session.state;
  const tile = tileOf(content, r.tile);
  const teams = session.playMode === "teams";
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const me = session.leaderboard[pid];
  const karaoke = content.variant === "karaoke";
  // В командах дарит и голосует каждый телефон своим ответом; в одиночной игре — ответ игрока.
  const mine = teams ? personal?.value : myAnswer;
  const busy = teams ? (personal?.sending ?? false) : sending;
  const send = (value: StageAnswerValue) => (teams ? personal?.send(value) : onAnswer(value));
  const head = (
    <p className="eyebrow">
      {VARIANT_TITLES[content.variant]}
      {me ? ` · ${pointsLabel(me.score)}` : ""}
    </p>
  );
  void role;

  if (stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center stage-phone">
        {head}
        <h2>Скоро начнём!</h2>
        <p className="muted">Команды по очереди выбирают плитку — на экране увидите, кто выходит {karaoke ? "петь" : "танцевать"}.</p>
      </div>
    );
  }

  if (r.mode === "pick" || !tile) {
    const turn = turnPid(r);
    return (
      <div className="quiz-phone quiz-phone--center stage-phone">
        {head}
        {turn === pid ? (
          <div className="buzz__plate buzz__plate--glow" role="status">
            <strong>Ваш ход!</strong>
            <span>Назовите ведущему категорию и очки</span>
          </div>
        ) : (
          <h2>
            Выбирают: <NameText name={nameOf(session, turn)} />
          </h2>
        )}
      </div>
    );
  }

  const onStage = r.performer === pid || r.opponent === pid;

  if (r.mode === "perform") {
    if (onStage) {
      return (
        <div className="quiz-phone quiz-phone--center stage-phone">
          {head}
          <Dancers figs={tile.kind === "battle" ? versusOf(tile.vs)[r.performer === pid ? "left" : "right"] : whoOf(tile.who).figs} karaoke={karaoke} className="stage-phone__dancers" />
          <div className="buzz__plate buzz__plate--glow" role="status">
            <strong>Ваш выход!</strong>
            <span>{tile.kind === "battle" ? versusOf(tile.vs).label : `${karaoke ? "Поют" : "Танцуют"}: ${whoOf(tile.who).label}`}</span>
          </div>
        </div>
      );
    }
    if (tile.kind === "battle") {
      return (
        <div className="quiz-phone quiz-phone--center stage-phone">
          {head}
          <h2>
            Батл: <NameText name={nameOf(session, r.performer)} /> против <NameText name={nameOf(session, r.opponent)} />
          </h2>
          <p className="muted">Смотрите на экран — скоро голосование.</p>
        </div>
      );
    }
    const gave = mine !== null && mine !== undefined && (mine.value as Record<string, unknown> | null)?.gift === true;
    const teamGave = r.gifts.includes(pid);
    const enough = (me?.score ?? 0) >= content.gift;
    return (
      <div className="quiz-phone quiz-phone--center stage-phone">
        {head}
        <p className="eyebrow stage-phone__now">Сейчас на сцене</p>
        <h2>
          <NameText name={nameOf(session, r.performer)} />
        </h2>
        <p className="muted">{whoOf(tile.who).label}</p>
        {content.gift > 0 &&
          (gave || teamGave ? (
            <div className="stage-heart is-done" role="status">
              <span className="stage-heart__burst" aria-hidden="true" />
              <span className="stage-heart__btn" aria-hidden="true">
                <Heart />
              </span>
              <strong>{gave ? `Подарено ${content.gift}!` : "Ваша команда уже подарила"}</strong>
            </div>
          ) : (
            <div className="stage-heart">
              <button type="button" className="stage-heart__btn" disabled={busy || !open || !enough} onClick={() => send({ gift: true })} aria-label={`Подарить ${content.gift} очков`}>
                <Heart />
              </button>
              <strong>Подарить {content.gift}</strong>
              <span className="muted small">{enough ? (teams ? `Понравилось? Отдайте ${content.gift} очков своей команды выступающим` : `Понравилось? Отдайте ${content.gift} своих очков выступающим`) : `Подарить можно, когда наберёте ${content.gift} очков`}</span>
            </div>
          ))}
      </div>
    );
  }

  if (r.mode === "vote" && stage === "question") {
    if (onStage) {
      return (
        <div className="quiz-phone quiz-phone--center stage-phone">
          {head}
          <div className="buzz__plate" role="status">
            <strong>Голосует зал</strong>
            <span>Смотрите на экран — канат тянут голоса</span>
          </div>
        </div>
      );
    }
    const choice = (mine?.value as Record<string, unknown> | null | undefined)?.vote;
    const vs = versusOf(tile.vs);
    const knot = choice === r.performer ? 30 : choice === r.opponent ? 70 : 50;
    const side = (p: string | null, label: string, cls: string) => (
      <button type="button" className={`stage-vote__side ${cls}${choice === p ? " is-on" : ""}`} disabled={busy || !open || !p} onClick={() => p && send({ vote: p })}>
        <small>{label}</small>
        <strong>
          <NameText name={nameOf(session, p)} />
        </strong>
        <span>{choice === p ? "Ваш голос ✓" : "Коснитесь, чтобы голосовать"}</span>
      </button>
    );
    return (
      <div className="quiz-phone stage-phone stage-vote">
        {head}
        <h2 className="stage-vote__title">Кто круче?</h2>
        {side(r.performer, vs.leftLabel, "stage-vote__side--left")}
        <div className="stage-vote__rope" aria-hidden="true">
          <span style={{ left: `${knot}%` }} />
        </div>
        {side(r.opponent, vs.rightLabel, "stage-vote__side--right")}
        <p className="muted small">{open ? "Передумать можно, пока идёт голосование" : "Голосование закрыто"}</p>
      </div>
    );
  }

  const delta = r.scores[pid];
  return (
    <div className="quiz-phone quiz-phone--center stage-phone">
      {head}
      <h2>{delta ? (delta > 0 ? `+${delta} вам!` : `${delta}: вы подарили симпатию`) : r.outcome === "tie" ? "Ничья в батле" : "Итог на экране"}</h2>
    </div>
  );
}
