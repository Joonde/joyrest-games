// Конструктор «Держи пари»: вопросы с ответом-числом, время на догадку и ставки, цена фишки и бонус автору.
import { useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { Fold } from "../../components/Fold";
import type { EditorProps } from "../types";
import { cleanNumber, formatNumber, newQuestion, START_CHIPS, WAGER_LIMITS, type WagerContent, type WagerQuestion } from "./content";
import { validateWager } from "./validate";

/** «Вставить списком»: строка «Вопрос? = 330 м» (после числа — единицы). */
export function importLines(text: string): WagerQuestion[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const at = line.lastIndexOf("=");
      if (at <= 0) return [];
      const m = /^\s*(-?[\d\s]+(?:[.,]\d+)?)\s*(.*)$/.exec(line.slice(at + 1));
      const answer = cleanNumber(m?.[1] ?? "");
      if (answer === null) return [];
      return [{ ...newQuestion(), text: line.slice(0, at).trim().slice(0, WAGER_LIMITS.text), answer, unit: (m?.[2] ?? "").trim().slice(0, WAGER_LIMITS.unit) }];
    });
}

export function WagerEditor({ content, onChange, editable }: EditorProps<WagerContent>) {
  const errors = validateWager(content);
  const latest = useRef(content);
  latest.current = content;
  const [paste, setPaste] = useState("");
  const update = (id: string, patch: Partial<WagerQuestion>) => onChange({ ...latest.current, questions: latest.current.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) });
  const imported = importLines(paste);

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Как играем</h2>
        <p className="muted small">
          Ответ на каждый вопрос — число. Капитаны пишут догадку на телефоне, потом догадки раскладываются на поле по возрастанию: в середине —
          2:1, к краям — 3:1, 4:1, 5:1, «меньше всех» — 6:1. Каждый ставит свои фишки (сколько хочет, до двух ячеек) на ответ, который ближе
          всех, но не больше правды. N фишек на верной ячейке при 5:1 превращаются в 5N, на других — сгорают; одна фишка несгораемая. Автору
          верной догадки — бонус фишками.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Секунд на догадку
            <ClampedNumber value={content.guessTime} min={WAGER_LIMITS.timeMin} max={WAGER_LIMITS.timeMax} fallback={60} disabled={!editable} onChange={(guessTime) => onChange({ ...content, guessTime })} />
          </label>
          <label className="field">
            Секунд на ставки
            <ClampedNumber value={content.betTime} min={WAGER_LIMITS.timeMin} max={WAGER_LIMITS.timeMax} fallback={45} disabled={!editable} onChange={(betTime) => onChange({ ...content, betTime })} />
          </label>
        </div>
        <p className="muted small">
          Счёт — фишки. В начале у каждого {START_CHIPS}, одна из них несгораемая. Игрок сам решает, сколько фишек поставить: 3 фишки на 3:1 — получит 9. Проиграл — ставка сгорает, но одна фишка остаётся всегда.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Бонус автору верной догадки, фишек
            <ClampedNumber value={content.authorBonus} min={0} max={WAGER_LIMITS.bonusChips} fallback={1} disabled={!editable} onChange={(authorBonus) => onChange({ ...content, authorBonus })} />
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
                <p key={e.path} className="error small">
                  {e.message}
                </p>
              ))}
              {editable && content.questions.length > 1 && (
                <button type="button" className="btn btn--quiet" onClick={() => onChange({ ...content, questions: content.questions.filter((x) => x.id !== q.id) })}>
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
            <button type="button" className="btn btn--secondary btn--block" disabled={content.questions.length >= WAGER_LIMITS.questions} onClick={() => onChange({ ...content, questions: [...content.questions, newQuestion()] })}>
              + Вопрос
            </button>
          </div>
          <Fold title="Вставить вопросы списком" value={imported.length > 0 ? `${imported.length}` : ""}>
            <div className="stack stack--tight">
              <p className="muted small">Каждый вопрос с новой строки, после «=» — ответ числом и единицы: «Высота Эльбруса? = 5642 м».</p>
              <label className="field">
                Список
                <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} />
              </label>
              <button
                type="button"
                className="btn btn--secondary btn--block"
                disabled={imported.length === 0 || content.questions.length >= WAGER_LIMITS.questions}
                onClick={() => {
                  const blank = content.questions.filter((q) => q.text.trim());
                  onChange({ ...content, questions: [...blank, ...imported].slice(0, WAGER_LIMITS.questions) });
                  setPaste("");
                }}
              >
                Добавить {imported.length > 0 ? imported.length : ""} в игру
              </button>
            </div>
          </Fold>
        </>
      )}
    </div>
  );
}

/** Поле числа: можно стирать и писать запятую, в игру уходит только правильное число. */
function NumberInput({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (n: number) => void }) {
  const [text, setText] = useState(formatNumber(value).replace(/ /g, " ").replace("−", "-"));
  const bad = cleanNumber(text) === null;
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
