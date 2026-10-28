import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { storeScope } from "../../core/program";
import { preloadTrack } from "../../components/music/useFragment";
import { placeOf } from "../../core/leaderboard";
import { pointsLabel } from "../../core/results";
import type { PlayerViewProps, ViewProps } from "../types";
import { WarmVideo } from "../stage/video";
import { cardCells, cellFit, DRUM_MS, hasVideo, RULE_TITLES, type CardStyle, type LottoContent, type LottoSong } from "./content";
import { LottoHall } from "./hall";
import { cardFor, isWin, orderOf, parseLottoResult, revealedUpTo, songIndexAt, splitMarks } from "./logic";

/**
 * Рисованная карточка «Вечер» / «День»: фон-картинка 3:4, заголовок и правило сверху, сетка — в пустой
 * середине рисунка. Цвета и места — переменные `.lotto-ticket--evening|day` в src/styles.css.
 * «Классика» — только сетка, как раньше.
 */
function LottoTicket({ style, rule, size, children }: { style: CardStyle; rule: LottoContent["rule"]; size: LottoContent["size"]; children: ReactNode }) {
  if (style === "classic") return <>{children}</>;
  return (
    <div className={`lotto-ticket lotto-ticket--${style} lotto-ticket--s${size}`}>
      <div className="lotto-ticket__head">
        <p className="lotto-ticket__title">Музыкальное лото</p>
        <p className="lotto-ticket__rule">{RULE_TITLES[rule]}</p>
      </div>
      {children}
    </div>
  );
}

interface CellState {
  on: boolean;
  now?: boolean;
  /** Отметка-догадка: название песни ещё не открыто. */
  pencil?: boolean;
  /** Песня уже открыта, а клетка не отмечена. */
  missed?: boolean;
}

function cellClass({ on, now = false, pencil = false, missed = false }: CellState): string {
  return `lotto-card__cell${on ? " is-marked" : ""}${pencil ? " is-pencil" : ""}${now ? " is-now" : ""}${missed ? " is-missed" : ""}`;
}

function CellText({ song, size, styled }: { song: LottoSong | undefined; size: LottoContent["size"]; styled: boolean }) {
  const title = song?.title ?? "";
  // Рисованная карточка: шрифт названия подстраивается под клетку, у длинных названий исполнителя нет.
  const fit = styled ? cellFit(title, size) : { fit: 1, artist: size < 5 };
  return (
    <>
      <span className="lotto-card__title" style={styled ? ({ "--fit": fit.fit } as CSSProperties) : undefined}>
        {title}
      </span>
      {song?.artist && fit.artist && <span className="lotto-card__artist">{song.artist}</span>}
    </>
  );
}

/** Пример карточки для заставки экрана зала: первые песни игры, несколько отмечено. */
function SampleTicket({ content }: { content: LottoContent }) {
  const cells = content.songs.slice(0, cardCells(content));
  const marked = new Set([0, content.size + 1, content.size * 2 + 2]);
  return (
    <div className="lotto-sample" aria-hidden="true">
      <LottoTicket style={content.cardStyle} rule={content.rule} size={content.size}>
        <div className="lotto-card" style={{ gridTemplateColumns: `repeat(${content.size}, minmax(0, 1fr))` }}>
          {cells.map((song, i) => (
            <span key={song.id} className={cellClass({ on: marked.has(i) })}>
              <CellText song={song} size={content.size} styled />
            </span>
          ))}
        </div>
      </LottoTicket>
    </div>
  );
}

/**
 * Экран зала: заставка «Откройте карточки» до первой песни, дальше — барабан, табло и страница песни (hall.tsx).
 */
export function LottoScreenView({ session, content }: ViewProps<LottoContent>) {
  if (session.state.stage === "ready") return <LottoIntro content={content} />;
  return <LottoHall session={session} content={content} />;
}

/** Заставка: правило, пример карточки; без барабана — заранее прогреваем ролик первой песни. */
function LottoIntro({ content }: { content: LottoContent }) {
  const first = content.drum === "off" ? content.songs[0] : undefined;
  useEffect(() => {
    preloadTrack(first && !hasVideo(first) ? first.trackId : null);
  }, [first]);
  const warm = first?.video.source === "link" && first.video.url ? <WarmVideo key={first.id} url={first.video.url} /> : null;
  const styled = content.cardStyle !== "classic" && content.songs.length >= cardCells(content);
  return (
    <div className={styled ? "quiz-screen quiz-screen--intro lotto-intro" : "quiz-screen quiz-screen--intro"}>
      <div className="lotto-intro__text">
        <span className="quiz-screen__badge">Музыкальное лото · {RULE_TITLES[content.rule].toLowerCase()}</span>
        <h2 className="quiz-screen__intro">Откройте карточки</h2>
        <p className="quiz-screen__hint">
          {content.drum === "off" ? "Звучит песня — угадайте её." : "Крутим барабан: выпадает номер — звучит песня. Угадайте её."}{" "}
          {content.hint ? "Ведущий откроет название — песня подсветится на карточке. Собрали — жмите «Лото!»" : "Узнали свою — отметьте. Собрали — жмите «Лото!»"}
        </p>
      </div>
      {styled && <SampleTicket content={content} />}
      {warm}
    </div>
  );
}

const MARKS_KEY = "joyrest.lotto";

function loadMarks(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function loadPending(key: string): number | null {
  try {
    const n = Number(localStorage.getItem(key));
    return localStorage.getItem(key) !== null && Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function savePending(key: string, step: number | null): void {
  try {
    if (step === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(step));
  } catch {
    // Приватный режим: заявка живёт до перезагрузки.
  }
}

function saveMarks(key: string, marks: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(marks));
  } catch {
    // Приватный режим: отметки живут до перезагрузки.
  }
}

/**
 * Телефон гостя: своя карточка, касание отмечает песню, «Лото!» — когда собрано по правилу игры.
 *
 * С подсказкой (по умолчанию) телефон сам сверяет отметки с открытыми названиями: пока песня звучит, отметка —
 * «карандашом» (догадка); ведущий показал название — верная становится настоящей (✓ и номер бочонка), неверные
 * снимаются с объяснением, у звучавшей песни клетка светится. «Лото!» считает только настоящие отметки, поэтому
 * ложную заявку не отправить. Собрали после названия — заявка ждёт и уходит с началом следующей песни (или в
 * «Последний шанс»). Без подсказки — отметки как есть, всё на слух. Пульт всё равно проверяет по сыгранным песням.
 */
export function LottoPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<LottoContent, { marks: string[] }>) {
  const card = useMemo(() => cardFor(content, pid), [content, pid]);
  const key = `${MARKS_KEY}.${storeScope(session)}.${pid}`;
  const pendingKey = `${key}.claim`;
  const [marks, setMarks] = useState<string[]>(() => loadMarks(key));
  const [pending, setPending] = useState<number | null>(() => loadPending(pendingKey));
  const titles = useMemo(() => new Map(content.songs.map((s) => [s.id, s])), [content.songs]);
  const numbers = useMemo(() => new Map(content.songs.map((s, i) => [s.id, i + 1])), [content.songs]);
  const result = parseLottoResult(session.state.result);
  const { stage, step } = session.state;
  const me = session.leaderboard[pid];
  const place = placeOf(session.leaderboard, pid);
  const won = result.winners.indexOf(pid);
  const guided = content.hint;
  const noScreen = session.screenMode === "none";
  const withNumbers = guided && content.drum !== "off" && !noScreen;
  const revealed = useMemo(() => revealedUpTo(content, session.state), [content, session.state]);
  const marked = new Set(marks);
  const split = splitMarks(marks, revealed);
  const claimed = myAnswer !== null && myAnswer !== undefined;
  const captain = role !== "member";
  const lastStep = step >= content.songs.length - 1;
  // Название открыто: показ названия, «Последний шанс» или награждение.
  const shown = stage === "reveal" || stage === "podium" || (stage === "question" && result.call > 0);
  const songIndex = songIndexAt(orderOf(content, result.order), step);
  const song = content.songs[songIndex];
  // С барабаном песня звучит не сразу: пока крутится барабан, ничего не выдаёт, какая песня выпадет
  // (часы телефона — свои, секунда туда-сюда не важна).
  const drumUntil = content.drum !== "off" && !noScreen && result.replay === 0 && result.call === 0 && stage === "question" && session.state.startedAt ? session.state.startedAt + DRUM_MS[content.drum] : 0;
  const [, wake] = useState(0);
  useEffect(() => {
    const wait = drumUntil - Date.now();
    if (wait <= 0) return;
    const timer = window.setTimeout(() => wake((n) => n + 1), wait + 50);
    return () => window.clearTimeout(timer);
  }, [drumUntil]);
  const spinning = drumUntil > Date.now();
  // «Лото!» с подсказкой — по настоящим отметкам. Плюс звучащая сейчас песня, если гость узнал её на слух и
  // отметил: она уже прозвучала, заявка честная (так знаток успевает первым). Пока крутится барабан — нет:
  // иначе загоревшаяся кнопка выдала бы, какая песня выпадет.
  const liveId = stage === "question" && result.call === 0 && !spinning && song ? song.id : null;
  const counted = guided ? [...split.confirmed, ...(liveId && marked.has(liveId) && !revealed.has(liveId) ? [liveId] : [])] : marks;
  const ready = isWin(card, new Set(counted), content.size, content.rule);
  const canClaimNow = captain && stage === "question" && won < 0 && !claimed && !sending && ready;
  const canQueue = captain && stage === "reveal" && won < 0 && !sending && ready && pending === null && !result.last.includes(pid);
  // Подсказка: название открыто и песня есть на карточке — клетка светится.
  const nowId = guided && shown && stage !== "podium" && song && card.includes(song.id) ? song.id : null;
  const nowMarked = nowId !== null && marked.has(nowId);

  useEffect(() => setMarks(loadMarks(key)), [key]);
  useEffect(() => setPending(loadPending(pendingKey)), [pendingKey]);

  // Название открылось — догадки, которые не совпали, снимаем сами и говорим, какие.
  const revealKey = guided && shown ? `${key}:${step}` : null;
  const [fixed, setFixed] = useState<{ at: string; titles: string[] } | null>(null);
  useEffect(() => {
    if (!revealKey) return;
    const wrong = marks.filter((id) => !revealed.has(id));
    if (wrong.length === 0) return;
    const next = marks.filter((id) => revealed.has(id));
    setMarks(next);
    saveMarks(key, next);
    setFixed({ at: revealKey, titles: wrong.map((id) => titles.get(id)?.title || "песня") });
    try {
      navigator.vibrate?.(60);
    } catch {
      // Вибрации нет — хватит надписи.
    }
    // Только в момент, когда название открылось: следующие догадки снимет следующий показ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);
  const fixedNow = fixed && fixed.at === revealKey ? fixed.titles : null;

  // Отложенная заявка: собрали после названия — уходит, как только снова принимают «Лото!».
  useEffect(() => {
    if (pending === null) return;
    const drop = () => {
      setPending(null);
      savePending(pendingKey, null);
    };
    if (won >= 0 || step < pending || session.state.phase === "finished" || stage === "podium" || !captain) return drop();
    if (stage !== "question" || claimed || sending) return;
    if (step === pending && result.call === 0) return;
    drop();
    if (ready) onAnswer({ marks: counted });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, stage, step, result.call, won, claimed, sending, session.state.phase, captain, ready]);

  // Собрали — кнопка «Лото!» загорается и мигает, телефон коротко вибрирует (один раз за сборку).
  const lit = canClaimNow || canQueue;
  const buzzed = useRef(false);
  useEffect(() => {
    if (!lit) {
      buzzed.current = false;
      return;
    }
    if (buzzed.current) return;
    buzzed.current = true;
    try {
      navigator.vibrate?.([120, 80, 120]);
    } catch {
      // Вибрации нет — хватит мигания.
    }
  }, [lit]);

  function toggle(id: string) {
    const next = marked.has(id) ? marks.filter((m) => m !== id) : [...marks, id];
    setMarks(next);
    saveMarks(key, next);
  }

  function claim() {
    if (canClaimNow) onAnswer({ marks: counted });
    else if (canQueue) {
      setPending(step);
      savePending(pendingKey, step);
    }
  }

  const nextWord = content.drum !== "off" && !noScreen ? "как только закрутится следующий барабан" : "как только зазвучит следующая песня";
  let status: string;
  if (won >= 0) status = `Вы выиграли! ${won + 1}-е место среди победителей`;
  else if (stage === "reveal" && result.last.includes(pid)) status = "ЛОТО! Верно!";
  else if (pending !== null && stage === "reveal")
    status = lastStep ? "Заявка ждёт — скажите ведущему «Лото!»: он откроет «Последний шанс»" : `Заявка принята — уйдёт ведущему, ${nextWord}`;
  else if (stage === "reveal" && result.rejected.includes(pid)) status = "Не совпало: на карточке есть песни, которые ещё не звучали";
  else if (sending) status = "Отправляем заявку…";
  else if (claimed) status = result.call > 0 ? "Заявка у ведущего — проверит сейчас" : "Заявка у ведущего — проверим после песни";
  else if (!captain) status = ready ? "Собрали! Скажите капитану — «Лото!» жмёт он" : "«Лото!» нажимает капитан команды";
  else if (stage === "ready") status = "Ждём первую песню";
  else if (result.call > 0 && stage === "question") status = ready ? "Последний шанс! Собрали — жмите «Лото!» ↑" : "Последний шанс «Лото!» — у вас пока не собрано";
  else status = ready ? "Собрали! Жмите «Лото!» ↑" : `Отмечайте песни · ${RULE_TITLES[content.rule].toLowerCase()}`;

  let hint: string | null = null;
  let hintDone = false;
  if (won < 0 && guided && !spinning && stage !== "ready" && stage !== "podium") {
    if (nowId !== null) {
      hint = nowMarked ? `✓ Песня${withNumbers ? ` № ${songIndex + 1}` : ""} отмечена` : "🎵 Эта песня у вас есть! Нажмите на светящуюся клетку";
      hintDone = nowMarked;
    } else if (shown && song) {
      hint = "Этой песни на вашей карточке нет — ждём следующую";
      hintDone = true;
    } else if (stage === "question") {
      hint = "🎧 Угадайте песню на слух. Ведущий откроет название — она подсветится на карточке";
      hintDone = true;
    }
  }

  return (
    <div className="quiz-phone lotto-phone">
      <p className="eyebrow">
        {stage === "ready" ? "Музыкальное лото" : spinning ? `Крутим барабан… · песня ${step + 1} из ${content.songs.length}` : content.drum !== "off" && !noScreen ? `Бочонок № ${songIndex + 1} · песня ${step + 1} из ${content.songs.length}` : `Песня ${step + 1} из ${content.songs.length}`}
        {me && place ? ` · ${pointsLabel(me.score)}` : ""}
      </p>
      {noScreen && shown && stage !== "podium" && song && (
        <p className="lotto-phone__song">
          Звучала: <strong>{song.title}</strong>
          {song.artist ? ` — ${song.artist}` : ""}
        </p>
      )}
      {fixedNow && (
        <p className="lotto-hint is-fixed" role="alert">
          {fixedNow.length === 1 ? `«${fixedNow[0]}» ещё не звучала — отметку сняли` : `Ещё не звучали: ${fixedNow.map((t) => `«${t}»`).join(", ")} — отметки сняли`}
        </p>
      )}
      {hint && (
        <p className={hintDone ? "lotto-hint is-done" : "lotto-hint"} role="status">
          {hint}
        </p>
      )}
      <LottoTicket style={content.cardStyle} rule={content.rule} size={content.size}>
        <div className="lotto-card" style={{ gridTemplateColumns: `repeat(${content.size}, minmax(0, 1fr))` }} role="group" aria-label="Ваша карточка">
          {card.map((id, i) => {
            const open = revealed.has(id);
            const on = marked.has(id) && (!guided || open);
            const pencil = guided && marked.has(id) && !open;
            const num = withNumbers && open ? numbers.get(id) : undefined;
            const label = `${titles.get(id)?.title ?? "Песня"}${num ? `, бочонок ${num}` : ""}${pencil ? ", отмечено карандашом — проверим после ответа" : on ? ", отмечено" : ""}`;
            return (
              <button
                key={`${id}-${i}`}
                type="button"
                className={cellClass({ on, now: id === nowId, pencil, missed: guided && open && !marked.has(id) && id !== nowId })}
                aria-pressed={marked.has(id)}
                aria-label={label}
                aria-current={id === nowId ? "true" : undefined}
                onClick={() => toggle(id)}
              >
                {num !== undefined && <span className="lotto-card__num" aria-hidden="true">№ {num}</span>}
                <CellText song={titles.get(id)} size={content.size} styled={content.cardStyle !== "classic"} />
              </button>
            );
          })}
        </div>
      </LottoTicket>
      {card.length < cardCells(content) && <p className="error small">В игре мало песен для карточки — скажите ведущему.</p>}
      {captain && won < 0 && (
        <button type="button" className={lit ? "btn btn--block lotto-phone__claim is-ready" : "btn btn--block lotto-phone__claim"} disabled={!lit} onClick={claim}>
          Лото!
        </button>
      )}
      {guided && split.pencil.length > 0 && !shown && <p className="muted small lotto-phone__pencil">«?» — ваша догадка. Ведущий откроет название — проверим её сами.</p>}
      <p aria-live="polite" className={won >= 0 || result.last.includes(pid) ? "quiz-phone__status success" : "quiz-phone__status muted"}>
        {status}
      </p>
    </div>
  );
}
