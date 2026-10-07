/**
 * Фото зала и меню для анкеты площадки: фото сжимаются прямо на телефоне (до ~350 КБ), PDF меню —
 * как есть, до 1,9 МБ. Файлы копятся здесь и уходят на сервер вместе с анкетой.
 */
import { useEffect, useId, useState } from "react";
import { MENU_PDF_MAX_BYTES, VENUE_FILES, type VenueFileKind } from "../../core/venues";
import type { VenueUpload } from "../../data";
import { ImageError, shrinkImage } from "../media/compressImage";

const PHOTO = { maxSide: 1600, targetBytes: 350 * 1024, maxBytes: 580 * 1024 };
// Страницы меню крупнее: текст должен читаться.
const MENU_PAGE = { maxSide: 2000, targetBytes: 450 * 1024, maxBytes: 580 * 1024 };

/** Файл с телефона → готовый к отправке (или понятная ошибка). */
export async function prepareVenueFile(kind: VenueFileKind, file: File): Promise<VenueUpload> {
  if (kind === "menu" && (file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
    if (file.size > MENU_PDF_MAX_BYTES) throw new ImageError("PDF больше 1,9 МБ. Пришлите фото страниц или ссылку на меню.");
    return { kind, blob: new Blob([file], { type: "application/pdf" }), name: file.name };
  }
  const blob = await shrinkImage(file, kind === "photo" ? PHOTO : MENU_PAGE);
  return { kind, blob, name: file.name.replace(/\.[a-z0-9]+$/i, "") };
}

export function FilePicker({
  kind,
  label,
  hint,
  files,
  onChange,
  required,
  max = VENUE_FILES[kind],
}: {
  kind: VenueFileKind;
  label: string;
  hint?: string;
  files: VenueUpload[];
  onChange: (files: VenueUpload[]) => void;
  required?: boolean;
  /** Сколько ещё можно добавить (у владельца — с учётом уже загруженных). */
  max?: number;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = max - files.length;

  async function add(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    setError(null);
    const added: VenueUpload[] = [];
    const picked = Array.from(list).slice(0, Math.max(0, left));
    // По одному: сжатие нескольких фото сразу съедает память слабого телефона.
    for (const file of picked) {
      try {
        added.push(await prepareVenueFile(kind, file));
      } catch (problem) {
        setError(problem instanceof ImageError ? problem.message : "Не получилось обработать файл. Попробуйте другой.");
      }
    }
    if (list.length > picked.length) setError(`Можно не больше ${max}. Лишние файлы не добавлены.`);
    onChange([...files, ...added]);
    setBusy(false);
  }

  return (
    <div className="field">
      <span className="field__label">
        {label}
        {required && <span className="required" aria-hidden="true"> *</span>}
        {hint && <span className="field__hint"> {hint}</span>}
      </span>
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="file-list__item">
              {file.blob.type.startsWith("image/") ? <FileThumb blob={file.blob} /> : <span className="file-list__pdf">PDF</span>}
              <span className="line-clamp">{file.name || (kind === "photo" ? `Фото ${index + 1}` : `Страница ${index + 1}`)}</span>
              <button type="button" className="btn btn--quiet file-list__remove" aria-label={`Убрать ${file.name || "файл"}`} onClick={() => onChange(files.filter((_, i) => i !== index))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {left > 0 ? (
        <label className="btn btn--secondary btn--block file-pick" htmlFor={id} aria-busy={busy}>
          {busy ? "Уменьшаем фото…" : kind === "photo" ? "Добавить фото" : "Добавить фото или PDF меню"}
          <input
            id={id}
            className="visually-hidden"
            type="file"
            multiple
            accept={kind === "photo" ? "image/*" : "image/*,application/pdf,.pdf"}
            disabled={busy}
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <p className="muted small">Добавлено максимум — {max}.</p>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function FileThumb({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <img className="file-list__thumb" src={url} alt="" /> : <span className="file-list__thumb" />;
}
