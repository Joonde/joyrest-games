// Конструктор «Своей игры»: размер поля, категории, стоимость и содержимое каждой клетки.
import { useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { compressImage, ImageError } from "../../components/media/compressImage";
import { MediaImage } from "../../components/media/MediaImage";
import { TrackTimeline } from "../../components/music/TrackTimeline";
import { Toast, useToast } from "../../components/Toast";
import { clipFields, parseClip } from "../../core/clip";
import { mediaRepo } from "../../data";
import type { EditorProps } from "../types";
import { allCells, BOARD_LIMITS, CELL_MARKS, CELL_TITLES, columnsOf, defaultPoints, findCell, resizeBoard, type BoardCell, type BoardContent, type CellKind } from "./content";
import { validateBoard } from "./validate";

const KINDS: CellKind[] = ["question", "track", "picture", "cat"];

const KIND_HINTS: Record<CellKind, string> = {
  question: "Вопрос на экране, гости жмут кнопку «кто первый», отвечают вслух.",
  track: "Звучит фрагмент трека — угадать песню. На верный ответ — припев и конфетти.",
  picture: "Картинка на экране — что на ней? Отвечают кнопкой.",
  cat: "Сначала ставки (до своего счёта или стоимости клетки), потом сложный вопрос. Верно — ставка ваша, неверно — ставку теряют все, кто ставил.",
};

export function BoardEditor({ gameId, content, onChange, editable }: EditorProps<BoardContent>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const latest = useRef(content);
  latest.current = content;
  const rows = content.categories.length;
  const cols = columnsOf(content);
  const errors = validateBoard(content);
  const errorCells = new Set(errors.map((e) => e.path.split("/")[1]).filter(Boolean));
  const open = findCell(content, openId);

  function updateCell(id: string, patch: Partial<BoardCell> | ((cell: BoardCell) => BoardCell)) {
    const current = latest.current;
    onChange({
      ...current,
      categories: current.categories.map((cat) => ({
        ...cat,
        cells: cat.cells.map((c) => (c.id === id ? (typeof patch === "function" ? patch(c) : { ...c, ...patch }) : c)),
      })),
    });
  }

  function releaseImage(mediaId: string | null) {
    if (!mediaId) return;
    // Картинку, на которую больше никто не ссылается, удаляем сразу (как в квизе).
    if (allCells(latest.current).some(({ cell }) => cell.imageId === mediaId)) return;
    void mediaRepo.remove(gameId, mediaId).catch(() => undefined);
  }

  async function pickImage(cell: BoardCell, file: File) {
    try {
      const image = await compressImage(file);
      const { mediaId, saved } = mediaRepo.upload(gameId, image);
      const previous = findCell(latest.current, cell.id)?.cell.imageId ?? null;
      updateCell(cell.id, { imageId: mediaId });
      releaseImage(previous);
      saved.catch(() => showToast("Картинка не сохранилась. Проверьте интернет и выберите её ещё раз."));
    } catch (error) {
      showToast(error instanceof ImageError ? error.message : "Не получилось добавить картинку.");
    }
  }

  function resetPoints() {
    onChange({ ...content, categories: content.categories.map((cat) => ({ ...cat, cells: cat.cells.map((c, i) => ({ ...c, points: defaultPoints(i) })) })) });
  }

  return (
    <div className="stack board-editor">
      <section className="card">
        <h2>Поле</h2>
        <p className="muted small">Строки — категории, колонки — стоимость. Гость выбирает клетку, все жмут кнопку «кто первый». Сыгранная клетка гаснет, пока не закроется всё поле.</p>
        <div className="row board-editor__size">
          <label className="field">
            Категорий
            <ClampedNumber value={rows} min={BOARD_LIMITS.minRows} max={BOARD_LIMITS.maxRows} fallback={4} disabled={!editable} onChange={(r) => onChange(resizeBoard(content, r, cols))} />
          </label>
          <label className="field">
            Вопросов в категории
            <ClampedNumber value={cols} min={BOARD_LIMITS.minCols} max={BOARD_LIMITS.maxCols} fallback={5} disabled={!editable} onChange={(c) => onChange(resizeBoard(content, rows, c))} />
          </label>
        </div>
        <label className="choice">
          <input type="checkbox" checked={content.penalty} disabled={!editable} onChange={(e) => onChange({ ...content, penalty: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Неверный ответ — минус стоимость клетки</span>
            <span className="choice__hint">Как в телевизионной «Своей игре». Без галочки ошибка просто передаёт слово следующему.</span>
          </span>
        </label>
        <label className="field">
          Время на ставку в «Коте в мешке», секунд
          <ClampedNumber value={content.betTime} min={BOARD_LIMITS.minBetTime} max={BOARD_LIMITS.maxBetTime} fallback={30} disabled={!editable} onChange={(betTime) => onChange({ ...content, betTime })} />
        </label>
        {editable && (
          <button type="button" className="btn btn--quiet btn--block" onClick={resetPoints}>
            Стоимость по колонкам: 100, 200, 300…
          </button>
        )}
      </section>

      <section className="card">
        <h2>Категории и клетки</h2>
        <p className="muted small">Коснитесь клетки, чтобы заполнить вопрос. Красная рамка — в клетке чего-то не хватает.</p>
        <div className="board-editor__grid" style={{ ["--board-cols" as string]: Math.max(1, cols) }}>
          {content.categories.map((category, r) => (
            <div key={category.id} className="board-editor__row">
              <input
                className="board-editor__title"
                value={category.title}
                maxLength={BOARD_LIMITS.title}
                placeholder={`Категория ${r + 1}`}
                aria-label={`Название категории ${r + 1}`}
                disabled={!editable}
                onChange={(e) => onChange({ ...content, categories: content.categories.map((c) => (c.id === category.id ? { ...c, title: e.target.value } : c)) })}
              />
              <div className="board-editor__cells">
                {category.cells.map((cell) => (
                  <button
                    key={cell.id}
                    type="button"
                    className={`board-editor__cell${openId === cell.id ? " is-open" : ""}${errorCells.has(cell.id) ? " has-error" : ""}${cell.kind === "cat" ? " is-cat" : ""}`}
                    aria-pressed={openId === cell.id}
                    aria-label={`${category.title || `Категория ${r + 1}`}, ${cell.points}, ${CELL_TITLES[cell.kind]}`}
                    onClick={() => setOpenId(openId === cell.id ? null : cell.id)}
                  >
                    <span>{cell.points}</span>
                    {CELL_MARKS[cell.kind] && <small>{CELL_MARKS[cell.kind]}</small>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {open && (
        <CellForm
          key={open.cell.id}
          gameId={gameId}
          title={open.category.title}
          cell={open.cell}
          editable={editable}
          errors={errors.filter((e) => e.path.startsWith(`cells/${open.cell.id}/`)).map((e) => e.message)}
          onChange={(patch) => updateCell(open.cell.id, patch)}
          onPickImage={(file) => pickImage(open.cell, file)}
          onRemoveImage={() => {
            const before = open.cell.imageId;
            updateCell(open.cell.id, { imageId: null });
            releaseImage(before);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
      {errors.some((e) => e.path === "board") && (
        <p className="error" role="alert">
          {errors.find((e) => e.path === "board")?.message}
        </p>
      )}
      <Toast text={toast} />
    </div>
  );
}

function CellForm({
  gameId,
  title,
  cell,
  editable,
  errors,
  onChange,
  onPickImage,
  onRemoveImage,
  onClose,
}: {
  gameId: string;
  title: string;
  cell: BoardCell;
  editable: boolean;
  errors: string[];
  onChange: (patch: Partial<BoardCell> | ((cell: BoardCell) => BoardCell)) => void;
  onPickImage: (file: File) => Promise<void>;
  onRemoveImage: () => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  return (
    <section className="card board-cell-form" aria-label={`Клетка: ${title}, ${cell.points}`}>
      <div className="row board-cell-form__head">
        <h2>
          {title || "Категория"} · {cell.points}
        </h2>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Готово
        </button>
      </div>
      <fieldset>
        <legend>Что в клетке</legend>
        <div className="seg" role="group" aria-label="Что в клетке">
          {KINDS.map((kind) => (
            <button key={kind} type="button" className={cell.kind === kind ? "seg__btn is-on" : "seg__btn"} aria-pressed={cell.kind === kind} disabled={!editable} onClick={() => onChange({ kind })}>
              {CELL_TITLES[kind]}
            </button>
          ))}
        </div>
        <p className="muted small">{KIND_HINTS[cell.kind]}</p>
      </fieldset>
      <label className="field">
        Стоимость
        <ClampedNumber value={cell.points} min={BOARD_LIMITS.minPoints} max={BOARD_LIMITS.maxPoints} fallback={100} disabled={!editable} onChange={(points) => onChange({ points })} />
      </label>
      <label className="field">
        {cell.kind === "track" ? "Подсказка на экране (необязательно)" : "Вопрос"}
        <textarea value={cell.text} maxLength={BOARD_LIMITS.text} disabled={!editable} placeholder={cell.kind === "track" ? "Угадайте песню" : "Текст вопроса"} onChange={(e) => onChange({ text: e.target.value })} />
      </label>
      <label className="field">
        Правильный ответ — видит только ведущий
        <input value={cell.answer} maxLength={BOARD_LIMITS.answer} disabled={!editable} onChange={(e) => onChange({ answer: e.target.value })} />
      </label>

      <div className="field">
        <span>Картинка{cell.kind === "picture" ? "" : " (необязательно)"}</span>
        {cell.imageId ? (
          <div className="stack stack--tight">
            <MediaImage className="board-cell-form__image" gameId={gameId} mediaId={cell.imageId} variant="small" alt="" />
            {editable && (
              <div className="actions">
                <button type="button" className="btn btn--secondary btn--block" disabled={processing} onClick={() => fileRef.current?.click()}>
                  Заменить картинку
                </button>
                <button type="button" className="btn btn--quiet btn--block" disabled={processing} onClick={onRemoveImage}>
                  Убрать картинку
                </button>
              </div>
            )}
          </div>
        ) : (
          editable && (
            <button type="button" className="btn btn--secondary btn--block" disabled={processing} onClick={() => fileRef.current?.click()}>
              {processing ? "Сжимаем…" : "Добавить картинку"}
            </button>
          )
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setProcessing(true);
            void onPickImage(file).finally(() => setProcessing(false));
          }}
        />
      </div>

      {(cell.kind === "track" || cell.trackId) && (
        <TrackTimeline clip={parseClip(cell)} disabled={!editable} onChange={(clip) => onChange((c) => ({ ...c, ...(clipFields(clip) as Partial<BoardCell>) }))} />
      )}

      {errors.length > 0 && (
        <ul className="error-list" role="alert">
          {errors.map((m) => (
            <li key={m} className="error">
              {m}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
