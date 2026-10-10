import { useEffect, useRef, useState, type ReactNode } from "react";

interface Page {
  id: string;
  label: string;
  node: ReactNode;
}

/**
 * Экраны, которые листаются пальцем вбок (как домашние экраны телефона), и переключатель сверху.
 * Последний открытый экран запоминается на этом устройстве.
 */
export function SwipePages({ pages, storageKey }: { pages: Page[]; storageKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  /** Идёт прокрутка по касанию переключателя: промежуточные положения не меняют вкладку. */
  const jumping = useRef<number | null>(null);
  const [index, setIndex] = useState(() => {
    try {
      const saved = Number(sessionStorage.getItem(storageKey));
      return Number.isInteger(saved) && saved >= 0 && saved < pages.length ? saved : 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTo({ left: index * el.clientWidth, behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при открытии
  }, []);

  // Высота видимого экрана → --swipe-h: невидимый экран не выше него, пустой прокрутки снизу нет.
  useEffect(() => {
    const el = box.current;
    const page = el?.children[index] as HTMLElement | undefined;
    if (!el || !page) return;
    const write = () => el.style.setProperty("--swipe-h", `${Math.ceil(page.getBoundingClientRect().height)}px`);
    write();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(write);
    ro.observe(page);
    return () => ro.disconnect();
  }, [index]);

  useEffect(() => () => {
    if (jumping.current !== null) window.clearTimeout(jumping.current);
  }, []);

  function go(i: number) {
    setIndex(i);
    try {
      sessionStorage.setItem(storageKey, String(i));
    } catch {
      // нет хранилища — не страшно
    }
    const el = box.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (el) {
      if (jumping.current !== null) window.clearTimeout(jumping.current);
      jumping.current = window.setTimeout(() => {
        jumping.current = null;
      }, reduce ? 50 : 700);
      el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
    }
  }

  function onScroll() {
    const el = box.current;
    if (!el || el.clientWidth === 0 || jumping.current !== null) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index && i >= 0 && i < pages.length) {
      setIndex(i);
      try {
        sessionStorage.setItem(storageKey, String(i));
      } catch {
        // ничего
      }
    }
  }

  return (
    <div className="swipe">
      <div className="swipe__switch" role="tablist" aria-label="Экраны">
        {pages.map((p, i) => (
          <button key={p.id} type="button" role="tab" id={`swipe-tab-${p.id}`} aria-controls={`swipe-page-${p.id}`} aria-selected={i === index} className={i === index ? "swipe__tab is-on" : "swipe__tab"} onClick={() => go(i)}>
            {p.label}
          </button>
        ))}
      </div>
      <div ref={box} className="swipe__pages" onScroll={onScroll}>
        {pages.map((p, i) => (
          <section key={p.id} id={`swipe-page-${p.id}`} role="tabpanel" aria-labelledby={`swipe-tab-${p.id}`} className="swipe__page" aria-hidden={i !== index} inert={i !== index ? true : undefined}>
            {p.node}
          </section>
        ))}
      </div>
    </div>
  );
}
