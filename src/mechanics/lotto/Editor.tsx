import { useMemo, useState } from "react";
import { TrackPicker } from "../../components/music/TrackPicker";
import type { EditorProps } from "../types";
import { cardCells, LOTTO_LIMITS, newSong, parseSongList, RULE_HINTS, RULE_TITLES, type LottoContent, type LottoSong, type WinRule } from "./content";
import { validateLotto } from "./validate";
import { ClampedNumber } from "../../components/ClampedNumber";

const SIZES: Array<LottoContent["size"]> = [3, 4, 5];
const RULES: WinRule[] = ["line", "twoLines", "full"];

/** Конструктор музыкального лото: песни (название, исполнитель, трек), карточка, правило победы, очки. */
export function LottoEditor({ content, onChange, editable }: EditorProps<LottoContent>) {
  const [bulk, setBulk] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const errors = useMemo(() => validateLotto(content), [content]);
  const general = errors.filter((e) => !e.path.startsWith("songs/"));
  const set = (patch: Partial<LottoContent>) => onChange({ ...content, ...patch });
  const setSong = (id: string, patch: Partial<LottoSong>) => set({ songs: content.songs.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
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
          <legend>Победа</legend>
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
      </section>

      <section className="card">
        <h2>Песни · {content.songs.length}</h2>
        <p className="muted">
          На карточке {cardCells(content)} песен из списка, у каждого гостя — своя. Звучат по порядку списка. Трек можно выбрать из своей или общей
          музыки — тогда песня играет на экране зала; без трека ведущий включает её сам.
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
