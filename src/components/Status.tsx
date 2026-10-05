import type { ReactNode } from "react";

export function Loading({ text = "Загружаем…" }: { text?: string }) {
  return (
    <main className="page page--center" aria-busy="true">
      <p className="muted">{text}</p>
    </main>
  );
}

export function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="page page--center">
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
