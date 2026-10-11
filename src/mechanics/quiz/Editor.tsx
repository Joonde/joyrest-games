import { useMemo, useRef, useState, type DragEvent } from "react";
import { questionsLabel } from "../../core/results";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ActionMenu, type MenuAction } from "../../components/Menu";
import { Toast, useToast } from "../../components/Toast";
import { compressImage, ImageError } from "../../components/media/compressImage";
import { MediaImage } from "../../components/media/MediaImage";
import { mediaRepo } from "../../data";
import type { EditorProps, ValidationError } from "../types";
import {
  changeKind,
  clipOf,
  correctSet,
  FORMAT_BLOCKS,
  hasAnswers,
  LIMITS as QUIZ_LIMITS,
  newPicture,
  QUESTION_FORMATS,
  questionImages,
  settingsOf,
  withClip,
  toggleCorrect,
  duplicateQuestion,
  KIND_HINTS,
  KIND_TITLES,
  LIMITS,
  moveItem,
  newQuestion,
  quizRounds,
  roundTitle,
  type QuestionKind,
  type QuizContent,
  type QuizQuestion,
  type QuizSettings,
} from "./content";
import { ImportSheet } from "./ImportSheet";
import { TrackTimeline } from "../../components/music/TrackTimeline";
import { ClampedNumber } from "../../components/ClampedNumber";
import { KindIcon } from "./KindIcon";
import { QuizPreview } from "./Preview";
import { errorsFor, validateContent, type QuestionField } from "./validate";
import { LETTERS } from "./views";
import { LevelIcon } from "../../components/live/SuperGame";
import { LEVEL_NAMES, newLevels, parsePenalty, parseStyle, PENALTY_TITLES, penaltyFor, STYLE_TITLES, SUPER_LIMITS, type SuperLevel, type SuperPenalty, type SuperStyle } from "../../core/supergame";

const KINDS: QuestionKind[] = ["choice", "open", "speed", "buzz", "pictures", "super"];

/** Конструктор квиза: список вопросов, правка, порядок, импорт списком и предпросмотр. */
export function QuizEditor({ gameId, themeId, content, onChange, editable }: EditorProps<QuizContent>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<QuizQuestion | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [toast, showToast] = useToast(3500);
  // Картинки, загруженные в этот раз: их можно сразу удалить при замене. Старые картинки
  // остаются до удаления игры — на них может ссылаться уже запущенная сессия.
  const uploadedHere = useRef(new Set<string>());
  // Сжатие занимает секунды: картинку ставим в актуальный список, а не в тот, что был до сжатия.
  const latest = useRef(content);
  latest.current = content;
  const errors = useMemo(() => validateContent(content), [content]);
  const questions = content.questions;
  const rounds = useMemo(() => quizRounds({ questions }), [questions]);
  const room = LIMITS.questions - questions.length;

  function setQuestions(next: QuizQuestion[]) {
    onChange({ ...content, questions: next });
  }

  function updateQuestion(id: string, patch: Partial<QuizQuestion> | ((q: QuizQuestion) => QuizQuestion)) {
    setQuestions(questions.map((q) => (q.id === id ? (typeof patch === "function" ? patch(q) : { ...q, ...patch }) : q)));
  }

  /** Убирает картинку из базы, если она загружена сейчас и больше ни в одном вопросе. */
  function releaseImage(mediaId: string | null, remaining: QuizQuestion[]) {
    if (!mediaId || !uploadedHere.current.has(mediaId)) return;
    if (remaining.some((q) => questionImages(q).includes(mediaId))) return;
    uploadedHere.current.delete(mediaId);
    void mediaRepo.remove(gameId, mediaId).catch(() => undefined);
  }

  function focusLater(selector: string) {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
  }

  function add(kind: QuestionKind = "choice") {
    const q = newQuestion(kind);
    setQuestions([...questions, q]);
    setOpenId(q.id);
    setAdding(false);
    focusLater(`#q-${q.id}-text`);
  }

  function duplicate(index: number) {
    const source = questions[index];
    if (!source || room <= 0) return;
    const copy = duplicateQuestion(source);
    setQuestions([...questions.slice(0, index + 1), copy, ...questions.slice(index + 1)]);
    setOpenId(copy.id);
    showToast("Вопрос продублирован");
  }

  function remove(question: QuizQuestion) {
    const remaining = questions.filter((q) => q.id !== question.id);
    setQuestions(remaining);
    for (const id of questionImages(question)) releaseImage(id, remaining);
    setToDelete(null);
    showToast("Вопрос удалён");
  }

  function move(index: number, to: number, focus?: "up" | "down") {
    const id = questions[index]?.id;
    setQuestions(moveItem(questions, index, to));
    // Фокус остаётся на той же кнопке у перемещённого вопроса.
    if (id && focus) focusLater(`[data-move="${id}-${focus}"]`);
  }

  /** Картинка вопроса (`slot` не задан) или одна из нескольких картинок (номер поля). */
  async function pickImage(question: QuizQuestion, file: File, slot?: Slot) {
    try {
      const image = await compressImage(file);
      const { mediaId, saved } = mediaRepo.upload(gameId, image);
      uploadedHere.current.add(mediaId);
      const current = latest.current;
      const found = current.questions.find((q) => q.id === question.id);
      const previous = found ? slotImage(found, slot) : null;
      const next = current.questions.map((q) => (q.id === question.id ? withSlotImage(q, slot, mediaId) : q));
      onChange({ ...current, questions: next });
      releaseImage(previous, next);
      saved.catch(() => showToast("Картинка не сохранилась. Проверьте интернет и выберите её ещё раз."));
    } catch (error) {
      showToast(error instanceof ImageError ? error.message : "Не получилось добавить картинку.");
    }
  }

  function removeImage(question: QuizQuestion, slot?: Slot) {
    const before = slotImage(question, slot);
    const next = questions.map((q) => (q.id === question.id ? withSlotImage(q, slot, null) : q));
    setQuestions(next);
    releaseImage(before, next);
  }

  // Перетаскивание мышью (на телефоне — кнопки вверх и вниз).
  function onDragOver(event: DragEvent, index: number) {
    if (!dragId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setDropIndex(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const from = questions.findIndex((q) => q.id === dragId);
    if (from >= 0 && dropIndex !== null) move(from, dropIndex > from ? dropIndex - 1 : dropIndex);
    setDragId(null);
    setDropIndex(null);
  }

  const generalErrors = errors.filter((e) => !e.path.startsWith("questions/"));

  return (
    <>
      <section className="card">
        <div className="stack stack--tight">
          <h2>Вопросы</h2>
          <p className="muted">
            {questions.length === 0
              ? editable
                ? "Добавьте первый вопрос или вставьте готовый список."
                : "В игре пока нет вопросов."
              : questionsLabel(questions.length)}
          </p>
        </div>
        {editable && generalErrors.map((e) => (
          <p key={e.message} className="error small">
            {e.message}
          </p>
        ))}
        {editable && (
          <div className="actions">
            <button type="button" className="btn btn--block" disabled={room <= 0} aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
              Добавить вопрос
            </button>
            <button type="button" className="btn btn--secondary btn--block" disabled={room <= 0} onClick={() => setImportOpen(true)}>
              Вставить списком
            </button>
          </div>
        )}
      </section>

      {editable && adding && <AddQuestion onPick={add} onClose={() => setAdding(false)} />}

      {editable && (
        <SettingsCard
          settings={settingsOf(content)}
          hasRace={questions.some((q) => q.kind === "buzz")}
          onChange={(settings) => onChange({ ...content, settings })}
        />
      )}

      {questions.length > 0 && (
        <ol className="q-list" aria-label="Вопросы игры" onDragLeave={(e) => e.currentTarget === e.target && setDropIndex(null)}>
          {questions.map((q, index) => {
            const own = errorsFor(errors, q.id);
            const expanded = openId === q.id;
            const menu: MenuAction[] = [{ label: "Предпросмотр", onClick: () => setPreview(index) }];
            if (editable) {
              if (room > 0) menu.push({ label: "Дублировать", onClick: () => duplicate(index) });
              menu.push({ label: "Удалить", onClick: () => setToDelete(q) });
            }
            const classes = ["card", "q-card"];
            if (dragId === q.id) classes.push("is-dragging");
            if (dropIndex === index) classes.push("drop-before");
            if (dropIndex === index + 1 && index === questions.length - 1) classes.push("drop-after");
            return (
              <li
                key={q.id}
                className={classes.join(" ")}
                onDragOver={(e) => onDragOver(e, index)}
                onDrop={onDrop}
              >
                <div className="q-card__head">
                  {editable && (
                    <span
                      className="q-card__handle"
                      draggable
                      title="Перетащите, чтобы поменять порядок"
                      aria-hidden="true"
                      onDragStart={(e) => {
                        setDragId(q.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", q.id);
                        const card = e.currentTarget.closest("li");
                        if (card) e.dataTransfer.setDragImage(card, 24, 24);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropIndex(null);
                      }}
                    >
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" />
                      </svg>
                    </span>
                  )}
                  <button
                    type="button"
                    className="q-card__summary"
                    aria-expanded={expanded}
                    aria-controls={`q-${q.id}-form`}
                    onClick={() => setOpenId(expanded ? null : q.id)}
                  >
                    <span className="q-card__number">{index + 1}</span>
                    <span className="q-card__titles">
                      {rounds.find((r) => r.from === index) && (
                        <span className="q-card__round">{roundTitle(rounds.find((r) => r.from === index) as (typeof rounds)[number])}</span>
                      )}
                      <span className="q-card__text">{q.text.trim() || "Без текста"}</span>
                      <span className="q-card__meta muted small">
                        {KIND_TITLES[q.kind]} · {q.timeLimit} с · {q.points} очк.
                        {q.imageId ? " · картинка" : ""}
                      </span>
                      {editable && own.length > 0 && <span className="q-card__issue">Нужно исправить: {own.length}</span>}
                    </span>
                  </button>
                  <ActionMenu icon="dots" label={`Действия с вопросом ${index + 1}`} actions={menu} />
                </div>

                {editable && (
                  <div className="q-card__toolbar">
                    <button
                      type="button"
                      className="btn btn--quiet q-card__move"
                      data-move={`${q.id}-up`}
                      disabled={index === 0}
                      aria-label={`Поднять вопрос ${index + 1} выше`}
                      onClick={() => move(index, index - 1, "up")}
                    >
                      <Arrow up />
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet q-card__move"
                      data-move={`${q.id}-down`}
                      disabled={index === questions.length - 1}
                      aria-label={`Опустить вопрос ${index + 1} ниже`}
                      onClick={() => move(index, index + 1, "down")}
                    >
                      <Arrow />
                    </button>
                    <button type="button" className="btn btn--quiet" onClick={() => setOpenId(expanded ? null : q.id)}>
                      {expanded ? "Свернуть" : "Изменить"}
                    </button>
                  </div>
                )}

                {expanded && (
                  <div id={`q-${q.id}-form`} className="q-card__body">
                    {editable ? (
                      <QuestionForm
                        gameId={gameId}
                        question={q}
                        errors={own}
                        onChange={(patch) => updateQuestion(q.id, patch)}
                        onPickImage={(file, slot) => pickImage(q, file, slot)}
                        onRemoveImage={(slot) => removeImage(q, slot)}
                      />
                    ) : (
                      <QuestionReadOnly gameId={gameId} question={q} />
                    )}
                    <div className="actions">
                      <button type="button" className="btn btn--secondary btn--block" onClick={() => setPreview(index)}>
                        Предпросмотр
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {editable && questions.length >= 3 && (
        <div className="actions">
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={room <= 0}
            onClick={() => {
              setAdding(true);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Добавить вопрос
          </button>
        </div>
      )}

      <QuizPreview gameId={gameId} themeId={themeId} content={content} index={preview} onIndex={setPreview} />
      {editable && (
        <ImportSheet
          open={importOpen}
          room={room}
          onClose={() => setImportOpen(false)}
          onAdd={(added) => {
            setQuestions([...questions, ...added]);
            setImportOpen(false);
            showToast(`Добавлено: ${questionsLabel(added.length)}`);
          }}
        />
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title="Удалить вопрос?"
        confirmLabel="Удалить вопрос"
        onConfirm={() => toDelete && remove(toDelete)}
        onCancel={() => setToDelete(null)}
      >
        <p>«{toDelete?.text.trim() || "Без текста"}» пропадёт из игры. Запущенные сессии не изменятся.</p>
      </ConfirmDialog>
      <Toast text={toast} />
    </>
  );
}

const BOARD_MODES: Array<{ id: QuizSettings["board"]; title: string; hint: string }> = [
  { id: "each", title: "После каждого вопроса", hint: "Ответ → таблица → следующий вопрос." },
  { id: "rounds", title: "В конце раунда", hint: "Таблица — только после последнего вопроса раунда (без раундов — в конце игры)." },
  { id: "manual", title: "По кнопке", hint: "После ответа — сразу следующий вопрос; таблицу ведущий показывает, когда захочет." },
];

/** Как проводить квиз: заставка вопроса, когда таблица, картинки на телефонах. */
function SettingsCard({ settings, hasRace, onChange }: { settings: QuizSettings; hasRace: boolean; onChange: (settings: QuizSettings) => void }) {
  return (
    <details className="card quiz-settings">
      <summary>
        <h2>Как проводить</h2>
        <span className="muted small">
          {settings.intro ? "с заставкой вопроса" : "без заставки"} · {BOARD_MODES.find((b) => b.id === settings.board)?.title.toLowerCase()}
          {settings.phoneImages ? " · картинки на телефонах" : ""}
        </span>
      </summary>
      <label className="choice">
        <input type="checkbox" checked={settings.intro} onChange={(e) => onChange({ ...settings, intro: e.target.checked })} />
        <span className="choice__text">
          <span className="choice__title">Заставка «Вопрос 2 из 8»</span>
          <span className="choice__hint">Без неё «Следующий вопрос» сразу открывает вопрос и таймер. Заставка раунда остаётся.</span>
        </span>
      </label>
      <fieldset>
        <legend>Таблица</legend>
        {BOARD_MODES.map((mode) => (
          <label key={mode.id} className="choice">
            <input type="radio" name="quiz-board" checked={settings.board === mode.id} onChange={() => onChange({ ...settings, board: mode.id })} />
            <span className="choice__text">
              <span className="choice__title">{mode.title}</span>
              <span className="choice__hint">{mode.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="choice">
        <input type="checkbox" checked={settings.phoneImages} onChange={(e) => onChange({ ...settings, phoneImages: e.target.checked })} />
        <span className="choice__text">
          <span className="choice__title">Картинки вопросов на телефонах гостей</span>
          <span className="choice__hint">Уменьшенная картинка над вариантами. В режиме «без экрана» показывается всегда.</span>
        </span>
      </label>
      {hasRace && (
        <label className="field">
          Гонка «Кто быстрее»: делений до финиша
          <ClampedNumber value={settings.raceTarget} min={QUIZ_LIMITS.minRace} max={QUIZ_LIMITS.maxRace} fallback={5} onChange={(raceTarget) => onChange({ ...settings, raceTarget })} />
          <span className="muted small">Кто первым угадает столько треков (супер-трек — 2–3 деления), тот выигрывает гонку.</span>
        </label>
      )}
    </details>
  );
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={up ? undefined : { transform: "rotate(180deg)" }}>
      <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function FieldErrors({ errors, field, questionId }: { errors: ValidationError[]; field: QuestionField; questionId: string }) {
  const own = errorsFor(errors, questionId, field);
  if (own.length === 0) return null;
  return (
    <span className="error small" id={`q-${questionId}-${field}-error`}>
      {own.map((e) => e.message).join(" ")}
    </span>
  );
}

interface FormProps {
  gameId: string;
  question: QuizQuestion;
  errors: ValidationError[];
  onChange: (patch: Partial<QuizQuestion> | ((q: QuizQuestion) => QuizQuestion)) => void;
  onPickImage: (file: File, slot?: Slot) => Promise<void>;
  onRemoveImage: (slot?: Slot) => void;
}

/** Где картинка: у вопроса (нет), в поле «Несколько картинок» (номер) или у уровня суперигры. */
type Slot = number | { level: number };

function slotImage(q: QuizQuestion, slot?: Slot): string | null {
  if (slot === undefined) return q.imageId;
  if (typeof slot === "number") return q.pictures?.[slot]?.imageId ?? null;
  return q.levels?.[slot.level]?.imageId ?? null;
}

function withSlotImage(q: QuizQuestion, slot: Slot | undefined, imageId: string | null): QuizQuestion {
  if (slot === undefined) return { ...q, imageId };
  if (typeof slot === "number") return { ...q, pictures: (q.pictures ?? []).map((p, i) => (i === slot ? { ...p, imageId } : p)) };
  return { ...q, levels: (q.levels ?? []).map((l, i) => (i === slot.level ? { ...l, imageId } : l)) };
}

function QuestionForm({ gameId, question: q, errors, onChange, onPickImage, onRemoveImage }: FormProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const has = (field: QuestionField) => errorsFor(errors, q.id, field).length > 0;
  const describedBy = (field: QuestionField) => (has(field) ? `q-${q.id}-${field}-error` : undefined);

  function setOption(i: number, value: string) {
    onChange((cur) => ({ ...cur, options: cur.options.map((o, j) => (j === i ? value : o)) }));
  }

  function removeOption(i: number) {
    onChange((cur) => {
      const options = cur.options.filter((_, j) => j !== i);
      // Верные варианты после удалённого сдвигаются на один вверх.
      const shifted = correctSet(cur)
        .filter((c) => c !== i)
        .map((c) => (c > i ? c - 1 : c));
      return { ...cur, options, correct: shifted[0] ?? -1, alsoCorrect: shifted.slice(1) };
    });
  }

  function setAnswer(i: number, value: string) {
    onChange((cur) => ({ ...cur, answers: cur.answers.map((a, j) => (j === i ? value : a)) }));
  }

  function numberValue(raw: string): number {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }

  return (
    <div className="stack">
      <fieldset>
        <legend>Формат вопроса</legend>
        <div className="format-tiles" role="radiogroup" aria-label="Формат вопроса">
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={q.kind === kind}
              className={q.kind === kind ? "format-tile is-on" : "format-tile"}
              onClick={() => onChange((cur) => changeKind(cur, kind))}
            >
              <KindIcon kind={kind} />
              <span>{KIND_TITLES[kind]}</span>
            </button>
          ))}
        </div>
        <p className="muted small">{KIND_HINTS[q.kind]}</p>
      </fieldset>

      <label className="field">
        {q.kind === "super" ? "Название на заставке" : "Вопрос"}
        <textarea
          id={`q-${q.id}-text`}
          rows={3}
          maxLength={LIMITS.text}
          value={q.text}
          aria-invalid={has("text")}
          aria-describedby={describedBy("text")}
          onChange={(e) => onChange({ text: e.target.value })}
        />
        <FieldErrors errors={errors} field="text" questionId={q.id} />
      </label>

      {q.kind === "super" ? (
        <SuperEditor gameId={gameId} question={q} errors={errors} onChange={onChange} onPickImage={onPickImage} onRemoveImage={onRemoveImage} />
      ) : q.kind === "pictures" ? (
        <PicturesEditor gameId={gameId} question={q} errors={errors} onChange={onChange} onPickImage={onPickImage} onRemoveImage={onRemoveImage} />
      ) : (
      <div className="field">
        <span>Картинка</span>
        {q.imageId ? (
          <div className="q-image">
            <MediaImage className="q-image__img" gameId={gameId} mediaId={q.imageId} variant="full" alt="Картинка к вопросу" />
            <div className="actions">
              <button type="button" className="btn btn--secondary btn--block" disabled={processing} onClick={() => fileRef.current?.click()}>
                {processing ? "Сжимаем…" : "Заменить картинку"}
              </button>
              <button type="button" className="btn btn--quiet btn--block" disabled={processing} onClick={() => onRemoveImage()}>
                Убрать картинку
              </button>
            </div>
          </div>
        ) : (
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" disabled={processing} onClick={() => fileRef.current?.click()}>
              {processing ? "Сжимаем…" : "Добавить картинку"}
            </button>
          </div>
        )}
        <span className="muted small">Картинку покажет экран зала. Мы уменьшим её на этом устройстве, чтобы она быстро грузилась.</span>
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
            // Сжатие идёт на устройстве; запись картинки уходит в очередь и дойдёт при связи.
            void onPickImage(file).finally(() => setProcessing(false));
          }}
        />
      </div>
      )}

      {q.kind === "pictures" || q.kind === "super" ? null : hasAnswers(q.kind) ? (
        <fieldset aria-describedby={describedBy("answers")}>
          <legend>{q.kind === "buzz" ? "Правильный ответ — видит только ведущий" : "Верные ответы"}</legend>
          <p className="muted small">
            {q.kind === "buzz"
              ? "Гость называет ответ вслух, ведущий сверяет и жмёт «Верно» или «Неверно»."
              : "Засчитывается любой из них. Регистр, ё/е, пробелы и знаки препинания не важны."}
          </p>
          {q.answers.map((answer, i) => (
            <div key={i} className="q-row">
              <input
                className="q-row__input"
                aria-label={`Верный ответ ${i + 1}`}
                maxLength={LIMITS.answer}
                value={answer}
                onChange={(e) => setAnswer(i, e.target.value)}
              />
              <RemoveButton
                label={`Удалить ответ ${i + 1}`}
                disabled={q.answers.length <= 1}
                onClick={() => onChange((cur) => ({ ...cur, answers: cur.answers.filter((_, j) => j !== i) }))}
              />
            </div>
          ))}
          <FieldErrors errors={errors} field="answers" questionId={q.id} />
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={q.answers.length >= LIMITS.answers}
            onClick={() => onChange((cur) => ({ ...cur, answers: [...cur.answers, ""] }))}
          >
            Добавить вариант написания
          </button>
        </fieldset>
      ) : (
        <fieldset aria-describedby={[describedBy("options"), describedBy("correct")].filter(Boolean).join(" ") || undefined}>
          <legend>Варианты ответа</legend>
          <p className="muted small">Отметьте галочкой правильный вариант — можно несколько, тогда засчитается любой. От 2 до 6 вариантов.</p>
          {q.options.map((option, i) => (
            <div key={i} className={correctSet(q).includes(i) ? "q-row q-row--correct" : "q-row"}>
              <input
                type="checkbox"
                className="check"
                checked={correctSet(q).includes(i)}
                aria-label={`Вариант ${LETTERS[i]} — правильный`}
                onChange={() => onChange((cur) => toggleCorrect(cur, i))}
              />
              <input
                className="q-row__input"
                aria-label={`Вариант ${LETTERS[i]}`}
                maxLength={LIMITS.option}
                value={option}
                onChange={(e) => setOption(i, e.target.value)}
              />
              <RemoveButton label={`Удалить вариант ${LETTERS[i]}`} disabled={q.options.length <= LIMITS.minOptions} onClick={() => removeOption(i)} />
            </div>
          ))}
          <FieldErrors errors={errors} field="options" questionId={q.id} />
          <FieldErrors errors={errors} field="correct" questionId={q.id} />
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={q.options.length >= LIMITS.maxOptions}
            onClick={() => onChange((cur) => ({ ...cur, options: [...cur.options, ""] }))}
          >
            Добавить вариант
          </button>
        </fieldset>
      )}

      {q.kind !== "super" && <TrackTimeline clip={clipOf(q)} onChange={(clip) => onChange((cur) => withClip(cur, clip))} />}

      {q.kind === "buzz" && (
        <div className="field">
          <span>За верный ответ — делений к финишу</span>
          <div className="seg" role="group" aria-label="Делений к финишу">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" className={(q.steps ?? 1) === n ? "seg__btn is-on" : "seg__btn"} aria-pressed={(q.steps ?? 1) === n} onClick={() => onChange({ steps: n })}>
                {n === 3 ? "3 · супер" : n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="q-numbers">
        {q.kind !== "buzz" && (
        <label className="field">
          Время, секунд
          <input
            type="number"
            inputMode="numeric"
            min={LIMITS.minTime}
            max={LIMITS.maxTime}
            step={5}
            value={q.timeLimit || ""}
            aria-invalid={has("timeLimit")}
            aria-describedby={describedBy("timeLimit")}
            onChange={(e) => onChange({ timeLimit: numberValue(e.target.value) })}
          />
          <FieldErrors errors={errors} field="timeLimit" questionId={q.id} />
        </label>
        )}
        {q.kind !== "super" && (
        <label className="field">
          {q.kind === "speed" ? "Очки, максимум" : q.kind === "pictures" ? "Очки за все картинки" : "Очки"}
          <input
            type="number"
            inputMode="numeric"
            min={LIMITS.minPoints}
            max={LIMITS.maxPoints}
            step={10}
            value={q.points || ""}
            aria-invalid={has("points")}
            aria-describedby={describedBy("points")}
            onChange={(e) => onChange({ points: numberValue(e.target.value) })}
          />
          <FieldErrors errors={errors} field="points" questionId={q.id} />
        </label>
        )}
      </div>
      {q.kind === "speed" && <p className="muted small">Самый быстрый верный ответ получает максимум, остальные — меньше.</p>}
      {q.kind === "pictures" && <p className="muted small">Очки делятся на картинки: угадал 3 из 4 — три четверти очков.</p>}

      <label className="field">
        Начать с этого вопроса раунд
        <input
          maxLength={LIMITS.round}
          placeholder="Название раунда, например «Кино»"
          value={q.round ?? ""}
          onChange={(e) => onChange({ round: e.target.value === "" ? null : e.target.value })}
        />
      </label>
      <p className="muted small">
        Пусто — вопрос продолжает прежний раунд. После последнего вопроса раунда экран покажет итоги раунда и общий счёт.
      </p>

      <label className="field">
        Заметка ведущему
        <textarea
          maxLength={LIMITS.note}
          rows={2}
          placeholder="Факт, шутка или подводка к вопросу — видно только на пульте"
          value={q.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </label>
    </div>
  );
}

function RemoveButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn btn--quiet q-row__remove" aria-label={label} disabled={disabled} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </button>
  );
}

function QuestionReadOnly({ gameId, question: q }: { gameId: string; question: QuizQuestion }) {
  return (
    <div className="stack stack--tight">
      <p>{q.text}</p>
      {q.imageId && <MediaImage className="q-image__img" gameId={gameId} mediaId={q.imageId} variant="full" alt="Картинка к вопросу" />}
      {q.kind === "pictures" ? (
        <ol className="import-item__options">
          {(q.pictures ?? []).map((p, i) => (
            <li key={i}>{p.answers.join(" / ") || "—"}</li>
          ))}
        </ol>
      ) : hasAnswers(q.kind) ? (
        <p className="muted">Верные ответы: {q.answers.join(" / ")}</p>
      ) : (
        <ul className="import-item__options">
          {q.options.map((o, i) => (
            <li key={i} className={correctSet(q).includes(i) ? "is-correct" : undefined}>
              {LETTERS[i]}. {o}
              {correctSet(q).includes(i) && <span className="visually-hidden"> (верный)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** «Добавить вопрос»: плитки форматов по блокам — классика, музыка, картинки. */
function AddQuestion({ onPick, onClose }: { onPick: (kind: QuestionKind) => void; onClose: () => void }) {
  return (
    <section className="card add-question" aria-label="Какой вопрос добавить">
      <div className="add-question__head">
        <h2>Добавить вопрос</h2>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {FORMAT_BLOCKS.map((block) => (
        <div key={block.id} className="stack stack--tight">
          <h3 className="add-question__block">{block.title}</h3>
          <div className="format-tiles">
            {QUESTION_FORMATS.filter((f) => f.block === block.id).map((f) => (
              <button key={f.id} type="button" className={`format-tile format-tile--${block.id}`} onClick={() => onPick(f.kind)}>
                <KindIcon kind={f.kind} music={f.music} picture={f.id === "image"} />
                <span>{f.title}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="muted small">Суперигру ставьте последним вопросом раунда: её очки войдут в счёт этого раунда.</p>
    </section>
  );
}

/** Несколько картинок: 2–4 поля, в каждом картинка и верные ответы к ней. */
function PicturesEditor({
  gameId,
  question: q,
  errors,
  onChange,
  onPickImage,
  onRemoveImage,
}: {
  gameId: string;
  question: QuizQuestion;
  errors: ValidationError[];
  onChange: FormProps["onChange"];
  onPickImage: FormProps["onPickImage"];
  onRemoveImage: FormProps["onRemoveImage"];
}) {
  const [processing, setProcessing] = useState<number | null>(null);
  const pics = q.pictures ?? [];
  const setAnswers = (slot: number, answers: string[]) =>
    onChange((cur) => ({ ...cur, pictures: (cur.pictures ?? []).map((p, i) => (i === slot ? { ...p, answers } : p)) }));
  return (
    <fieldset className="pictures-editor">
      <legend>Картинки и ответы</legend>
      <p className="muted small">От 2 до 4. Номер картинки гости увидят на экране и на телефоне.</p>
      {pics.map((p, i) => (
        <div key={i} className="pictures-editor__slot">
          <span className="pictures-editor__num">{i + 1}</span>
          <div className="stack stack--tight">
            {p.imageId ? (
              <MediaImage className="q-image__img" gameId={gameId} mediaId={p.imageId} variant="small" alt={`Картинка ${i + 1}`} />
            ) : (
              <span className="pictures-editor__empty">Нет картинки</span>
            )}
            <div className="actions actions--row">
              <label className="btn btn--secondary">
                {processing === i ? "Сжимаем…" : p.imageId ? "Заменить" : "Добавить картинку"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={processing !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setProcessing(i);
                    void onPickImage(file, i).finally(() => setProcessing(null));
                  }}
                />
              </label>
              {p.imageId && (
                <button type="button" className="btn btn--quiet" onClick={() => onRemoveImage(i)}>
                  Убрать
                </button>
              )}
            </div>
            {p.answers.map((a, j) => (
              <div key={j} className="q-row">
                <input
                  className="q-row__input"
                  aria-label={`Верный ответ к картинке ${i + 1}`}
                  placeholder="Верный ответ"
                  maxLength={QUIZ_LIMITS.answer}
                  value={a}
                  onChange={(e) => setAnswers(i, p.answers.map((x, k) => (k === j ? e.target.value : x)))}
                />
                <RemoveButton label="Удалить вариант написания" disabled={p.answers.length <= 1} onClick={() => setAnswers(i, p.answers.filter((_, k) => k !== j))} />
              </div>
            ))}
            <button type="button" className="btn btn--quiet" disabled={p.answers.length >= QUIZ_LIMITS.answers} onClick={() => setAnswers(i, [...p.answers, ""])}>
              + вариант написания
            </button>
            {pics.length > QUIZ_LIMITS.minPictures && (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  if (p.imageId) onRemoveImage(i);
                  onChange((cur) => ({ ...cur, pictures: (cur.pictures ?? []).filter((_, k) => k !== i) }));
                }}
              >
                Удалить картинку {i + 1}
              </button>
            )}
          </div>
        </div>
      ))}
      <FieldErrors errors={errors} field="pictures" questionId={q.id} />
      {pics.length < QUIZ_LIMITS.maxPictures && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => onChange((cur) => ({ ...cur, pictures: [...(cur.pictures ?? []), newPicture()] }))}>
          Добавить ещё картинку
        </button>
      )}
    </fieldset>
  );
}

/** Суперигра: оформление, правило ошибки и четыре уровня — очки, вопрос, картинка, верные ответы. */
function SuperEditor({
  gameId,
  question: q,
  errors,
  onChange,
  onPickImage,
  onRemoveImage,
}: {
  gameId: string;
  question: QuizQuestion;
  errors: ValidationError[];
  onChange: FormProps["onChange"];
  onPickImage: FormProps["onPickImage"];
  onRemoveImage: FormProps["onRemoveImage"];
}) {
  const [processing, setProcessing] = useState<number | null>(null);
  const levels = q.levels ?? newLevels();
  const style = parseStyle(q.superStyle);
  const penalty = parsePenalty(q.penalty);
  const setLevel = (i: number, patch: Partial<SuperLevel>) =>
    onChange((cur) => ({ ...cur, levels: (cur.levels ?? newLevels()).map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  return (
    <div className="stack super-editor">
      <div className="field">
        <span>Оформление</span>
        <div className="seg" role="group" aria-label="Оформление уровней">
          {(Object.keys(STYLE_TITLES) as SuperStyle[]).map((id) => (
            <button key={id} type="button" className={style === id ? "seg__btn is-on" : "seg__btn"} aria-pressed={style === id} onClick={() => onChange({ superStyle: id })}>
              {STYLE_TITLES[id]}
            </button>
          ))}
        </div>
      </div>
      <fieldset>
        <legend>Если ответ неверный</legend>
        <div className="stack stack--tight">
          {(Object.keys(PENALTY_TITLES) as SuperPenalty[]).map((id) => (
            <label key={id} className="choice">
              <input type="radio" name={`penalty-${q.id}`} checked={penalty === id} onChange={() => onChange({ penalty: id })} />
              <span className="choice__text">
                <span className="choice__title">{PENALTY_TITLES[id]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {levels.map((l, i) => (
        <fieldset key={i} className={`super-editor__level super-level--${["bronze", "silver", "gold", "diamond"][i]}`}>
          <legend className="super-editor__legend">
            <span className="super-editor__icon">
              <LevelIcon style={style} level={i} />
            </span>
            {LEVEL_NAMES[i]}
          </legend>
          <label className="field">
            Очки за верный ответ
            <input
              type="number"
              inputMode="numeric"
              min={SUPER_LIMITS.minPoints}
              max={SUPER_LIMITS.maxPoints}
              step={50}
              value={l.points || ""}
              onChange={(e) => setLevel(i, { points: Number.parseInt(e.target.value, 10) || 0 })}
            />
            <span className="muted small">{penaltyFor(penalty, i, l.points) > 0 ? `Ошибка — минус ${penaltyFor(penalty, i, l.points)}` : "Ошибка без штрафа"}</span>
          </label>
          <label className="field">
            Вопрос уровня
            <textarea rows={2} maxLength={SUPER_LIMITS.text} value={l.text} onChange={(e) => setLevel(i, { text: e.target.value })} />
          </label>
          {l.imageId ? (
            <div className="stack stack--tight">
              <MediaImage className="q-image__img" gameId={gameId} mediaId={l.imageId} variant="small" alt={`Картинка уровня «${LEVEL_NAMES[i]}»`} />
              <button type="button" className="btn btn--quiet" onClick={() => onRemoveImage({ level: i })}>
                Убрать картинку
              </button>
            </div>
          ) : (
            <label className="btn btn--secondary">
              {processing === i ? "Сжимаем…" : "Добавить картинку"}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={processing !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setProcessing(i);
                  void onPickImage(file, { level: i }).finally(() => setProcessing(null));
                }}
              />
            </label>
          )}
          {l.answers.map((a, j) => (
            <div key={j} className="q-row">
              <input
                className="q-row__input"
                aria-label={`Верный ответ, ${LEVEL_NAMES[i]}`}
                placeholder="Верный ответ"
                maxLength={SUPER_LIMITS.answer}
                value={a}
                onChange={(e) => setLevel(i, { answers: l.answers.map((x, k) => (k === j ? e.target.value : x)) })}
              />
              <RemoveButton label="Удалить вариант написания" disabled={l.answers.length <= 1} onClick={() => setLevel(i, { answers: l.answers.filter((_, k) => k !== j) })} />
            </div>
          ))}
          <button type="button" className="btn btn--quiet" disabled={l.answers.length >= SUPER_LIMITS.answers} onClick={() => setLevel(i, { answers: [...l.answers, ""] })}>
            + вариант написания
          </button>
        </fieldset>
      ))}
      <FieldErrors errors={errors} field="levels" questionId={q.id} />
      <p className="muted small">
        Капитаны выбирают уровень на телефоне, видят вопрос только своего уровня и пишут ответ. Экран зала показывает, кто какой уровень выбрал, а после «Показать ответы» —
        верно или нет и сколько очков.
      </p>
    </div>
  );
}
