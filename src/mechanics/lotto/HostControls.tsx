import { useEffect, useRef, useState } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { podiumLabel, podiumNext, startPodium } from "../../core/podium";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { canSeek } from "../stage/video";
import { useServerNow } from "../../components/live/useServerNow";
import { clockOf, DRUM_MS, hasLyrics, hasVideo, RULE_TITLES, type LottoContent } from "./content";
import { canLastCall, cardFor, hushSong, isClaim, isWin, lastCall, lottoBack, lottoPrimary, lottoVideoCommand, lyricsCommand, nextSong, orderOf, parseLottoResult, playedUpTo, playSong, replaySong, revealSong, songIndexAt, type LottoAction, type LottoVideoCmd } from "./logic";

const LABELS: Record<LottoAction, string> = {
  play: "Включить первую песню",
  reveal: "Показать название",
  next: "Следующая песня",
  podium: "Награждение",
  podiumNext: "Показать место",
  finish: "Завершить игру",
};

/**
 * Пульт лото: какая песня звучит (ведущему видно название), заявки «Лото!» с проверкой прямо
 * сейчас, победители; «Показать название» засчитывает верные заявки.
 */
export function LottoHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<LottoContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Session>(session);
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    latest.current = session;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);

  const { stage, step } = session.state;
  const result = parseLottoResult(session.state.result);
  const order = orderOf(content, result.order);
  const songIndex = songIndexAt(order, step);
  const song = content.songs[songIndex];
  const action = lottoPrimary(session, content);
  // В «Последний шанс» прежние победители этой песни уже засчитаны — их заявки не показываем.
  const own = answers.filter((a) => a.step === step && isClaim(a.value) && !(result.call > 0 && result.winners.includes(a.pid)));
  const played = playedUpTo(content, step, order);
  const drum = content.drum !== "off" && session.screenMode !== "none";
  const drumUntil = drum && stage === "question" && result.replay === 0 && result.call === 0 && session.state.startedAt ? session.state.startedAt + DRUM_MS[content.drum] : 0;
  const now = useServerNow(500, drumUntil > 0);
  const spinning = drumUntil > now;
  const nameOf = (pid: string) => session.leaderboard[pid]?.name ?? participants.find((p) => p.id === pid)?.name ?? "Игрок";

  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: SessionChange | (() => Promise<SessionChange>), afterClear?: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    try {
      const change = typeof make === "function" ? await make() : make;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } });
      if (afterClear !== undefined) await control.clearAnswers(afterClear);
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) {
        setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Заявки — по свежему списку с сервера: нажатие в последнюю секунду не потеряется. */
  async function revealChange(): Promise<SessionChange> {
    let all: Answer[] = answers.filter((a) => a.step === step);
    try {
      const fresh = await control.freshAnswers(step);
      const byId = new Map(all.map((a) => [a.id, a]));
      for (const a of fresh) if (a.step === step) byId.set(a.id, a);
      all = [...byId.values()];
    } catch {
      // Нет связи — считаем по тому, что уже пришло.
    }
    return revealSong(latest.current, content, all, participants);
  }

  function onPrimary() {
    if (action === "play") void run(playSong(session, content));
    if (action === "reveal") void run(revealChange);
    if (action === "next") void run(nextSong(session));
    if (action === "podium") void run(startPodium(session));
    if (action === "podiumNext") void run(podiumNext(session));
    if (action === "finish") control.requestFinish();
  }

  const back = lottoBack(session);
  const screen = session.screenMode !== "none";
  const video = screen && hasVideo(song) && song ? song : null;
  const seek = video ? canSeek({ id: video.id, title: video.title, video: video.video }) : false;
  const cmd = (c: LottoVideoCmd) => void run(lottoVideoCommand(latest.current, c));
  const videoPanel = video && (stage === "question" || stage === "reveal") && (
    <section className="stack stack--tight" aria-label="Видео на экране зала">
      <h3 className="host-quiz__subtitle">Видео на экране зала{content.videoHide && stage === "question" ? " · картинка скрыта до названия" : ""}</h3>
      <div className="lotto-player">
        <button type="button" className="btn btn--secondary" disabled={busy || !seek} onClick={() => cmd("back")} aria-label="Назад на 10 секунд">
          −10 с
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => cmd(result.video.paused ? "play" : "pause")}>
          {result.video.paused ? "▶ Дальше" : "⏸ Пауза"}
        </button>
        <button type="button" className="btn btn--secondary" disabled={busy || !seek} onClick={() => cmd("fwd")} aria-label="Вперёд на 10 секунд">
          +10 с
        </button>
      </div>
      <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => cmd("stop")}>
        ⏹ Остановить — видео в начало
      </button>
      {!seek && <p className="muted small">VK Видео не даёт управлять плеером: «Пауза» и «Остановить» убирают ролик, «Дальше» запускает его заново. Перемотка — у YouTube, Rutube и файла.</p>}
    </section>
  );

  // После названия песня играет дальше (настройка «играет и после ответа») — её можно остановить.
  const track = screen && song && !video && song.trackId ? song : null;
  // Кнопка — при любой настройке: если песня всё же звучит (экран открыли поздно, трек догружался), её можно
  // заглушить с пульта, а не только «Следующей песней» (ревью 29 октября 2026).
  const afterPanel =
    track && stage === "reveal" && result.hush === 0 ? (
      <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(hushSong(latest.current))}>
        {content.playAfter ? "⏹ Остановить песню (играет на 60%)" : "⏹ Остановить песню"}
      </button>
    ) : null;
  const lyricsPanel = track && hasLyrics(track) && (stage === "question" || stage === "reveal") && !spinning && (
    <section className="stack stack--tight" aria-label="Текст песни на экране зала">
      <h3 className="host-quiz__subtitle">
        🎤 Текст песни на экране:{" "}
        {result.lyrics === "on" ? "показан" : result.lyrics === "off" ? "убран" : track.lyricsShow === "reveal" ? "после названия" : `с ${clockOf(track.lyricsAt)}`}
      </h3>
      <div className="actions">
        {result.lyrics !== "on" && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(lyricsCommand(latest.current, "on"))}>
            Показать текст сейчас
          </button>
        )}
        {result.lyrics !== "off" && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(lyricsCommand(latest.current, "off"))}>
            Убрать текст
          </button>
        )}
        {result.lyrics !== "auto" && (
          <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void run(lyricsCommand(latest.current, "auto"))}>
            Как в настройке песни
          </button>
        )}
      </div>
    </section>
  );

  const buttons = (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {/* Пока крутится барабан, название не открыть: песня ещё не звучала (ревью 29 октября 2026). */}
        <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || (action === "reveal" && spinning)} onClick={onPrimary}>
          {action === "reveal" && spinning ? "🎰 Барабан крутится…" : action === "podiumNext" ? podiumLabel(session) : action === "reveal" && result.call > 0 ? "Проверить «Лото!» и закрыть приём" : drum && action === "play" ? "🎰 Крутить барабан — первая песня" : drum && action === "next" ? "🎰 Крутить барабан — следующая песня" : LABELS[action]}
        </button>
        {canLastCall(session, content) && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(lastCall(latest.current))}>
            🙋 Последний шанс «Лото!»
          </button>
        )}
        {afterPanel}
        {(song?.trackId || video) && screen && stage === "question" && result.call === 0 && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(replaySong(session))}>
            {video ? "↺ Видео сначала" : "♪ Повторить песню"}
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || back === null} onClick={() => back && void run(back.change, back.clearAnswers)}>
          Назад
        </button>
      </div>
    </>
  );

  if (stage === "podium") {
    return (
      <div className="stack host-quiz">
        <p className="eyebrow">Награждение</p>
        <PodiumHostList session={session} />
        {buttons}
      </div>
    );
  }

  return (
    <div className="stack host-quiz">
      <div className="stack stack--tight">
        <p className="eyebrow">
          Музыкальное лото · {RULE_TITLES[content.rule].toLowerCase()} · песня {step + 1} из {content.songs.length}
          {drum && stage !== "ready" ? ` · бочонок № ${songIndex + 1}` : ""}
        </p>
        {stage === "ready" && drum ? (
          <p className="host-quiz__question">Песни выпадают из барабана в случайном порядке.</p>
        ) : (
          song && (
            <p className="host-quiz__question">
              {stage === "ready" ? "Первая: " : ""}
              {drum ? `№ ${songIndex + 1} · ` : ""}
              {song.title}
              {song.artist ? <span className="muted"> — {song.artist}</span> : null}
            </p>
          )
        )}
        {spinning && <p className="notice small">🎰 Барабан крутится на экране зала — песня зазвучит через {Math.max(1, Math.ceil((drumUntil - now) / 1000))} с.</p>}
        {!song?.trackId && !video && stage !== "ready" && <p className="muted small">У песни нет трека — включите её со своего плеера.</p>}
        {video && stage !== "ready" && <p className="muted small">У песни видео: {video.video.source === "file" ? `файл «${video.video.name || "видео"}» на устройстве экрана` : video.video.source === "server" ? `«${video.video.name || "видео"}» из видео JoyRest` : "ролик по ссылке"}. Звук — из видео.</p>}
      </div>

      {canLastCall(session, content) && (
        <p className="muted small">Песни кончились. Кто-то собрал карточку после названия? «Последний шанс» снова откроет приём «Лото!» по этой песне.</p>
      )}
      {stage === "question" && result.call > 0 && <p className="notice small">🙋 Последний шанс: на экране «Жмите «Лото!»». Подождите заявки и нажмите «Проверить».</p>}
      {stage === "question" && (
        <section className="stack stack--tight" aria-live="polite">
          <h3 className="host-quiz__subtitle">Заявки «Лото!»: {own.length}</h3>
          {own.length === 0 ? (
            <p className="muted small">Пока никто не собрал карточку.</p>
          ) : (
            <ul className="open-answers">
              {own.map((a) => {
                const ok = isWin(cardFor(content, a.pid), played, content.size, content.rule) && !result.winners.includes(a.pid);
                return (
                  <li key={a.id} className={`open-answers__item open-answers__item--${ok ? "correct" : "wrong"}`}>
                    <span className="open-answers__text">{nameOf(a.pid)}</span>
                    <span className="open-answers__mark">{ok ? "Верно" : "Не совпадает"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {videoPanel}
      {lyricsPanel}

      {result.winners.length > 0 && (
        <section className="stack stack--tight">
          <h3 className="host-quiz__subtitle">Победители</h3>
          <ol className="lotto-winners">
            {result.winners.map((pid) => (
              <li key={pid}>{nameOf(pid)}</li>
            ))}
          </ol>
        </section>
      )}

      {buttons}
    </div>
  );
}
