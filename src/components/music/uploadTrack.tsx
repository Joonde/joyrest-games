/**
 * Загрузка трека одним шагом (решение владельца 11 октября 2026): без вопросов о правах — выбрал файл, он
 * ушёл в «Мою музыку» с категорией «Музыка» и сразу доступен в любой игре (квиз, лото, батл, «Своя игра»).
 * Используют вкладка «Музыка» и выбор трека в конструкторах игр.
 */
import { useRef, useState } from "react";
import { permissions, tracksRepo, useAuth, type Track, type TrackCategory } from "../../data";
import { titleFromFile } from "../../core/music";
import { audioDuration } from "./usePreview";

export const MAX_TRACK_BYTES = 15 * 1024 * 1024;
export const TRACK_ACCEPT = "audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,.mp3,.m4a,.ogg";

export function newTrackId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "t" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

/** Понятный текст ошибки загрузки. */
export function uploadErrorText(e: unknown): string {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  return code === "invalid-argument"
    ? "Это не похоже на mp3, m4a или ogg. Выберите другой файл."
    : code === "resource-exhausted"
      ? "Место для музыки закончилось. Удалите старые треки."
      : "Не удалось загрузить. Проверьте интернет и попробуйте снова.";
}

/** Описание и файл трека; `pendingId` — описание уже создано, а файл не дошёл (повтор без дублей). */
export async function uploadTrack(
  file: File,
  options: { title?: string; category?: TrackCategory; scope?: "personal" | "agency"; pendingId?: { current: string | null } } = {},
): Promise<Track> {
  if (!tracksRepo) throw new Error("unavailable");
  if (file.size > MAX_TRACK_BYTES) throw Object.assign(new Error("too big"), { code: "too-big" });
  let id = options.pendingId?.current ?? null;
  if (!id) {
    id = newTrackId();
    await tracksRepo.create({ id, scope: options.scope ?? "personal", title: (options.title ?? titleFromFile(file.name)).trim() || "Трек", category: options.category ?? "music", license: "other", licenseNote: "" });
    if (options.pendingId) options.pendingId.current = id;
  }
  const track = await tracksRepo.upload(id, file, await audioDuration(file));
  if (options.pendingId) options.pendingId.current = null;
  return track;
}

/** Кнопка «Загрузить свой трек» прямо в игре: файл → «Моя музыка» → сразу выбран. */
export function UploadTrackButton({ onUploaded, disabled }: { onUploaded: (track: Track) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const pending = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Какой файл грузили: тот же файл повторно — дописываем прежнее описание трека, а не создаём новое. */
  const lastFile = useRef<string>("");
  const [auth] = useAuth();
  if (!tracksRepo) return null;
  // Загружать треки может не каждый (например, «Создатель игр» без профессии ведущего) — сервер ответил бы 403.
  if (auth.status !== "signedIn" || !auth.profile || !permissions.canUploadTrack(auth.profile, "personal")) return null;

  async function pick(file: File | null) {
    if (ref.current) ref.current.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_TRACK_BYTES) return setError("Файл больше 15 МБ. Возьмите mp3 поменьше.");
    setBusy(true);
    const fileKey = `${file.name}|${file.size}|${file.lastModified}`;
    if (fileKey !== lastFile.current) pending.current = null;
    lastFile.current = fileKey;
    try {
      onUploaded(await uploadTrack(file, { pendingId: pending }));
    } catch (e) {
      setError(uploadErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--tight">
      <input ref={ref} type="file" accept={TRACK_ACCEPT} className="visually-hidden" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
      <button type="button" className="btn btn--secondary btn--block" disabled={disabled || busy} onClick={() => ref.current?.click()}>
        {busy ? "Загружаем трек…" : "♪ Загрузить свой трек"}
      </button>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
