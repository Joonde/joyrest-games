// «Танцевальный батл»: карточки на экране, видео или трек выступления, оценки на телефонах.
// Вид (решение владельца 15 октября 2026): сцена с прожекторами и зеркальным шаром, нарисованные карточки
// «Батл», «Танец», «Караоке» (Canva AI, public/dance/art/), золото и пыльная роза JoyRest. Только вид:
// ход игры, очки и ответы телефонов — в logic.ts, они не менялись.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { loadLocalVideo, saveLocalVideo } from "../../components/media/localVideo";
import { useFragment } from "../../components/music/useFragment";
import { NameText } from "../../components/NameText";
import { rankedLeaderboard } from "../../core/leaderboard";
import { pointsLabel } from "../../core/results";
import { moveLabel, placeMoves } from "../../core/rounds";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import { videosRepo } from "../../data";
import type { Leaderboard, Session } from "../../data/types";
import { teamColorVar } from "../../themes/registry";
import type { PlayerViewProps, ViewProps } from "../types";
import { embedUrl, KIND_EMOJI, KIND_TITLES, type DanceCard, type DanceContent, type DanceKind } from "./content";
import { styleById } from "./styles";
import { canVote, cardOf, parseDanceResult, turnPid, type DanceResult } from "./logic";

/** Ответ: выбор карточки, оценка или голос за команду в батле. */
export type DanceAnswerValue = { card: string } | { rate: number } | { team: string };

const nameOf = (session: Session, p: string | null) => (p ? (session.leaderboard[p]?.name ?? "") : "");

/** Цвет команды для `--db-team` (у игроков без цвета — золото сцены). */
function teamStyle(session: Session, p: string | null): CSSProperties {
  const color = p ? teamColorVar(session.leaderboard[p]?.colorIndex) : undefined;
  return { "--db-team": color ?? "var(--db-gold)" } as CSSProperties;
}

/** «Танец · Джаз-фанк». */
function kindLabel(card: DanceCard): string {
  const style = styleById(card.style);
  return style ? `${KIND_TITLES[card.kind]} · ${style.title.toLowerCase()}` : KIND_TITLES[card.kind];
}

/** Нарисованная карточка: картинка вида, снизу название, стиль и подсказка. */
export function ArtCard({ kind, styleId = "", hint, n, className = "", style, children }: { kind: DanceKind; styleId?: string; hint?: ReactNode; n?: number; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const st = styleById(styleId);
  return (
    <span className={`db-card db-card--${kind} ${className}`.trim()} style={style}>
      <span className="db-card__label">
        <span className="db-card__name">{KIND_TITLES[kind]}</span>
        {st && (
          <span className="db-card__style">
            {st.emoji} {st.title}
          </span>
        )}
        {hint && <span className="db-card__hint">{hint}</span>}
        {n !== undefined && <span className="db-card__n">№ {n}</span>}
      </span>
      {children}
    </span>
  );
}

/** Карточки игры на пульте: нарисованные, сыгранные — тусклые с галочкой. */
export function CardGrid({ content, result, onPick, disabled }: { content: DanceContent; result: DanceResult; onPick?: (id: string) => void; disabled?: boolean }) {
  return (
    <div className="dance-cards" role="list">
      {content.cards.map((card, i) => {
        const played = result.played.includes(card.id);
        const current = result.card === card.id;
        const st = styleById(card.style);
        const body = (
          <>
            {played && (
              <span className="dance-card__done" aria-hidden="true">
                ✓
              </span>
            )}
            <span className="dance-card__kind">
              {KIND_EMOJI[card.kind]} {KIND_TITLES[card.kind]}
            </span>
            {st && <span className="dance-card__style">{st.title}</span>}
            <span className="dance-card__n">№ {i + 1}</span>
          </>
        );
        const cls = `dance-card dance-card--${card.kind}${played ? " is-played" : ""}${current ? " is-current" : ""}`;
        return onPick && !played ? (
          <button key={card.id} type="button" role="listitem" className={cls} disabled={disabled} onClick={() => onPick(card.id)} aria-label={`${KIND_TITLES[card.kind]} ${i + 1}${st ? `, ${st.title}` : ""}`}>
            {body}
          </button>
        ) : (
          <div key={card.id} role="listitem" className={cls} aria-label={`${KIND_TITLES[card.kind]} ${i + 1}${played ? ", сыграна" : ""}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Видео карточки на экране зала: файл с этого устройства или ролик по ссылке. */
function CardVideo({ card, paused, replay }: { card: DanceCard; paused: boolean; replay: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Адрес файла, выбранного здесь же (blob:), освобождается при замене и при уходе с экрана — иначе
  // каждое «Выбрать видео» держит в памяти весь файл до перезагрузки (QA 22 октября 2026).
  useEffect(() => {
    if (!url?.startsWith("blob:")) return;
    const own = url;
    return () => URL.revokeObjectURL(own);
  }, [url]);

  useEffect(() => {
    if (card.video.source !== "file") return;
    let made: string | null = null;
    let cancelled = false;
    void loadLocalVideo(card.id).then((v) => {
      if (cancelled) return;
      if (!v) return setMissing(true);
      made = URL.createObjectURL(v.blob);
      setUrl(made);
      setMissing(false);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [card.id, card.video.source]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (paused) el.pause();
    else void el.play().catch(() => undefined);
  }, [paused, url]);

  useEffect(() => {
    const el = ref.current;
    if (!el || replay === 0) return;
    el.currentTime = 0;
    void el.play().catch(() => undefined);
  }, [replay]);

  if (card.video.source === "link") {
    const src = embedUrl(card.video.url);
    if (!src) return <p className="dance-screen__note">Ссылку на видео не открыть. Проверьте её в конструкторе: подходят YouTube, VK Видео и Rutube.</p>;
    // Пауза ролика по ссылке — кнопками самого плеера; «Сначала» перезагружает плеер.
    return <iframe key={replay} className="dance-screen__video" src={src} title={card.title || "Видео"} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />;
  }
  if (card.video.source === "server") {
    if (!videosRepo) return <p className="dance-screen__note">Видео JoyRest открывается только на платформе JoyRest (games.joy-rest.ru).</p>;
    if (!card.video.url) return null;
    return <video ref={ref} className="dance-screen__video" src={videosRepo.fileUrl(card.video.url)} playsInline preload="auto" autoPlay={!paused} controls={false} />;
  }
  if (card.video.source === "file") {
    if (missing) {
      return (
        <div className="dance-screen__pick">
          <p>На этом устройстве нет видео «{card.video.name || card.title}».</p>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Выбрать видео на этом устройстве
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              // Видео играет сразу; сохранить на устройстве — для следующих запусков (места может не хватить).
              setUrl(URL.createObjectURL(file));
              setMissing(false);
              void saveLocalVideo(card.id, file).catch(() => undefined);
            }}
          />
        </div>
      );
    }
    return url ? <video ref={ref} className="dance-screen__video" src={url} playsInline autoPlay controls={false} /> : null;
  }
  return null;
}


// ---------------------------------------------------------------- экран зала

/** Размер карточек на поле выбора: одна строка до 6 карточек, дальше две-три строки помельче (в единицах --u). */
function pickLayout(n: number): { width: number; cols: number } {
  const rows = n <= 6 ? 1 : n <= 16 ? 2 : 3;
  const cols = Math.max(1, Math.ceil(n / rows));
  const cap = rows === 1 ? (n <= 4 ? 15 : 13) : rows === 2 ? 9.5 : 6.5;
  return { width: Math.min(cap, 84 / cols - 2.4), cols };
}

/** Кольцо-доля (0…1) с числом внутри: «сыграно», «оценили». Без анимации — только цвета. */
function Ring({ part, children, big = false }: { part: number; children: ReactNode; big?: boolean }) {
  const p = Math.max(0, Math.min(1, Number.isFinite(part) ? part : 0));
  return (
    <span className={big ? "db-ring db-ring--big" : "db-ring"} style={{ "--p": p } as CSSProperties}>
      <span className="db-ring__fill" aria-hidden="true" />
      <span className="db-ring__inner">{children}</span>
    </span>
  );
}

/** Таблица после выступления: места, очки и стрелки (кто кого обогнал этим выступлением). */
function ResultBoard({ leaderboard, scores }: { leaderboard: Leaderboard; scores: Record<string, number> }) {
  const before: Leaderboard = {};
  for (const [id, e] of Object.entries(leaderboard)) before[id] = { ...e, score: e.score - (scores[id] ?? 0) };
  const moves = placeMoves(before, leaderboard);
  const rows = rankedLeaderboard(leaderboard).slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <ol className="db-board">
      {rows.map((e) => {
        const move = moves.get(e.id) ?? 0;
        return (
          <li key={e.id} className={e.place === 1 ? "db-row is-top" : "db-row"} style={{ "--db-team": teamColorVar(e.colorIndex) ?? "var(--db-gold)" } as CSSProperties}>
            <span className="db-row__place">{e.place}</span>
            <span className="db-row__name">
              <NameText name={e.name} />
            </span>
            <span className="db-row__score">{e.score}</span>
            <span className={move > 0 ? "db-row__move is-up" : "db-row__move is-down"}>{moveLabel(move)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function DanceScreenView({ session, content }: ViewProps<DanceContent>) {
  const r = parseDanceResult(session.state.result);
  const { stage, step } = session.state;
  const card = cardOf(content, r.card);
  const now = useServerNow(250, r.mode === "vote" && stage === "question");
  const left = r.mode === "vote" && stage === "question" ? secondsLeft(session.state, now) : null;
  const performing = r.mode === "perform";
  // Трек играет, только если видео нет (иначе звучали бы оба сразу).
  const battleTrack = card && card.trackId && (card.video.source === "none" || (card.video.source === "server" && !card.video.url)) ? card : null;
  useFragment(
    battleTrack?.trackId ?? null,
    battleTrack?.trackStart ?? 0,
    Math.max(battleTrack?.trackLength ?? 60, 30),
    battleTrack && performing ? `d:${step}:${r.replay}` : null,
    { options: { fadeIn: battleTrack?.fadeIn ?? 0, fadeOut: battleTrack?.fadeOut ?? 0 }, paused: r.paused },
  );
  const previous = useRef(`${step}:${r.mode}`);
  useEffect(() => {
    const key = `${step}:${r.mode}`;
    if (previous.current !== key && r.mode === "result" && Object.keys(r.scores).length > 0) playSound("applause");
    if (previous.current !== key && r.mode === "perform") playSound("drumroll");
    previous.current = key;
  }, [step, r.mode, r.scores]);

  const teams = session.playMode === "teams";

  // 1. Заставка: заголовок с бликом, веер карточек, очередь команд.
  if (stage === "ready") {
    const queue = (r.order.length > 0 ? r.order : Object.entries(session.leaderboard).sort(([a, x], [b, y]) => (x.colorIndex ?? 999) - (y.colorIndex ?? 999) || a.localeCompare(b)).map(([id]) => id)).filter((id) => session.leaderboard[id]);
    return (
      <div className="dance-screen db-stage db-intro">
        <div className="db-head">
          <span className="db-kicker">JoyRest · вечер танцев</span>
          <h2 className="db-title">Танцевальный батл</h2>
        </div>
        <div className="db-fan" aria-hidden="true">
          <ArtCard kind="battle" />
          <ArtCard kind="dance" />
          <ArtCard kind="karaoke" />
        </div>
        <div className="db-queue">
          {queue.length === 0 ? (
            <span>Команды по очереди выбирают: батл, танец или караоке</span>
          ) : (
            <>
              <span>Очередь</span>
              {queue.slice(0, 6).map((id, i) => (
                <span key={id} className="db-queue__item">
                  {i > 0 && (
                    <span className="db-arrow" aria-hidden="true">
                      →
                    </span>
                  )}
                  <span className="db-chip" style={teamStyle(session, id)}>
                    <i className="db-dot" aria-hidden="true" />
                    <NameText name={nameOf(session, id)} />
                  </span>
                </span>
              ))}
              {queue.length > 6 && <span>и ещё {queue.length - 6}</span>}
            </>
          )}
        </div>
      </div>
    );
  }

  // 2. Выбор карточки.
  if (r.mode === "pick" || !card) {
    const turn = turnPid(r);
    const who = nameOf(session, turn);
    const { width, cols } = pickLayout(content.cards.length);
    const played = content.cards.filter((c) => r.played.includes(c.id)).length;
    return (
      <div className="dance-screen db-stage db-pick">
        <div className="db-turn">
          {who && (
            <span className="db-badge" style={teamStyle(session, turn)}>
              <NameText name={who} /> · {teams ? "ход команды" : "ваш ход"}
            </span>
          )}
          <h2 className="db-title">Что танцуем?</h2>
        </div>
        <div className="db-pick__cards" style={{ "--db-w": width, "--db-cols": cols } as CSSProperties}>
          {content.cards.map((c, i) => (
            <ArtCard key={c.id} kind={c.kind} styleId={c.style} n={i + 1} className={r.played.includes(c.id) ? "is-played" : ""}>
              {r.played.includes(c.id) && (
                <span className="db-card__done" aria-label="сыграна">
                  ✓
                </span>
              )}
            </ArtCard>
          ))}
        </div>
        <div className="db-status">
          <Ring part={content.cards.length > 0 ? played / content.cards.length : 0}>{played}</Ring>
          <span>
            Сыграно {played} из {content.cards.length} · {teams ? "капитан выбирает" : "игрок выбирает"} на телефоне или называет ведущему
          </span>
        </div>
      </div>
    );
  }

  const performer = nameOf(session, r.performer);
  const st = styleById(card.style);

  // 3. Выступление: видео (или сцена с треком) в рамке, справа — кто на сцене.
  if (performing) {
    const noVideo = card.video.source === "none" || ((card.video.source === "link" || card.video.source === "server") && !card.video.url.trim());
    return (
      <div className="dance-screen db-stage db-perform">
        <div className={noVideo ? "db-video db-video--art" : "db-video"}>
          {noVideo ? (
            <div className={`db-video__art db-video__art--${card.kind}`}>
              <span className="db-video__title">{card.title || KIND_TITLES[card.kind]}</span>
            </div>
          ) : (
            <CardVideo card={card} paused={r.paused} replay={r.replay} />
          )}
          <span className="db-live">{r.paused ? "❚❚ ПАУЗА" : "● ИДЁТ ВЫСТУПЛЕНИЕ"}</span>
        </div>
        <div className="db-side">
          <div>
            <span className="db-kicker">На сцене</span>
            <div className="db-who" style={teamStyle(session, card.kind === "battle" ? null : r.performer)}>
              {card.kind === "battle" ? "Все команды" : <NameText name={performer} />}
            </div>
          </div>
          <div className="db-mini">
            <ArtCard kind={card.kind} className="db-card--mini" />
            <div className="db-mini__text">
              <b>{KIND_TITLES[card.kind]}</b>
              <span>{[st?.title, !noVideo ? card.title : ""].filter(Boolean).join(" · ") || "Своя музыка"}</span>
            </div>
          </div>
          <div className={r.paused ? "db-eq is-paused" : "db-eq"} aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <p className="db-hint">
            {card.note || (card.kind === "battle" ? "После батла капитаны выберут победителя на телефонах" : "После выступления зал оценит с телефонов — готовьте аплодисменты!")}
          </p>
        </div>
      </div>
    );
  }

  // 4. Оценки зала или голос в батле: пока идёт — только сколько проголосовало, без оценок.
  if (r.mode === "vote") {
    const answered = session.state.answered ?? 0;
    const voters = r.order.filter((p) => canVote(r, card, p) && session.leaderboard[p]);
    const timer = left === null ? (stage === "question" ? null : "Голосование закрыто") : left === 0 ? "Голосование закрыто" : `${left} с`;
    if (card.kind === "battle") {
      const sides = r.order.filter((p) => session.leaderboard[p]).slice(0, 8);
      return (
        <div className="dance-screen db-stage db-vote db-vote--battle">
          <h2 className="db-h">Батл: кто победил?</h2>
          {/* «VS» — только когда команд ровно две; больше — сетка карточек команд. */}
          <div className={sides.length === 2 ? "db-versus" : `db-versus db-versus--grid${sides.length === 4 ? "" : " db-versus--3"}`}>
            {sides.map((p, i) => (
              <span key={p} className="db-versus__item">
                {i > 0 && sides.length === 2 && <span className="db-vs">VS</span>}
                <span className="db-side-plate" style={teamStyle(session, p)}>
                  <span>
                    <NameText name={nameOf(session, p)} />
                  </span>
                </span>
              </span>
            ))}
          </div>
          <div className="db-status">
            <Ring part={voters.length > 0 ? answered / voters.length : 0}>{answered}</Ring>
            <span>
              Проголосовали {answered} из {voters.length} · {teams ? "капитаны голосуют" : "голосуют"} на телефонах, за себя нельзя
            </span>
            {timer && <span className="db-timer" role="timer">{timer}</span>}
          </div>
        </div>
      );
    }
    return (
      <div className="dance-screen db-stage db-vote">
        <h2 className="db-h">
          Зал оценивает:{" "}
          <span className="db-team-ink" style={teamStyle(session, r.performer)}>
            <NameText name={performer} />
          </span>
        </h2>
        <Ring big part={voters.length > 0 ? answered / voters.length : 0}>
          <b>{answered}</b>
          <span>из {voters.length} оценили</span>
        </Ring>
        <div className="db-vote__side">
          <p className="db-vote__lead">
            Оценка от {content.minRate} до {content.maxRate} — на телефонах {teams ? "капитанов" : "гостей"}
          </p>
          <div className="db-chips">
            {voters.slice(0, 10).map((p) => (
              <span key={p} className="db-chip" style={teamStyle(session, p)}>
                <i className="db-dot" aria-hidden="true" />
                <NameText name={nameOf(session, p)} />
              </span>
            ))}
            {voters.length > 10 && <span className="db-chip">и ещё {voters.length - 10}</span>}
          </div>
          {timer && <span className="db-timer" role="timer">{timer}</span>}
        </div>
        <p className="db-foot">
          {KIND_EMOJI[card.kind]} {kindLabel(card)}
        </p>
      </div>
    );
  }

  // 5. Итог: «+N», таблица со стрелками, лучи и конфетти.
  const entries = Object.entries(r.scores);
  const [winner, points] = entries[0] ?? [null, 0];
  const leftCards = content.cards.filter((c) => !r.played.includes(c.id) && c.id !== r.card).length;
  const at = r.performer ? r.order.indexOf(r.performer) : -1;
  const nextPid = r.order.length > 0 && at >= 0 ? (r.order[(at + 1) % r.order.length] ?? null) : null;
  const nextName = nameOf(session, nextPid);
  return (
    <div className="dance-screen db-stage db-result">
      {winner && <div className="db-burst" aria-hidden="true" />}
      {winner && <Confetti burst={`dance:${step}`} />}
      {winner ? (
        <>
          <div className="db-plus">+{points}</div>
          <p className="db-for">
            <b className="db-team-ink" style={teamStyle(session, winner)}>
              <NameText name={nameOf(session, winner)} />
            </b>{" "}
            {card.kind === "battle" ? "побеждает в батле" : "за"} «{kindLabel(card)}»
            {card.kind !== "battle" && <span className="db-for__hint"> · средняя оценка зала</span>}
          </p>
        </>
      ) : (
        <h2 className="db-h">{r.tie.length > 1 ? "Ничья! Победителя назовёт ведущий" : "Голосов нет"}</h2>
      )}
      <ResultBoard leaderboard={session.leaderboard} scores={r.scores} />
      <p className="db-next">{leftCards === 0 ? "Карточки сыграны — дальше награждение" : nextName ? <>Дальше выбирают: <NameText name={nextName} /></> : "Дальше — следующая карточка"}</p>
    </div>
  );
}

// ---------------------------------------------------------------- телефон

/** Капитан листает карточки пальцем, выбранная светится, «Выбираем …» отправляет `{ card }`. */
function PhonePick({ content, result, sending, onPick }: { content: DanceContent; result: DanceResult; sending: boolean; onPick: (id: string) => void }) {
  const cards = content.cards.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => !result.played.includes(c.id));
  const [sel, setSel] = useState<string | null>(cards[0]?.c.id ?? null);
  const listRef = useRef<HTMLDivElement>(null);
  const chosen = cards.find(({ c }) => c.id === sel)?.c ?? null;

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    const mid = list.scrollLeft + list.clientWidth / 2;
    let best: string | null = null;
    let dist = Infinity;
    for (const el of Array.from(list.children) as HTMLElement[]) {
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (d < dist) {
        dist = d;
        best = el.dataset.id ?? null;
      }
    }
    if (best && best !== sel) setSel(best);
  }

  function choose(id: string, el: HTMLElement) {
    setSel(id);
    const list = listRef.current;
    if (list) list.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - list.clientWidth / 2, behavior: "smooth" });
  }

  return (
    <>
      <div className="db-swipe" ref={listRef} onScroll={onScroll} role="listbox" aria-label="Карточки">
        {cards.map(({ c, n }) => (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={c.id === sel}
            data-id={c.id}
            className={c.id === sel ? "db-swipe__item is-on" : "db-swipe__item"}
            aria-label={`${KIND_TITLES[c.kind]} ${n}${styleById(c.style) ? `, ${styleById(c.style)?.title}` : ""}`}
            onClick={(e) => choose(c.id, e.currentTarget)}
          >
            <ArtCard kind={c.kind} styleId={c.style} n={n} />
          </button>
        ))}
      </div>
      {cards.length > 1 && (
        <div className="db-dots" aria-hidden="true">
          {cards.map(({ c }) => (
            <i key={c.id} className={c.id === sel ? "is-on" : ""} />
          ))}
        </div>
      )}
      <button type="button" className="btn btn--block" disabled={!chosen || sending} onClick={() => chosen && onPick(chosen.id)}>
        {chosen ? `Выбираем «${KIND_TITLES[chosen.kind]}»` : "Выберите карточку"}
      </button>
      <p className="muted db-small">Листайте карточки пальцем. Карточка появится на экране после выбора.</p>
    </>
  );
}

/** Оценка: крупное число, ползунок от min до max, быстрые кнопки и «Отправить оценку» (`{ rate }`). */
function RateForm({ min, max, sending, onRate }: { min: number; max: number; sending: boolean; onRate: (n: number) => void }) {
  const span = Math.max(1, max - min);
  // Шаг 5 — для широкой шкалы (10–100), если до верха им можно дойти; иначе по одному.
  const step = span >= 40 && span % 5 === 0 ? 5 : 1;
  const snap = (v: number) => Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));
  const quick = [...new Set([0.45, 0.65, 0.8].map((f) => snap(min + span * f)).concat(max))];
  const [value, setValue] = useState(() => snap(min + span * 0.7));
  return (
    <div className="db-rate">
      <b className="db-rate__num" aria-live="polite">
        {value}
      </b>
      <input className="db-range" type="range" min={min} max={max} step={step} value={value} aria-label="Оценка" disabled={sending} onChange={(e) => setValue(snap(Number(e.target.value)))} style={{ "--fill": `${((value - min) / span) * 100}%` } as CSSProperties} />
      <div className="db-rate__ticks" aria-hidden="true">
        <span>{min}</span>
        <span>{snap(min + span / 2)}</span>
        <span>{max}</span>
      </div>
      <div className="db-rate__quick" role="group" aria-label="Быстрая оценка">
        {quick.map((v) => (
          <button key={v} type="button" className={v === value ? "btn btn--secondary is-on" : "btn btn--secondary"} aria-pressed={v === value} disabled={sending} onClick={() => setValue(v)}>
            {v}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn--block" disabled={sending} onClick={() => onRate(value)}>
        Отправить оценку
      </button>
    </div>
  );
}

/** Мини-карточка выступления на телефоне: картинка вида, кто выступает, что. */
function MiniPerf({ session, card, who, flip = false }: { session: Session; card: DanceCard; who: string | null; flip?: boolean }) {
  return (
    <span className="db-mini-perf" style={teamStyle(session, who)}>
      <ArtCard kind={card.kind} className={flip ? "db-card--mini is-flip" : "db-card--mini"} />
      <span className="db-mini-perf__text">
        <b>{who ? <NameText name={nameOf(session, who)} /> : "Все команды"}</b>
        <span>{kindLabel(card)}</span>
      </span>
    </span>
  );
}

/** Батл: «За кого вы?» — команды столбиком (своей среди них нет), выбор и «Голос за …» (`{ team }`). */
function BattleVote({ session, card, others, sending, onVote }: { session: Session; card: DanceCard; others: string[]; sending: boolean; onVote?: (team: string) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="db-battle">
      {others.map((p, i) => (
        <div key={p} className="db-battle__item">
          {onVote ? (
            <button type="button" className={sel === p ? "db-battle__pick is-on" : "db-battle__pick"} aria-pressed={sel === p} disabled={sending} onClick={() => setSel(p)}>
              <MiniPerf session={session} card={card} who={p} flip={i % 2 === 1} />
            </button>
          ) : (
            <MiniPerf session={session} card={card} who={p} flip={i % 2 === 1} />
          )}
        </div>
      ))}
      {onVote && (
        <button type="button" className="btn btn--block" disabled={!sel || sending} onClick={() => sel && onVote(sel)}>
          {sel ? (
            <>
              Голос за <NameText name={nameOf(session, sel)} />
            </>
          ) : (
            "Выберите команду"
          )}
        </button>
      )}
    </div>
  );
}

export function DancePlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<DanceContent, DanceAnswerValue>) {
  const r = parseDanceResult(session.state.result);
  const { stage } = session.state;
  const card = cardOf(content, r.card);
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const me = session.leaderboard[pid];
  const head = (
    <p className="eyebrow">
      Танцевальный батл{me ? ` · ${pointsLabel(me.score)}` : ""}
    </p>
  );
  const captain = role !== "member";

  if (stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center db-phone">
        {head}
        <div className="db-phone-fan" aria-hidden="true">
          <ArtCard kind="battle" />
          <ArtCard kind="dance" />
          <ArtCard kind="karaoke" />
        </div>
        <h2>Скоро начнём!</h2>
        <p className="muted">Команды по очереди выбирают батл, танец или караоке.</p>
      </div>
    );
  }

  if (r.mode === "pick") {
    const mine = turnPid(r) === pid;
    if (mine && captain && !myAnswer && open) {
      return (
        <div className="quiz-phone db-phone">
          {head}
          <h2 className="db-phone__title">Ваш ход! Выберите карточку</h2>
          <PhonePick content={content} result={r} sending={sending} onPick={(id) => onAnswer({ card: id })} />
        </div>
      );
    }
    return (
      <div className="quiz-phone quiz-phone--center db-phone">
        {head}
        <h2>{mine ? (captain ? (myAnswer ? "Выбор отправлен" : "Время выбора вышло — назовите карточку ведущему") : "Выбирает ваш капитан") : <>Выбирает <NameText name={nameOf(session, turnPid(r))} /></>}</h2>
        {!mine && <p className="muted">Вы наблюдаете — нажимать ничего не нужно, ваша очередь будет позже.</p>}
      </div>
    );
  }

  if (!card) return null;

  if (r.mode === "perform") {
    const ours = card.kind === "battle" || r.performer === pid;
    return (
      <div className="quiz-phone quiz-phone--center db-phone">
        {head}
        <MiniPerf session={session} card={card} who={card.kind === "battle" ? null : r.performer} />
        <div className={ours ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
          <strong>{ours ? "Ваш выход! Смотрите на экран" : <>Выступает <NameText name={nameOf(session, r.performer)} /></>}</strong>
          <span>{card.title || (card.kind === "battle" ? "Покажите лучшее под этот трек" : card.kind === "karaoke" ? "Пойте вместе с экраном" : "Повторяйте движения за экраном")}</span>
        </div>
      </div>
    );
  }

  if (r.mode === "vote" && stage === "question") {
    const others = r.order.filter((p) => p !== pid && session.leaderboard[p]);
    if (!captain) {
      return (
        <div className="quiz-phone db-phone">
          {head}
          <h2 className="db-phone__title">{card.kind === "battle" ? "Батл! За кого вы?" : "Зал оценивает"}</h2>
          <p className="muted">Голосует капитан — подскажите ему.</p>
          {card.kind === "battle" ? <BattleVote session={session} card={card} others={others} sending={sending} /> : <MiniPerf session={session} card={card} who={r.performer} />}
        </div>
      );
    }
    if (!canVote(r, card, pid)) {
      return (
        <div className="quiz-phone quiz-phone--center db-phone">
          {head}
          <div className="buzz__plate" role="status">
            <strong>Вас оценивают другие команды</strong>
            <span>Ждите итог на экране</span>
          </div>
        </div>
      );
    }
    if (myAnswer) {
      return (
        <div className="quiz-phone quiz-phone--center db-phone">
          {head}
          <div className="buzz__plate buzz__plate--glow" role="status">
            <strong>Голос принят</strong>
          </div>
        </div>
      );
    }
    if (!open) return <div className="quiz-phone quiz-phone--center">{head}<p className="muted">Голосование закрыто.</p></div>;
    if (card.kind === "battle") {
      return (
        <div className="quiz-phone db-phone">
          {head}
          <h2 className="db-phone__title">Батл! За кого вы?</h2>
          <BattleVote session={session} card={card} others={others} sending={sending} onVote={(team) => onAnswer({ team })} />
        </div>
      );
    }
    return (
      <div className="quiz-phone db-phone">
        {head}
        <MiniPerf session={session} card={card} who={r.performer} />
        <h2 className="db-phone__title">Ваша оценка</h2>
        <RateForm min={content.minRate} max={content.maxRate} sending={sending} onRate={(rate) => onAnswer({ rate })} />
      </div>
    );
  }

  const mine = r.scores[pid];
  return (
    <div className="quiz-phone quiz-phone--center db-phone">
      {head}
      {mine ? <p className="db-phone__plus">+{mine}</p> : null}
      <h2>{mine ? (session.playMode === "teams" ? "вашей команде!" : "ваши очки!") : "Итог на экране"}</h2>
    </div>
  );
}
