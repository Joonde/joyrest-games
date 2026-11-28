/** Конструктор «Игр Матрёшки» (3d): все поля MatContent, без скрытой замены неполных своих вопросов на встроенные. */
import { ClampedNumber } from "../../../components/ClampedNumber";
import type { EditorProps } from "../../types";
import { FINALISTS_MAX, FINALISTS_MIN, OPTION_MAX_LEN, QUESTION_MAX_LEN, QUESTIONS_MAX, QUESTIONS_MIN } from "../rules/constants";
import { SHAPE_IDS } from "../rules/content";
import { SHAPE_TITLES } from "../rules/shapes";
import type { MatContent, Question, ShapeId, TrialKind } from "../rules/types";
import { validateMatryoshka } from "./validate";
import "./editor.css";

const TRIALS: Record<TrialKind, { title: string; hint: string }> = {
  freeze: { title: "1. Замри!", hint: "Всегда первое. Удержание зоны на телефоне, взгляд Матрёшки, откат на треть пути." },
  ginger: { title: "Пряник", hint: "Выбор коробки и обводка одной из четырёх фигур." },
  chairs: { title: "Стулья", hint: "Три захода, выбор стула на телефоне после остановки музыки." },
  rope: { title: "Канат", hint: "Две стороны, частые касания; болельщики помогают рывками." },
  hopscotch: { title: "Классики", hint: "Ледяные ряды, смельчаки и выбор клетки вслепую." },
};

const EMPTY_QUESTION = (): Question => ({ q: "", options: ["", ""], correct: 0 });
const DEFAULT_QUESTION = (n: number): Question => ({ q: `Вопрос ${n}`, options: ["Первый вариант", "Второй вариант"], correct: 0 });

export function MatryoshkaEditorView({ content, onChange, editable }: EditorProps<MatContent>) {
  const set = (patch: Partial<MatContent>) => onChange({ ...content, ...patch });
  const errors = validateMatryoshka(content);
  const enabled = content.trials.filter((t) => t.on).length;
  const setStyle = (style: MatContent["style"]) => {
    const wasAutomatic = content.lives === (content.style === "sunny" ? 2 : 1);
    set({ style, ...(wasAutomatic ? { lives: style === "sunny" ? 2 : 1 } : {}) });
  };
  const moveTrial = (index: number, delta: -1 | 1) => {
    if (index <= 0) return;
    const to = index + delta;
    if (to <= 0 || to >= content.trials.length) return;
    const trials = [...content.trials];
    const current = trials[index];
    const target = trials[to];
    if (!current || !target) return;
    trials[index] = target;
    trials[to] = current;
    set({ trials });
  };
  const toggleShape = (shape: ShapeId) => {
    const shapes = content.shapes.includes(shape) ? content.shapes.filter((s) => s !== shape) : [...content.shapes, shape];
    set({ shapes });
  };
  const setQuestion = (index: number, patch: Partial<Question>) => set({ questions: content.questions.map((q, i) => i === index ? { ...q, ...patch } : q) });
  const questionErrors = errors.filter((e) => e.path.startsWith("questions"));

  return <div className="stack mate-editor">
    <section className="card stack">
      <h2>⚙️ Правила и настройки</h2>
      <p className="muted small">Дворовые игры на вылет для 6–100 гостей, каждый сам. Сердечки — жизни, выбывшие остаются болельщиками. Финал — «Камень, ножницы, бумага». Экран зала обязателен.</p>
      <p className="meta"><span>Включено испытаний: {enabled}</span><span>≈ {enabled === 5 ? "20–25" : `${Math.max(8, enabled * 4)}–${Math.max(12, enabled * 5)}`} минут</span></p>
      {errors.length > 0 && <p className="error" role="alert">Перед запуском исправьте отмеченные настройки ниже.</p>}
    </section>

    <section className="card stack">
      <h2>Двор и оформление</h2>
      <label className="choice"><input type="radio" name="mat-style" checked={content.style === "sunny"} disabled={!editable} onChange={() => setStyle("sunny")} /><span className="choice__text"><span className="choice__title">Солнечный двор · гжель</span><span className="choice__hint">Кобальт по белому фарфору, дневной праздник, по умолчанию 2 сердечка.</span></span></label>
      <label className="choice"><input type="radio" name="mat-style" checked={content.style === "night"} disabled={!editable} onChange={() => setStyle("night")} /><span className="choice__text"><span className="choice__title">Ночной двор · хохлома</span><span className="choice__hint">Чёрный лак, золото и киноварь, более строгий «Пряник», по умолчанию 1 сердечко.</span></span></label>
    </section>

    <section className="card stack">
      <h2>Испытания и порядок</h2>
      {content.trials.map((trial, index) => <div className="card stack stack--tight" key={trial.kind}>
        <label className="choice"><input type="checkbox" checked={trial.on} disabled={!editable || trial.kind === "freeze"} onChange={(e) => set({ trials: content.trials.map((t, i) => i === index ? { ...t, on: e.target.checked } : t) })} /><span className="choice__text"><span className="choice__title">{TRIALS[trial.kind].title}</span><span className="choice__hint">{TRIALS[trial.kind].hint}</span></span></label>
        {index > 0 && <div className="actions"><button type="button" className="btn btn--secondary" disabled={!editable || index <= 1} onClick={() => moveTrial(index, -1)} aria-label={`Выше: ${TRIALS[trial.kind].title}`}>↑ Выше</button><button type="button" className="btn btn--secondary" disabled={!editable || index === content.trials.length - 1} onClick={() => moveTrial(index, 1)} aria-label={`Ниже: ${TRIALS[trial.kind].title}`}>↓ Ниже</button></div>}
      </div>)}
      <p className="muted small">После третьего сыгранного испытания доступен «Второй шанс». Выключенные и пропущенные в его счёт не входят.</p>
    </section>

    <section className="card stack">
      <h2>Игроки и продолжительность</h2>
      <label className="field">Финалистов — от {FINALISTS_MIN} до {FINALISTS_MAX}<ClampedNumber value={content.finalists} min={FINALISTS_MIN} max={FINALISTS_MAX} fallback={4} disabled={!editable} onChange={(finalists) => set({ finalists })} /></label>
      <p className="muted small">В финал не попадёт больше половины стартового зала: при 6 гостях финалистов не больше 3.</p>
      <span className="field__label">Сердечки на старте</span>
      <div className="seg" role="group" aria-label="Сердечки на старте">{([1, 2] as const).map((lives) => <button type="button" key={lives} className={content.lives === lives ? "seg__btn is-on" : "seg__btn"} aria-pressed={content.lives === lives} disabled={!editable} onClick={() => set({ lives })}>{lives === 1 ? "1 · взрослые" : "2 · дети"}</button>)}</div>
      <span className="field__label">Темп игры</span>
      <div className="seg" role="group" aria-label="Темп игры">{([["short", "Короче ×0,75"], ["normal", "Обычный"], ["long", "Дольше ×1,25"]] as const).map(([tempo, label]) => <button type="button" key={tempo} className={content.tempo === tempo ? "seg__btn is-on" : "seg__btn"} aria-pressed={content.tempo === tempo} disabled={!editable} onClick={() => set({ tempo })}>{label}</button>)}</div>
      <label className="choice"><input type="checkbox" checked={content.fanBets} disabled={!editable} onChange={(e) => set({ fanBets: e.target.checked })} /><span className="choice__text"><span className="choice__title">Прогнозы и ставки болельщиков</span><span className="choice__hint">Выбывшие угадывают число ошибок, помогают в «Канате» и ставят на дуэлянтов.</span></span></label>
    </section>

    <section className="card stack">
      <h2>Второй шанс</h2>
      <p className="muted small">После третьего сыгранного испытания вернётся процент от всех выбывших к этому моменту. Вернувшийся получает 1 сердечко.</p>
      <div className="seg" role="group" aria-label="Процент второго шанса">{([0, 5, 10, 20] as const).map((secondChance) => <button type="button" key={secondChance} className={content.secondChance === secondChance ? "seg__btn is-on" : "seg__btn"} aria-pressed={content.secondChance === secondChance} disabled={!editable} onClick={() => set({ secondChance })}>{secondChance === 0 ? "Выключен" : `${secondChance}%`}</button>)}</div>
    </section>

    <section className={errors.some((e) => e.path === "shapes") ? "card stack edit-issue" : "card stack"}>
      <h2>Фигуры для «Пряника»</h2>
      <p className="muted small">Выберите ровно 4. Сейчас: {content.shapes.length}. У фигур разная сложность, но одинаковая длина контура.</p>
      {SHAPE_IDS.map((shape) => <label className="choice" key={shape}><input type="checkbox" checked={content.shapes.includes(shape)} disabled={!editable || (!content.shapes.includes(shape) && content.shapes.length >= 4)} onChange={() => toggleShape(shape)} /><span className="choice__text"><span className="choice__title">{SHAPE_TITLES[shape]}</span></span></label>)}
      {errors.filter((e) => e.path === "shapes").map((e, i) => <p className="error" key={i}>{e.message}</p>)}
    </section>

    <section className={questionErrors.length > 0 ? "card stack edit-issue" : "card stack"}>
      <h2>Вопросы «Второго шанса»</h2>
      {content.questions.length === 0 ? <>
        <p className="muted small">Используются 10 встроенных семейных вопросов. Можно задать свои: от {QUESTIONS_MIN} до {QUESTIONS_MAX}, в каждом 2–4 варианта.</p>
        <button type="button" className="btn btn--secondary btn--block" disabled={!editable} onClick={() => set({ questions: Array.from({ length: QUESTIONS_MIN }, (_, i) => DEFAULT_QUESTION(i + 1)) })}>Написать свои вопросы</button>
      </> : <>
        {content.questions.map((q, index) => <QuestionEditor key={index} q={q} index={index} editable={editable} set={(patch) => setQuestion(index, patch)} remove={() => set({ questions: content.questions.filter((_, i) => i !== index) })} invalid={errors.some((e) => e.path === `questions/${index}`)} />)}
        <div className="actions"><button type="button" className="btn btn--secondary" disabled={!editable || content.questions.length >= QUESTIONS_MAX} onClick={() => set({ questions: [...content.questions, EMPTY_QUESTION()] })}>+ Добавить вопрос</button><button type="button" className="btn btn--quiet" disabled={!editable} onClick={() => set({ questions: [] })}>Вернуть встроенные</button></div>
        {questionErrors.map((e, i) => <p className="error small" role="alert" key={i}>{e.message}</p>)}
      </>}
    </section>
  </div>;
}

function QuestionEditor({ q, index, editable, set, remove, invalid }: { q: Question; index: number; editable: boolean; set: (patch: Partial<Question>) => void; remove: () => void; invalid: boolean }) {
  return <div className={invalid ? "card stack edit-issue" : "card stack"}>
    <div className="sectionheader"><h3>Вопрос {index + 1}</h3><button type="button" className="btn btn--quiet" disabled={!editable} onClick={remove}>Удалить</button></div>
    <label className="field">Текст вопроса<input value={q.q} maxLength={QUESTION_MAX_LEN} disabled={!editable} onChange={(e) => set({ q: e.target.value })} /></label>
    {q.options.map((option, optionIndex) => <div className="choice mate-option" key={optionIndex}>
      <input type="radio" name={`mat-correct-${index}`} checked={q.correct === optionIndex} disabled={!editable} onChange={() => set({ correct: optionIndex })} aria-label={`Верный ответ ${optionIndex + 1}`} />
      <label className="field" style={{ flex: 1 }}>Вариант {optionIndex + 1}<input value={option} maxLength={OPTION_MAX_LEN} disabled={!editable} onChange={(e) => set({ options: q.options.map((o, i) => i === optionIndex ? e.target.value : o) })} /></label>
      <button type="button" className="btn btn--quiet" disabled={!editable || q.options.length <= 2} onClick={() => set({ options: q.options.filter((_, i) => i !== optionIndex), correct: q.correct === optionIndex ? 0 : q.correct > optionIndex ? q.correct - 1 : q.correct })} aria-label={`Удалить вариант ${optionIndex + 1}`}>×</button>
    </div>)}
    <button type="button" className="btn btn--secondary" disabled={!editable || q.options.length >= 4} onClick={() => set({ options: [...q.options, ""] })}>+ Вариант ответа</button>
    <p className="muted small">Переключатель слева отмечает верный ответ. Гость увидит его только после итога.</p>
  </div>;
}
