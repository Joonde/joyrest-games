/**
 * Видео JoyRest на сервере (решение владельца 15 октября 2026; ведущие — с 31 октября, в своё место 2 ГБ): загружают владелец и заместитель, все остальные
 * выбирают из готовых. Загрузка частями с дозагрузкой: тот же файл после обрыва или закрытой вкладки продолжает
 * с того места, где остановился (id недогруженного видео запоминается на устройстве по имени, размеру и дате файла).
 * Используют конструкторы игр с видео и вкладка «Видео» в студии.
 */
import { useEffect, useRef, useState } from "react";
import { permissions, useAuth, videosRepo, type LibraryVideo } from "../../data";
import { titleFromFile } from "../../core/music";

/** Откуда видео (тот же список, что `VideoSource` механик с видео). */
type VideoSource = "none" | "file" | "link" | "server";

export const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm,.mkv";
/** Потолок сервера на один файл (DEFAULT_VIDEO_LIMITS.fileBytes). */
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

/** Подпись источника видео в конструкторах. */
export function videoSourceLabel(s: VideoSource): string {
  return s === "server" ? "Видео JoyRest" : s === "link" ? "Ссылка" : s === "file" ? "Файл" : "Без видео";
}

/** Источники видео по порядку в выборе: «Видео JoyRest» — только на своём сервере. */
export function videoSources(order: readonly VideoSource[] = ["server", "link", "file", "none"]): VideoSource[] {
  return order.filter((s) => s !== "server" || videosRepo !== null);
}

export function newVideoId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "v" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

/** Длительность видео в мс (по метаданным файла); не прочиталась — null. */
export function videoDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 8000);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null);
    };
    el.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    el.src = url;
  });
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1).replace(".", ",")} ГБ`;
  if (n >= 1024 * 1024) return `${Math.round(n / 1024 / 1024)} МБ`;
  return `${Math.max(1, Math.round(n / 1024))} КБ`;
}

export function formatDuration(ms: number | null): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Место ведущего под музыку и видео (2 ГБ) закончилось. */
export const SPACE_FULL_TEXT =
  "Ваше место под музыку и видео (2 ГБ) закончилось. Уберите ненужные видео или треки — или сожмите видео (720p, MP4), оно станет в разы меньше.";

/** Понятный текст ошибки загрузки видео. */
export function videoErrorText(e: unknown): string {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  const status = typeof e === "object" && e !== null && "status" in e ? Number((e as { status: unknown }).status) : 0;
  const reason = typeof e === "object" && e !== null && "reason" in e ? String((e as { reason: unknown }).reason) : "";
  if (reason === "quota") return SPACE_FULL_TEXT;
  if (code === "too-big" || status === 413) return "Файл больше 1 ГБ. Сожмите видео (720p, MP4) и загрузите снова.";
  if (status === 507 || code === "resource-exhausted") return "На сервере мало места. Уберите ненужные видео или напишите владельцу.";
  if (code === "invalid-argument") return "Это не похоже на видео MP4, MOV или WebM. Выберите другой файл.";
  if (code === "permission-denied") return "Загружать видео могут ведущие, владелец и заместитель.";
  return "Связь прервалась. Выберите тот же файл ещё раз — загрузка продолжится с того же места.";
}

const PENDING_KEY = "joyrest.video.pending.";
const fileKey = (file: File) => `${PENDING_KEY}${file.name}|${file.size}|${file.lastModified}`;
function readPending(file: File): string | null {
  try {
    return localStorage.getItem(fileKey(file));
  } catch {
    return null;
  }
}
function writePending(file: File, id: string | null) {
  try {
    if (id) localStorage.setItem(fileKey(file), id);
    else localStorage.removeItem(fileKey(file));
  } catch {
    // Нет хранилища — дозагрузка начнётся заново, ничего страшного.
  }
}

/** Загрузить видео в «Видео JoyRest». Тот же файл, что не догрузился раньше, — продолжает с того же места. */
export async function uploadVideo(
  file: File,
  options: { title?: string; folder?: string; onProgress?: (received: number, size: number) => void; signal?: AbortSignal } = {},
): Promise<LibraryVideo> {
  if (!videosRepo) throw new Error("unavailable");
  if (file.size > MAX_VIDEO_BYTES) throw Object.assign(new Error("too big"), { code: "too-big" });
  const id = readPending(file) ?? newVideoId();
  writePending(file, id);
  const video = await videosRepo.upload(
    { id, title: (options.title ?? titleFromFile(file.name)).trim() || "Видео", folder: options.folder ?? "", file, durationMs: await videoDuration(file) },
    options.onProgress,
    options.signal,
  );
  writePending(file, null);
  return video;
}

/** Полоса загрузки: сколько уже на сервере. */
export function UploadProgress({ received, size, label }: { received: number; size: number; label: string }) {
  const percent = size > 0 ? Math.floor((received / size) * 100) : 0;
  return (
    <div className="video-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
      <div className="video-progress__bar" style={{ width: `${percent}%` }} />
      <span className="video-progress__text small">
        {label}: {percent}% · {formatBytes(received)} из {formatBytes(size)}
      </span>
    </div>
  );
}

/** Группы видео по папкам: сначала папки по алфавиту, потом без папки. */
export function videosByFolder(videos: LibraryVideo[]): Array<{ folder: string; videos: LibraryVideo[] }> {
  const map = new Map<string, LibraryVideo[]>();
  for (const v of videos) map.set(v.folder, [...(map.get(v.folder) ?? []), v]);
  return [...map.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "ru")))
    .map(([folder, list]) => ({ folder, videos: list.sort((x, y) => x.title.localeCompare(y.title, "ru")) }));
}

/**
 * Выбор видео JoyRest в конструкторе: список готовых видео по папкам; владелец и заместитель могут загрузить новое
 * прямо здесь — оно сразу выбрано.
 */
export function LibraryVideoPicker({ value, editable, onPick }: { value: string; editable: boolean; onPick: (video: { id: string; title: string }) => void }) {
  const [auth] = useAuth();
  const [videos, setVideos] = useState<LibraryVideo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<{ received: number; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const canUpload = auth.status === "signedIn" && auth.profile !== null && permissions.canUploadVideo(auth.profile);

  useEffect(() => {
    if (!videosRepo) return;
    let alive = true;
    videosRepo
      .list()
      .then((d) => alive && setVideos(d.videos.filter((v) => v.ready)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!videosRepo) return <p className="muted small">Видео JoyRest есть только на платформе JoyRest (games.joy-rest.ru).</p>;
  const current = videos?.find((v) => v.id === value) ?? null;

  async function pick(file: File | null) {
    if (ref.current) ref.current.value = "";
    if (!file) return;
    setError(null);
    setProgress({ received: 0, size: file.size });
    try {
      const video = await uploadVideo(file, { onProgress: (received, size) => setProgress({ received, size }) });
      setVideos((list) => [...(list ?? []).filter((v) => v.id !== video.id), video]);
      onPick({ id: video.id, title: video.title });
    } catch (e) {
      setError(videoErrorText(e));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="stack stack--tight">
      {failed ? (
        <p className="error small">Список видео не загрузился. Проверьте интернет и откройте игру снова.</p>
      ) : videos === null ? (
        <p className="muted small">Загружаем список видео…</p>
      ) : videos.length === 0 && !canUpload ? (
        <p className="muted small">Видео JoyRest пока нет — их загружают ведущие, владелец и заместитель (студия → «Видео»).</p>
      ) : (
        <label className="field">
          Видео
          <select value={current ? value : ""} disabled={!editable} onChange={(e) => {
            const v = videos.find((x) => x.id === e.target.value);
            if (v) onPick({ id: v.id, title: v.title });
          }}>
            <option value="">{value && !current ? "Видео удалено — выберите другое" : "Выберите видео"}</option>
            {videosByFolder(videos).map((g) =>
              g.folder ? (
                <optgroup key={g.folder} label={g.folder}>
                  {g.videos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title}
                      {v.durationMs ? ` · ${formatDuration(v.durationMs)}` : ""}
                    </option>
                  ))}
                </optgroup>
              ) : (
                g.videos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                    {v.durationMs ? ` · ${formatDuration(v.durationMs)}` : ""}
                  </option>
                ))
              ),
            )}
          </select>
          <span className="muted small">Видео лежит на сервере JoyRest: экран зала берёт его сам, на устройство ничего копировать не нужно.</span>
        </label>
      )}
      {canUpload && editable && (
        <>
          <input ref={ref} type="file" accept={VIDEO_ACCEPT} className="visually-hidden visually-hidden--pinned" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
          {progress ? (
            <UploadProgress received={progress.received} size={progress.size} label="Загружаем видео" />
          ) : (
            <button type="button" className="btn btn--secondary btn--block" onClick={() => ref.current?.click()}>
              ⬆ Загрузить новое видео JoyRest
            </button>
          )}
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
