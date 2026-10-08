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

  function go(i: number) {
    setIndex(i);
    try {
      sessionStorage.setItem(storageKey, String(i));
    } catch {
      // нет хранилища — не страшно
    }
    const el = box.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  }

  function onScroll() {
    const el = box.current;
    if (!el || el.clientWidth === 0) return;
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
          <button key={p.id} type="button" role="tab" aria-selected={i === index} className={i === index ? "swipe__tab is-on" : "swipe__tab"} onClick={() => go(i)}>
            {p.label}
          </button>
        ))}
      </div>
      <div ref={box} className="swipe__pages" onScroll={onScroll}>
        {pages.map((p, i) => (
          <section key={p.id} className="swipe__page" aria-label={p.label} aria-hidden={i !== index} inert={i !== index ? true : undefined}>
            {p.node}
          </section>
        ))}
      </div>
    </div>
  );
}
