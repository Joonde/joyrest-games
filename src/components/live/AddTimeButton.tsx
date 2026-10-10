import { useState } from "react";
import { addTimeChange } from "../../core/session";
import type { Session, SessionChange } from "../../data/types";

/**
 * «+10 секунд» под пультом механики: продлевает время открытого вопроса (гости не успевают).
 * Видна, только пока вопрос открыт и у него есть таймер. `now` — время сервера.
 */
export function AddTimeButton({ session, now, onApply }: { session: Session; now: () => number; onApply: (change: SessionChange) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { phase, stage, timeLimit, revealed } = session.state;
  if (phase !== "playing" || stage !== "question" || revealed || timeLimit === null) return null;

  async function add() {
    const change = addTimeChange(session.state, now());
    if (!change) return;
    setBusy(true);
    setFailed(false);
    try {
      await onApply(change);
    } catch (e) {
      // Вопрос уже закрыли (второй пульт) — молча; иначе просим нажать ещё раз.
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--tight">
      <button type="button" className="btn btn--secondary btn--block" disabled={busy || addTimeChange(session.state, now()) === null} onClick={() => void add()}>
        +10 секунд
      </button>
      {failed && (
        <p className="error" role="alert">
          Не получилось. Проверьте интернет и нажмите ещё раз.
        </p>
      )}
    </div>
  );
}
