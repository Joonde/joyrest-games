import { useEffect, useRef, type KeyboardEvent } from "react";

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
  /** Много вкладок: на узком экране — лента с прокруткой вбок, выбранная всегда видна. */
  scroll?: boolean;
}

/**
 * Вкладки: тихие кнопки, у выбранной — полоса фирменного градиента снизу.
 * Стрелки влево и вправо переключают вкладки, как в системных приложениях.
 */
export function Tabs<Id extends string>({ items, value, onChange, label, idPrefix, scroll = false }: Props<Id>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // Выбранная вкладка видна в ленте: прокручиваем только саму ленту вбок, страницу не трогаем.
  const index = items.findIndex((item) => item.id === value);
  useEffect(() => {
    if (!scroll) return;
    const tab = refs.current[index];
    const list = tab?.parentElement;
    if (!tab || !list) return;
    const left = tab.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + tab.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: Math.max(0, left - 16), behavior: "auto" });
    }
  }, [scroll, index]);

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
    <div className={scroll ? "tabs tabs--scroll" : "tabs"} role="tablist" aria-label={label}>
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
