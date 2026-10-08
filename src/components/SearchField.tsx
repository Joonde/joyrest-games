import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { searchSuggestions } from "../core/search";

interface Props {
  label: string;
  value: string;
  placeholder?: string;
  /** Из чего подсказывать: названия, метро, районы… */
  candidates: Array<string | null | undefined>;
  onChange: (value: string) => void;
}

/**
 * Поле поиска с подсказками: пока человек печатает, под полем до пяти вариантов (не закрывают
 * весь экран). Касание варианта подставляет его; стрелки и Enter — с клавиатуры, Esc закрывает.
 */
export function SearchField({ label, value, placeholder, candidates, onChange }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = useMemo(() => (open ? searchSuggestions(candidates, value) : []), [open, candidates, value]);
  const shown = open && options.length > 0;

  function pick(option: string) {
    onChange(option);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!shown) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      pick(options[active] ?? value);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="field search-field">
      <label className="field__label" htmlFor={`${id}-input`}>
        {label}
      </label>
      <input
        id={`${id}-input`}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-activedescendant={shown && active >= 0 ? `${id}-opt-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <ul className="search-field__list" id={`${id}-list`} role="listbox" aria-label="Подсказки">
          {options.map((option, i) => (
            <li
              key={option}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "search-field__option is-active" : "search-field__option"}
              // До потери фокуса полем: иначе список закроется раньше касания.
              onPointerDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
