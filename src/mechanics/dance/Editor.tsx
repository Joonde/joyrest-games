// Конструктор «Танцевального батла»: карточки Батл / Танец / Караоке, видео (файл или ссылка), трек.
import { useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { saveLocalVideo } from "../../components/media/localVideo";
import { TrackTimeline } from "../../components/music/TrackTimeline";
import { clipFields, parseClip } from "../../core/clip";
import type { EditorProps } from "../types";
import { DANCE_LIMITS, embedUrl, KIND_EMOJI, KIND_TITLES, newCard, type DanceCard, type DanceContent, type DanceKind, type VideoSource } from "./content";
import { validateDance } from "./validate";

const KINDS: DanceKind[] = ["dance", "karaoke", "battle"];

export function DanceEditor({ content, onChange, editable }: EditorProps<DanceContent>) {
  const [openId, setOpenId] = useState<string | null>(content.cards[0]?.id ?? null);
  const errors = validateDance(content);
  const latest = useRef(content);
  latest.current = content;
  const update = (id: string, patch: Partial<DanceCard> | ((c: DanceCard) => DanceCard)) =>
    onChange({ ...latest.current, cards: latest.current.cards.map((c) => (c.id === id ? (typeof patch === "function" ? patch(c) : { ...c, ...patch }) : c)) });

  return (
    <div className="stack">
      <section className="card">
        <h2>Как играем</h2>
        <p className="muted small">
          Команды по очереди выбирают карточку. Танец — на экране видео, команда повторяет движения. Караоке — видео с текстом, участник поёт. Батл — играет трек, выступают все команды. Танец и караоке оценивают другие команды, в батле капитаны голосуют за лучшую команду (за свою нельзя).
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Оценка от
            <ClampedNumber value={content.minRate} min={1} max={content.maxRate - 1} fallback={10} disabled={!editable} onChange={(minRate) => onChange({ ...content, minRate })} />
          </label>
          <label className="field">
            до
            <ClampedNumber value={content.maxRate} min={content.minRate + 1} max={1000} fallback={100} disabled={!editable} onChange={(maxRate) => onChange({ ...content, maxRate })} />
          </label>
        </div>
        <div className="row board-editor__size">
          <label className="field">
            Очки за победу в батле
            <ClampedNumber value={content.battlePoints} min={DANCE_LIMITS.minPoints} max={DANCE_LIMITS.maxPoints} fallback={100} disabled={!editable} onChange={(battlePoints) => onChange({ ...content, battlePoints })} />
          </label>
          <label className="field">
            Секунд на голосование
            <ClampedNumber value={content.voteTime} min={DANCE_LIMITS.minVote} max={DANCE_LIMITS.maxVote} fallback={30} disabled={!editable} onChange={(voteTime) => onChange({ ...content, voteTime })} />
          </label>
        </div>
      </section>

      <section className="stack">
        <h2>Карточки · {content.cards.length}</h2>
        {content.cards.map((card, i) => {
          const open = openId === card.id;
          const cardErrors = errors.filter((e) => e.path.startsWith(`cards/${card.id}/`));
          return (
            <article key={card.id} className={cardErrors.length ? "card dance-editor__card has-error" : "card dance-editor__card"}>
              <button type="button" className="dance-editor__head" aria-expanded={open} onClick={() => setOpenId(open ? null : card.id)}>
                <span aria-hidden="true">{KIND_EMOJI[card.kind]}</span>
                <strong>
                  {i + 1}. {KIND_TITLES[card.kind]}
                </strong>
                <span className="muted line-clamp">{card.title || "без названия"}</span>
              </button>
              {open && <CardForm card={card} editable={editable} errors={cardErrors.map((e) => e.message)} onChange={(p) => update(card.id, p)} onRemove={content.cards.length > 1 ? () => onChange({ ...content, cards: content.cards.filter((c) => c.id !== card.id) }) : undefined} />}
            </article>
          );
        })}
      </section>

      {editable && (
        <div className="row dance-editor__add">
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="tile"
              disabled={content.cards.length >= DANCE_LIMITS.cards}
              onClick={() => {
                const card = newCard(kind);
                onChange({ ...content, cards: [...content.cards, card] });
                setOpenId(card.id);
              }}
            >
              <span className="dance-editor__tile-emoji" aria-hidden="true">
                {KIND_EMOJI[kind]}
              </span>
              + {KIND_TITLES[kind]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CardForm({ card, editable, errors, onChange, onRemove }: { card: DanceCard; editable: boolean; errors: string[]; onChange: (p: Partial<DanceCard> | ((c: DanceCard) => DanceCard)) => void; onRemove?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const setSource = (source: VideoSource) => onChange({ video: { ...card.video, source } });
  return (
    <div className="stack stack--tight">
      <div className="seg" role="group" aria-label="Что это">
        {KINDS.map((kind) => (
          <button key={kind} type="button" className={card.kind === kind ? "seg__btn is-on" : "seg__btn"} aria-pressed={card.kind === kind} disabled={!editable} onClick={() => onChange({ kind })}>
            {KIND_EMOJI[kind]} {KIND_TITLES[kind]}
          </button>
        ))}
      </div>
      <label className="field">
        Название (видно на экране)
        <input value={card.title} maxLength={DANCE_LIMITS.title} disabled={!editable} placeholder={card.kind === "karaoke" ? "Песня — исполнитель" : card.kind === "dance" ? "Название танца" : "Тема батла"} onChange={(e) => onChange({ title: e.target.value })} />
      </label>
      <label className="field">
        Подсказка (необязательно)
        <input value={card.note} maxLength={DANCE_LIMITS.note} disabled={!editable} placeholder="Выходит вся команда / поёт один участник" onChange={(e) => onChange({ note: e.target.value })} />
      </label>

      <fieldset className="stack stack--tight">
        <legend>Видео {card.kind === "battle" ? "(для батла не обязательно)" : ""}</legend>
        <div className="seg" role="group" aria-label="Откуда видео">
          {(["link", "file", "none"] as const).map((s) => (
            <button key={s} type="button" className={card.video.source === s ? "seg__btn is-on" : "seg__btn"} aria-pressed={card.video.source === s} disabled={!editable} onClick={() => setSource(s)}>
              {s === "link" ? "Ссылка" : s === "file" ? "Файл" : "Без видео"}
            </button>
          ))}
        </div>
        {card.video.source === "link" && (
          <label className="field">
            Ссылка на YouTube, VK Видео или Rutube
            <input value={card.video.url} inputMode="url" maxLength={DANCE_LIMITS.url} disabled={!editable} placeholder="https://youtu.be/…" onChange={(e) => onChange({ video: { ...card.video, url: e.target.value.trim() } })} />
            {card.video.url && !embedUrl(card.video.url) && <span className="error small">Эту ссылку экран не откроет: нужна ссылка на ролик YouTube, VK Видео или Rutube.</span>}
            <span className="muted small">Ролик откроется прямо на экране зала — нужен интернет на площадке. Некоторые ролики запрещают показ на других сайтах — проверьте на репетиции.</span>
          </label>
        )}
        {card.video.source === "file" && (
          <div className="stack stack--tight">
            <p className="muted small">
              Видео на сервер не загружается: оно хранится только на устройстве, где открыт экран зала. Выберите файл здесь, если это тот же ноутбук или планшет, — или экран зала сам попросит выбрать его перед выступлением.
            </p>
            {card.video.name && <p className="small">Файл: {card.video.name}</p>}
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
                void saveLocalVideo(card.id, file)
                  .then(() => setSaved("Видео сохранено на этом устройстве"))
                  .catch(() => setSaved("Не получилось сохранить видео в браузере"));
                onChange({ video: { ...card.video, name: file.name.slice(0, 120) } });
              }}
            />
          </div>
        )}
      </fieldset>

      {(card.kind === "battle" || card.video.source === "none" || card.trackId) && (
        <TrackTimeline clip={parseClip(card)} disabled={!editable} onChange={(clip) => onChange((c) => ({ ...c, ...(clipFields(clip) as Partial<DanceCard>) }))} />
      )}

      {errors.map((m) => (
        <p key={m} className="error small">
          {m}
        </p>
      ))}
      {editable && onRemove && (
        <button type="button" className="btn btn--quiet btn--block" onClick={onRemove}>
          Убрать карточку
        </button>
      )}
    </div>
  );
}
