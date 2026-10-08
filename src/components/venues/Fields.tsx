/**
 * Поля анкет базы площадок: выбор чипами (один или несколько), числа, строки, переключатели,
 * пожелания «хотелось бы / обязательно» и цветные статусы. Крупные касания для телефона.
 */
import { useId, type CSSProperties, type ReactNode } from "react";
import { CRITERIA, CRITERIA_GROUPS, type StatusTone } from "../../core/venues";
import { brand } from "../../themes/brand";

const TONES: Record<StatusTone, string> = { rose: brand.coral, gold: brand.gold, green: brand.sage, gray: brand.taupe };

/** Цвет статуса (пастель) — для точек фильтра. */
export function statusColor(tone: StatusTone): string {
  return TONES[tone];
}

/** Цветной статус: пастельная заливка, тёмный текст (как у цветов команд). */
export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="status-pill" style={{ "--status-color": TONES[tone] } as CSSProperties}>
      {label}
    </span>
  );
}

/** Выбор статуса: цветные кнопки, выбранная — с обводкой. */
export function StatusPicker<Id extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: ReadonlyArray<{ id: Id; label: string; tone: StatusTone }>;
  value: Id;
  onChange: (id: Id) => void;
  disabled?: boolean;
}) {
  return (
    <div className="stack stack--tight">
      <span className="field__label">{label}</span>
      <div className="status-picker" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === value}
            disabled={disabled}
            className="status-picker__item"
            style={{ "--status-color": TONES[option.tone] } as CSSProperties}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="card venue-section">
      <legend className="venue-section__title">{title}</legend>
      {hint && <p className="muted small">{hint}</p>}
      {children}
    </fieldset>
  );
}

function Label({ text, required, hint }: { text: string; required?: boolean; hint?: string }) {
  return (
    <span className="field__label">
      {text}
      {required && <span className="required" aria-hidden="true"> *</span>}
      {hint && <span className="field__hint"> {hint}</span>}
    </span>
  );
}

export function TextField({
  label,
  value,
  onChange,
  required,
  hint,
  placeholder,
  maxLength,
  inputMode,
  type = "text",
  multiline,
  autoComplete = "off",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  maxLength?: number;
  inputMode?: "text" | "tel" | "email" | "url";
  type?: "text" | "tel" | "email" | "url" | "date" | "time";
  multiline?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="field">
      <Label text={label} required={required} hint={hint} />
      {multiline ? (
        <textarea value={value} maxLength={maxLength} placeholder={placeholder} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          type={type}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  required,
  placeholder,
  hint,
  max = 1_000_000,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  max?: number;
}) {
  return (
    <label className="field">
      <Label text={label} required={required} hint={hint} />
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9 ]*"
        value={value === null ? "" : String(value)}
        placeholder={placeholder}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(digits === "" ? null : Math.min(Number(digits), max));
        }}
      />
    </label>
  );
}

/** Один вариант из списка. Повторное касание снимает выбор (поле необязательное). */
export function ChoiceChips({
  label,
  options,
  value,
  onChange,
  required,
  hint,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span id={id}>
        <Label text={label} required={required} hint={hint} />
      </span>
      <div className="pick-chips">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className="pick-chip"
            aria-pressed={option === value}
            onClick={() => onChange(option === value && !required ? "" : option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Несколько вариантов. `limit` — не больше N (например, три кухни). */
export function MultiChips({
  label,
  options,
  value,
  onChange,
  hint,
  limit,
  render,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
  hint?: string;
  limit?: number;
  render?: (option: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span id={id}>
        <Label text={label} hint={hint} />
      </span>
      <div className={render ? "pick-tiles" : "pick-chips"}>
        {options.map((option) => {
          const on = value.includes(option);
          const full = !on && limit !== undefined && value.length >= limit;
          return (
            <button
              key={option}
              type="button"
              className={render ? "pick-tile" : "pick-chip"}
              aria-pressed={on}
              disabled={full}
              onClick={() => onChange(on ? value.filter((v) => v !== option) : [...value, option])}
            >
              {render ? render(option) : option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string }) {
  return (
    <label className="choice">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="choice__text">
        <span className="choice__title">{label}</span>
        {hint && <span className="choice__hint">{hint}</span>}
      </span>
    </label>
  );
}

/** Пожелания клиента: одно касание — «хотелось бы», второе — «обязательно», третье — снять. */
export function WishPicker({ value, onChange }: { value: Record<string, 1 | 2>; onChange: (value: Record<string, 1 | 2>) => void }) {
  function toggle(id: string) {
    const next = { ...value };
    const level = next[id];
    if (!level) next[id] = 1;
    else if (level === 1) next[id] = 2;
    else delete next[id];
    onChange(next);
  }
  return (
    <div className="stack">
      <p className="wish-legend small">
        <span>
          <span className="wish-mark wish-mark--1" aria-hidden="true" /> одно касание — хотелось бы
        </span>
        <span>
          <span className="wish-mark wish-mark--2" aria-hidden="true" /> два — обязательно
        </span>
      </p>
      {CRITERIA_GROUPS.map((group) => {
        const items = CRITERIA.filter((c) => c.group === group);
        const chosen = items.filter((c) => value[c.id]).length;
        return (
          <details key={group} className="wish-group" open={group === "Атмосфера" || group === "Пространство" || chosen > 0}>
            <summary>
              <span>{group}</span>
              {chosen > 0 && <span className="wish-group__count">выбрано {chosen}</span>}
            </summary>
            <div className="pick-chips">
              {items.map((c) => {
                const level = value[c.id] ?? 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`pick-chip wish-chip wish-chip--${level}`}
                    aria-pressed={level > 0}
                    aria-label={`${c.label}: ${level === 2 ? "обязательно" : level === 1 ? "хотелось бы" : "не важно"}`}
                    onClick={() => toggle(c.id)}
                  >
                    {level === 2 && <strong aria-hidden="true">! </strong>}
                    {c.label}
                  </button>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
