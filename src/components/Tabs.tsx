import { useRef, type KeyboardEvent } from "react";

export interface TabItem<Id extends string> {
  id: Id;
  label: string;
}

interface Props<Id extends string> {
  items: Array<TabItem<Id>>;
  value: Id;
  onChange: (id: Id) => void;
  label: string;
  /** Префикс id: панель вкладки получает id `${idPrefix}-panel-${id}`. */
  idPrefix: string;
}

/**
 * Вкладки: тихие кнопки, у выбранной — полоса фирменного градиента снизу.
 * Стрелки влево и вправо переключают вкладки, как в системных приложениях.
 */
export function Tabs<Id extends string>({ items, value, onChange, label, idPrefix }: Props<Id>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = (index + delta + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    refs.current[next]?.focus();
  }

  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            className="btn btn--quiet tab"
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
