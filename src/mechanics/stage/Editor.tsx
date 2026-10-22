// Конструктор «Just Dance / Караоке на поле»: категории и плитки, у плитки — очки, кто выходит (или кто против кого),
// трек, задание и видео (ссылка или файл на устройстве экрана зала).
import { useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { Fold } from "../../components/Fold";
import { LibraryVideoPicker, videoSourceLabel, videoSources } from "../../components/media/libraryVideo";
import { saveLocalVideo } from "../../components/media/localVideo";
import type { EditorProps } from "../types";
import { embedUrl, type VideoSource } from "../dance/content";
import { newCategory, newTile, STAGE_LIMITS, tilesOf, VARIANT_TITLES, type StageContent, type StageTile, type StageVariant } from "./content";
import { DEMO_STAGE_DANCE, DEMO_STAGE_KARAOKE } from "./demo";
import { Dancers } from "./figures";
import { validateStage } from "./validate";
import { tileShort } from "./views";
import { VERSUS, WHO, WHO_GROUPS, versusOf, whoOf } from "./who";

export function StageEditor({ content, onChange, editable }: EditorProps<StageContent>) {
  const [openTile, setOpenTile] = useState<string | null>(null);
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  const errors = validateStage(content);
  const latest = useRef(content);
  latest.current = content;
  const set = (patch: Partial<StageContent>) => onChange({ ...latest.current, ...patch });
  const updateTile = (id: string, patch: Partial<StageTile>) => set({ tiles: latest.current.tiles.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const karaoke = content.variant === "karaoke";

  return (
    <div className="stack">
      <section className="card stack stack--tight">
        <h2>Что играем</h2>
        <div className="seg" role="group" aria-label="Вариант игры">
          {(["dance", "karaoke"] as StageVariant[]).map((v) => (
            <button key={v} type="button" className={content.variant === v ? "seg__btn is-on" : "seg__btn"} aria-pressed={content.variant === v} disabled={!editable} onClick={() => set({ variant: v })}>
              {VARIANT_TITLES[v]}
            </button>
          ))}
        </div>
        <p className="muted small">
          Поле как в «Своей игре»: команды по очереди называют категорию и очки, плитка переворачивается и показывает, кто выходит {karaoke ? "петь" : "танцевать"}, — и на экране зала включается видео. Вы управляете им с пульта: пауза, перемотка, на весь экран. Батл — зал голосует с телефонов, на экране перетягивание каната.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Зрительская симпатия, очков (0 — выключить)
            <ClampedNumber value={content.gift} min={0} max={STAGE_LIMITS.maxGift} fallback={50} disabled={!editable} onChange={(gift) => set({ gift })} />
          </label>
          <label className="field">
            Секунд на голосование в батле
            <ClampedNumber value={content.voteTime} min={STAGE_LIMITS.minVote} max={STAGE_LIMITS.maxVote} fallback={20} disabled={!editable} onChange={(voteTime) => set({ voteTime })} />
          </label>
        </div>
        <p className="muted small">Симпатия: зрители других команд дарят выступающим свои заработанные очки — у дарителя столько же снимается (в минус никто не уходит).</p>
        <label className="choice">
          <input type="checkbox" checked={content.battleLock} disabled={!editable} onChange={(e) => set({ battleLock: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Батлы — после того, как каждая команда выступила</span>
            <span className="choice__hint">Пока не выступили все, плитки батлов закрыты замком: в начале у команд нет очков на симпатию. Обычные плитки кончились — батлы открываются сами; на пульте можно открыть раньше.</span>
          </span>
        </label>
      </section>

      {editable && (
        <Fold title="Готовое поле" value={karaoke ? DEMO_STAGE_KARAOKE.title : DEMO_STAGE_DANCE.title}>
          <p className="muted small">4 категории по 5 плиток, все составы и батлы. Видео добавьте сами — ссылками или файлами.</p>
          {confirmTemplate ? (
            <div className="actions">
              <button
                type="button"
                className="btn btn--block"
                onClick={() => {
                  setConfirmTemplate(false);
                  // Новые id: видео-файлы на устройстве экрана хранятся по id плитки — у разных игр они не путаются.
                  const tpl = karaoke ? DEMO_STAGE_KARAOKE.content : DEMO_STAGE_DANCE.content;
                  const cats = new Map(tpl.categories.map((c) => [c.id, newCategory(c.title)]));
                  onChange({
                    ...tpl,
                    categories: [...cats.values()],
                    tiles: tpl.tiles.map((t) => ({ ...t, id: newTile(t.cat, t.points).id, cat: cats.get(t.cat)?.id ?? t.cat })),
                    gift: content.gift,
                    voteTime: content.voteTime,
                    battleLock: content.battleLock,
                  });
                }}
              >
                Да, заменить поле
              </button>
              <button type="button" className="btn btn--secondary btn--block" onClick={() => setConfirmTemplate(false)}>
                Не заменять
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setConfirmTemplate(true)}>
              Заполнить поле шаблоном
            </button>
          )}
        </Fold>
      )}

      {content.categories.map((cat, ci) => {
        const tiles = tilesOf(content, cat.id);
        const catError = errors.find((e) => e.path === `categories/${cat.id}/title`);
        return (
          <section key={cat.id} className="card stack stack--tight">
            <label className="field">
              Категория {ci + 1}
              <input value={cat.title} maxLength={STAGE_LIMITS.catTitle} disabled={!editable} placeholder={karaoke ? "Хиты, дуэты, батлы…" : "Активные, медленные, джаз-дэнс…"} onChange={(e) => set({ categories: latest.current.categories.map((c) => (c.id === cat.id ? { ...c, title: e.target.value } : c)) })} />
              {catError && <span className="error small">{catError.message}</span>}
            </label>
            <ul className="stage-editor__tiles">
              {tiles.map((tile) => {
                const open = openTile === tile.id;
                const tileErrors = errors.filter((e) => e.path.startsWith(`tiles/${tile.id}/`));
                return (
                  <li key={tile.id} className={tileErrors.length ? "stage-editor__tile has-error" : "stage-editor__tile"}>
                    <button type="button" className="stage-editor__head" aria-expanded={open} onClick={() => setOpenTile(open ? null : tile.id)}>
                      <strong>{tile.points}</strong>
                      <span className={tile.kind === "battle" ? "stage-editor__kind is-battle" : "stage-editor__kind"}>{tileShort(tile)}</span>
                      <span className="muted line-clamp">{tile.title || tile.note || "—"}</span>
                      <span className="muted small">{tile.video.source === "none" ? "без видео" : tile.video.source === "file" ? "файл" : tile.video.source === "server" ? "видео JoyRest" : "ссылка"}</span>
                    </button>
                    {open && (
                      <TileForm
                        tile={tile}
                        karaoke={karaoke}
                        editable={editable}
                        errors={tileErrors.map((e) => e.message)}
                        onChange={(p) => updateTile(tile.id, p)}
                        onRemove={() => set({ tiles: latest.current.tiles.filter((t) => t.id !== tile.id) })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            {editable && (
              <div className="row">
                {(["perform", "battle"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="btn btn--secondary"
                    disabled={tiles.length >= STAGE_LIMITS.perCategory}
                    onClick={() => {
                      const top = tiles.reduce((m, t) => Math.max(m, t.points), 0);
                      const t = newTile(cat.id, top + 100, kind);
                      set({ tiles: [...latest.current.tiles, t] });
                      setOpenTile(t.id);
                    }}
                  >
                    {kind === "battle" ? "+ Батл" : "+ Плитка"}
                  </button>
                ))}
                {content.categories.length > 1 && (
                  <button type="button" className="btn btn--quiet" onClick={() => set({ categories: latest.current.categories.filter((c) => c.id !== cat.id), tiles: latest.current.tiles.filter((t) => t.cat !== cat.id) })}>
                    Убрать категорию
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      {editable && content.categories.length < STAGE_LIMITS.categories && (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => {
            const c = newCategory("");
            set({ categories: [...latest.current.categories, c], tiles: [...latest.current.tiles, newTile(c.id, 100), newTile(c.id, 200), newTile(c.id, 300)] });
          }}
        >
          + Категория
        </button>
      )}
      {errors
        .filter((e) => e.path === "categories" || e.path === "tiles")
        .map((e) => (
          <p key={e.path} className="error small">
            {e.message}
          </p>
        ))}
    </div>
  );
}

function TileForm({ tile, karaoke, editable, errors, onChange, onRemove }: { tile: StageTile; karaoke: boolean; editable: boolean; errors: string[]; onChange: (p: Partial<StageTile>) => void; onRemove: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // В «Видео JoyRest» поле url — id видео: при переходе к нему или от него ссылка и id не смешиваются.
  const setSource = (source: VideoSource) => onChange({ video: (source === "server") === (tile.video.source === "server") ? { ...tile.video, source } : { source, url: "", name: "" } });
  const chip = (on: boolean) => (on ? "stage-chip is-on" : "stage-chip");
  return (
    <div className="stack stack--tight stage-editor__form">
      <div className="row board-editor__size">
        <label className="field">
          Очки
          <ClampedNumber value={tile.points} min={STAGE_LIMITS.minPoints} max={STAGE_LIMITS.maxPoints} fallback={100} disabled={!editable} onChange={(points) => onChange({ points })} />
        </label>
      </div>
      <div className="seg" role="group" aria-label="Что на плитке">
        <button type="button" className={tile.kind === "perform" ? "seg__btn is-on" : "seg__btn"} aria-pressed={tile.kind === "perform"} disabled={!editable} onClick={() => onChange({ kind: "perform" })}>
          Выступление
        </button>
        <button type="button" className={tile.kind === "battle" ? "seg__btn is-on" : "seg__btn"} aria-pressed={tile.kind === "battle"} disabled={!editable} onClick={() => onChange({ kind: "battle" })}>
          Батл
        </button>
      </div>
      {tile.kind === "perform" ? (
        <div className="stack stack--tight">
          <div className="stage-editor__preview">
            <Dancers figs={whoOf(tile.who).figs} karaoke={karaoke} />
            <span>{whoOf(tile.who).label}</span>
          </div>
          {WHO_GROUPS.map((g) => (
            <div key={g.id} className="stack stack--tight">
              <span className="stage-editor__group">{g.title}</span>
              <div className="stage-chips">
                {WHO.filter((w) => w.group === g.id).map((w) => (
                  <button key={w.id} type="button" className={chip(tile.who === w.id)} aria-pressed={tile.who === w.id} disabled={!editable} onClick={() => onChange({ who: w.id })}>
                    {w.short}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="stack stack--tight">
          <div className="stage-editor__preview">
            <Dancers figs={versusOf(tile.vs).left} karaoke={karaoke} />
            <strong>VS</strong>
            <Dancers figs={versusOf(tile.vs).right} karaoke={karaoke} />
          </div>
          <div className="stage-chips">
            {VERSUS.map((v) => (
              <button key={v.id} type="button" className={chip(tile.vs === v.id)} aria-pressed={tile.vs === v.id} disabled={!editable} onClick={() => onChange({ vs: v.id })}>
                {v.label}
              </button>
            ))}
          </div>
          <p className="muted small">Соперника выбираете на пульте, победителя — зал голосованием (ничья — очки пополам).</p>
        </div>
      )}
      <label className="field">
        {karaoke ? "Песня" : "Трек"} (по желанию, видно на экране)
        <input value={tile.title} maxLength={STAGE_LIMITS.title} disabled={!editable} placeholder="Название — исполнитель" onChange={(e) => onChange({ title: e.target.value })} />
      </label>
      <label className="field">
        Задание или подсказка (по желанию)
        <input value={tile.note} maxLength={STAGE_LIMITS.note} disabled={!editable} placeholder={karaoke ? "Команда — на подпевках" : "Повторяйте движения за экраном"} onChange={(e) => onChange({ note: e.target.value })} />
      </label>
      <fieldset className="stack stack--tight">
        <legend>Видео {karaoke ? "караоке" : "Just Dance"}</legend>
        <div className="seg" role="group" aria-label="Откуда видео">
          {videoSources().map((s) => (
            <button key={s} type="button" className={tile.video.source === s ? "seg__btn is-on" : "seg__btn"} aria-pressed={tile.video.source === s} disabled={!editable} onClick={() => setSource(s)}>
              {videoSourceLabel(s)}
            </button>
          ))}
        </div>
        {tile.video.source === "server" && (
          <LibraryVideoPicker value={tile.video.url} editable={editable} onPick={(v) => onChange({ video: { source: "server", url: v.id, name: v.title.slice(0, 120) } })} />
        )}
        {tile.video.source === "link" && (
          <label className="field">
            Ссылка на YouTube, VK Видео или Rutube
            <input value={tile.video.url} inputMode="url" maxLength={STAGE_LIMITS.url} disabled={!editable} placeholder="https://youtu.be/…" onChange={(e) => onChange({ video: { ...tile.video, url: e.target.value.trim() } })} />
            {tile.video.url && !embedUrl(tile.video.url) && <span className="error small">Эту ссылку экран не откроет: нужна ссылка на ролик YouTube, VK Видео или Rutube.</span>}
            <span className="muted small">Пауза и перемотка с пульта работают у YouTube и Rutube; у VK Видео — только «остановить» и «запустить заново». Проверьте ролик на репетиции: некоторые запрещают показ на других сайтах.</span>
          </label>
        )}
        {tile.video.source === "file" && (
          <div className="stack stack--tight">
            <p className="muted small">Видео на сервер не загружается: оно хранится только на устройстве, где открыт экран зала. Выберите файл здесь, если это тот же ноутбук, — или экран сам попросит выбрать его перед выступлением.</p>
            {tile.video.name && <p className="small">Файл: {tile.video.name}</p>}
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
                void saveLocalVideo(tile.id, file)
                  .then(() => setSaved("Видео сохранено на этом устройстве"))
                  .catch(() => setSaved("Не получилось сохранить видео в браузере"));
                onChange({ video: { ...tile.video, name: file.name.slice(0, 120) } });
              }}
            />
          </div>
        )}
      </fieldset>
      {errors.map((m) => (
        <p key={m} className="error small">
          {m}
        </p>
      ))}
      {editable && (
        <button type="button" className="btn btn--quiet btn--block" onClick={onRemove}>
          Убрать плитку
        </button>
      )}
    </div>
  );
}
