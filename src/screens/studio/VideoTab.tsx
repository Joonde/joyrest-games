/**
 * «Видео» в студии (решение владельца 15 октября 2026): видео JoyRest на сервере — для «Танцуй как звезда и Караоке на поле»,
 * «Танцевального батла» и музыкального лото. Видят все, кто работает с играми; владелец и заместитель загружают
 * (сразу несколько файлов — по очереди, с дозагрузкой после обрыва), переименовывают, раскладывают по папкам, убирают.
 * Папки — как у «Музыки» (решение владельца 15 октября 2026): «+ Новая папка» (можно пустую), у видео «⋯ → В папку»,
 * у папки «Переименовать папку» (видео переезжают) и «Удалить папку» (видео остаются без папки).
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

const EMPTY = { videos: [] as LibraryVideo[], usedBytes: 0, folders: [] as string[] };

const FOLDER_HINT = "Например: Танцы, Караоке, Батлы";

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
  const [editing, setEditing] = useState<{ video: LibraryVideo; title: string } | null>(null);
  /** Видео, которое кладём в папку. */
  const [moveFor, setMoveFor] = useState<LibraryVideo | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removingFolder, setRemovingFolder] = useState<{ name: string; count: number } | null>(null);
  const [toDelete, setToDelete] = useState<LibraryVideo | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (!repo) return null;

  const replace = (video: LibraryVideo) =>
    update((d) => ({
      ...d,
      videos: [...d.videos.filter((v) => v.id !== video.id), video],
      folders: video.folder && !(d.folders ?? []).includes(video.folder) ? [...(d.folders ?? []), video.folder] : d.folders,
    }));

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

  function pick(fileList: FileList | null) {
    // Сначала забираем файлы: очистка поля в некоторых браузерах опустошает и сам список.
    const files = fileList ? [...fileList] : [];
    if (fileRef.current) fileRef.current.value = "";
    if (files.length === 0) return;
    const added: QueueItem[] = files.map((file) => ({
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
      replace(await repo.update(editing.video.id, { title: editing.title.trim() }));
      setEditing(null);
      onToast("Сохранено");
    } catch {
      setDialogError("Не получилось сохранить. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  async function saveFolder() {
    if (!moveFor || !repo) return;
    setBusy(true);
    setDialogError(null);
    try {
      const target = folderDraft.trim();
      replace(await repo.update(moveFor.id, { folder: target }));
      setMoveFor(null);
      onToast(target ? `Видео в папке «${target}»` : "Видео без папки");
    } catch {
      setDialogError("Не получилось переложить видео. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  /** Создать, переименовать или удалить папку: сервер сам переносит её видео, список перечитываем. */
  async function folderAction(run: () => Promise<unknown>, done: () => void, toast: string) {
    setBusy(true);
    setDialogError(null);
    try {
      await run();
      done();
      retry();
      onToast(toast);
    } catch {
      setDialogError("Не получилось. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  function createFolder() {
    if (!repo) return;
    const name = folderDraft.trim();
    if (!name) return setDialogError("Напишите название папки.");
    void folderAction(() => repo.createFolder(name), () => setCreating(false), `Папка «${name}» создана`);
  }

  function renameFolder() {
    if (!repo || !renaming) return;
    const from = renaming;
    const to = folderDraft.trim();
    if (!to) return setDialogError("Напишите название. Чтобы убрать папку — «Удалить папку».");
    if (to === from) return setRenaming(null);
    void folderAction(() => repo.renameFolder(from, to), () => setRenaming(null), `Папка теперь «${to}»`);
  }

  function deleteFolder() {
    if (!repo || !removingFolder) return;
    const { name } = removingFolder;
    void folderAction(() => repo.deleteFolder(name), () => setRemovingFolder(null), `Папка «${name}» удалена, видео остались`);
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
    // Чужое видео переименовать, переложить и убрать может только владелец агентства; заместитель — только своё
    // (так же проверяет сервер, QA 22 октября 2026).
    const mine = permissions.isAdmin(profile) || video.ownerId === profile.uid;
    const actions: MenuAction[] =
      canUpload && mine
        ? [
            { label: "Название", onClick: () => { setDialogError(null); setEditing({ video, title: video.title }); } },
            {
              label: video.folder ? "Другая папка" : "В папку",
              onClick: () => {
                setDialogError(null);
                setFolderDraft(video.folder);
                setMoveFor(video);
              },
            },
            { label: "Убрать видео", onClick: () => { setDialogError(null); setToDelete(video); } },
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
  const folders = data ? [...new Set([...data.videos.map((v) => v.folder), ...(data.folders ?? [])].filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")) : [];
  const groups = data ? videosByFolder(data.videos) : [];
  const loose = groups.find((g) => g.folder === "")?.videos ?? [];

  return (
    <div className="stack">
      <p className="muted">
        Видео для «Танцуй как звезда и Караоке на поле», «Танцевального батла» и музыкального лото. Видео лежит на сервере JoyRest: в игре выберите «Видео JoyRest» — экран зала
        возьмёт его сам.
        {canUpload ? " Загружают владелец и заместитель, видят все ведущие." : " Загружают владелец и заместитель."}
      </p>

      {canUpload && (
        <div className="card stack stack--tight">
          <h3>Загрузить видео</h3>
          {folders.length > 0 && (
            <div className="pick-chips" role="group" aria-label="В какую папку загружать">
              <button type="button" className="pick-chip" aria-pressed={folder.trim() === ""} onClick={() => setFolder("")}>
                Без папки
              </button>
              {folders.map((f) => (
                <button key={f} type="button" className="pick-chip" aria-pressed={folder.trim() === f} onClick={() => setFolder(f)}>
                  📁 {f}
                </button>
              ))}
            </div>
          )}
          <label className="field">
            {folders.length > 0 ? "Или новая папка" : "Папка (по желанию)"}
            <input value={folder} maxLength={40} placeholder={FOLDER_HINT} onChange={(e) => setFolder(e.target.value)} />
          </label>
          <input ref={fileRef} type="file" accept={VIDEO_ACCEPT} multiple className="visually-hidden visually-hidden--pinned" tabIndex={-1} onChange={(e) => pick(e.target.files)} />
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
      {data && data.videos.length === 0 && folders.length === 0 && <p className="muted">Видео пока нет.</p>}
      {data && (data.videos.length > 0 || folders.length > 0) && (
        <>
          <SearchField label="Поиск видео" value={query} placeholder="Название или папка" candidates={data.videos.flatMap((v) => [v.title, v.folder])} onChange={setQuery} />
          {found ? (
            found.length === 0 ? (
              <p className="muted">Ничего не нашлось.</p>
            ) : (
              <ul className="tracks">{found.map(row)}</ul>
            )
          ) : (
            <>
              {canUpload && (
                <>
                  <p className="muted small">Разложите видео по папкам: «+ Новая папка», потом у видео «⋯ → В папку».</p>
                  <button
                    type="button"
                    className="btn btn--secondary btn--block"
                    onClick={() => {
                      setFolderDraft("");
                      setDialogError(null);
                      setCreating(true);
                    }}
                  >
                    + Новая папка
                  </button>
                </>
              )}
              {folders.map((name) => {
                const items = groups.find((g) => g.folder === name)?.videos ?? [];
                return (
                  <Fold key={name} title={`📁 ${name}`} value={`${items.length}`}>
                    {items.length === 0 ? (
                      <p className="muted small">{canUpload ? "Пустая папка. Положите видео: у видео «⋯ → В папку» или выберите папку перед загрузкой." : "Пустая папка."}</p>
                    ) : (
                      <ul className="tracks">{items.map(row)}</ul>
                    )}
                    {canUpload && (
                      <div className="actions">
                        <button
                          type="button"
                          className="btn btn--quiet btn--block"
                          onClick={() => {
                            setFolderDraft(name);
                            setDialogError(null);
                            setRenaming(name);
                          }}
                        >
                          Переименовать папку
                        </button>
                        <button
                          type="button"
                          className="btn btn--quiet btn--block"
                          onClick={() => {
                            setDialogError(null);
                            setRemovingFolder({ name, count: items.length });
                          }}
                        >
                          Удалить папку
                        </button>
                      </div>
                    )}
                  </Fold>
                );
              })}
              {loose.length > 0 && <ul className="tracks">{loose.map(row)}</ul>}
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={editing !== null}
        title="Название видео"
        confirmLabel="Сохранить"
        busy={busy}
        error={dialogError}
        onConfirm={() => void saveEdit()}
        onCancel={() => setEditing(null)}
      >
        {editing && (
          <label className="field">
            Название
            <input value={editing.title} maxLength={120} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </label>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={moveFor !== null}
        title="В какую папку?"
        confirmLabel="Готово"
        busy={busy}
        error={dialogError}
        onConfirm={() => void saveFolder()}
        onCancel={() => setMoveFor(null)}
      >
        {moveFor && (
          <div className="stack stack--tight">
            <p className="muted small">«{moveFor.title}»</p>
            <div className="pick-chips" role="group" aria-label="Папки">
              {folders.map((name) => (
                <button key={name} type="button" className="pick-chip" aria-pressed={folderDraft.trim() === name} onClick={() => setFolderDraft(name)}>
                  📁 {name}
                </button>
              ))}
              <button type="button" className="pick-chip" aria-pressed={folderDraft.trim() === ""} onClick={() => setFolderDraft("")}>
                Без папки
              </button>
            </div>
            <label className="field">
              Или новая папка
              <input maxLength={40} placeholder={FOLDER_HINT} value={folderDraft} onChange={(e) => setFolderDraft(e.target.value)} />
            </label>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={creating}
        title="Новая папка"
        confirmLabel="Создать"
        busy={busy}
        error={dialogError}
        onConfirm={createFolder}
        onCancel={() => setCreating(false)}
      >
        <label className="field">
          Название папки
          <input maxLength={40} placeholder={FOLDER_HINT} value={folderDraft} onChange={(e) => setFolderDraft(e.target.value)} />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={renaming !== null}
        title="Переименовать папку"
        confirmLabel="Сохранить"
        busy={busy}
        error={dialogError}
        onConfirm={renameFolder}
        onCancel={() => setRenaming(null)}
      >
        <label className="field">
          Новое название
          <input maxLength={40} value={folderDraft} onChange={(e) => setFolderDraft(e.target.value)} />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={removingFolder !== null}
        title="Удалить папку?"
        confirmLabel="Удалить папку"
        busy={busy}
        error={dialogError}
        onConfirm={deleteFolder}
        onCancel={() => setRemovingFolder(null)}
      >
        <p>
          Папка «{removingFolder?.name}» пропадёт.{" "}
          {removingFolder && removingFolder.count > 0 ? `Её видео (${removingFolder.count}) не удалятся — останутся без папки.` : "Она пустая."}
        </p>
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
