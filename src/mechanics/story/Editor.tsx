// Конструктор «Давайте знакомиться»: какие разделы и в каком порядке, тексты и очки каждого раздела.
import { useEffect, useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { useConfirm } from "../../components/ConfirmDialog";
import type { EditorProps } from "../types";
import { createStory, SECTION_HINTS, SECTION_KINDS, SECTION_TITLES, STORY_LIMITS, type SectionKind, type StoryContent } from "./content";
import { validateStory } from "./validate";

/** Список по строкам: правится свободно, применяется, когда поле теряет фокус. */
function LinesField({ label, hint, value, disabled, rows, onCommit }: { label: string; hint?: string; value: string; disabled: boolean; rows: number; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  return (
    <label className="field">
      {label}
      {hint && <span className="muted small">{hint}</span>}
      <textarea
        className="input"
        rows={rows}
        value={draft}
        disabled={disabled}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onCommit(draft);
        }}
      />
    </label>
  );
}

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

function bankText(bank: Record<string, string[]>): string {
  return Object.entries(bank).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");
}

function parseBank(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of lines(text)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim().toLowerCase().slice(0, STORY_LIMITS.label);
    const words = line.slice(at + 1).split(",").map((w) => w.trim().slice(0, STORY_LIMITS.word)).filter(Boolean).slice(0, STORY_LIMITS.words);
    if (key && words.length > 0) out[key] = words;
  }
  return out;
}

export function StoryEditor({ content, onChange, editable }: EditorProps<StoryContent>) {
  const latest = useRef(content);
  latest.current = content;
  const [dialog, confirm] = useConfirm();
  const errors = validateStory(content);
  const set = (patch: Partial<StoryContent>) => onChange({ ...latest.current, ...patch });
  const on = (k: SectionKind) => content.sections.includes(k);
  const off = SECTION_KINDS.filter((k) => !on(k));

  function move(i: number, d: -1 | 1) {
    const list = [...latest.current.sections];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j] as SectionKind, list[i] as SectionKind];
    set({ sections: list });
  }

  const num = (label: string, key: keyof StoryContent, min: number, max: number) => (
    <label className="field">
      {label}
      <ClampedNumber value={content[key] as number} min={min} max={max} fallback={createStory()[key] as number} disabled={!editable} onChange={(v) => set({ [key]: v } as Partial<StoryContent>)} />
    </label>
  );

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Разделы</h2>
        <p className="muted small">Игра на знакомство: разделы идут по порядку, между ними — заставка и общий счёт. Уберите лишние или поменяйте порядок.</p>
        <ol className="st-editor__sections">
          {content.sections.map((k, i) => (
            <li key={k} className="st-editor__section">
              <span className="st-editor__name">
                <b>
                  {i + 1}. {SECTION_TITLES[k]}
                </b>
                <span className="muted small">{SECTION_HINTS[k]}</span>
              </span>
              {editable && (
                <span className="st-editor__tools">
                  <button type="button" className="btn btn--quiet" aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="btn btn--quiet" aria-label="Ниже" disabled={i === content.sections.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    disabled={content.sections.length <= 1}
                    onClick={() => confirm({ title: `Убрать раздел «${SECTION_TITLES[k]}»?`, text: "Его можно вернуть кнопкой ниже, настройки сохранятся.", confirmLabel: "Убрать", run: () => set({ sections: latest.current.sections.filter((x) => x !== k) }) })}
                  >
                    Убрать
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        {editable && off.length > 0 && (
          <div className="actions">
            {off.map((k) => (
              <button key={k} type="button" className="btn btn--secondary btn--block" onClick={() => set({ sections: [...latest.current.sections, k] })}>
                + {SECTION_TITLES[k]}
              </button>
            ))}
          </div>
        )}
      </section>

      {(on("author") || on("said")) && (
        <section className="card stack">
          <h2>Угадываем автора</h2>
          <p className="muted small">Общие настройки «Чья история?» и «Кто это сказал?»: время на голос и очки.</p>
          <div className="row board-editor__size">
            {num("Секунд на голос", "guessSeconds", STORY_LIMITS.minSeconds, STORY_LIMITS.maxSeconds)}
            {num("Очки за верную догадку", "guessPoints", 0, STORY_LIMITS.maxPoints)}
            {num("Бонус автору, если никто не угадал", "authorBonus", 0, STORY_LIMITS.maxPoints)}
          </div>
        </section>
      )}

      {on("author") && (
        <section className="card stack">
          <h2>{SECTION_TITLES.author}</h2>
          <label className="field">
            Подсказка гостям: о чём писать
            <input className="input" maxLength={STORY_LIMITS.prompt} value={content.prompt} disabled={!editable} onChange={(e) => set({ prompt: e.target.value })} />
          </label>
          <LinesField label="Примеры под полем (каждый с новой строки)" value={content.examples.join("\n")} rows={4} disabled={!editable} onCommit={(t) => set({ examples: lines(t).map((x) => x.slice(0, STORY_LIMITS.example)).slice(0, STORY_LIMITS.examples) })} />
          <div className="row board-editor__size">{num("Сколько историй играть (0 — все)", "maxStories", 0, STORY_LIMITS.maxStories)}</div>
        </section>
      )}

      {on("words") && (
        <section className="card stack">
          <h2>{SECTION_TITLES.words}</h2>
          <p className="muted small">В предложении пропуски в [квадратных скобках]. Каждому гостю достаётся бумажка со словами для одного пропуска — он выбирает смешное слово, рулетка выбирает, кто покажет историю, зал ставит звёзды.</p>
          <LinesField label="Предложения (каждое с новой строки)" hint="Например: Однажды [кто] отправился в [куда]…" value={content.templates.join("\n")} rows={6} disabled={!editable} onCommit={(t) => set({ templates: lines(t).map((x) => x.slice(0, STORY_LIMITS.template)).slice(0, STORY_LIMITS.templates) })} />
          <LinesField label="Банк слов: «пропуск: слово, слово, …»" hint="Названия пропусков — как в скобках." value={bankText(content.bank)} rows={8} disabled={!editable} onCommit={(t) => set({ bank: parseBank(t) })} />
          <div className="row board-editor__size">
            {num("Слов на бумажке", "paperWords", 2, 8)}
            {num("Секунд на звёзды", "rateSeconds", STORY_LIMITS.minSeconds, STORY_LIMITS.maxSeconds)}
            {num("Очки за звезду", "starPoints", 0, 200)}
          </div>
        </section>
      )}

      {on("ending") && (
        <section className="card stack">
          <h2>{SECTION_TITLES.ending}</h2>
          <p className="muted small">Гости пишут начало своей истории и чем она кончилась. Остальные придумывают концовки, на экране — все вперемешку с настоящей. Угадал правду — очки, твоей выдумке поверили — очки за каждого.</p>
          <div className="row board-editor__size">
            {num("Сколько историй", "endingMax", 1, 20)}
            {num("Секунд на концовку", "endingSeconds", STORY_LIMITS.minSeconds, 180)}
            {num("Очки за каждого обманутого", "foolPoints", 0, STORY_LIMITS.maxPoints)}
          </div>
        </section>
      )}

      {on("lies") && (
        <section className="card stack">
          <h2>{SECTION_TITLES.lies}</h2>
          <p className="muted small">Каждый пишет о себе три факта и отмечает, какой выдуман. Нашёл ложь — очки; автору — очки за каждого, кого обманул.</p>
          <div className="row board-editor__size">{num("Сколько игроков показать", "liesMax", 1, 30)}</div>
        </section>
      )}

      {on("said") && (
        <section className="card stack">
          <h2>{SECTION_TITLES.said}</h2>
          <LinesField label="Вопросы (каждый с новой строки)" value={content.saidQuestions.join("\n")} rows={8} disabled={!editable} onCommit={(t) => set({ saidQuestions: lines(t).map((x) => x.slice(0, STORY_LIMITS.prompt)).slice(0, 20) })} />
          <div className="row board-editor__size">{num("Ответов на экран на вопрос", "saidShown", 2, 15)}</div>
        </section>
      )}

      {errors.length > 0 && (
        <ul className="error small">
          {errors.slice(0, 3).map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}
      {dialog}
    </div>
  );
}
