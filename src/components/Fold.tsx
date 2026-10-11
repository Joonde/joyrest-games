import { useState, type ReactNode } from "react";

/**
 * Сворачиваемый блок (решение владельца 11 октября 2026): длинные списки — шаблоны, оформление, механики,
 * импорт — свёрнуты и не занимают экран; в заголовке видно, что выбрано сейчас, касание раскрывает.
 * `open` — только как блок показан в первый раз: дальше открывает и закрывает сам человек (иначе блок
 * захлопывался бы под пальцем, например на первой букве вопроса).
 */
export function Fold({ title, value, open, className, children }: { title: ReactNode; value?: ReactNode; open?: boolean; className?: string; children: ReactNode }) {
  const [initiallyOpen] = useState(Boolean(open));
  return (
    <details className={`fold${className ? ` ${className}` : ""}`} open={initiallyOpen}>
      <summary className="fold__head">
        <span className="fold__title">{title}</span>
        {value !== undefined && value !== null && value !== "" && <span className="fold__value">{value}</span>}
        <span className="fold__chev" aria-hidden="true" />
      </summary>
      <div className="fold__body">{children}</div>
    </details>
  );
}
