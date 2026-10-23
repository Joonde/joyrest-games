import { useMemo, useState } from "react";
import { questionsLabel } from "../../core/results";
import { Sheet } from "../../components/Sheet";
import { KIND_TITLES, LIMITS, type QuizQuestion } from "./content";
import { IMPORT_EXAMPLE, parseImport } from "./importText";
import { LETTERS } from "./views";

interface Props {
  open: boolean;
  /** Сколько вопросов ещё помещается в игру. */
  room: number;
  onClose: () => void;
  onAdd: (questions: QuizQuestion[]) => void;
}

/** «Вставить списком»: текст в простом формате → распознанные вопросы → добавить. */
export function ImportSheet({ open, room, onClose, onAdd }: Props) {
  const [text, setText] = useState("");
  const result = useMemo(() => parseImport(text), [text]);
  const found = result.questions.slice(0, room);
  const withProblems = found.filter((q) => q.problems.length > 0).length;

  function add() {
    onAdd(found.map((q) => q.question));
    setText("");
  }

  return (
    <Sheet
      open={open}
      title="Добавить списком — в конец игры"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--block" disabled={found.length === 0} onClick={add}>
            {found.length > 0 ? `Добавить ${questionsLabel(found.length)}` : "Добавить вопросы"}
          </button>
          <button type="button" className="btn btn--secondary btn--block" onClick={onClose}>
            Отмена
          </button>
        </>
      }
    >
      <details className="import-help" open={text === ""}>
        <summary>Как записывать вопросы</summary>
        <ul className="import-help__list">
          <li>Каждый вопрос — с новой строки.</li>
          <li>
            Варианты — с новой строки через <kbd>-</kbd>, правильный помечен <kbd>*</kbd>.
          </li>
          <li>
            Варианты можно писать и так: <kbd>а) Москва</kbd>, <kbd>1. Москва</kbd>.
          </li>
          <li>
            Открытый ответ — строка <kbd>= ответ1 | ответ2</kbd>; варианты ответа — через <kbd>|</kbd> или <kbd> / </kbd> с
            пробелами (слитное «AC/DC», «300 км/ч» — один ответ).
          </li>
          <li>
            «Расставь по порядку» — карточки через <kbd>&gt;</kbd> в верном порядке, «Угадай число» — <kbd>~ 1665 ступеней</kbd>.
          </li>
          <li>
            Новый раунд — строка <kbd># Раунд: Кино</kbd>.
          </li>
          <li>
            Аукцион — строка <kbd># Аукцион: тема</kbd> перед вопросом (с вариантами или ответом).
          </li>
          <li>Тип «на скорость», картинку, время и очки можно поменять после добавления.</li>
        </ul>
        <pre className="import-example">{IMPORT_EXAMPLE}</pre>
        <div className="actions">
          <button type="button" className="btn btn--quiet btn--block" onClick={() => setText(IMPORT_EXAMPLE)}>
            Вставить пример
          </button>
        </div>
      </details>

      <label className="field">
        Текст с вопросами
        <textarea
          rows={8}
          value={text}
          spellCheck
          placeholder={"Вопрос?\n- вариант\n* правильный вариант"}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      {text.trim() !== "" && (
        <section className="stack stack--tight" aria-live="polite">
          <h3 className="import-title">
            {found.length === 0 ? "Вопросов не нашли" : `Распознано: ${questionsLabel(found.length)}`}
          </h3>
          {withProblems > 0 && (
            <p className="muted small">
              С замечаниями: {withProblems}. Они добавятся, а исправить их можно в конструкторе — до этого игру не
              запустить.
            </p>
          )}
          {result.questions.length > room && (
            <p className="error small import-note">
              В игре не больше {LIMITS.questions} вопросов: добавятся первые {room}.
            </p>
          )}
          {result.skipped.length > 0 && (
            <p className="muted small">
              Без вопроса и пропущены: строки {result.skipped.join(", ")}. Перед вариантами должен стоять вопрос.
            </p>
          )}
          <ol className="import-list">
            {found.map(({ question, line, problems }, i) => (
              <li key={`${line}-${i}`} className={problems.length > 0 ? "import-item import-item--warn" : "import-item"}>
                <p className="import-item__head">
                  <strong>
                    {i + 1}. {question.text || "Без текста"}
                  </strong>
                  <span className="muted small"> · {KIND_TITLES[question.kind]}</span>
                </p>
                {question.kind === "auction" && (
                  <p className="small">Тема аукциона: {question.topic?.trim() ? `«${question.topic.trim()}»` : "скрыта"}</p>
                )}
                {question.kind === "open" || (question.kind === "auction" && question.auctionAnswer === "open") ? (
                  <p className="small">
                    {/* Каждый ответ в кавычках через «|»: видно, как разбили («AC/DC» — один ответ). */}
                    {question.answers.length === 1 ? "Верный ответ" : `Верные ответы (${question.answers.length})`}:{" "}
                    {question.answers.length > 0 ? question.answers.map((a) => `«${a}»`).join(" | ") : "—"}
                  </p>
                ) : question.kind === "number" ? (
                  <p className="small">
                    Верное число:{" "}
                    {question.number === null || question.number === undefined
                      ? "—"
                      : `${question.number.toLocaleString("ru-RU")}${question.unit ? ` ${question.unit}` : ""}`}
                  </p>
                ) : question.kind === "order" ? (
                  <>
                    <p className="small muted">Верный порядок:</p>
                    <ol className="import-item__options small">
                      {question.options.map((o, j) => (
                        <li key={j}>{o || "—"}</li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <ul className="import-item__options small">
                    {question.options.map((o, j) => (
                      <li key={j} className={j === question.correct ? "is-correct" : undefined}>
                        {LETTERS[j]}. {o || "—"}
                        {j === question.correct && <span className="visually-hidden"> (верный)</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {problems.map((p) => (
                  <p key={p} className="error small import-note">
                    {p}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </section>
      )}
    </Sheet>
  );
}
