/**
 * «Видео» в студии (решение владельца 15 октября 2026): видео JoyRest на сервере — для «Just Dance и Караоке на поле»,
 * «Танцевального батла» и музыкального лото. Видят все, кто работает с играми; владелец и заместитель загружают
 * (сразу несколько файлов — по очереди, с дозагрузкой после обрыва), переименовывают, раскладывают по папкам, убирают.
 */
import { useRef, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Fold } from "../../components/Fold";
import { ActionMenu, type MenuAction } from "../../components/Menu";
import { SearchField } from "../../components/SearchField";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { formatBytes, formatDuration, MAX_VIDEO_BYTES, UploadProgress, uploadVideo, VIDEO_ACCEPT, videoErrorText, videosByFolder } from "../../components/media/libraryVideo";
import { matchesSearch } from "../../core/search";
import { permissions, useLoad, videosRepo, type LibraryVideo, type UserProfile } from "../../data";

interface Props {
  profile: UserProfile;
  onToast: (text: string) => void;
}

interface QueueItem {
  key: string;
  file: File;
  received: number;
  error: string | null;
}

const EMPTY = { videos: [] as LibraryVideo[], usedBytes: 0 };

export function VideoTab({ profile, onToast }: Props) {
  const repo = videosRepo;
  const [state, retry, update] = useLoad(() => (repo ? repo.list() : Promise.resolve(EMPTY)), [repo]);
  const canUpload = permissions.canUploadVideo(profile);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const running = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [watching, setWatching] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ video: LibraryVideo; title: string; folder: string } | null>(null);
  const [toDelete, setToDelete] = useState<LibraryVideo | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (!repo) return null;

  const replace = (video: LibraryVideo) => update((d) => ({ ...d, videos: [...d.videos.filter((v) => v.id !== video.id), video] }));

  /** Файлы — по одному: загрузка видео тяжёлая, параллельно только мешали бы друг другу. */
  async function runQueue(items: QueueItem[]) {
    if (running.current) return;
    running.current = true;
    try {
      for (const item of items) {
        if (item.error === "done") continue;
        try {
          const video = await uploadVideo(item.file, {
            folder: folder.trim(),
            onProgress: (received) => setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, received, error: null } : x))),
          });
          replace(video);
          setQueue((q) => q.filter((x) => x.key !== item.key));
          onToast(`Видео «${video.title}» загружено`);
        } catch (e) {
          setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, error: videoErrorText(e) } : x)));
        }
      }
    } finally {
      running.current = false;
    }
  }

  function pick(files: FileList | null) {
    if (fileRef.current) fileRef.current.value = "";
    if (!files || files.length === 0) return;
    const added: QueueItem[] = [...files].map((file) => ({
      key: `${file.name}|${file.size}|${file.lastModified}`,
      file,
      received: 0,
      error: file.size > MAX_VIDEO_BYTES ? "Файл больше 1 ГБ. Сожмите видео (720p, MP4) и загрузите снова." : null,
    }));
    const next = [...queue.filter((q) => !added.some((a) => a.key === q.key)), ...added];
    setQueue(next);
    void runQueue(next.filter((q) => q.error === null));
  }

  async function saveEdit() {
    if (!editing || !repo) return;
    setBusy(true);
    setDialogError(null);
    try {
      replace(await repo.update(editing.video.id, { title: editing.title.trim(), folder: editing.folder.trim() }));
      setEditing(null);
      onToast("Сохранено");
    } catch {
      setDialogError("Не получилось сохранить. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!toDelete || !repo) return;
    setBusy(true);
    setDialogError(null);
    try {
      await repo.remove(toDelete.id);
      update((d) => ({ ...d, videos: d.videos.filter((v) => v.id !== toDelete.id) }));
      onToast(`Видео «${toDelete.title}» убрано`);
      setToDelete(null);
    } catch {
      setDialogError("Не получилось убрать видео. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  function row(video: LibraryVideo) {
    const actions: MenuAction[] = canUpload
      ? [
          { label: "Название и папка", onClick: () => { setDialogError(null); setEditing({ video, title: video.title, folder: video.folder }); } },
          // Убрать видео у всех — владелец агентства; заместитель — только своё.
          ...(permissions.isAdmin(profile) || video.ownerId === profile.uid ? [{ label: "Убрать видео", onClick: () => { setDialogError(null); setToDelete(video); } }] : []),
        ]
      : [];
    return (
      <li key={video.id} className="track">
        <button
          type="button"
          className="btn btn--secondary track__play"
          aria-label={watching === video.id ? `Скрыть «${video.title}»` : `Посмотреть «${video.title}»`}
          disabled={!video.ready}
          onClick={() => setWatching(watching === video.id ? null : video.id)}
        >
          {watching === video.id ? "■" : "▶"}
        </button>
        <div className="track__text">
          <p className="track__title line-clamp">{video.title}</p>
          <ul className="meta" aria-label="О видео">
            {video.durationMs ? <li>{formatDuration(video.durationMs)}</li> : null}
            <li>{formatBytes(video.size)}</li>
            {query.trim() && video.folder && <li>📁 {video.folder}</li>}
            {!video.ready && <li className="meta__warn">Загружено {Math.floor((video.received / Math.max(1, video.size)) * 100)}% — выберите тот же файл, чтобы догрузить</li>}
          </ul>
          {watching === video.id && repo && (
            <video className="video-tab__player" src={repo.fileUrl(video.id)} controls playsInline autoPlay preload="metadata" />
          )}
        </div>
        {actions.length > 0 && <ActionMenu icon="dots" label={`Действия с видео «${video.title}»`} actions={actions} />}
      </li>
    );
  }

  const data = state.status === "ready" ? state.data : null;
  const found = data && query.trim() ? data.videos.filter((v) => matchesSearch([v.title, v.folder], query)) : null;
  const folders = data ? [...new Set(data.videos.map((v) => v.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")) : [];

  return (
    <div className="stack">
      <p className="muted">
        Видео для «Just Dance и Караоке на поле», «Танцевального батла» и музыкального лото. Видео лежит на сервере JoyRest: в игре выберите «Видео JoyRest» — экран зала
        возьмёт его сам.
        {canUpload ? " Загружают владелец и заместитель, видят все ведущие." : " Загружают владелец и заместитель."}
      </p>

      {canUpload && (
        <div className="card stack stack--tight">
          <h3>Загрузить видео</h3>
          <label className="field">
            Папка (по желанию)
            <input value={folder} maxLength={40} list="video-folders" placeholder="Just Dance, Караоке, Батлы…" onChange={(e) => setFolder(e.target.value)} />
            <datalist id="video-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <input ref={fileRef} type="file" accept={VIDEO_ACCEPT} multiple className="visually-hidden" tabIndex={-1} onChange={(e) => pick(e.target.files)} />
          <button type="button" className="btn btn--block" onClick={() => fileRef.current?.click()}>
            ⬆ Выбрать видео (можно сразу несколько)
          </button>
          <p className="muted small">
            MP4 (лучше всего), MOV или WebM, до 1 ГБ. Сжимать не обязательно, но 720p грузится в разы быстрее и места на сервере хватит на сотни роликов. Файлы
            уходят по очереди; связь оборвалась — выберите тот же файл ещё раз, загрузка продолжится с того же места. Не закрывайте вкладку, пока идёт загрузка.
          </p>
          {queue.length > 0 && (
            <ul className="stack stack--tight video-queue">
              {queue.map((q) => (
                <li key={q.key} className="stack stack--tight">
                  <UploadProgress received={q.received} size={q.file.size} label={q.file.name} />
                  {q.error && (
                    <p className="error small" role="alert">
                      {q.error}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data && <p className="muted small">Все видео занимают {formatBytes(data.usedBytes)}.</p>}
        </div>
      )}

      {state.status === "loading" && <ListSkeleton />}
      {state.status === "error" && <LoadFailedInline onRetry={retry} />}
      {data && data.videos.length === 0 && <p className="muted">Видео пока нет.</p>}
      {data && data.videos.length > 0 && (
        <>
          <SearchField label="Поиск видео" value={query} placeholder="Название или папка" candidates={data.videos.flatMap((v) => [v.title, v.folder])} onChange={setQuery} />
          {found ? (
            found.length === 0 ? (
              <p className="muted">Ничего не нашлось.</p>
            ) : (
              <ul className="tracks">{found.map(row)}</ul>
            )
          ) : (
            videosByFolder(data.videos).map((g) =>
              g.folder ? (
                <Fold key={g.folder} title={`📁 ${g.folder}`} value={`${g.videos.length}`}>
                  <ul className="tracks">{g.videos.map(row)}</ul>
                </Fold>
              ) : (
                <ul key="" className="tracks">
                  {g.videos.map(row)}
                </ul>
              ),
            )
          )}
        </>
      )}

      <ConfirmDialog
        open={editing !== null}
        title="Название и папка"
        confirmLabel="Сохранить"
        busy={busy}
        error={dialogError}
        onConfirm={() => void saveEdit()}
        onCancel={() => setEditing(null)}
      >
        {editing && (
          <div className="stack stack--tight">
            <label className="field">
              Название
              <input value={editing.title} maxLength={120} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </label>
            <label className="field">
              Папка (пусто — без папки)
              <input value={editing.folder} maxLength={40} list="video-folders-edit" onChange={(e) => setEditing({ ...editing, folder: e.target.value })} />
              <datalist id="video-folders-edit">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={toDelete !== null}
        title="Убрать видео?"
        confirmLabel="Убрать видео"
        busy={busy}
        error={dialogError}
        onConfirm={() => void remove()}
        onCancel={() => setToDelete(null)}
      >
        <p>«{toDelete?.title}» пропадёт у всех ведущих. В играх, где оно стоит, экран зала покажет, что видео нет, — там выберите другое.</p>
      </ConfirmDialog>
    </div>
  );
}
