import type { ReactNode } from "react";
import { Logo } from "./Logo";

/** Шапка пульта и студии: монограмма, заголовок и действия справа. */
export function TopBar({ title, eyebrow, children }: { title: ReactNode; eyebrow?: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Logo kind="monogram" className="logo--mark" />
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
        </div>
      </div>
      {children && <div className="row">{children}</div>}
    </header>
  );
}
