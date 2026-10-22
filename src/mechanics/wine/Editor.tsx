// Конструктор «Винного казино»: паспорта вин, страны и сорта на поле, коэффициенты, фишки и время на ставки.
import { useEffect, useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { Fold } from "../../components/Fold";
import { insertBack } from "../../components/undoRemove";
import { useUndoRemove } from "../../components/useUndoRemove";
import type { EditorProps } from "../types";
import {
  CATEGORIES,
  CATEGORY_TITLES,
  COLOR_TITLES,
  DEFAULT_ODDS,
  newWine,
  SWEETNESS_TITLES,
  WINE_LIMITS,
  WORLD_TITLES,
  type Wine,
  type WineColor,
  type WineContent,
  type WineSweetness,
  type WineWorld,
} from "./content";
import { validateWine } from "./validate";

export function WineEditor({ content, onChange, editable }: EditorProps<WineContent>) {
  const errors = validateWine(content);
  const latest = useRef(content);
  latest.current = content;
  const [openId, setOpenId] = useState<string | null>(content.wines[0]?.id ?? null);
  const update = (id: string, patch: Partial<Wine>) => onChange({ ...latest.current, wines: latest.current.wines.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const { offer, bar } = useUndoRemove();
  const fieldErrors = errors.filter((e) => e.path === "countries" || e.path === "grapes" || e.path === "wines");

  // «Показать, что исправить»: бутылка с замечанием раскрывается.
  const firstBad = useRef<string | null>(null);
  firstBad.current = content.wines.find((w) => errors.some((e) => e.path.startsWith(`wines/${w.id}/`)))?.id ?? null;
  useEffect(() => {
    const reveal = () => {
      if (firstBad.current) setOpenId(firstBad.current);
    };
    window.addEventListener("joyrest:reveal-issues", reveal);
    return () => window.removeEventListener("joyrest:reveal-issues", reveal);
  }, []);

  /** Удалить вино — 7 секунд «Вернуть» на то же место. */
  function removeWine(wine: Wine) {
    const index = latest.current.wines.findIndex((x) => x.id === wine.id);
    if (index < 0) return;
    onChange({ ...latest.current, wines: latest.current.wines.filter((x) => x.id !== wine.id) });
    offer(`Бутылка ${index + 1}${wine.name.trim() ? ` «${wine.name.trim()}»` : ""} удалена`, () =>
      onChange({ ...latest.current, wines: insertBack(latest.current.wines, { item: wine, index }, (x) => x.id) }),
    );
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>⚙️ Правила и настройки</h2>
        <p className="muted small">
          Гости пробуют вино и раскладывают фишки на телефоне, как на поле рулетки: цвет, Старый или Новый Свет, сладость, страна, сорт, год. «Открыть
          бутылку» — на экране паспорт вина, фишки на верных ответах приносят цену фишки × коэффициент. Игра 18+.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Фишек на бутылку
            <ClampedNumber value={content.chips} min={WINE_LIMITS.chipsMin} max={WINE_LIMITS.chipsMax} fallback={5} disabled={!editable} onChange={(chips) => onChange({ ...latest.current, chips })} />
          </label>
          <label className="field">
            Цена фишки
            <ClampedNumber value={content.chipValue} min={WINE_LIMITS.valueMin} max={WINE_LIMITS.valueMax} fallback={10} disabled={!editable} onChange={(chipValue) => onChange({ ...latest.current, chipValue })} />
          </label>
        </div>
        <div className="row board-editor__size">
          <label className="field">
            Секунд на ставки
            <ClampedNumber value={content.betTime} min={WINE_LIMITS.timeMin} max={WINE_LIMITS.timeMax} fallback={90} disabled={!editable} onChange={(betTime) => onChange({ ...latest.current, betTime })} />
          </label>
          <label className="field">
            Годы на поле — с
            <ClampedNumber value={content.yearFrom} min={1950} max={new Date().getFullYear()} fallback={new Date().getFullYear() - 10} disabled={!editable} onChange={(yearFrom) => onChange({ ...latest.current, yearFrom })} />
          </label>
        </div>
      </section>

      <Fold title="Коэффициенты" value={CATEGORIES.map((c) => `×${content.odds[c]}`).join(" · ")}>
        <div className="stack stack--tight">
          {CATEGORIES.map((c) => (
            <label key={c} className="field">
              {CATEGORY_TITLES[c]}
              <ClampedNumber
                value={content.odds[c]}
                min={WINE_LIMITS.oddsMin}
                max={WINE_LIMITS.oddsMax}
                fallback={DEFAULT_ODDS[c]}
                disabled={!editable}
                onChange={(n) => onChange({ ...latest.current, odds: { ...latest.current.odds, [c]: n } })}
              />
            </label>
          ))}
        </div>
      </Fold>

      <Fold title="Страны и сорта на поле" value={`${content.countries.length} стран · ${content.grapes.length} сортов`}>
        <div className="stack stack--tight">
          <p className="muted small">Через запятую, до {WINE_LIMITS.options}. Вино не из списка выигрывает ячейку «Другая» / «Другой».</p>
          <ListField label="Страны" value={content.countries} disabled={!editable} onChange={(countries) => onChange({ ...latest.current, countries })} />
          <ListField label="Сорта" value={content.grapes} disabled={!editable} onChange={(grapes) => onChange({ ...latest.current, grapes })} />
          {fieldErrors
            .filter((e) => e.path !== "wines")
            .map((e) => (
              <p key={e.path} className="error small edit-issue">
                {e.message}
              </p>
            ))}
        </div>
      </Fold>

      <section className="stack">
        <h2>Вина · {content.wines.length}</h2>
        <p className="muted small">Паспорт видите только вы на пульте; гости узнают вино, когда вы откроете бутылку. Порядок — порядок подачи.</p>
        {content.wines.map((w, i) => {
          const open = openId === w.id;
          const wErrors = errors.filter((e) => e.path.startsWith(`wines/${w.id}/`));
          return (
            <article key={w.id} className={wErrors.length ? "card dance-editor__card has-error" : "card dance-editor__card"}>
              <button type="button" className="dance-editor__head" aria-expanded={open} onClick={() => setOpenId(open ? null : w.id)}>
                <strong>Бутылка {i + 1}</strong>
                <span className="muted line-clamp">{w.name || "без названия"}</span>
              </button>
              {open && (
                <div className="stack stack--tight">
                  <label className="field">
                    Название (на экране после открытия)
                    <input value={w.name} maxLength={WINE_LIMITS.name} disabled={!editable} placeholder="Кьянти Классико" onChange={(e) => update(w.id, { name: e.target.value })} />
                  </label>
                  <Seg label="Цвет" value={w.color} titles={COLOR_TITLES} disabled={!editable} onChange={(color: WineColor) => update(w.id, { color })} />
                  <Seg label="Свет" value={w.world} titles={WORLD_TITLES} disabled={!editable} onChange={(world: WineWorld) => update(w.id, { world })} />
                  <Seg label="Сладость" value={w.sweetness} titles={SWEETNESS_TITLES} disabled={!editable} onChange={(sweetness: WineSweetness) => update(w.id, { sweetness })} />
                  <div className="row board-editor__size">
                    <label className="field">
                      Страна
                      <input value={w.country} maxLength={WINE_LIMITS.option} list="wine-countries" disabled={!editable} onChange={(e) => update(w.id, { country: e.target.value })} />
                    </label>
                    <label className="field">
                      Сорт
                      <input value={w.grape} maxLength={WINE_LIMITS.option} list="wine-grapes" disabled={!editable} onChange={(e) => update(w.id, { grape: e.target.value })} />
                    </label>
                  </div>
                  <label className="field">
                    Год урожая (пусто — без года)
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1900}
                      max={2100}
                      value={w.year ?? ""}
                      disabled={!editable}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        update(w.id, { year: e.target.value === "" ? null : Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : w.year });
                      }}
                    />
                  </label>
                  <label className="field">
                    Заметка (на экране после открытия, необязательно)
                    <input value={w.note} maxLength={WINE_LIMITS.note} disabled={!editable} placeholder="Чем интересно это вино" onChange={(e) => update(w.id, { note: e.target.value })} />
                  </label>
                  {wErrors.map((e) => (
                    <p key={e.path} className="error small edit-issue">
                      {e.message}
                    </p>
                  ))}
                  {editable && content.wines.length > 1 && (
                    <button type="button" className="btn btn--quiet" onClick={() => removeWine(w)}>
                      Удалить вино
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
        <datalist id="wine-countries">
          {content.countries.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="wine-grapes">
          {content.grapes.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </section>

      {editable && (
        <div className="actions">
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={content.wines.length >= WINE_LIMITS.wines}
            onClick={() => {
              const wine = newWine();
              onChange({ ...latest.current, wines: [...latest.current.wines, wine] });
              setOpenId(wine.id);
            }}
          >
            + Вино
          </button>
        </div>
      )}
      {fieldErrors
        .filter((e) => e.path === "wines")
        .map((e) => (
          <p key={e.path} className="error small edit-issue">
            {e.message}
          </p>
        ))}
      {bar}
    </div>
  );
}

function Seg<T extends string>({ label, value, titles, disabled, onChange }: { label: string; value: T; titles: Record<T, string>; disabled: boolean; onChange: (v: T) => void }) {
  return (
    <div className="stack stack--tight">
      <span className="field__label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {(Object.keys(titles) as T[]).map((k) => (
          <button key={k} type="button" className={value === k ? "seg__btn is-on" : "seg__btn"} aria-pressed={value === k} disabled={disabled} onClick={() => onChange(k)}>
            {titles[k]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Список через запятую: правка текстом, в игру — без пустых и повторов. */
function ListField({ label, value, disabled, onChange }: { label: string; value: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  const distinct: string[] = [];
  for (const raw of text.split(",")) {
    const s = raw.trim().slice(0, WINE_LIMITS.option);
    if (s && !distinct.some((x) => x.toLowerCase() === s.toLowerCase())) distinct.push(s);
  }
  const extra = distinct.slice(WINE_LIMITS.options);
  return (
    <label className="field">
      {label}
      <textarea
        rows={3}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const items: string[] = [];
          for (const raw of e.target.value.split(",")) {
            const s = raw.trim().slice(0, WINE_LIMITS.option);
            if (s && !items.some((x) => x.toLowerCase() === s.toLowerCase())) items.push(s);
          }
          onChange(items.slice(0, WINE_LIMITS.options));
        }}
      />
      {extra.length > 0 && (
        <span className="muted small" role="status">
          Больше {WINE_LIMITS.options} на поле не берём — лишние: {extra.join(", ")}
        </span>
      )}
    </label>
  );
}
