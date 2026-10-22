// Конструктор «Держи пари»: вопросы с ответом-числом, время на догадку и ставки, цена фишки и бонус автору.
import { useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { Fold } from "../../components/Fold";
import { insertBack } from "../../components/undoRemove";
import { useUndoRemove } from "../../components/useUndoRemove";
import type { EditorProps } from "../types";
import { cleanNumber, formatNumber, newQuestion, START_CHIPS, WAGER_LIMITS, type WagerContent, type WagerQuestion } from "./content";
import { importWager } from "./importText";
import { validateWager } from "./validate";

export function WagerEditor({ content, onChange, editable }: EditorProps<WagerContent>) {
  const errors = validateWager(content);
  const latest = useRef(content);
  latest.current = content;
  const [paste, setPaste] = useState("");
  const update = (id: string, patch: Partial<WagerQuestion>) => onChange({ ...latest.current, questions: latest.current.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) });
  const parsed = importWager(paste);
  const imported = parsed.questions;
  const [importNote, setImportNote] = useState<string | null>(null);
  const { offer, bar } = useUndoRemove();

  /** Удалить вопрос — 7 секунд «Вернуть» на то же место. */
  function removeQuestion(q: WagerQuestion) {
    const index = latest.current.questions.findIndex((x) => x.id === q.id);
    if (index < 0) return;
    onChange({ ...latest.current, questions: latest.current.questions.filter((x) => x.id !== q.id) });
    offer(`Вопрос ${index + 1}${q.text.trim() ? ` «${q.text.trim().slice(0, 40)}»` : ""} удалён`, () =>
      onChange({ ...latest.current, questions: insertBack(latest.current.questions, { item: q, index }, (x) => x.id) }),
    );
  }

  function addImported() {
    const kept = latest.current.questions.filter((q) => q.text.trim());
    const all = [...kept, ...imported];
    const lost = Math.max(0, all.length - WAGER_LIMITS.questions);
    onChange({ ...latest.current, questions: all.slice(0, WAGER_LIMITS.questions) });
    setImportNote(
      [
        `Добавлено в конец: ${imported.length - lost}.`,
        lost > 0 ? `Больше ${WAGER_LIMITS.questions} вопросов в игре не берём — последние ${lost} из списка не вошли.` : "",
        parsed.skipped.length > 0 ? `Не разобрали строки: ${parsed.skipped.map((x) => x.line).join(", ")} — их нет в игре.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    setPaste("");
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>⚙️ Правила и настройки</h2>
        <p className="muted small">
          Ответ на каждый вопрос — число. Капитаны пишут догадку на телефоне, потом догадки раскладываются на поле по возрастанию: в середине —
          2:1, к краям — 3:1, 4:1, 5:1, «меньше всех» — 6:1. Каждый ставит свои фишки (сколько хочет, до двух ячеек) на ответ, который ближе
          всех, но не больше правды. N фишек на верной ячейке при 5:1 превращаются в 5N, на других — сгорают; одна фишка несгораемая. Автору
          верной догадки — бонус фишками.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Секунд на догадку
            <ClampedNumber value={content.guessTime} min={WAGER_LIMITS.timeMin} max={WAGER_LIMITS.timeMax} fallback={60} disabled={!editable} onChange={(guessTime) => onChange({ ...latest.current, guessTime })} />
          </label>
          <label className="field">
            Секунд на ставки
            <ClampedNumber value={content.betTime} min={WAGER_LIMITS.timeMin} max={WAGER_LIMITS.timeMax} fallback={45} disabled={!editable} onChange={(betTime) => onChange({ ...latest.current, betTime })} />
          </label>
        </div>
        <p className="muted small">
          Счёт — фишки. В начале у каждого {START_CHIPS}, одна из них несгораемая. Игрок сам решает, сколько фишек поставить: 3 фишки на 3:1 — получит 9. Проиграл — ставка сгорает, но одна фишка остаётся всегда.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Бонус автору верной догадки, фишек
            <ClampedNumber value={content.authorBonus} min={0} max={WAGER_LIMITS.bonusChips} fallback={1} disabled={!editable} onChange={(authorBonus) => onChange({ ...latest.current, authorBonus })} />
          </label>
        </div>
      </section>

      <section className="stack">
        <h2>Вопросы · {content.questions.length}</h2>
        {content.questions.map((q, i) => {
          const qErrors = errors.filter((e) => e.path.startsWith(`questions/${q.id}/`));
          return (
            <article key={q.id} className={qErrors.length ? "card stack stack--tight has-error" : "card stack stack--tight"}>
              <p className="eyebrow">Вопрос {i + 1}</p>
              <label className="field">
                Вопрос (ответ — число)
                <textarea rows={2} value={q.text} maxLength={WAGER_LIMITS.text} disabled={!editable} placeholder="Какова высота Эйфелевой башни?" onChange={(e) => update(q.id, { text: e.target.value })} />
              </label>
              <div className="row board-editor__size">
                <label className="field">
                  Правильный ответ
                  <NumberInput value={q.answer} disabled={!editable} onChange={(answer) => update(q.id, { answer })} />
                </label>
                <label className="field">
                  Единицы
                  <input value={q.unit} maxLength={WAGER_LIMITS.unit} disabled={!editable} placeholder="м, лет, штук" onChange={(e) => update(q.id, { unit: e.target.value })} />
                </label>
              </div>
              <label className="field">
                Пояснение после ответа (необязательно)
                <input value={q.note} maxLength={WAGER_LIMITS.note} disabled={!editable} placeholder="Откуда это число" onChange={(e) => update(q.id, { note: e.target.value })} />
              </label>
              {qErrors.map((e) => (
                <p key={e.path} className="error small edit-issue">
                  {e.message}
                </p>
              ))}
              {editable && content.questions.length > 1 && (
                <button type="button" className="btn btn--quiet" onClick={() => removeQuestion(q)}>
                  Удалить вопрос
                </button>
              )}
            </article>
          );
        })}
      </section>

      {editable && (
        <>
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" disabled={content.questions.length >= WAGER_LIMITS.questions} onClick={() => onChange({ ...latest.current, questions: [...latest.current.questions, newQuestion()] })}>
              + Вопрос
            </button>
          </div>
          <Fold title="Добавить списком" value={imported.length > 0 ? `${imported.length}` : ""}>
            <div className="stack stack--tight">
              <p className="muted small">Каждый вопрос с новой строки, после «=» — ответ числом и единицы: «Высота Эльбруса? = 5642 м».</p>
              <label className="field">
                Список
                <textarea
                  rows={6}
                  value={paste}
                  onChange={(e) => {
                    setPaste(e.target.value);
                    setImportNote(null);
                  }}
                />
              </label>
              {parsed.skipped.length > 0 && (
                <div className="muted small" role="status">
                  <p>Не разобрали строки — нет «=» или после него не число (пишите «= 330 м», без «около»):</p>
                  <ul>
                    {parsed.skipped.slice(0, 8).map((x) => (
                      <li key={x.line}>
                        Строка {x.line}: «{x.text.length > 60 ? `${x.text.slice(0, 60)}…` : x.text}»
                      </li>
                    ))}
                    {parsed.skipped.length > 8 && <li>и ещё {parsed.skipped.length - 8}</li>}
                  </ul>
                </div>
              )}
              <button
                type="button"
                className="btn btn--secondary btn--block"
                disabled={imported.length === 0 || content.questions.length >= WAGER_LIMITS.questions}
                onClick={addImported}
              >
                Добавить списком{imported.length > 0 ? ` · ${imported.length}` : ""}
              </button>
              {importNote && (
                <p className="muted small" role="status">
                  {importNote}
                </p>
              )}
            </div>
          </Fold>
        </>
      )}
      {bar}
    </div>
  );
}

/** Поле числа: можно стирать и писать запятую, в игру уходит только правильное число. */
function NumberInput({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (n: number) => void }) {
  const [text, setText] = useState(formatNumber(value).replace(/ /g, " ").replace("−", "-"));
  const bad = cleanNumber(text) === null; // пустое поле — тоже ошибка, а не ответ 0
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      disabled={disabled}
      aria-invalid={bad}
      onChange={(e) => {
        setText(e.target.value);
        const n = cleanNumber(e.target.value);
        if (n !== null) onChange(n);
      }}
    />
  );
}
