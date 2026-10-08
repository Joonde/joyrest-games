import type { Session, SessionChange } from "../../data/types";

/** Таблица поверх игры по кнопке: общий счёт или счёт текущего раунда. */
export function PeekCard({ session, onApply }: { session: Session; onApply: (change: SessionChange) => Promise<unknown> }) {
  const peek = session.state.peek ?? null;
  const hasRounds = Object.values(session.leaderboard).some((e) => (e.roundBase ?? 0) > 0);
  const toggle = (view: "total" | "round") => void onApply({ state: { peek: peek === view ? null : view } }).catch(() => undefined);
  return (
    <div className="row peek-card" role="group" aria-label="Таблица на экран">
      <button type="button" className={peek === "total" ? "btn btn--block" : "btn btn--secondary btn--block"} aria-pressed={peek === "total"} onClick={() => toggle("total")}>
        {peek === "total" ? "Убрать таблицу" : "Таблица на экран"}
      </button>
      {hasRounds && (
        <button type="button" className={peek === "round" ? "btn btn--block" : "btn btn--secondary btn--block"} aria-pressed={peek === "round"} onClick={() => toggle("round")}>
          {peek === "round" ? "Убрать счёт раунда" : "Счёт раунда"}
        </button>
      )}
    </div>
  );
}

