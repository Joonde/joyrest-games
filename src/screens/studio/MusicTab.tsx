import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { categoryTitle, durationLabel, folderNames, groupByFolder, LICENSE_TITLES, titleFromFile, TRACK_CATEGORIES } from "../../core/music";
import { matchesSearch } from "../../core/search";
import { Fold } from "../../components/Fold";
import { SearchField } from "../../components/SearchField";
import { isClipped, permissions, tracksRepo, useLoad, type Track, type TrackCategory, type TrackClip, type TrackUsage, type UserProfile } from "../../data";
import { TrackUsageLine } from "../../components/media/SpaceUsage";
import { TrackClipEditor } from "../../components/music/TrackClipEditor";
import { forgetTracks } from "../../components/music/TrackPicker";

function clipLabel(clip: TrackClip): string {
  const t = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  return `${t(clip.start)}–${clip.end === null ? "конец" : t(clip.end)}`;
}
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ActionMenu, type MenuAction } from "../../components/Menu";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { uploadErrorText } from "../../components/music/uploadTrack";
import { audioDuration, usePreview } from "../../components/music/usePreview";

const MAX_BYTES = 15 * 1024 * 1024;
const SOURCE_MAX = 200;

/** «Откуда трек»: ссылка открывается в новой вкладке, остальное — просто текст. */
function TrackSource({ text }: { text: string }) {
  const value = text.trim();
  if (!value) return null;
  const url = /^https?:\/\/\S+$/i.test(value) ? value : null;
  return (
    <p className="muted small line-clamp">
      Откуда:{" "}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {value.replace(/^https?:\/\/(www\.)?/i, "")}
        </a>
      ) : (
        value
      )}
    </p>
  );
}
const EMPTY = { mine: [] as Track[], library: [] as Track[], folders: { mine: [] as string[], library: [] as string[] }, usage: undefined as TrackUsage | undefined };
const NONE: Track[] = [];

type Scope = "personal" | "agency";

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
  /** Трек, у которого открыт редактор отрезка. */
  const [clipFor, setClipFor] = useState<string | null>(null);
  /** Трек, у которого правят «Откуда трек». */
  const [sourceFor, setSourceFor] = useState<Track | null>(null);
  const [sourceDraft, setSourceDraft] = useState("");
  /** Поиск по всем трекам и папкам. */
  const [query, setQuery] = useState("");
  /** Трек, который кладём в папку. */
  const [moveFor, setMoveFor] = useState<Track | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  /** Папка, которую переименовываем (треки переезжают на сервере), удаляем или создаём. */
  const [renaming, setRenaming] = useState<{ scope: Scope; from: string } | null>(null);
  const [removingFolder, setRemovingFolder] = useState<{ scope: Scope; name: string; count: number } | null>(null);
  const [creating, setCreating] = useState<Scope | null>(null);

  // Музыка изменилась (загрузили, удалили, переименовали) — выборы трека в играх возьмут свежий список.
  useEffect(() => {
    if (state.status === "ready") forgetTracks();
  }, [state]);

  if (!repo) return <p className="muted">Музыка доступна на своём сервере JoyRest.</p>;

  /** Занятое место пересчитывает сервер (файл — один раз, общая музыка не в счёт): после загрузки и удаления — тихо. */
  function refreshUsage() {
    repo
      ?.list()
      .then((fresh) => update((d) => ({ ...d, usage: fresh.usage })))
      .catch(() => undefined);
  }

  const replace = (track: Track) =>
    update((data) => ({
      ...data,
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
      update((data) => ({ ...data, mine: data.mine.filter((t) => t.id !== id), library: data.library.filter((t) => t.id !== id) }));
      setToDelete(null);
      onToast("Трек удалён");
      refreshUsage();
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

  async function acceptAll(list: Track[]) {
    if (!repo) return;
    setBusy(true);
    try {
      for (const t of list) {
        await repo.accept(t.id);
        updatePending((rest) => rest.filter((x) => x.id !== t.id));
      }
      retry();
      onToast(`Папка «${list[0]?.folder ?? ""}» в общей музыке`);
    } catch {
      onToast("Приняты не все треки. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
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

  function editSource(track: Track) {
    setSourceDraft(track.licenseNote);
    setDialogError(null);
    setSourceFor(track);
  }

  async function saveSource() {
    if (!repo || !sourceFor) return;
    setBusy(true);
    setDialogError(null);
    try {
      replace(await repo.update(sourceFor.id, { licenseNote: sourceDraft.trim() }));
      setSourceFor(null);
      onToast("Сохранено");
    } catch {
      setDialogError("Не удалось сохранить. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  function moveTo(track: Track) {
    setFolderDraft(track.folder);
    setDialogError(null);
    setMoveFor(track);
  }

  async function saveFolder() {
    if (!repo || !moveFor) return;
    setBusy(true);
    setDialogError(null);
    try {
      const folder = folderDraft.trim();
      replace(await repo.update(moveFor.id, { folder }));
      setMoveFor(null);
      onToast(folder ? `Трек в папке «${folder}»` : "Трек без папки");
    } catch {
      setDialogError("Не удалось сохранить. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  /** Создать, переименовать или удалить папку: сервер сам переносит её треки, список перечитываем. */
  async function folderAction(run: () => Promise<unknown>, done: () => void, toast: string) {
    if (!repo) return;
    setBusy(true);
    setDialogError(null);
    try {
      await run();
      done();
      retry();
      onToast(toast);
    } catch {
      setDialogError("Не удалось сохранить. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  function renameFolder() {
    if (!repo || !renaming) return;
    const to = folderDraft.trim();
    if (!to) return setDialogError("Напишите название. Чтобы убрать папку — «Удалить папку».");
    const { scope, from } = renaming;
    void folderAction(() => repo.renameFolder(scope, from, to), () => setRenaming(null), `Папка теперь «${to}»`);
  }

  function createFolder() {
    if (!repo || !creating) return;
    const name = folderDraft.trim();
    if (!name) return setDialogError("Напишите название папки.");
    const scope = creating;
    void folderAction(() => repo.createFolder(scope, name), () => setCreating(null), `Папка «${name}» создана`);
  }

  function deleteFolder() {
    if (!repo || !removingFolder) return;
    const { scope, name } = removingFolder;
    void folderAction(() => repo.deleteFolder(scope, name), () => setRemovingFolder(null), `Папка «${name}» удалена, треки остались`);
  }

  /**
   * Треки по папкам: сначала без папки, дальше папки по алфавиту — и пустые созданные (свёрнуты, в заголовке —
   * сколько треков); у папки — «Переименовать» и «Удалить папку» (треки остаются без папки).
   */
  function folders(scope: Scope, list: Track[], created: string[], actionsFor: (t: Track) => MenuAction[], editable: boolean) {
    const groups = groupByFolder(list);
    const loose = groups.find((g) => g.folder === "")?.items ?? [];
    const names = [...new Set([...groups.map((g) => g.folder).filter(Boolean), ...created])].sort((a, b) => a.localeCompare(b, "ru"));
    return (
      <>
        {editable && (
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => {
              setFolderDraft("");
              setDialogError(null);
              setCreating(scope);
            }}
          >
            + Новая папка
          </button>
        )}
        {names.map((name) => {
          const items = groups.find((g) => g.folder === name)?.items ?? [];
          return (
            <Fold key={name} title={`📁 ${name}`} value={`${items.length}`}>
              {items.length === 0 ? (
                <p className="muted small">Пустая папка. Положите трек: у трека «⋯ → В папку».</p>
              ) : (
                <ul className="tracks">{items.map((t) => row(t, actionsFor(t)))}</ul>
              )}
              {scope === "agency" && items.length > 0 && permissions.canUploadTrack(profile, "personal") && (
                <button
                  type="button"
                  className="btn btn--secondary btn--block"
                  disabled={busy}
                  onClick={() => void folderAction(() => (repo ? repo.takeFolder(name) : Promise.resolve()), () => undefined, `Папка «${name}» теперь и в ваших треках`)}
                >
                  Взять папку себе
                </button>
              )}
              {scope === "personal" &&
                items.some((t) => t.ready && permissions.canShareTrack(profile, t) && (t.shareStatus === "none" || t.shareStatus === "rejected")) && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--block"
                    disabled={busy}
                    onClick={() =>
                      void folderAction(
                        () => (repo ? repo.shareFolder(name) : Promise.resolve()),
                        () => undefined,
                        "Папка отправлена владельцу JoyRest на проверку — после проверки она появится у всех",
                      )
                    }
                  >
                    Предложить папку в общую
                  </button>
                )}
              {editable && (
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn--quiet btn--block"
                    onClick={() => {
                      setFolderDraft(name);
                      setDialogError(null);
                      setRenaming({ scope, from: name });
                    }}
                  >
                    Переименовать папку
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet btn--block"
                    onClick={() => {
                      setDialogError(null);
                      setRemovingFolder({ scope, name, count: items.length });
                    }}
                  >
                    Удалить папку
                  </button>
                </div>
              )}
            </Fold>
          );
        })}
        {loose.length > 0 && <ul className="tracks">{loose.map((t) => row(t, actionsFor(t)))}</ul>}
      </>
    );
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
            {query.trim() && track.folder && <li>📁 {track.folder}</li>}
            {query.trim() && <li>{track.scope === "agency" ? "Общая" : "Мои"}</li>}
          </ul>
          <TrackSource text={track.licenseNote} />
          {track.shareStatus === "rejected" && track.shareReason && <p className="muted small">Причина: {track.shareReason}</p>}
          {isClipped(track.clip) && clipFor !== track.id && (
            <p className="muted small">
              Отрезок {clipLabel(track.clip)} · громкость {track.clip.volume}%
            </p>
          )}
          {clipFor === track.id && (
            <TrackClipEditor
              track={track}
              onClose={() => setClipFor(null)}
              onSave={async (clip) => {
                if (!repo) return;
                replace(await repo.update(track.id, { clip }));
                onToast("Отрезок сохранён");
              }}
            />
          )}
          {extra}
        </div>
        {actions.length > 0 && <ActionMenu icon="dots" label={`Действия с треком «${track.title}»`} actions={actions} />}
      </li>
    );
  }

  function mineActions(t: Track): MenuAction[] {
    const actions: MenuAction[] = [];
    if (t.ready && permissions.canShareTrack(profile, t) && (t.shareStatus === "none" || t.shareStatus === "rejected")) {
      actions.push({ label: "Предложить в общую", onClick: () => void share(t) });
    }
    actions.push({ label: t.folder ? "Другая папка" : "В папку", onClick: () => moveTo(t) });
    if (t.ready) actions.push({ label: "Отрезок, громкость, затухание", onClick: () => setClipFor(t.id) });
    actions.push({ label: t.licenseNote ? "Откуда трек — изменить" : "Откуда трек — добавить", onClick: () => editSource(t) });
    actions.push({ label: "Удалить", onClick: () => setToDelete(t) });
    return actions;
  }

  function libraryActions(t: Track): MenuAction[] {
    return permissions.canEditTrack(profile, t)
      ? [
          { label: t.folder ? "Другая папка" : "В папку", onClick: () => moveTo(t) },
          { label: "Отрезок, громкость, затухание", onClick: () => setClipFor(t.id) },
          { label: "Откуда трек", onClick: () => editSource(t) },
          { label: "Удалить из общей", onClick: () => setToDelete(t) },
        ]
      : [];
  }

  const data = state.status === "ready" ? state.data : null;

  return (
    <>
      {(permissions.canUploadTrack(profile, "personal") || permissions.canUploadTrack(profile, "agency")) && <UploadCard
        profile={profile}
        folders={data ? [...new Set([...folderNames([...data.mine, ...data.library]), ...(data.folders?.mine ?? []), ...(data.folders?.library ?? [])])].sort((a, b) => a.localeCompare(b, "ru")) : []}
        onUploaded={(track) => {
          update((d) => (track.scope === "agency" ? { ...d, library: [track, ...d.library] } : { ...d, mine: [track, ...d.mine] }));
          onToast("Трек загружен");
          refreshUsage();
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
          {(() => {
            // Предложенные папкой — принять всю папку одним касанием (решение владельца 15 октября 2026).
            const groups = new Map<string, Track[]>();
            for (const t of pending.data) if (t.folder) groups.set(`${t.ownerId}\u0000${t.folder}`, [...(groups.get(`${t.ownerId}\u0000${t.folder}`) ?? []), t]);
            return [...groups.values()]
              .filter((list) => list.length > 1)
              .map((list) => (
                <button
                  key={`${list[0]?.ownerId}:${list[0]?.folder}`}
                  type="button"
                  className="btn btn--secondary btn--block"
                  disabled={busy}
                  onClick={() => void acceptAll(list)}
                >
                  Принять всю папку «{list[0]?.folder}» ({list.length}) · {list[0]?.ownerName}
                </button>
              ));
          })()}
          <ul className="tracks">
            {pending.data.map((t) =>
              row(
                t,
                [],
                <>
                  {t.license !== "other" && <p className="muted small">Права: {LICENSE_TITLES[t.license]}</p>}
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
          {data.mine.length + data.library.length > 0 && (
            <SearchField
              label="Поиск по трекам"
              placeholder="Название, исполнитель или папка"
              value={query}
              candidates={[...data.mine, ...data.library].map((t) => t.title)}
              onChange={setQuery}
            />
          )}
          {query.trim() ? (
            <section className="card" aria-labelledby="tracks-found">
              {(() => {
                const found = [...data.mine, ...data.library].filter((t) => matchesSearch([t.title, t.folder, t.licenseNote, t.ownerName], query));
                return (
                  <>
                    <h2 id="tracks-found">Найдено: {found.length}</h2>
                    {found.length === 0 ? (
                      <p className="muted">Ничего не нашлось. Попробуйте часть названия или имя исполнителя.</p>
                    ) : (
                      <ul className="tracks">{found.map((t) => row(t, t.scope === "agency" ? libraryActions(t) : mineActions(t)))}</ul>
                    )}
                  </>
                );
              })()}
            </section>
          ) : (
            <>
              <section className="card" aria-labelledby="tracks-mine">
                <h2 id="tracks-mine">Мои треки</h2>
                {data.usage && <TrackUsageLine usage={data.usage} />}
                {data.mine.length === 0 ? (
                  <p className="muted">Пока пусто. Загрузите трек — он появится на пульте в плеере.</p>
                ) : (
                  <>
                    <p className="muted small">Разложите треки по папкам: «+ Новая папка», потом у трека «⋯ → В папку».</p>
                    {folders("personal", data.mine, data.folders?.mine ?? [], mineActions, true)}
                  </>
                )}
              </section>

              <section className="card" aria-labelledby="tracks-library">
                <h2 id="tracks-library">Общая музыка JoyRest</h2>
                {data.library.length === 0 ? (
                  <p className="muted">Здесь появятся треки, которые одобрил владелец JoyRest.</p>
                ) : (
                  folders("agency", data.library, data.folders?.library ?? [], libraryActions, permissions.canUploadTrack(profile, "agency"))
                )}
              </section>
            </>
          )}
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
        open={sourceFor !== null}
        title="Откуда трек"
        confirmLabel="Сохранить"
        busy={busy}
        error={dialogError}
        onConfirm={() => void saveSource()}
        onCancel={() => setSourceFor(null)}
      >
        <label className="field">
          Ссылка или откуда взят (необязательно)
          <input
            maxLength={SOURCE_MAX}
            inputMode="url"
            placeholder="https://… или «ВКонтакте, купил, свой»"
            value={sourceDraft}
            onChange={(e) => setSourceDraft(e.target.value)}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={moveFor !== null}
        title="В какую папку?"
        confirmLabel="Положить"
        busy={busy}
        error={dialogError}
        onConfirm={() => void saveFolder()}
        onCancel={() => setMoveFor(null)}
      >
        {moveFor && data && (
          <div className="stack stack--tight">
            <div className="pick-chips">
              {[...new Set([...folderNames(moveFor.scope === "agency" ? data.library : data.mine), ...((moveFor.scope === "agency" ? data.folders?.library : data.folders?.mine) ?? [])])].sort((a, b) => a.localeCompare(b, "ru")).map((name) => (
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
              <input maxLength={40} placeholder="Например: Лото, Квизы, Перерыв" value={folderDraft} onChange={(e) => setFolderDraft(e.target.value)} />
            </label>
          </div>
        )}
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
        open={creating !== null}
        title={creating === "agency" ? "Новая папка в общей музыке" : "Новая папка"}
        confirmLabel="Создать"
        busy={busy}
        error={dialogError}
        onConfirm={createFolder}
        onCancel={() => setCreating(null)}
      >
        <label className="field">
          Название папки
          <input maxLength={40} placeholder="Например: Лото, Квизы, Перерыв" value={folderDraft} onChange={(e) => setFolderDraft(e.target.value)} />
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
          {removingFolder && removingFolder.count > 0 ? `Её треки (${removingFolder.count}) не удалятся — останутся без папки.` : "Она пустая."}
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

function UploadCard({ profile, folders, onUploaded }: { profile: UserProfile; folders: string[]; onUploaded: (track: Track) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  /** id трека, описание которого уже на сервере, а файл не дошёл: повтор не плодит пустые треки. */
  const pendingId = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<TrackCategory>("music");
  const [source, setSource] = useState("");
  const [folder, setFolder] = useState("");
  const [toLibrary, setToLibrary] = useState(permissions.canUploadTrack(profile, "agency"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canLibrary = permissions.canUploadTrack(profile, "agency");

  function clearInput() {
    // Иначе тот же файл не выбрать повторно: у поля остаётся прежнее значение и onChange молчит.
    if (fileRef.current) fileRef.current.value = "";
  }

  function pick(next: File | null) {
    setError(null);
    if (!next) return;
    if (next.size > MAX_BYTES) {
      setError("Файл больше 15 МБ. Возьмите mp3 поменьше или обрежьте трек.");
      clearInput();
      return;
    }
    pendingId.current = null;
    setFile(next);
    setTitle(titleFromFile(next.name));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!tracksRepo || !file) return;
    if (!title.trim()) return setError("Напишите название трека.");
    setBusy(true);
    setError(null);
    try {
      let id = pendingId.current;
      if (!id) {
        id = newTrackId();
        await tracksRepo.create({ id, scope: canLibrary && toLibrary ? "agency" : "personal", title: title.trim(), category, license: "other", licenseNote: source.trim(), folder: folder.trim() });
        pendingId.current = id;
      }
      const track = await tracksRepo.upload(id, file, await audioDuration(file));
      pendingId.current = null;
      onUploaded(track);
      setFile(null);
      setTitle("");
      setSource("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(uploadErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="upload-track">
      <h2 id="upload-track">Музыка</h2>
      <p className="muted">
        Загрузите трек — он сразу появится в «Моих треках»: его можно поставить в любую игру (квиз, лото, батл, «Ставка
        на знания») и включить с пульта на экране зала. У трека можно выбрать отрезок, громкость и затухание.
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
            Откуда трек (необязательно)
            <input
              maxLength={SOURCE_MAX}
              inputMode="url"
              placeholder="Ссылка https://… или «ВКонтакте, купил, свой»"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <label className="field">
            Папка (необязательно)
            <input maxLength={40} list="track-folders" placeholder="Например: Лото, Квизы, Перерыв" value={folder} onChange={(e) => setFolder(e.target.value)} />
            <datalist id="track-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
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
            <button
              type="button"
              className="btn btn--quiet btn--block"
              disabled={busy}
              onClick={() => {
                setFile(null);
                clearInput();
              }}
            >
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
