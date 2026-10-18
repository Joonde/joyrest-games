import { useMemo, useRef, useState } from "react";
import { LibraryVideoPicker, videoSourceLabel, videoSources } from "../../components/media/libraryVideo";
import { saveLocalVideo } from "../../components/media/localVideo";
import { TrackPicker } from "../../components/music/TrackPicker";
import type { VideoSource } from "../dance/content";
import type { EditorProps } from "../types";
import { badVideoLink, CARD_STYLE_HINTS, CARD_STYLE_TITLES, CARD_STYLES, cardCells, hasVideo, LOTTO_LIMITS, newSong, parseSongList, RULE_HINTS, RULE_TITLES, WIN_RULES, type LottoContent, type LottoSong, type WinRule } from "./content";
import { validateLotto } from "./validate";
import { ClampedNumber } from "../../components/ClampedNumber";

const SIZES: Array<LottoContent["size"]> = [3, 4, 5];
const RULES: WinRule[] = WIN_RULES;

/** Конструктор музыкального лото: песни (название, исполнитель, трек), карточка, правило победы, очки. */
export function LottoEditor({ content, onChange, editable }: EditorProps<LottoContent>) {
  const [bulk, setBulk] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const errors = useMemo(() => validateLotto(content), [content]);
  const general = errors.filter((e) => !e.path.startsWith("songs/"));
  // Трек грузится несколько секунд: правим игру, какой она стала, а не какой была при касании.
  const latest = useRef(content);
  latest.current = content;
  const set = (patch: Partial<LottoContent>) => onChange({ ...latest.current, ...patch });
  const setSong = (id: string, patch: Partial<LottoSong>) => set({ songs: latest.current.songs.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const room = LOTTO_LIMITS.songs - content.songs.length;

  function addBulk() {
    const songs = parseSongList(bulk).slice(0, room);
    if (songs.length === 0) return;
    set({ songs: [...content.songs, ...songs] });
    setBulk("");
  }

  function shuffle() {
    const songs = [...content.songs];
    for (let i = songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [songs[i], songs[j]] = [songs[j] as LottoSong, songs[i] as LottoSong];
    }
    set({ songs });
  }

  return (
    <>
      <section className="card">
        <h2>Как играем</h2>
        <fieldset disabled={!editable}>
          <legend>Карточка</legend>
          <div className="pick-chips">
            {SIZES.map((size) => (
              <button key={size} type="button" className="pick-chip" aria-pressed={content.size === size} onClick={() => set({ size })}>
                {size}×{size} · {size * size} песен
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={!editable}>
          <legend>Оформление карточки</legend>
          {CARD_STYLES.map((style) => (
            <label key={style} className="choice lotto-style">
              <input type="radio" name="lotto-style" checked={content.cardStyle === style} onChange={() => set({ cardStyle: style })} />
              <span className="choice__text">
                <span className="choice__title">{CARD_STYLE_TITLES[style]}</span>
                <span className="choice__hint">{CARD_STYLE_HINTS[style]}</span>
              </span>
              <span className={`lotto-style__thumb lotto-style__thumb--${style}`} aria-hidden="true" />
            </label>
          ))}
        </fieldset>
        <fieldset disabled={!editable}>
          <legend>Что собрать для победы</legend>
          {RULES.map((rule) => (
            <label key={rule} className="choice">
              <input type="radio" name="lotto-rule" checked={content.rule === rule} onChange={() => set({ rule })} />
              <span className="choice__text">
                <span className="choice__title">{RULE_TITLES[rule]}</span>
                <span className="choice__hint">{RULE_HINTS[rule]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="q-numbers">
          <label className="field">
            Песня звучит, секунд
            <ClampedNumber
              value={content.fragment}
              min={LOTTO_LIMITS.minFragment}
              max={LOTTO_LIMITS.maxFragment}
              fallback={30}
              disabled={!editable}
              onChange={(v) => set({ fragment: v })}
            />
          </label>
        </div>
        <fieldset disabled={!editable}>
          <legend>Очки победителям по порядку</legend>
          <div className="q-numbers">
            {[0, 1, 2].map((i) => (
              <label key={i} className="field">
                {i + 1}-й
                <ClampedNumber
                  value={content.prizes[i] ?? 0}
                  min={0}
                  max={LOTTO_LIMITS.maxPrize}
                  fallback={0}
                  disabled={!editable}
                  onChange={(v) => {
                    const prizes = [...content.prizes];
                    while (prizes.length <= i) prizes.push(0);
                    prizes[i] = v;
                    set({ prizes });
                  }}
                />
              </label>
            ))}
          </div>
          <p className="muted small">Следующим победителям — очки третьего.</p>
        </fieldset>
        <label className="choice">
          <input type="checkbox" checked={content.hint} disabled={!editable} onChange={(e) => set({ hint: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Подсказывать гостям песню на карточке</span>
            <span className="choice__hint">Звучит песня, которая есть у гостя, — её клетка светится и на телефоне «Эта песня у вас есть!». Выключите для игры на знатоков.</span>
          </span>
        </label>
        <fieldset disabled={!editable}>
          <legend>Видео песен</legend>
          <label className="choice">
            <input type="radio" name="lotto-video" checked={!content.videoHide} onChange={() => set({ videoHide: false })} />
            <span className="choice__text">
              <span className="choice__title">Показывать видео сразу</span>
              <span className="choice__hint">Клип или караоке с текстом — зал подпевает. Название песни видео может подсказать.</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="lotto-video" checked={content.videoHide} onChange={() => set({ videoHide: true })} />
            <span className="choice__text">
              <span className="choice__title">Прятать картинку до названия</span>
              <span className="choice__hint">Пока песня звучит — только звук, угадывают на слух. «Показать название» открывает видео.</span>
            </span>
          </label>
        </fieldset>
      </section>

      <section className="card">
        <h2>Песни · {content.songs.length}</h2>
        <p className="muted">
          На карточке {cardCells(content)} песен из списка, у каждого гостя — своя. Звучат по порядку списка. Трек можно выбрать из своей или общей
          музыки — тогда песня играет на экране зала; без трека ведущий включает её сам. К песне можно добавить видео — клип или караоке:
          ссылкой на YouTube, VK Видео или Rutube или файлом на устройстве экрана зала (на сервер видео не загружается).
        </p>
        {content.songs.length >= cardCells(content) && content.songs.length < cardCells(content) * 2 && (
          <p className="notice small">
            Чтобы карточки гостей заметно отличались, нужно хотя бы {cardCells(content) * 2} песен (сейчас {content.songs.length}). Иначе у всех почти одни и те же песни — победителей «Лото!» будет сразу много.
          </p>
        )}
        {general.map((e) => (
          <p key={e.message} className="error small">
            {e.message}
          </p>
        ))}
        {editable && (
          <>
            <label className="field">
              Вставить списком: «Исполнитель — Песня», по одной в строке
              <textarea rows={4} value={bulk} placeholder={"Земфира — Хочешь?\nКино — Звезда по имени Солнце"} onChange={(e) => setBulk(e.target.value)} />
            </label>
            <div className="actions">
              <button type="button" className="btn btn--block" disabled={!bulk.trim() || room <= 0} onClick={addBulk}>
                Добавить песни из списка
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--block"
                disabled={room <= 0}
                onClick={() => {
                  const song = newSong();
                  set({ songs: [...content.songs, song] });
                  setOpenId(song.id);
                }}
              >
                Добавить одну песню
              </button>
              <button type="button" className="btn btn--quiet btn--block" disabled={content.songs.length < 2} onClick={shuffle}>
                Перемешать порядок
              </button>
            </div>
          </>
        )}
      </section>

      {content.songs.length > 0 && (
        <ol className="q-list" aria-label="Песни">
          {content.songs.map((song, index) => {
            const own = errors.filter((e) => e.path.startsWith(`songs/${song.id}/`));
            const open = openId === song.id;
            return (
              <li key={song.id} className="card q-card">
                <div className="q-card__head">
                  <span className="q-card__number">{index + 1}</span>
                  <button type="button" className="btn btn--quiet q-card__summary" aria-expanded={open} onClick={() => setOpenId(open ? null : song.id)}>
                    <span className="q-card__text">
                      {song.title || "Без названия"}
                      {song.artist ? <span className="muted"> — {song.artist}</span> : null}
                      {song.trackId ? " ♪" : ""}
                      {hasVideo(song) ? " ▶" : ""}
                    </span>
                  </button>
                </div>
                {own.map((e) => (
                  <p key={e.message} className="error small">
                    {e.message}
                  </p>
                ))}
                {open && (
                  <div className="stack">
                    <label className="field">
                      Название
                      <input maxLength={LOTTO_LIMITS.title} value={song.title} disabled={!editable} onChange={(e) => setSong(song.id, { title: e.target.value })} />
                    </label>
                    <label className="field">
                      Исполнитель
                      <input maxLength={LOTTO_LIMITS.artist} value={song.artist} disabled={!editable} onChange={(e) => setSong(song.id, { artist: e.target.value })} />
                    </label>
                    <TrackPicker
                      trackId={song.trackId}
                      start={song.trackStart}
                      length={content.fragment}
                      showLength={false}
                      disabled={!editable}
                      onChange={(patch) =>
                        setSong(song.id, {
                          ...(patch.trackId !== undefined ? { trackId: patch.trackId } : {}),
                          ...(patch.trackStart !== undefined ? { trackStart: patch.trackStart } : {}),
                        })
                      }
                    />
                    <SongVideo song={song} editable={editable} onChange={(patch) => setSong(song.id, patch)} />
                    {editable && (
                      <button type="button" className="btn btn--quiet btn--block" onClick={() => set({ songs: content.songs.filter((s) => s.id !== song.id) })}>
                        Убрать песню
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/** Видео песни: ссылка (YouTube, VK Видео, Rutube) или файл только на этом устройстве (IndexedDB, ключ — id песни). */
function SongVideo({ song, editable, onChange }: { song: LottoSong; editable: boolean; onChange: (patch: Partial<LottoSong>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // В «Видео JoyRest» поле url — id видео: при переходе к нему или от него ссылка и id не смешиваются.
  const setSource = (source: VideoSource) => onChange({ video: (source === "server") === (song.video.source === "server") ? { ...song.video, source } : { source, url: "", name: "" } });
  return (
    <fieldset className="stack stack--tight">
      <legend>Видео: клип или караоке (по желанию)</legend>
      <div className="seg" role="group" aria-label="Откуда видео">
        {videoSources(["none", "server", "link", "file"]).map((s) => (
          <button key={s} type="button" className={song.video.source === s ? "seg__btn is-on" : "seg__btn"} aria-pressed={song.video.source === s} disabled={!editable} onClick={() => setSource(s)}>
            {videoSourceLabel(s)}
          </button>
        ))}
      </div>
      {song.video.source === "server" && (
          <LibraryVideoPicker value={song.video.url} editable={editable} onPick={(v) => onChange({ video: { source: "server", url: v.id, name: v.title.slice(0, 120) } })} />
        )}
        {song.video.source === "link" && (
        <label className="field">
          Ссылка на YouTube, VK Видео или Rutube
          <input value={song.video.url} inputMode="url" maxLength={LOTTO_LIMITS.url} disabled={!editable} placeholder="https://youtu.be/…" onChange={(e) => onChange({ video: { ...song.video, url: e.target.value.trim() } })} />
          {badVideoLink(song) && <span className="error small">Эту ссылку экран не откроет: нужна ссылка на ролик YouTube, VK Видео или Rutube.</span>}
          <span className="muted small">Проверьте ролик на репетиции: некоторые запрещают показ на других сайтах. Пауза и перемотка с пульта — у YouTube и Rutube.</span>
        </label>
      )}
      {song.video.source === "file" && (
        <div className="stack stack--tight">
          <p className="muted small">Видео на сервер не загружается: оно хранится только на устройстве, где открыт экран зала. Выберите файл здесь, если это тот же ноутбук, — или экран сам попросит его, когда дойдёт до песни.</p>
          {song.video.name && <p className="small">Файл: {song.video.name}</p>}
          {saved && <p className="success small">{saved}</p>}
          {editable && (
            <button type="button" className="btn btn--secondary btn--block" onClick={() => fileRef.current?.click()}>
              Выбрать видео на этом устройстве
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void saveLocalVideo(song.id, file)
                .then(() => setSaved("Видео сохранено на этом устройстве"))
                .catch(() => setSaved("Не получилось сохранить видео в браузере"));
              onChange({ video: { ...song.video, name: file.name.slice(0, 120) } });
            }}
          />
        </div>
      )}
      {song.video.source !== "none" && (
        <label className="field">
          С какой секунды
          <ClampedNumber value={song.videoStart} min={0} max={LOTTO_LIMITS.maxVideoStart} fallback={0} disabled={!editable} onChange={(videoStart) => onChange({ videoStart })} />
          <span className="muted small">Звук — из видео: трек песни, если выбран, тогда не играет.</span>
        </label>
      )}
    </fieldset>
  );
}
