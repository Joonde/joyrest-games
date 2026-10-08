// Конструктор «Боя с драконом»: бои (имя и здоровье дракона), задания полосками со свойством (Ум, Ловкость —
// вопрос; Сила, Харизма — задание; Удача — кубик), жизни команд, бонусы; шаблоны «Классика» и «Для детей».
import { useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { useConfirm } from "../../components/ConfirmDialog";
import type { EditorProps } from "../types";
import { DRAGON_LIMITS, HEROES, LETTERS_RU, newBattle, newDragonTask, parseDragonList, STATS, type DragonBattle, type DragonContent, type DragonTask, type Stat } from "./content";
import { DEMO_DRAGON, DEMO_DRAGON_KIDS } from "./demo";
import { validateDragon } from "./validate";

/** Вид задания по свойству: Удача — кубик, Сила и Харизма — задание, Ум и Ловкость — вопрос. */
const kindFor = (stat: Stat): DragonTask["kind"] => (stat === "luck" ? "dice" : stat === "str" || stat === "cha" ? "task" : "choice");

export function DragonEditor({ content, onChange, editable }: EditorProps<DragonContent>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const [dialog, confirm] = useConfirm();
  const latest = useRef(content);
  latest.current = content;
  const errors = validateDragon(content);

  const setBattle = (id: string, patch: Partial<DragonBattle>) => onChange({ ...latest.current, battles: latest.current.battles.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const setTask = (bid: string, tid: string, patch: Partial<DragonTask>) =>
    onChange({ ...latest.current, battles: latest.current.battles.map((b) => (b.id === bid ? { ...b, tasks: b.tasks.map((t) => (t.id === tid ? { ...t, ...patch } : t)) } : b)) });

  function replace(battles: DragonBattle[], label: string, style?: DragonContent["style"], lives?: number) {
    confirm({
      title: `${label}?`,
      text: "Все бои и задания заменятся новыми.",
      confirmLabel: "Заменить",
      run: () => {
        onChange({ ...latest.current, battles: battles.map((b) => ({ ...b, id: newBattle().id, tasks: b.tasks.map((t) => ({ ...t, id: newDragonTask().id })) })), ...(style ? { style } : {}), ...(lives ? { lives } : {}) });
        setImporting(false);
        setText("");
      },
    });
  }

  function removeTask(bid: string, tid: string) {
    confirm({
      title: "Удалить задание?",
      confirmLabel: "Удалить",
      run: () => onChange({ ...latest.current, battles: latest.current.battles.map((b) => (b.id === bid ? { ...b, tasks: b.tasks.filter((t) => t.id !== tid) } : b)) }),
    });
  }

  function removeBattle(b: DragonBattle) {
    confirm({
      title: `Удалить бой «${b.name}»?`,
      text: "Бой пропадёт вместе с заданиями.",
      confirmLabel: "Удалить бой",
      run: () => onChange({ ...latest.current, battles: latest.current.battles.filter((x) => x.id !== b.id) }),
    });
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Как играем</h2>
        <p className="muted small">
          Капитаны выбирают героя ({HEROES.map((h) => h.name.toLowerCase()).join(", ")}) — у каждого своя сила — и раскладывают 5 очков по свойствам. В бою каждое задание помечено свойством: урон дракону = урон задания × (1 + свойство героя). Не справились — дракон отнимает жизнь; жизни кончились — команда теряет очки боя и ждёт следующего. Дракон дожил до конца боя — все теряют очки боя. Добили — бонус за последний удар и выжившим.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Жизни команды в бою
            <ClampedNumber value={content.lives} min={1} max={DRAGON_LIMITS.maxLives} fallback={3} disabled={!editable} onChange={(lives) => onChange({ ...content, lives })} />
          </label>
          <label className="field">
            Бонус за последний удар
            <ClampedNumber value={content.killBonus} min={0} max={DRAGON_LIMITS.maxPower} fallback={300} disabled={!editable} onChange={(killBonus) => onChange({ ...content, killBonus })} />
          </label>
          <label className="field">
            Бонус выжившим за победу
            <ClampedNumber value={content.winBonus} min={0} max={DRAGON_LIMITS.maxPower} fallback={100} disabled={!editable} onChange={(winBonus) => onChange({ ...content, winBonus })} />
          </label>
        </div>
        {editable && (
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" onClick={() => replace(DEMO_DRAGON.battles, "Заполнить шаблоном «Классика»", "classic", DEMO_DRAGON.lives)}>
              Шаблон «Классика»
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => replace(DEMO_DRAGON_KIDS.battles, "Заполнить шаблоном «Для детей»", "kids", DEMO_DRAGON_KIDS.lives)}>
              Шаблон «Для детей»
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setImporting((v) => !v)}>
              {importing ? "Скрыть вставку списком" : "Заполнить из списка"}
            </button>
          </div>
        )}
        {importing && editable && (
          <div className="stack stack--tight">
            <p className="muted small">«# Бой: Огненный дракон 2000» — новый бой и его здоровье. Задание — «Ум: вопрос?» с вариантами «- …» и верным «* …»; «Сила: …» и «Харизма: …» — задание; «Удача» — кубик. «(150)» в конце — урон.</p>
            <textarea value={text} rows={10} placeholder={"# Бой: Огненный дракон 2000\nУм: Столица Франции?\n- Рим\n* Париж\n- Берлин\n- Мадрид\nСила: 10 приседаний всей командой (150)\nУдача: бросок!"} onChange={(e) => setText(e.target.value)} />
            <button type="button" className="btn btn--block" disabled={!text.trim()} onClick={() => replace(parseDragonList(text), "Заменить бои списком")}>
              Заменить бои
            </button>
          </div>
        )}
      </section>

      {content.battles.map((battle, bi) => (
        <section key={battle.id} className="card stack">
          <h2>
            🐉 Бой {bi + 1}: {battle.name}
          </h2>
          <div className="row board-editor__size">
            <label className="field">
              Имя дракона
              <input maxLength={60} value={battle.name} disabled={!editable} onChange={(e) => setBattle(battle.id, { name: e.target.value })} />
            </label>
            <label className="field">
              Здоровье дракона
              <ClampedNumber value={battle.hp} min={1} max={DRAGON_LIMITS.maxHp} fallback={1500} disabled={!editable} onChange={(hp) => setBattle(battle.id, { hp })} />
            </label>
          </div>
          <ol className="quest-strips">
            {battle.tasks.map((task, ti) => {
              const open = openId === task.id;
              const mine = errors.filter((e) => e.path.startsWith(`tasks/${task.id}/`));
              const stat = STATS.find((s) => s.id === task.stat);
              return (
                <li key={task.id} className={`quest-strip${open ? " is-open" : ""}${mine.length > 0 ? " has-error" : ""}`}>
                  <button type="button" className="quest-strip__head" aria-expanded={open} onClick={() => setOpenId(open ? null : task.id)}>
                    <span className="quest-strip__n">{ti + 1}</span>
                    <span aria-hidden="true">{stat?.icon}</span>
                    <span className="quest-strip__text line-clamp">{task.kind === "dice" ? task.text || "Бросок кубика" : task.text || <span className="muted">{stat?.title} — заполните</span>}</span>
                    <span className="quest-strip__pts">{task.power}</span>
                  </button>
                  {open && (
                    <div className="stack stack--tight quest-strip__body">
                      <div className="seg" role="group" aria-label="Свойство задания">
                        {STATS.map((s) => (
                          <button key={s.id} type="button" className={task.stat === s.id ? "seg__btn is-on" : "seg__btn"} aria-pressed={task.stat === s.id} disabled={!editable} onClick={() => setTask(battle.id, task.id, { stat: s.id, kind: kindFor(s.id), seconds: kindFor(s.id) === "choice" ? task.seconds || 30 : 0 })}>
                            {s.icon} {s.title}
                          </button>
                        ))}
                      </div>
                      <p className="muted small">{task.kind === "choice" ? "Вопрос: отвечает капитан, верно — удар." : task.kind === "task" ? "Задание: ведущий отмечает, кто выполнил." : "Кубик: капитан бросает на телефоне, урон по числу."}</p>
                      <label className="field">
                        {task.kind === "choice" ? "Вопрос" : task.kind === "task" ? "Задание" : "Подпись (необязательно)"}
                        <textarea rows={2} maxLength={DRAGON_LIMITS.text} value={task.text} disabled={!editable} onChange={(e) => setTask(battle.id, task.id, { text: e.target.value })} />
                      </label>
                      {task.kind === "choice" &&
                        task.options.map((o, k) => (
                          <div key={k} className="row mil-editor-option">
                            <label className="choice mil-editor-option__right">
                              <input type="radio" name={`dr-correct-${task.id}`} checked={task.correct === k} disabled={!editable} onChange={() => setTask(battle.id, task.id, { correct: k })} />
                              <span className="choice__text">
                                <span className="choice__title">{LETTERS_RU[k]}</span>
                              </span>
                            </label>
                            <input aria-label={`Вариант ${LETTERS_RU[k]}`} maxLength={DRAGON_LIMITS.option} value={o} disabled={!editable} onChange={(e) => setTask(battle.id, task.id, { options: task.options.map((x, j) => (j === k ? e.target.value : x)) })} />
                          </div>
                        ))}
                      <div className="row board-editor__size">
                        <label className="field">
                          Урон
                          <ClampedNumber value={task.power} min={1} max={DRAGON_LIMITS.maxPower} fallback={100} disabled={!editable} onChange={(power) => setTask(battle.id, task.id, { power })} />
                        </label>
                        {task.kind === "choice" && (
                          <label className="field">
                            Секунд на ответ
                            <ClampedNumber value={task.seconds} min={0} max={DRAGON_LIMITS.maxSeconds} fallback={30} disabled={!editable} onChange={(seconds) => setTask(battle.id, task.id, { seconds })} />
                          </label>
                        )}
                      </div>
                      {mine.map((e) => (
                        <p key={e.message} className="error small">
                          {e.message}
                        </p>
                      ))}
                      {editable && (
                        <button type="button" className="btn btn--quiet" onClick={() => removeTask(battle.id, task.id)}>
                          Удалить задание
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {editable && (
            <div className="actions">
              {battle.tasks.length < DRAGON_LIMITS.maxTasks && (
                <button type="button" className="btn btn--quiet btn--block" onClick={() => setBattle(battle.id, { tasks: [...battle.tasks, newDragonTask("choice")] })}>
                  + Задание
                </button>
              )}
              {content.battles.length > 1 && (
                <button type="button" className="btn btn--quiet btn--block" onClick={() => removeBattle(battle)}>
                  Удалить бой
                </button>
              )}
            </div>
          )}
        </section>
      ))}
      {editable && content.battles.length < DRAGON_LIMITS.maxBattles && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => onChange({ ...latest.current, battles: [...latest.current.battles, newBattle(latest.current.battles.length + 1)] })}>
          + Бой с новым драконом
        </button>
      )}
      {dialog}
    </div>
  );
}
