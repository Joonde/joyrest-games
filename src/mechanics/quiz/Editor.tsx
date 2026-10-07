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
  correctSet,
  settingsOf,
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
import { QuizPreview } from "./Preview";
import { errorsFor, validateContent, type QuestionField } from "./validate";
import { LETTERS } from "./views";

const KINDS: QuestionKind[] = ["choice", "open", "speed"];

/** Конструктор квиза: список вопросов, правка, порядок, импорт списком и предпросмотр. */
export function QuizEditor({ gameId, themeId, content, onChange, editable }: EditorProps<QuizContent>) {
  const [openId, setOpenId] = useState<string | null>(null);
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
    if (remaining.some((q) => q.imageId === mediaId)) return;
    uploadedHere.current.delete(mediaId);
    void mediaRepo.remove(gameId, mediaId).catch(() => undefined);
  }

  function focusLater(selector: string) {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
  }

  function add() {
    const q = newQuestion("choice");
    setQuestions([...questions, q]);
    setOpenId(q.id);
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
    releaseImage(question.imageId, remaining);
    setToDelete(null);
    showToast("Вопрос удалён");
  }

  function move(index: number, to: number, focus?: "up" | "down") {
    const id = questions[index]?.id;
    setQuestions(moveItem(questions, index, to));
    // Фокус остаётся на той же кнопке у перемещённого вопроса.
    if (id && focus) focusLater(`[data-move="${id}-${focus}"]`);
  }

  async function pickImage(question: QuizQuestion, file: File) {
    try {
      const image = await compressImage(file);
      const { mediaId, saved } = mediaRepo.upload(gameId, image);
      uploadedHere.current.add(mediaId);
      const current = latest.current;
      const previous = current.questions.find((q) => q.id === question.id)?.imageId ?? null;
      const next = current.questions.map((q) => (q.id === question.id ? { ...q, imageId: mediaId } : q));
      onChange({ ...current, questions: next });
      releaseImage(previous, next);
      saved.catch(() => showToast("Картинка не сохранилась. Проверьте интернет и выберите её ещё раз."));
    } catch (error) {
      showToast(error instanceof ImageError ? error.message : "Не получилось добавить картинку.");
    }
  }

  function removeImage(question: QuizQuestion) {
    const next = questions.map((q) => (q.id === question.id ? { ...q, imageId: null } : q));
    setQuestions(next);
    releaseImage(question.imageId, next);
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
            <button type="button" className="btn btn--block" disabled={room <= 0} onClick={add}>
              Добавить вопрос
            </button>
            <button type="button" className="btn btn--secondary btn--block" disabled={room <= 0} onClick={() => setImportOpen(true)}>
              Вставить списком
            </button>
          </div>
        )}
      </section>

      {editable && <SettingsCard settings={settingsOf(content)} onChange={(settings) => onChange({ ...content, settings })} />}

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
                        onPickImage={(file) => pickImage(q, file)}
                        onRemoveImage={() => removeImage(q)}
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
          <button type="button" className="btn btn--secondary btn--block" disabled={room <= 0} onClick={add}>
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
function SettingsCard({ settings, onChange }: { settings: QuizSettings; onChange: (settings: QuizSettings) => void }) {
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
  onPickImage: (file: File) => Promise<void>;
  onRemoveImage: () => void;
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
        <legend>Тип вопроса</legend>
        {KINDS.map((kind) => (
          <label key={kind} className="choice">
            <input type="radio" name={`kind-${q.id}`} checked={q.kind === kind} onChange={() => onChange((cur) => changeKind(cur, kind))} />
            <span className="choice__text">
              <span className="choice__title">{KIND_TITLES[kind]}</span>
              <span className="choice__hint">{KIND_HINTS[kind]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="field">
        Вопрос
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

      <div className="field">
        <span>Картинка</span>
        {q.imageId ? (
          <div className="q-image">
            <MediaImage className="q-image__img" gameId={gameId} mediaId={q.imageId} variant="full" alt="Картинка к вопросу" />
            <div className="actions">
              <button type="button" className="btn btn--secondary btn--block" disabled={processing} onClick={() => fileRef.current?.click()}>
                {processing ? "Сжимаем…" : "Заменить картинку"}
              </button>
              <button type="button" className="btn btn--quiet btn--block" disabled={processing} onClick={onRemoveImage}>
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

      {q.kind === "open" ? (
        <fieldset aria-describedby={describedBy("answers")}>
          <legend>Верные ответы</legend>
          <p className="muted small">Засчитывается любой из них. Регистр, ё/е, пробелы и знаки препинания не важны.</p>
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

      <div className="q-numbers">
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
        <label className="field">
          {q.kind === "speed" ? "Очки, максимум" : "Очки"}
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
      </div>
      {q.kind === "speed" && <p className="muted small">Самый быстрый верный ответ получает максимум, остальные — меньше.</p>}

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
      {q.kind === "open" ? (
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
