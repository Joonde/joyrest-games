/**
 * Конструктор «Бубликатора» (Блок 2d, отдельный чанк): тема, сложность, перелёты и их длительность, события, задания «Все на
 * палубу!», диверсант, размер экипажа и свои названия приборов. Всё — поля `BubContent` (`rules/content.ts`); числа и правила —
 * docs/bublikator.md. Ошибки запуска — `validate.ts` (путь `names`).
 */
import { useEffect, useRef, useState } from "react";
import { ClampedNumber } from "../../../components/ClampedNumber";
import { useDebouncedCommit } from "../../../components/useDebouncedCommit";
import type { EditorProps } from "../../types";
import { wordsOf } from "../lexicon";
import { CREW_SIZE_DEFAULT, EVENT_MS, ORDER_SECONDS, TASK_MAX } from "../rules/constants";
import { cleanTask, defaultTasks, DIFFICULTIES, EVENT_KINDS, THEMES } from "../rules/content";
import type { BubContent, Difficulty, EventKind } from "../rules/types";
import { gameMinutes, linesOf, validateBublikator } from "./validate";

const DIFFICULTY_TEXT: Record<Difficulty, { title: string; hint: string }> = {
  kids: { title: "Детская", hint: "Кнопка, тумблер и рычаг с картинками (лягушка, банан, ракета), всегда 3 прибора, без диверсанта. Метеоритный дождь без урона." },
  normal: { title: "Обычная", hint: "Названия вроде «Бубликатор» и «Чихометр», 3 прибора, в третьем перелёте — 4 и похожие близнецы." },
  crazy: { title: "Безумная", hint: "То же, но на приказ меньше времени — для азартной компании." },
};

const EVENT_TEXT: Record<EventKind, { title: string; hint: string }> = {
  meteor: { title: "Метеоритный дождь", hint: `${EVENT_MS.meteor / 1000} секунд: трясут телефоны или тапают — щит корабля; слабый щит бьёт по корпусу.` },
  pull: { title: "Притяжение", hint: `${EVENT_MS.pull / 1000} секунд: весь экипаж держит «Тягу» 3 секунды вместе, иначе корабль сносит назад.` },
  sos: { title: "Сигнал SOS", hint: `${EVENT_MS.sos / 1000} секунд: на экране мигают цвета, капитан вводит их по порядку. Верно — +30.` },
  captain: { title: "Все на палубу!", hint: `${EVENT_MS.captain / 1000} секунд: ваше задание на экране, приказы стоят; потом вы ставите экипажам звёзды. Только вручную.` },
};

/** Поле «по одному на строку»: правка уходит в игру через 0,4 с и при уходе из поля, чужая правка (отмена) — подтягивается. */
function LinesField({ label, hint, value, rows, disabled, onCommit, invalid }: { label: string; hint: string; value: string[]; rows: number; disabled: boolean; onCommit: (lines: string[]) => void; invalid?: boolean }) {
  const [draft, setDraft] = useState(value.join("\n"));
  const focused = useRef(false);
  const { schedule, flush } = useDebouncedCommit<string>((text) => onCommit(linesOf(text)));
  const joined = value.join("\n");
  useEffect(() => {
    if (!focused.current) setDraft(joined);
  }, [joined]);
  useEffect(() => flush, [flush]);
  return (
    <label className={invalid ? "field edit-issue" : "field"}>
      {label}
      <textarea
        rows={rows}
        value={draft}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          flush();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          schedule(e.target.value);
        }}
      />
      <span className="muted small">{hint}</span>
    </label>
  );
}

export function BublikatorEditorView({ content, onChange, editable }: EditorProps<BubContent>) {
  const set = (patch: Partial<BubContent>) => onChange({ ...content, ...patch });
  const kids = content.difficulty === "kids";
  const time = gameMinutes(content);
  const errors = validateBublikator(content);
  const seconds = ORDER_SECONDS[content.difficulty];
  const nameErrors = errors.filter((e) => e.path === "names");
  const ownTasks = content.captainTasks.join("\n") !== defaultTasks(content.theme).join("\n");

  return (
    <div className="stack">
      <section className="card stack">
        <h2>⚙️ Правила и настройки</h2>
        <p className="muted small">
          Команды — экипажи кораблей. У каждого гостя на телефоне 3–4 прибора с дурацкими названиями и приказ — чаще всего про прибор товарища: «Включите Чихометр!». Кричите, крутите, держите секунду — корабль летит к цели. Просроченный приказ бьёт по корпусу. {content.legs === 2 ? "Два перелёта" : "Три перелёта"}, события, привал с итогами, пьедестал. Нужен экран зала, играют только командами.
        </p>
        <p className="meta">
          <span>≈ {time.from}–{time.to} минут</span>
        </p>
      </section>

      <section className="card stack">
        <h2>Тема</h2>
        {THEMES.map((theme) => {
          const w = wordsOf(theme);
          return (
            <label key={theme} className="choice">
              <input type="radio" name="bub-theme" checked={content.theme === theme} disabled={!editable} onChange={() => set({ theme, captainTasks: ownTasks ? content.captainTasks : defaultTasks(theme) })} />
              <span className="choice__text">
                <span className="choice__title">{w.title}</span>
                <span className="choice__hint">
                  Летим: {w.ship}, цель — {w.goalTitle.toLowerCase()}. Беда: «{w.pull}»
                </span>
              </span>
            </label>
          );
        })}
        <p className="muted small">Тема — фон экрана зала, корабли, слова на телефонах и своя ритмичная музыка полёта.</p>
      </section>

      <section className="card stack">
        <h2>Сложность</h2>
        {DIFFICULTIES.map((d) => (
          <label key={d} className="choice">
            <input type="radio" name="bub-diff" checked={content.difficulty === d} disabled={!editable} onChange={() => set({ difficulty: d, saboteur: d === "kids" ? false : content.saboteur })} />
            <span className="choice__text">
              <span className="choice__title">{DIFFICULTY_TEXT[d].title}</span>
              <span className="choice__hint">
                {DIFFICULTY_TEXT[d].hint} На приказ: {ORDER_SECONDS[d].join(" / ")} секунд по перелётам.
              </span>
            </span>
          </label>
        ))}
        <p className="muted small">Во время игры время на приказ можно менять кнопками пульта «Медленнее / Быстрее» (сейчас {seconds.join(" / ")} с).</p>
      </section>

      <section className="card stack">
        <h2>Перелёты</h2>
        <div className="seg" role="group" aria-label="Сколько перелётов">
          {([2, 3] as const).map((n) => (
            <button key={n} type="button" className={content.legs === n ? "seg__btn is-on" : "seg__btn"} aria-pressed={content.legs === n} disabled={!editable} onClick={() => set({ legs: n })}>
              {n === 2 ? "2 перелёта" : "3 перелёта"}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Длительность перелёта">
          {([3, 4, 5] as const).map((n) => (
            <button key={n} type="button" className={content.legMinutes === n ? "seg__btn is-on" : "seg__btn"} aria-pressed={content.legMinutes === n} disabled={!editable} onClick={() => set({ legMinutes: n })}>
              {n === 5 ? "5 минут" : `${n} минуты`}
            </button>
          ))}
        </div>
        <p className="muted small">Перелёт — столько минут полёта; слаженный экипаж долетает раньше и получает бонус. Между перелётами — «Привал» с итогами.</p>
      </section>

      <section className="card stack">
        <h2>События</h2>
        {EVENT_KINDS.map((k) => (
          <label key={k} className="choice">
            <input type="checkbox" checked={content.events[k]} disabled={!editable} onChange={(e) => set({ events: { ...content.events, [k]: e.target.checked } })} />
            <span className="choice__text">
              <span className="choice__title">{EVENT_TEXT[k].title}</span>
              <span className="choice__hint">{EVENT_TEXT[k].hint}</span>
            </span>
          </label>
        ))}
        <p className="muted small">В каждом перелёте 2–3 события из включённых приходят сами; «Событие сейчас» на пульте — вручную.</p>
        {content.events.captain && (
          <>
            <LinesField
              label="Задания «Все на палубу!» — по одному на строку"
              hint={`До 30 заданий, каждое до ${TASK_MAX} знаков. На пульте выбираете одно из них или пишете своё.`}
              value={content.captainTasks}
              rows={6}
              disabled={!editable}
              onCommit={(lines) => set({ captainTasks: lines.map(cleanTask).filter((t) => t !== "").slice(0, 30) })}
            />
            {ownTasks && (
              <button type="button" className="btn btn--quiet btn--block" disabled={!editable} onClick={() => set({ captainTasks: defaultTasks(content.theme) })}>
                Вернуть задания темы
              </button>
            )}
          </>
        )}
      </section>

      <section className="card stack">
        <h2>Диверсант на борту</h2>
        <label className="choice">
          <input type="checkbox" checked={content.saboteur} disabled={!editable || kids} onChange={(e) => set({ saboteur: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Тайный диверсант в каждом экипаже от 5 человек</span>
            <span className="choice__hint">
              {kids
                ? "В детской сложности диверсанта нет."
                : "Каждый перелёт — новый. Примерно каждый третий его приказ ложный и вредит кораблю. На «Привале» экипаж голосует: угадали — +50."}
            </span>
          </span>
        </label>
      </section>

      <section className="card stack">
        <h2>Экипаж</h2>
        <p className="muted small">Экипаж — это команда. Сколько человек получают приборы; лишние становятся дублёрами (тот же пульт, что у товарища).</p>
        <label className="field">
          Меньше всего человек в экипаже
          <ClampedNumber value={content.crewSize.min} min={1} max={CREW_SIZE_DEFAULT.max} fallback={CREW_SIZE_DEFAULT.min} disabled={!editable} onChange={(min) => set({ crewSize: { min, max: Math.max(min, content.crewSize.max) } })} />
        </label>
        <label className="field">
          Больше всего с приборами
          <ClampedNumber value={content.crewSize.max} min={1} max={CREW_SIZE_DEFAULT.max} fallback={CREW_SIZE_DEFAULT.max} disabled={!editable} onChange={(max) => set({ crewSize: { min: Math.min(content.crewSize.min, max), max } })} />
        </label>
        <p className="muted small">Экипаж меньше 3 человек играет, но пульт предложит объединить его с другим.</p>
      </section>

      <section className="card stack">
        <h2>Свои названия приборов</h2>
        <LinesField
          label="По одному на строку — по желанию"
          hint={
            kids
              ? "В детской сложности приборы — картинки предметов, свои названия не используются."
              : "От 2 до 24 знаков, до 400 названий. Игра смешает их с названиями темы и раздаст так, чтобы в экипаже они не были похожи. Например: «Тёщемер», «Салатоскоп»."
          }
          value={content.names}
          rows={5}
          disabled={!editable}
          invalid={nameErrors.length > 0}
          onCommit={(lines) => set({ names: lines.map((l) => l.slice(0, 24)).filter((l) => l.length >= 2).slice(0, 400) })}
        />
        {nameErrors.map((e, i) => (
          <p key={i} className="error" role="alert">
            {e.message}
          </p>
        ))}
      </section>
    </div>
  );
}
