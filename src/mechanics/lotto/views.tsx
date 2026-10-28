import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { storeScope } from "../../core/program";
import { preloadTrack } from "../../components/music/useFragment";
import { placeOf } from "../../core/leaderboard";
import { pointsLabel } from "../../core/results";
import type { PlayerViewProps, ViewProps } from "../types";
import { WarmVideo } from "../stage/video";
import { cardCells, cellFit, DRUM_MS, hasVideo, RULE_TITLES, type CardStyle, type LottoContent, type LottoSong } from "./content";
import { LottoHall } from "./hall";
import { cardFor, isWin, orderOf, parseLottoResult, songIndexAt } from "./logic";

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

function cellClass(on: boolean, now = false): string {
  return `lotto-card__cell${on ? " is-marked" : ""}${now ? " is-now" : ""}`;
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
            <span key={song.id} className={cellClass(marked.has(i))}>
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
          {content.drum === "off" ? "Услышали песню с карточки — отметьте её. Собрали — жмите «Лото!»" : "Крутим барабан: выпадает номер — звучит песня. Есть на карточке — отметьте. Собрали — жмите «Лото!»"}
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

function saveMarks(key: string, marks: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(marks));
  } catch {
    // Приватный режим: отметки живут до перезагрузки.
  }
}

/**
 * Телефон гостя: своя карточка, касание отмечает песню, «Лото!» — когда собрана линия по отметкам.
 * Проверяет пульт по песням, которые действительно звучали.
 */
export function LottoPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<LottoContent, { marks: string[] }>) {
  const card = useMemo(() => cardFor(content, pid), [content, pid]);
  const key = `${MARKS_KEY}.${storeScope(session)}.${pid}`;
  const [marks, setMarks] = useState<string[]>(() => loadMarks(key));
  const titles = useMemo(() => new Map(content.songs.map((s) => [s.id, s])), [content.songs]);
  const result = parseLottoResult(session.state.result);
  const { stage, step } = session.state;
  const me = session.leaderboard[pid];
  const place = placeOf(session.leaderboard, pid);
  const won = result.winners.indexOf(pid);
  const marked = new Set(marks);
  const ready = isWin(card, marked, content.size, content.rule);
  const claimed = myAnswer !== null && myAnswer !== undefined;
  const canClaim = role !== "member" && stage === "question" && won < 0 && !claimed && !sending && ready;
  const noScreen = session.screenMode === "none";
  const songIndex = songIndexAt(orderOf(content, result.order), step);
  const song = content.songs[songIndex];
  // С барабаном песня звучит не сразу: пока крутится барабан, подсказка и номер не выдают, какая песня выпадет
  // (часы телефона — свои, секунда туда-сюда не важна).
  const drumUntil = content.drum !== "off" && session.screenMode !== "none" && result.replay === 0 && stage === "question" && session.state.startedAt ? session.state.startedAt + DRUM_MS[content.drum] : 0;
  const [, wake] = useState(0);
  useEffect(() => {
    const wait = drumUntil - Date.now();
    if (wait <= 0) return;
    const timer = window.setTimeout(() => wake((n) => n + 1), wait + 50);
    return () => window.clearTimeout(timer);
  }, [drumUntil]);
  const spinning = drumUntil > Date.now();
  // Подсказка: звучащая (или только что звучавшая) песня есть на карточке — клетка светится.
  const nowId = !spinning && content.hint && (stage === "question" || stage === "reveal") && song && card.includes(song.id) ? song.id : null;
  const nowMarked = nowId !== null && marked.has(nowId);

  useEffect(() => setMarks(loadMarks(key)), [key]);

  // Собрали — кнопка «Лото!» загорается и мигает, телефон коротко вибрирует (один раз за сборку).
  const buzzed = useRef(false);
  useEffect(() => {
    if (!canClaim) {
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
  }, [canClaim]);

  function toggle(id: string) {
    const next = marked.has(id) ? marks.filter((m) => m !== id) : [...marks, id];
    setMarks(next);
    saveMarks(key, next);
  }

  let status: string;
  if (won >= 0) status = `Вы выиграли! ${won + 1}-е место среди победителей`;
  else if (stage === "reveal" && result.last.includes(pid)) status = "ЛОТО! Верно!";
  else if (stage === "reveal" && result.rejected.includes(pid)) status = "Не совпало: на карточке есть песни, которые ещё не звучали";
  else if (sending) status = "Отправляем заявку…";
  else if (claimed) status = "Заявка у ведущего — проверим после песни";
  else if (role === "member") status = "«Лото!» нажимает капитан команды";
  else if (stage === "ready") status = "Ждём первую песню";
  else status = ready ? "Собрали! Жмите «Лото!» ↑" : `Отмечайте песни · ${RULE_TITLES[content.rule].toLowerCase()}`;
  const hint = won < 0 && nowId !== null ? (nowMarked ? "✓ Эта песня у вас отмечена" : "🎵 Эта песня у вас есть! Нажмите на светящуюся клетку") : null;

  return (
    <div className="quiz-phone lotto-phone">
      <p className="eyebrow">
        {stage === "ready" ? "Музыкальное лото" : spinning ? `Крутим барабан… · песня ${step + 1} из ${content.songs.length}` : content.drum !== "off" ? `Бочонок № ${songIndex + 1} · песня ${step + 1} из ${content.songs.length}` : `Песня ${step + 1} из ${content.songs.length}`}
        {me && place ? ` · ${pointsLabel(me.score)}` : ""}
      </p>
      {noScreen && stage === "reveal" && song && (
        <p className="lotto-phone__song">
          Звучала: <strong>{song.title}</strong>
          {song.artist ? ` — ${song.artist}` : ""}
        </p>
      )}
      {hint && (
        <p className={nowMarked ? "lotto-hint is-done" : "lotto-hint"} role="status">
          {hint}
        </p>
      )}
      <LottoTicket style={content.cardStyle} rule={content.rule} size={content.size}>
        <div className="lotto-card" style={{ gridTemplateColumns: `repeat(${content.size}, minmax(0, 1fr))` }} role="group" aria-label="Ваша карточка">
          {card.map((id, i) => {
            const on = marked.has(id);
            return (
              <button key={`${id}-${i}`} type="button" className={cellClass(on, id === nowId)} aria-pressed={on} aria-current={id === nowId ? "true" : undefined} onClick={() => toggle(id)}>
                <CellText song={titles.get(id)} size={content.size} styled={content.cardStyle !== "classic"} />
              </button>
            );
          })}
        </div>
      </LottoTicket>
      {card.length < cardCells(content) && <p className="error small">В игре мало песен для карточки — скажите ведущему.</p>}
      {role !== "member" && won < 0 && (
        <button type="button" className={canClaim ? "btn btn--block lotto-phone__claim is-ready" : "btn btn--block lotto-phone__claim"} disabled={!canClaim} onClick={() => onAnswer({ marks })}>
          Лото!
        </button>
      )}
      <p aria-live="polite" className={won >= 0 || result.last.includes(pid) ? "quiz-phone__status success" : "quiz-phone__status muted"}>
        {status}
      </p>
    </div>
  );
}
