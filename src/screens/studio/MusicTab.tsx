import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { categoryTitle, durationLabel, LICENSE_TITLES, titleFromFile, TRACK_CATEGORIES } from "../../core/music";
import { permissions, tracksRepo, useLoad, type Track, type TrackCategory, type TrackLicense, type UserProfile } from "../../data";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ActionMenu, type MenuAction } from "../../components/Menu";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { audioDuration, usePreview } from "../../components/music/usePreview";

const MAX_BYTES = 15 * 1024 * 1024;
const LICENSES: TrackLicense[] = ["pixabay", "bought", "own", "other"];
const EMPTY = { mine: [] as Track[], library: [] as Track[] };
const NONE: Track[] = [];

function newTrackId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "t" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

const SHARE_LABELS: Record<Track["shareStatus"], string | null> = {
  none: null,
  pending: "На проверке",
  accepted: "В общей библиотеке",
  rejected: "Отклонён",
};

/**
 * Вкладка «Музыка» в студии (CLAUDE.md, раздел 7, «Музыка»): загрузка своих треков, общая
 * библиотека JoyRest и проверка предложенных треков у владельца.
 */
export function MusicTab({ profile, onToast }: { profile: UserProfile; onToast: (text: string) => void }) {
  const repo = tracksRepo;
  const [state, retry, update] = useLoad(() => (repo ? repo.list() : Promise.resolve(EMPTY)), [repo]);
  const reviewer = permissions.canReviewTracks(profile);
  const [pending, , updatePending] = useLoad(() => (repo && reviewer ? repo.listPending() : Promise.resolve(NONE)), [repo, reviewer]);
  const preview = usePreview();
  const [toDelete, setToDelete] = useState<Track | null>(null);
  const [toReject, setToReject] = useState<Track | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (!repo) return <p className="muted">Музыка доступна на своём сервере JoyRest.</p>;

  const replace = (track: Track) =>
    update((data) => ({
      mine: data.mine.map((t) => (t.id === track.id ? track : t)),
      library: data.library.map((t) => (t.id === track.id ? track : t)),
    }));

  async function share(track: Track) {
    if (!repo) return;
    try {
      replace(await repo.share(track.id));
      onToast("Трек отправлен владельцу JoyRest на проверку");
    } catch {
      onToast("Не удалось отправить. Проверьте интернет.");
    }
  }

  async function remove() {
    if (!repo || !toDelete) return;
    setBusy(true);
    setDialogError(null);
    try {
      await repo.remove(toDelete.id);
      const id = toDelete.id;
      update((data) => ({ mine: data.mine.filter((t) => t.id !== id), library: data.library.filter((t) => t.id !== id) }));
      setToDelete(null);
      onToast("Трек удалён");
    } catch {
      setDialogError("Не удалось удалить. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  async function accept(track: Track) {
    if (!repo) return;
    try {
      await repo.accept(track.id);
      updatePending((list) => list.filter((t) => t.id !== track.id));
      retry();
      onToast(`«${track.title}» в общей библиотеке`);
    } catch {
      onToast("Не удалось принять. Проверьте интернет.");
    }
  }

  async function reject() {
    if (!repo || !toReject) return;
    setBusy(true);
    setDialogError(null);
    try {
      await repo.reject(toReject.id, reason.trim());
      const id = toReject.id;
      updatePending((list) => list.filter((t) => t.id !== id));
      setToReject(null);
      onToast("Трек отклонён");
    } catch {
      setDialogError("Не удалось отклонить. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  function row(track: Track, actions: MenuAction[], extra?: ReactNode) {
    const label = SHARE_LABELS[track.shareStatus];
    return (
      <li key={track.id} className="track">
        <button
          type="button"
          className="btn btn--secondary track__play"
          aria-label={preview.playing === track.id ? `Остановить «${track.title}»` : `Прослушать «${track.title}»`}
          disabled={!track.ready || preview.loading === track.id}
          onClick={() => preview.toggle(track.id)}
        >
          {preview.loading === track.id ? "…" : preview.playing === track.id ? "■" : "▶"}
        </button>
        <div className="track__text">
          <p className="track__title line-clamp">{track.title}</p>
          <ul className="meta" aria-label="О треке">
            <li>{categoryTitle(track.category)}</li>
            {track.durationMs ? <li>{durationLabel(track.durationMs)}</li> : null}
            {!track.ready && <li className="meta__warn">Файл не загружен</li>}
            {label && <li className={track.shareStatus === "rejected" ? "meta__warn" : undefined}>{label}</li>}
            {reviewer && track.ownerName && track.scope === "personal" && <li>{track.ownerName}</li>}
          </ul>
          {track.shareStatus === "rejected" && track.shareReason && <p className="muted small">Причина: {track.shareReason}</p>}
          {extra}
        </div>
        {actions.length > 0 && <ActionMenu icon="dots" label={`Действия с треком «${track.title}»`} actions={actions} />}
      </li>
    );
  }

  const data = state.status === "ready" ? state.data : null;

  return (
    <>
      {(permissions.canUploadTrack(profile, "personal") || permissions.canUploadTrack(profile, "agency")) && <UploadCard
        profile={profile}
        onUploaded={(track) => {
          update((d) => (track.scope === "agency" ? { ...d, library: [track, ...d.library] } : { ...d, mine: [track, ...d.mine] }));
          onToast("Трек загружен");
        }}
      />}
      {preview.error && (
        <p className="error" role="alert">
          Не удалось включить трек. Проверьте интернет.
        </p>
      )}

      {reviewer && pending.status === "ready" && pending.data.length > 0 && (
        <section className="card" aria-labelledby="tracks-pending">
          <h2 id="tracks-pending">Треки на проверку: {pending.data.length}</h2>
          <p className="muted">Послушайте и проверьте, откуда права. Принятый трек увидят все ведущие.</p>
          <ul className="tracks">
            {pending.data.map((t) =>
              row(
                t,
                [],
                <>
                  <p className="muted small">Права: {LICENSE_TITLES[t.license]}{t.licenseNote ? ` — ${t.licenseNote}` : ""}</p>
                  <div className="actions">
                    <button type="button" className="btn btn--block" onClick={() => void accept(t)}>
                      Принять в общую
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet btn--block"
                      onClick={() => {
                        setReason("");
                        setDialogError(null);
                        setToReject(t);
                      }}
                    >
                      Отклонить
                    </button>
                  </div>
                </>,
              ),
            )}
          </ul>
        </section>
      )}

      {state.status === "loading" && <ListSkeleton />}
      {state.status === "error" && <LoadFailedInline onRetry={retry} />}
      {data && (
        <>
          <section className="card" aria-labelledby="tracks-mine">
            <h2 id="tracks-mine">Мои треки</h2>
            {data.mine.length === 0 ? (
              <p className="muted">Пока пусто. Загрузите трек — он появится на пульте в плеере.</p>
            ) : (
              <ul className="tracks">
                {data.mine.map((t) => {
                  const actions: MenuAction[] = [];
                  if (t.ready && permissions.canShareTrack(profile, t) && (t.shareStatus === "none" || t.shareStatus === "rejected")) {
                    actions.push({ label: "Предложить в общую", onClick: () => void share(t) });
                  }
                  actions.push({ label: "Удалить", onClick: () => setToDelete(t) });
                  return row(t, actions);
                })}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="tracks-library">
            <h2 id="tracks-library">Общая музыка JoyRest</h2>
            {data.library.length === 0 ? (
              <p className="muted">Здесь появятся треки, которые одобрил владелец JoyRest.</p>
            ) : (
              <ul className="tracks">
                {data.library.map((t) =>
                  row(t, permissions.canEditTrack(profile, t) ? [{ label: "Удалить из общей", onClick: () => setToDelete(t) }] : []),
                )}
              </ul>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Удалить трек?"
        confirmLabel="Удалить трек"
        busy={busy}
        error={dialogError}
        onConfirm={() => void remove()}
        onCancel={() => setToDelete(null)}
      >
        <p>
          «{toDelete?.title}» пропадёт {toDelete?.scope === "agency" ? "из общей музыки у всех ведущих" : "из ваших треков"}.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={toReject !== null}
        title="Отклонить трек?"
        confirmLabel="Отклонить"
        busy={busy}
        error={dialogError}
        onConfirm={() => void reject()}
        onCancel={() => setToReject(null)}
      >
        <p>«{toReject?.title}» не попадёт в общую музыку. Ведущий увидит отказ и причину.</p>
        <label className="field">
          Причина для ведущего (необязательно)
          <textarea maxLength={300} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </ConfirmDialog>
    </>
  );
}

function UploadCard({ profile, onUploaded }: { profile: UserProfile; onUploaded: (track: Track) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<TrackCategory>("background");
  const [license, setLicense] = useState<TrackLicense | null>(null);
  const [note, setNote] = useState("");
  const [toLibrary, setToLibrary] = useState(permissions.canUploadTrack(profile, "agency"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canLibrary = permissions.canUploadTrack(profile, "agency");

  function pick(next: File | null) {
    setError(null);
    if (!next) return;
    if (next.size > MAX_BYTES) {
      setError("Файл больше 15 МБ. Возьмите mp3 поменьше или обрежьте трек.");
      return;
    }
    setFile(next);
    setTitle(titleFromFile(next.name));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!tracksRepo || !file) return;
    if (!title.trim()) return setError("Напишите название трека.");
    if (!license) return setError("Отметьте, откуда у вас права на трек.");
    if (license === "other" && !note.trim()) return setError("Напишите, откуда трек и почему его можно использовать.");
    setBusy(true);
    setError(null);
    try {
      const id = newTrackId();
      await tracksRepo.create({ id, scope: canLibrary && toLibrary ? "agency" : "personal", title: title.trim(), category, license, licenseNote: note.trim() });
      const track = await tracksRepo.upload(id, file, await audioDuration(file));
      onUploaded(track);
      setFile(null);
      setTitle("");
      setLicense(null);
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
      setError(
        code === "invalid-argument"
          ? "Это не похоже на mp3, m4a или ogg. Выберите другой файл."
          : code === "resource-exhausted"
            ? "Место для музыки закончилось. Удалите старые треки."
            : "Не удалось загрузить. Проверьте интернет и попробуйте снова.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="upload-track">
      <h2 id="upload-track">Музыка</h2>
      <p className="muted">
        Треки для лобби, фона, конкурсов и награждения. Они играют на экране зала по кнопке с пульта. Загружайте только
        музыку с чистыми правами: Pixabay, купленную с лицензией или свою.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,.mp3,.m4a,.ogg"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      {!file ? (
        <div className="actions">
          <button type="button" className="btn btn--block" onClick={() => fileRef.current?.click()}>
            Загрузить трек
          </button>
        </div>
      ) : (
        <form className="stack" onSubmit={(e) => void submit(e)}>
          <p className="small line-clamp">Файл: {file.name}</p>
          <label className="field">
            Название
            <input maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            Для чего
            <select value={category} onChange={(e) => setCategory(e.target.value as TrackCategory)}>
              {TRACK_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} — {c.hint.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Откуда права на трек</legend>
            {LICENSES.map((id) => (
              <label key={id} className="choice">
                <input type="radio" name="track-license" checked={license === id} onChange={() => setLicense(id)} />
                <span className="choice__text">
                  <span className="choice__title">{LICENSE_TITLES[id]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {license === "other" && (
            <label className="field">
              Откуда трек
              <input maxLength={200} value={note} placeholder="Например: заказан у композитора для JoyRest" onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          {canLibrary && (
            <label className="choice">
              <input type="checkbox" checked={toLibrary} onChange={(e) => setToLibrary(e.target.checked)} />
              <span className="choice__text">
                <span className="choice__title">Сразу в общую музыку JoyRest</span>
                <span className="choice__hint">Трек увидят все ведущие</span>
              </span>
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button type="submit" className="btn btn--block" disabled={busy}>
              {busy ? "Загружаем…" : "Загрузить"}
            </button>
            <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => setFile(null)}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {!file && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
