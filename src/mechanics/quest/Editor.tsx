// Конструктор «Активной настолки»: размер поля (40–100), клетки полосками, тип задания, список, шаблоны.
import { useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { useConfirm } from "../../components/ConfirmDialog";
import { TrackTimeline } from "../../components/music/TrackTimeline";
import { clipFields, parseClip } from "../../core/clip";
import { embedUrl } from "../dance/content";
import type { EditorProps } from "../types";
import { newQuestCell, parseQuestList, QUEST_EMOJI, QUEST_LIMITS, QUEST_TITLES, resizeQuest, STYLE_TITLES, type QuestCell, type QuestContent, type QuestKind, type QuestStyle } from "./content";
import { DEMO_QUEST, DEMO_QUEST_ADULT } from "./demo";
import { validateQuest } from "./validate";

const KINDS: QuestKind[] = ["task", "question", "dance", "karaoke", "bonus", "trap", "skip", "empty"];

export function QuestEditor({ content, onChange, editable }: EditorProps<QuestContent>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const [dialog, confirm] = useConfirm();
  const latest = useRef(content);
  latest.current = content;
  const errors = validateQuest(content);
  const update = (id: string, patch: Partial<QuestCell> | ((c: QuestCell) => QuestCell)) =>
    onChange({ ...latest.current, cells: latest.current.cells.map((c) => (c.id === id ? (typeof patch === "function" ? patch(c) : { ...c, ...patch }) : c)) });

  function fillFrom(cells: QuestCell[], label: string) {
    confirm({
      title: `${label}?`,
      text: "Задания в клетках заменятся новыми по порядку. Остальные клетки останутся.",
      confirmLabel: "Заполнить",
      run: () => {
        const current = latest.current;
        const size = Math.max(current.cells.length, Math.min(QUEST_LIMITS.maxCells, cells.length));
        const base = resizeQuest(current, size).cells;
        onChange({ ...current, cells: base.map((c, i) => cells[i] ?? c) });
        setImporting(false);
        setText("");
      },
    });
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Как играем</h2>
        <p className="muted small">
          На экране поле змейкой, фишки команд на старте. Капитан, чья очередь, жмёт «Бросить кубик» на телефоне — фишка идёт, открывается задание клетки. Ведущий решает: «Выполнено» (очки клетки) или «Не выполнено». Бонус и ловушка двигают фишку, «пропуск» — команда пропускает следующий ход. Кто первый на финише — получает бонус, дальше награждение.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Клеток на поле (40–100)
            <ClampedNumber value={content.cells.length} min={QUEST_LIMITS.minCells} max={QUEST_LIMITS.maxCells} fallback={40} disabled={!editable} onChange={(n) => onChange(resizeQuest(content, n))} />
          </label>
          <label className="field">
            Очки за финиш
            <ClampedNumber value={content.finishPoints} min={0} max={QUEST_LIMITS.maxPoints} fallback={200} disabled={!editable} onChange={(finishPoints) => onChange({ ...content, finishPoints })} />
          </label>
        </div>
        <fieldset>
          <legend>Оформление</legend>
          <div className="seg" role="group" aria-label="Оформление">
            {(Object.keys(STYLE_TITLES) as QuestStyle[]).map((style) => (
              <button key={style} type="button" className={content.style === style ? "seg__btn is-on" : "seg__btn"} aria-pressed={content.style === style} disabled={!editable} onClick={() => onChange({ ...content, style })}>
                {STYLE_TITLES[style]}
              </button>
            ))}
          </div>
        </fieldset>
        {editable && (
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" onClick={() => fillFrom(DEMO_QUEST.content.cells, "Заполнить шаблоном «Классика»")}>
              Заполнить шаблоном «Классика»
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => fillFrom(DEMO_QUEST_ADULT.content.cells, "Заполнить шаблоном «18+»")}>
              Заполнить шаблоном «18+»
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setImporting((v) => !v)}>
              {importing ? "Скрыть вставку списком" : "Заполнить из списка"}
            </button>
          </div>
        )}
        {importing && editable && (
          <div className="stack stack--tight">
            <p className="muted small">
              Строка — клетка по порядку. «Вопрос: текст = ответ», «Танец: …», «Караоке: …», «+3» (бонус), «Ловушка −2», «Пропуск», «Пусто», иначе — задание. В конце «(30)» — очки.
            </p>
            <textarea value={text} rows={10} placeholder={"Изобразите животное (20)\nВопрос: Столица Франции? = Париж\n+2\nТанец: Макарена (30)"} onChange={(e) => setText(e.target.value)} />
            <button type="button" className="btn btn--block" disabled={!text.trim()} onClick={() => fillFrom(parseQuestList(text), "Заполнить клетки из списка")}>
              Заполнить клетки
            </button>
          </div>
        )}
      </section>

      <section className="stack">
        <h2>Клетки · {content.cells.length}</h2>
        <ol className="quest-strips">
          {content.cells.map((cell, i) => {
            const open = openId === cell.id;
            const bad = errors.some((e) => e.path.startsWith(`cells/${cell.id}/`));
            return (
              <li key={cell.id} className={`quest-strip${open ? " is-open" : ""}${bad ? " has-error" : ""}`}>
                <button type="button" className="quest-strip__head" aria-expanded={open} onClick={() => setOpenId(open ? null : cell.id)}>
                  <span className="quest-strip__n">{i + 1}</span>
                  <span aria-hidden="true">{QUEST_EMOJI[cell.kind] || "·"}</span>
                  <span className="quest-strip__text line-clamp">
                    {cell.kind === "bonus" ? `Бонус +${cell.move}` : cell.kind === "trap" ? `Ловушка ${cell.move}` : cell.kind === "skip" ? "Пропуск хода" : cell.kind === "empty" ? "Пусто" : cell.text || <span className="muted">{QUEST_TITLES[cell.kind]} — заполните</span>}
                  </span>
                  {cell.points > 0 && <span className="quest-strip__pts">{cell.points}</span>}
                </button>
                {open && <CellForm cell={cell} editable={editable} errors={errors.filter((e) => e.path.startsWith(`cells/${cell.id}/`)).map((e) => e.message)} onChange={(p) => update(cell.id, p)} />}
              </li>
            );
          })}
        </ol>
      </section>
      {dialog}
    </div>
  );
}

function CellForm({ cell, editable, errors, onChange }: { cell: QuestCell; editable: boolean; errors: string[]; onChange: (p: Partial<QuestCell> | ((c: QuestCell) => QuestCell)) => void }) {
  const withTask = cell.kind === "task" || cell.kind === "question" || cell.kind === "dance" || cell.kind === "karaoke";
  return (
    <div className="stack stack--tight quest-strip__form">
      <div className="seg seg--wrap" role="group" aria-label="Что в клетке">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={cell.kind === kind ? "seg__btn is-on" : "seg__btn"}
            aria-pressed={cell.kind === kind}
            disabled={!editable}
            onClick={() => {
              const fresh = newQuestCell(kind);
              onChange({ kind, move: fresh.move, points: cell.points || fresh.points });
            }}
          >
            {QUEST_EMOJI[kind]} {QUEST_TITLES[kind]}
          </button>
        ))}
      </div>
      {withTask && (
        <>
          <label className="field">
            {cell.kind === "question" ? "Вопрос" : "Задание"}
            <textarea value={cell.text} maxLength={QUEST_LIMITS.text} disabled={!editable} onChange={(e) => onChange({ text: e.target.value })} />
          </label>
          {cell.kind === "question" && (
            <label className="field">
              Ответ — видит только ведущий
              <input value={cell.answer} maxLength={QUEST_LIMITS.answer} disabled={!editable} onChange={(e) => onChange({ answer: e.target.value })} />
            </label>
          )}
          <label className="field">
            Очки за выполнение
            <ClampedNumber value={cell.points} min={0} max={QUEST_LIMITS.maxPoints} fallback={20} disabled={!editable} onChange={(points) => onChange({ points })} />
          </label>
        </>
      )}
      {(cell.kind === "bonus" || cell.kind === "trap") && (
        <label className="field">
          {cell.kind === "bonus" ? "Вперёд на клеток" : "Назад на клеток"}
          <ClampedNumber value={Math.abs(cell.move)} min={1} max={QUEST_LIMITS.maxMove} fallback={2} disabled={!editable} onChange={(n) => onChange({ move: cell.kind === "bonus" ? n : -n })} />
        </label>
      )}
      {(cell.kind === "dance" || cell.kind === "karaoke") && (
        <label className="field">
          Видео (необязательно): YouTube, VK Видео или Rutube
          <input value={cell.videoUrl} inputMode="url" maxLength={QUEST_LIMITS.url} disabled={!editable} placeholder="https://youtu.be/…" onChange={(e) => onChange({ videoUrl: e.target.value.trim() })} />
          {cell.videoUrl && !embedUrl(cell.videoUrl) && <span className="error small">Эту ссылку экран не откроет.</span>}
        </label>
      )}
      {withTask && <TrackTimeline clip={parseClip(cell)} disabled={!editable} onChange={(clip) => onChange((c) => ({ ...c, ...(clipFields(clip) as Partial<QuestCell>) }))} />}
      {errors.map((m) => (
        <p key={m} className="error small">
          {m}
        </p>
      ))}
    </div>
  );
}
