import type { ReactNode } from "react";

/**
 * Сворачиваемый блок (решение владельца 11 октября 2026): длинные списки — шаблоны, оформление, механики,
 * импорт — свёрнуты и не занимают экран; в заголовке видно, что выбрано сейчас, касание раскрывает.
 */
export function Fold({ title, value, open, className, children }: { title: ReactNode; value?: ReactNode; open?: boolean; className?: string; children: ReactNode }) {
  return (
    <details className={`fold${className ? ` ${className}` : ""}`} open={open}>
      <summary className="fold__head">
        <span className="fold__title">{title}</span>
        {value !== undefined && value !== null && value !== "" && <span className="fold__value">{value}</span>}
        <span className="fold__chev" aria-hidden="true" />
      </summary>
      <div className="fold__body">{children}</div>
    </details>
  );
}
