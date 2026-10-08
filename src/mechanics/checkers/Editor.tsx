// Конструктор «Шашек»: время на ответ и вопросы (варианты или открытый ответ), импорт списком.
import { useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import type { EditorProps } from "../types";
import { CHECKERS_LIMITS, newCheckersQuestion, parseCheckersList, type CheckersContent, type CheckersQuestion } from "./content";
import { validateCheckers } from "./validate";

const LETTERS = ["A", "B", "C", "D"];

export function CheckersEditor({ content, onChange, editable }: EditorProps<CheckersContent>) {
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const errors = validateCheckers(content);
  const set = (questions: CheckersQuestion[]) => onChange({ ...content, questions });
  const update = (id: string, patch: Partial<CheckersQuestion>) => set(content.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  return (
    <div className="stack">
      <section className="card">
        <h2>Как играем</h2>
        <p className="muted small">
          Две команды: белые (подключились первыми) и чёрные. На экране — доска. На каждый вопрос отвечают обе команды; ход получает та, что ответила верно и быстрее. Капитан ходит с телефона по правилам русских шашек. Взятая шашка — 10 очков, дамка — 30, победа на доске — 50. Вопросы кончились — побеждает больший счёт.
        </p>
        <label className="field">
          Секунд на ответ
          <ClampedNumber value={content.timeLimit} min={CHECKERS_LIMITS.minTime} max={CHECKERS_LIMITS.maxTime} fallback={30} disabled={!editable} onChange={(timeLimit) => onChange({ ...content, timeLimit })} />
        </label>
        <p className="muted small">Партия обычно занимает 30–60 ходов — вопросов лучше заготовить побольше (40+), лишние просто не понадобятся.</p>
      </section>

      <section className="stack">
        <h2>Вопросы · {content.questions.length}</h2>
        {content.questions.map((q, i) => (
          <article key={q.id} className="card stack stack--tight">
            <div className="row checkers-editor__head">
              <strong>Вопрос {i + 1}</strong>
              <div className="seg" role="group" aria-label="Тип вопроса">
                {(["choice", "open"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={q.kind === kind ? "seg__btn is-on" : "seg__btn"}
                    aria-pressed={q.kind === kind}
                    disabled={!editable}
                    onClick={() => update(q.id, kind === "choice" ? { kind, options: q.options.length >= 2 ? q.options : ["", ""], answers: [] } : { kind, options: [], answers: q.answers.length ? q.answers : [""] })}
                  >
                    {kind === "choice" ? "Варианты" : "Открытый"}
                  </button>
                ))}
              </div>
            </div>
            <textarea value={q.text} maxLength={CHECKERS_LIMITS.text} disabled={!editable} placeholder="Текст вопроса" aria-label={`Вопрос ${i + 1}`} onChange={(e) => update(q.id, { text: e.target.value })} />
            {q.kind === "choice" ? (
              <fieldset className="stack stack--tight">
                <legend className="muted small">Отметьте верный вариант</legend>
                {q.options.map((o, oi) => (
                  <div key={oi} className="q-row">
                    <label className="checkers-editor__radio">
                      <input type="radio" name={`correct-${q.id}`} checked={q.correct === oi} disabled={!editable} onChange={() => update(q.id, { correct: oi })} />
                      {LETTERS[oi]}
                    </label>
                    <input value={o} maxLength={CHECKERS_LIMITS.option} disabled={!editable} aria-label={`Вариант ${LETTERS[oi]}`} onChange={(e) => update(q.id, { options: q.options.map((x, xi) => (xi === oi ? e.target.value : x)) })} />
                    {q.options.length > CHECKERS_LIMITS.minOptions && editable && (
                      <button type="button" className="btn btn--quiet" aria-label={`Убрать вариант ${LETTERS[oi]}`} onClick={() => update(q.id, { options: q.options.filter((_, xi) => xi !== oi), correct: q.correct === oi ? 0 : q.correct > oi ? q.correct - 1 : q.correct })}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {q.options.length < CHECKERS_LIMITS.maxOptions && editable && (
                  <button type="button" className="btn btn--quiet btn--block" onClick={() => update(q.id, { options: [...q.options, ""] })}>
                    + Вариант
                  </button>
                )}
              </fieldset>
            ) : (
              <label className="field">
                Верные ответы через «|»
                <input value={q.answers.join(" | ")} disabled={!editable} placeholder="Париж | Paris" onChange={(e) => update(q.id, { answers: e.target.value.split("|").map((a) => a.trim()).slice(0, CHECKERS_LIMITS.answers) })} />
              </label>
            )}
            {errors
              .filter((er) => er.path.startsWith(`questions/${q.id}/`))
              .map((er) => (
                <p key={er.message} className="error small">
                  {er.message}
                </p>
              ))}
            {editable && content.questions.length > 1 && (
              <button type="button" className="btn btn--quiet btn--block" onClick={() => set(content.questions.filter((x) => x.id !== q.id))}>
                Убрать вопрос
              </button>
            )}
          </article>
        ))}
      </section>

      {editable && (
        <div className="actions">
          <button type="button" className="btn btn--secondary btn--block" disabled={content.questions.length >= CHECKERS_LIMITS.questions} onClick={() => set([...content.questions, newCheckersQuestion()])}>
            + Вопрос
          </button>
          <button type="button" className="btn btn--quiet btn--block" onClick={() => setImporting((v) => !v)}>
            {importing ? "Скрыть вставку списком" : "Вставить списком"}
          </button>
        </div>
      )}
      {importing && editable && (
        <section className="card stack stack--tight">
          <p className="muted small">Вопрос — с новой строки. Варианты — с «-», верный — с «*». Открытый ответ — строка «= ответ | ответ».</p>
          <textarea value={text} rows={8} placeholder={"Столица Италии?\n- Милан\n* Рим\n- Неаполь\nСколько лап у паука?\n= 8 | восемь"} onChange={(e) => setText(e.target.value)} />
          <button
            type="button"
            className="btn btn--block"
            disabled={!text.trim()}
            onClick={() => {
              const added = parseCheckersList(text);
              const keep = content.questions.filter((q) => q.text.trim());
              set([...keep, ...added].slice(0, CHECKERS_LIMITS.questions));
              setText("");
              setImporting(false);
            }}
          >
            Добавить вопросы
          </button>
        </section>
      )}
    </div>
  );
}
