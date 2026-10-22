/**
 * Фотоотчёт мероприятия на пульте (решение владельца 15 октября 2026): до 3 общих фото на игру — переснять или удалить.
 * Нужен для отчётности, Telegram-канала и сайта. Перед съёмкой ведущий предупреждает гостей (текст — `PHOTO_SCRIPT`).
 * Фото сжимает телефон (до 1600 px, ~0,8 МБ), на сервер уходит только сжатое.
 */
import { useEffect, useRef, useState } from "react";
import { photosRepo, type EventPhoto } from "../../data";
import { ConfirmDialog } from "../ConfirmDialog";
import { ImageError, shrinkImage } from "../media/compressImage";

export const PHOTO_SLOTS = [1, 2, 3] as const;

/** Что сказать гостям перед общим фото. */
export const PHOTO_SCRIPT =
  "Давайте сделаем общее фото на память! Оно попадёт в наш фотоотчёт и, может быть, в Telegram-канал и на сайт JoyRest. Кто не хочет в кадр — скажите или просто отойдите в сторону.";

async function dimensions(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 1, height: 1 };
  }
}

export function EventPhotosCard({ sessionId }: { sessionId: string }) {
  const [photos, setPhotos] = useState<EventPhoto[] | null>(null);
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<number>(1);

  // Список не загрузился — это не «фото нет» (QA 22 октября 2026, M10): показываем «Повторить», а снимать нельзя,
  // иначе «Сделать фото» молча заменит уже снятое (в том числе со второго пульта).
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Поколение записей: растёт в начале и в конце каждого сохранения и удаления. Список, запрошенный до последней записи
  // (закрыли и открыли блок, пока фото сохранялось), устарел — его ответ не затирает только что снятое фото, а список
  // перечитывается заново (повторная проверка QA 22 октября 2026).
  const generation = useRef(0);
  useEffect(() => {
    if (!photosRepo || !open) return;
    let alive = true;
    const asked = generation.current;
    setFailed(false);
    // Каждое открытие — свежий список: второй пульт мог уже снять фото.
    photosRepo
      .list(sessionId)
      .then((list) => {
        if (!alive) return;
        if (asked !== generation.current) {
          setAttempt((n) => n + 1);
          return;
        }
        setPhotos(list);
      })
      .catch(() => {
        if (!alive) return;
        if (asked !== generation.current) {
          setAttempt((n) => n + 1);
          return;
        }
        setPhotos(null);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open, attempt, sessionId]);

  if (!photosRepo) return null;
  const bySlot = new Map((photos ?? []).map((p) => [p.slot, p]));
  const count = bySlot.size;

  function shoot(slot: number) {
    target.current = slot;
    setError(null);
    input.current?.click();
  }

  async function save(file: File | null) {
    if (input.current) input.current.value = "";
    if (!file || !photosRepo) return;
    const slot = target.current;
    setBusySlot(slot);
    setError(null);
    generation.current += 1;
    try {
      const blob = await shrinkImage(file, { maxSide: 1600, targetBytes: 800 * 1024, maxBytes: 1400 * 1024 });
      const { width, height } = await dimensions(blob);
      const photo = await photosRepo.save(sessionId, slot, blob, width, height);
      setPhotos((list) => [...(list ?? []).filter((p) => p.slot !== slot), photo].sort((a, b) => a.slot - b.slot));
    } catch (e) {
      setError(e instanceof ImageError ? e.message : "Не получилось сохранить фото. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      generation.current += 1;
      setBusySlot(null);
    }
  }

  async function remove(slot: number) {
    if (!photosRepo) return;
    setToDelete(null);
    setBusySlot(slot);
    setError(null);
    generation.current += 1;
    try {
      await photosRepo.remove(sessionId, slot);
      setPhotos((list) => (list ?? []).filter((p) => p.slot !== slot));
    } catch {
      setError("Не получилось удалить фото. Проверьте интернет.");
    } finally {
      generation.current += 1;
      setBusySlot(null);
    }
  }

  return (
    <>
      <details className="fold event-photos" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="fold__head">
          <span className="fold__title">📷 Общее фото для фотоотчёта</span>
          <span className="fold__value">{failed ? "не загрузилось" : photos ? `${count} из ${PHOTO_SLOTS.length}` : "до 3 фото"}</span>
          <span className="fold__chev" aria-hidden="true" />
        </summary>
        <div className="fold__body stack stack--tight">
          <p className="muted small">
            <strong>Сначала предупредите гостей:</strong> «{PHOTO_SCRIPT}»
          </p>
          <input
            ref={input}
            type="file"
            accept="image/*"
            capture="environment"
            className="visually-hidden"
            tabIndex={-1}
            onChange={(e) => void save(e.target.files?.[0] ?? null)}
          />
          {failed && (
            <div className="stack stack--tight" role="alert">
              <p className="error small">Фото этой игры не загрузились — снимать пока нельзя, чтобы не заменить уже снятое.</p>
              <button type="button" className="btn btn--secondary btn--block" onClick={() => setAttempt((n) => n + 1)}>
                Не загрузилось — Повторить
              </button>
            </div>
          )}
          {!failed && photos === null && open && <p className="muted small">Загружаем фото этой игры…</p>}
          <div className="event-photos__grid">
            {PHOTO_SLOTS.map((slot) => {
              const photo = bySlot.get(slot);
              const busy = busySlot === slot;
              return (
                <div key={slot} className="event-photos__slot">
                  {photo ? (
                    <img src={photo.url} alt={`Фото ${slot}`} className="event-photos__img" loading="lazy" />
                  ) : (
                    <div className="event-photos__empty" aria-hidden="true">
                      {slot}
                    </div>
                  )}
                  <button type="button" className="btn btn--secondary btn--block" disabled={busy || photos === null} onClick={() => shoot(slot)}>
                    {busy ? "Сохраняем…" : photo ? "Переснять" : "Сделать фото"}
                  </button>
                  {photo && (
                    <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => setToDelete(slot)}>
                      Удалить
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
          <p className="muted small">Фото видите вы и владелец JoyRest (студия → «Фотоотчёты»). Гостям и на экран зала они не уходят.</p>
        </div>
      </details>
      <ConfirmDialog
        open={toDelete !== null}
        title={`Удалить фото ${toDelete ?? ""}?`}
        confirmLabel="Удалить фото"
        cancelLabel="Оставить"
        onConfirm={() => toDelete !== null && void remove(toDelete)}
        onCancel={() => setToDelete(null)}
      >
        <p>Фото пропадёт из фотоотчёта. Вместо него можно сразу сделать новое — «Переснять».</p>
      </ConfirmDialog>
    </>
  );
}
