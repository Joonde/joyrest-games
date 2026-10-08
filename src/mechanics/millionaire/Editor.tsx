// Конструктор «Миллионера»: лестница из 12 ступеней (очки, несгораемые), подсказки в игре, вопросы по
// ступеням полосками (каждой команде нужен свой вопрос на ступень, плюс запасные для «Замены вопроса»).
import { useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { useConfirm } from "../../components/ConfirmDialog";
import { pointsLabel } from "../../core/results";
import type { EditorProps } from "../types";
import { LETTERS, LEVELS, LIFELINES, MILLIONAIRE_LIMITS, newMillionaireQuestion, parseMillionaireList, questionsOf, type MillionaireContent, type MillionaireQuestion } from "./content";
import { DEMO_MILLIONAIRE } from "./demo";
import { teamsCovered, validateMillionaire } from "./validate";

export function MillionaireEditor({ content, onChange, editable }: EditorProps<MillionaireContent>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const [dialog, confirm] = useConfirm();
  const latest = useRef(content);
  latest.current = content;
  const errors = validateMillionaire(content);
  const update = (id: string, patch: Partial<MillionaireQuestion>) => onChange({ ...latest.current, questions: latest.current.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) });

  function replaceAll(questions: MillionaireQuestion[], label: string) {
    confirm({
      title: `${label}?`,
      text: "Все вопросы игры заменятся новыми. Лестница и подсказки останутся.",
      confirmLabel: "Заменить вопросы",
      run: () => {
        onChange({ ...latest.current, questions: questions.map((q) => ({ ...q, id: newMillionaireQuestion().id })) });
        setImporting(false);
        setText("");
      },
    });
  }

  function add(level: number) {
    const q = newMillionaireQuestion(level);
    onChange({ ...latest.current, questions: [...latest.current.questions, q] });
    setOpenId(q.id);
  }

  function remove(q: MillionaireQuestion) {
    confirm({
      title: "Удалить вопрос?",
      text: q.text ? `«${q.text.slice(0, 80)}» пропадёт из игры.` : "Пустой вопрос пропадёт из игры.",
      confirmLabel: "Удалить вопрос",
      run: () => onChange({ ...latest.current, questions: latest.current.questions.filter((x) => x.id !== q.id) }),
    });
  }

  const covered = teamsCovered(content);

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Как играем</h2>
        <p className="muted small">
          12 вопросов с четырьмя вариантами. Команды ходят по очереди, у каждой на экране своя полоска-лестница: верный ответ — ступенью выше, ошибка — вниз до несгораемой. Капитан отвечает с телефона, подсказку просит там же или у ведущего; каждая подсказка — один раз за игру.
        </p>
        <fieldset>
          <legend>Кто играет</legend>
          <div className="seg" role="group" aria-label="Кто играет">
            <button type="button" className={content.players === "all" ? "seg__btn is-on" : "seg__btn"} aria-pressed={content.players === "all"} disabled={!editable} onClick={() => onChange({ ...content, players: "all" })}>
              Все команды по очереди
            </button>
            <button type="button" className={content.players === "one" ? "seg__btn is-on" : "seg__btn"} aria-pressed={content.players === "one"} disabled={!editable} onClick={() => onChange({ ...content, players: "one" })}>
              Одна команда
            </button>
          </div>
        </fieldset>
        <p className={covered >= 2 || content.players === "one" ? "muted small" : "error small"}>
          Вопросов хватит на {covered} {content.players === "one" ? "игру" : "команд"} (на каждой ступени по столько вопросов). Для «Замены вопроса» добавьте по одному запасному.
        </p>
        <fieldset>
          <legend>Подсказки в игре</legend>
          <div className="row profession-chips">
            {LIFELINES.map((l) => {
              const on = content.lifelines.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  className="pick-chip"
                  aria-pressed={on}
                  disabled={!editable}
                  title={l.hint}
                  onClick={() => onChange({ ...content, lifelines: on ? content.lifelines.filter((x) => x !== l.id) : [...content.lifelines, l.id] })}
                >
                  {l.icon} {l.title}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="row board-editor__size">
          <label className="field">
            Звонок другу, секунд
            <ClampedNumber value={content.callSeconds} min={MILLIONAIRE_LIMITS.minSeconds} max={MILLIONAIRE_LIMITS.maxSeconds} fallback={60} disabled={!editable} onChange={(callSeconds) => onChange({ ...content, callSeconds })} />
          </label>
          <label className="field">
            Голосование зала, секунд
            <ClampedNumber value={content.audienceSeconds} min={MILLIONAIRE_LIMITS.minSeconds} max={MILLIONAIRE_LIMITS.maxSeconds} fallback={20} disabled={!editable} onChange={(audienceSeconds) => onChange({ ...content, audienceSeconds })} />
          </label>
        </div>
        <details>
          <summary>Лестница: очки и несгораемые ступени</summary>
          <ol className="mil-ladder-editor">
            {content.ladder.map((points, i) => {
              const level = i + 1;
              const safe = content.safe.includes(level);
              return (
                <li key={level} className="row">
                  <span className="mil-ladder-editor__n">{level}</span>
                  <ClampedNumber value={points} min={0} max={MILLIONAIRE_LIMITS.maxPoints} fallback={points} disabled={!editable} onChange={(n) => onChange({ ...content, ladder: content.ladder.map((p, k) => (k === i ? n : p)) })} />
                  {level < LEVELS && (
                    <button type="button" className="pick-chip" aria-pressed={safe} disabled={!editable} onClick={() => onChange({ ...content, safe: safe ? content.safe.filter((s) => s !== level) : [...content.safe, level].sort((a, b) => a - b) })}>
                      Несгораемая
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {errors.filter((e) => e.path === "ladder").map((e) => (
            <p key={e.message} className="error small">
              {e.message}
            </p>
          ))}
        </details>
        {editable && (
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" onClick={() => replaceAll(DEMO_MILLIONAIRE.questions, "Заполнить шаблоном")}>
              Заполнить шаблоном (36 вопросов)
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setImporting((v) => !v)}>
              {importing ? "Скрыть вставку списком" : "Заполнить из списка"}
            </button>
          </div>
        )}
        {importing && editable && (
          <div className="stack stack--tight">
            <p className="muted small">Вопрос с новой строки, варианты — «- …», верный — «* …». «# Ступень 5» — следующие вопросы на 5-ю ступень; без неё вопросы идут по ступеням 1, 2, 3…</p>
            <textarea value={text} rows={10} placeholder={"# Ступень 1\nСтолица Франции?\n- Рим\n* Париж\n- Берлин\n- Мадрид"} onChange={(e) => setText(e.target.value)} />
            <button type="button" className="btn btn--block" disabled={!text.trim()} onClick={() => replaceAll(parseMillionaireList(text), "Заменить вопросы списком")}>
              Заменить вопросы
            </button>
          </div>
        )}
      </section>

      {Array.from({ length: LEVELS }, (_, i) => i + 1).map((level) => {
        const list = questionsOf(content, level);
        return (
          <section key={level} className="stack stack--tight">
            <h3>
              Ступень {level} · {pointsLabel(content.ladder[level - 1] ?? 0)}
              {content.safe.includes(level) ? " · несгораемая" : ""} · вопросов: {list.length}
            </h3>
            <ol className="quest-strips">
              {list.map((q) => {
                const open = openId === q.id;
                const mine = errors.filter((e) => e.path.startsWith(`questions/${q.id}/`));
                return (
                  <li key={q.id} className={`quest-strip${open ? " is-open" : ""}${mine.length > 0 ? " has-error" : ""}`}>
                    <button type="button" className="quest-strip__head" aria-expanded={open} onClick={() => setOpenId(open ? null : q.id)}>
                      <span className="quest-strip__n">{level}</span>
                      <span className="quest-strip__text line-clamp">{q.text || <span className="muted">Вопрос — заполните</span>}</span>
                    </button>
                    {open && (
                      <div className="stack stack--tight quest-strip__body">
                        <label className="field">
                          Вопрос
                          <textarea rows={2} maxLength={MILLIONAIRE_LIMITS.text} value={q.text} disabled={!editable} onChange={(e) => update(q.id, { text: e.target.value })} />
                        </label>
                        {q.options.map((o, k) => (
                          <div key={k} className="row mil-editor-option">
                            <label className="choice mil-editor-option__right">
                              <input type="radio" name={`correct-${q.id}`} checked={q.correct === k} disabled={!editable} onChange={() => update(q.id, { correct: k })} />
                              <span className="choice__text">
                                <span className="choice__title">{LETTERS[k]}</span>
                              </span>
                            </label>
                            <input aria-label={`Вариант ${LETTERS[k]}`} maxLength={MILLIONAIRE_LIMITS.option} value={o} disabled={!editable} onChange={(e) => update(q.id, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} />
                          </div>
                        ))}
                        <p className="muted small">Кружок — верный вариант (сейчас {LETTERS[q.correct]}).</p>
                        <label className="field">
                          Ступень
                          <ClampedNumber value={q.level} min={1} max={LEVELS} fallback={level} disabled={!editable} onChange={(n) => update(q.id, { level: n })} />
                        </label>
                        <label className="field">
                          Пояснение для ведущего (видит только пульт)
                          <input maxLength={MILLIONAIRE_LIMITS.note} value={q.note} disabled={!editable} onChange={(e) => update(q.id, { note: e.target.value })} />
                        </label>
                        {mine.map((e) => (
                          <p key={e.message} className="error small">
                            {e.message}
                          </p>
                        ))}
                        {editable && (
                          <button type="button" className="btn btn--quiet" onClick={() => remove(q)}>
                            Удалить вопрос
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {editable && content.questions.length < MILLIONAIRE_LIMITS.maxQuestions && (
              <button type="button" className="btn btn--quiet" onClick={() => add(level)}>
                + Вопрос на ступень {level}
              </button>
            )}
          </section>
        );
      })}
      {errors.some((e) => e.path === "questions") && (
        <div className="notice" role="note">
          {errors.filter((e) => e.path === "questions").map((e) => (
            <p key={e.message}>{e.message}</p>
          ))}
        </div>
      )}
      {dialog}
    </div>
  );
}
