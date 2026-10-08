// Конструктор «Правды или действия»: колода (правда и действие, пометка 18+), импорт списком, шаблоны,
// очки, круги, задания от гостей.
import { useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { useConfirm } from "../../components/ConfirmDialog";
import type { EditorProps } from "../types";
import { KIND_TITLES, newCardId, parseCardList, TRUTH_LIMITS, type TruthCard, type TruthContent, type TruthKind } from "./content";
import { DEMO_TRUTH, DEMO_TRUTH_ADULT } from "./demo";
import { validateTruth } from "./validate";

export function TruthEditor({ content, onChange, editable }: EditorProps<TruthContent>) {
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<TruthKind>("truth");
  const [dialog, confirm] = useConfirm();
  const latest = useRef(content);
  latest.current = content;
  const errors = validateTruth(content);
  const setCard = (id: string, patch: Partial<TruthCard>) => onChange({ ...latest.current, cards: latest.current.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const shown = content.cards.filter((c) => c.kind === filter);
  const count = (k: TruthKind, adult: boolean) => content.cards.filter((c) => c.kind === k && c.adult === adult).length;

  function replace(cards: TruthCard[], label: string, adult: boolean) {
    confirm({
      title: `${label}?`,
      text: "Все карточки заменятся карточками шаблона.",
      confirmLabel: "Заменить",
      run: () => onChange({ ...latest.current, adult, cards: cards.map((c) => ({ ...c, id: newCardId() })) }),
    });
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Как играем</h2>
        <p className="muted small">
          Игроки (или команды) ходят по очереди. Тот, чья очередь, касается половины карты на телефоне: «Правда» — честный ответ на вопрос, «Действие» — шуточное задание. Карточка открывается на экране, ведущий отмечает «Выполнено» или «Отказ». Гости могут прислать свои вопросы и задания — ведущий решает, брать ли их.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Очки за правду
            <ClampedNumber value={content.truthPoints} min={0} max={TRUTH_LIMITS.maxPoints} fallback={50} disabled={!editable} onChange={(truthPoints) => onChange({ ...content, truthPoints })} />
          </label>
          <label className="field">
            Очки за действие
            <ClampedNumber value={content.darePoints} min={0} max={TRUTH_LIMITS.maxPoints} fallback={100} disabled={!editable} onChange={(darePoints) => onChange({ ...content, darePoints })} />
          </label>
          <label className="field">
            Штраф за отказ (0 — фант от зала)
            <ClampedNumber value={content.refusePenalty} min={0} max={TRUTH_LIMITS.maxPoints} fallback={0} disabled={!editable} onChange={(refusePenalty) => onChange({ ...content, refusePenalty })} />
          </label>
          <label className="field">
            Кругов (0 — пока не остановите)
            <ClampedNumber value={content.rounds} min={0} max={TRUTH_LIMITS.maxRounds} fallback={3} disabled={!editable} onChange={(rounds) => onChange({ ...content, rounds })} />
          </label>
        </div>
        <label className="choice">
          <input type="checkbox" checked={content.guestCards} disabled={!editable} onChange={(e) => onChange({ ...content, guestCards: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Гости присылают свои вопросы и задания</span>
            <span className="choice__hint">С телефона, пока ходит другой игрок. На пульте — «В колоду» или «Не брать».</span>
          </span>
        </label>
        <label className="choice">
          <input type="checkbox" checked={content.adult} disabled={!editable} onChange={(e) => onChange({ ...content, adult: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Играть и карточками 18+</span>
            <span className="choice__hint">Только для взрослой компании. Без галочки карточки 18+ не выпадают.</span>
          </span>
        </label>
        {editable && (
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" onClick={() => replace(DEMO_TRUTH.cards, "Заполнить колодой «Для любой компании»", false)}>
              Колода «Для любой компании»
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => replace(DEMO_TRUTH_ADULT.cards, "Заполнить колодой «18+»", true)}>
              Колода «18+»
            </button>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>Колода</h2>
        <p className="muted small">
          Правда: {count("truth", false)}
          {count("truth", true) ? ` + ${count("truth", true)} (18+)` : ""} · Действие: {count("dare", false)}
          {count("dare", true) ? ` + ${count("dare", true)} (18+)` : ""}
        </p>
        <div className="td-suggest__kinds" role="tablist" aria-label="Вид карточек">
          {(["truth", "dare"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={`td-chip td-chip--${k}`} onClick={() => setFilter(k)}>
              {KIND_TITLES[k]}
            </button>
          ))}
        </div>
        <ol className="td-editor__list">
          {shown.map((c) => (
            <li key={c.id} className="td-editor__card">
              <textarea className="input" rows={2} maxLength={TRUTH_LIMITS.text} value={c.text} disabled={!editable} aria-label="Текст карточки" onChange={(e) => setCard(c.id, { text: e.target.value })} />
              <span className="td-editor__row">
                <label className="td-editor__adult">
                  <input type="checkbox" checked={c.adult} disabled={!editable} onChange={(e) => setCard(c.id, { adult: e.target.checked })} /> 18+
                </label>
                {editable && (
                  <button type="button" className="btn btn--quiet" onClick={() => confirm({ title: "Удалить карточку?", confirmLabel: "Удалить", run: () => onChange({ ...latest.current, cards: latest.current.cards.filter((x) => x.id !== c.id) }) })}>
                    Удалить
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
        {editable && (
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" disabled={content.cards.length >= TRUTH_LIMITS.cards} onClick={() => onChange({ ...content, cards: [...content.cards, { id: newCardId(), kind: filter, text: "", adult: false }] })}>
              + {KIND_TITLES[filter]}
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setImporting((v) => !v)}>
              Добавить списком
            </button>
          </div>
        )}
        {importing && (
          <div className="stack stack--tight">
            <p className="muted small">Каждая карточка с новой строки. «Правда: …» или «Действие: …» меняют вид; «18+» в начале — карточка для взрослых.</p>
            <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Правда: Кем вы мечтали стать в детстве?\nДействие: Станцуйте как робот\n18+ Правда: Самое смелое свидание?"} />
            <button type="button" className="btn btn--block" disabled={!text.trim()} onClick={() => { onChange({ ...latest.current, cards: [...latest.current.cards, ...parseCardList(text)].slice(0, TRUTH_LIMITS.cards) }); setText(""); setImporting(false); }}>
              Добавить в колоду
            </button>
          </div>
        )}
        {errors.length > 0 && (
          <ul className="error small">
            {errors.slice(0, 3).map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        )}
      </section>
      {dialog}
    </div>
  );
}
