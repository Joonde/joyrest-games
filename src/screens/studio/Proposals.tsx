import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../../core/format";
import { proposalsRepo, useLoad, type LibraryProposal } from "../../data";
import { ConfirmDialog } from "../../components/ConfirmDialog";

interface Props {
  /** Принятая игра появилась в библиотеке — список библиотеки надо обновить. */
  onAccepted: () => void;
  onToast: (text: string) => void;
}

const NONE: LibraryProposal[] = [];

/**
 * Предложения ведущих в библиотеку (CLAUDE.md, раздел 3) — блок на вкладке «Библиотека JoyRest»
 * у владельца. Нет предложений — блока нет.
 */
export function ProposalsBlock({ onAccepted, onToast }: Props) {
  const repo = proposalsRepo;
  const [state, , update] = useLoad(() => (repo ? repo.listPending() : Promise.resolve(NONE)), [repo]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toReject, setToReject] = useState<LibraryProposal | null>(null);
  const [reason, setReason] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (!repo || state.status !== "ready" || state.data.length === 0) return null;
  const proposals = state.data;
  const remove = (id: string) => update((list) => list.filter((p) => p.id !== id));

  async function accept(proposal: LibraryProposal) {
    if (!repo) return;
    setBusyId(proposal.id);
    try {
      await repo.accept(proposal.id);
      remove(proposal.id);
      onAccepted();
      onToast(`«${proposal.title}» в библиотеке`);
    } catch (error) {
      onToast(isGone(error) ? "Ведущий удалил эту игру — принять нельзя." : "Не удалось принять. Проверьте интернет.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject() {
    if (!repo || !toReject) return;
    setBusyId(toReject.id);
    setDialogError(null);
    try {
      await repo.reject(toReject.id, reason.trim());
      remove(toReject.id);
      setToReject(null);
      onToast("Предложение отклонено");
    } catch {
      setDialogError("Не удалось отклонить. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card" aria-labelledby="proposals-title">
      <h2 id="proposals-title">Предложения ведущих: {proposals.length}</h2>
      <p className="muted">
        Ведущие предлагают свои игры в библиотеку. Принятая игра копируется в библиотеку JoyRest, у ведущего она
        остаётся.
      </p>
      <ul className="proposals">
        {proposals.map((p) => (
          <li key={p.id} className="proposals__item">
            <div>
              <p className="proposals__title line-clamp">{p.title || "Без названия"}</p>
              <p className="muted small">
                {p.hostName || "Ведущий"} · {formatDate(p.createdAt)}
              </p>
            </div>
            <div className="actions">
              <button type="button" className="btn btn--block" disabled={busyId === p.id} onClick={() => void accept(p)}>
                {busyId === p.id ? "Подождите…" : "Принять в библиотеку"}
              </button>
              <Link className="btn btn--secondary btn--block" to={`/studio/games/${p.gameId}`}>
                Посмотреть
              </Link>
              <button
                type="button"
                className="btn btn--quiet btn--block"
                disabled={busyId === p.id}
                onClick={() => {
                  setReason("");
                  setDialogError(null);
                  setToReject(p);
                }}
              >
                Отклонить
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={toReject !== null}
        title="Отклонить предложение?"
        confirmLabel="Отклонить"
        busy={busyId !== null && busyId === toReject?.id}
        error={dialogError}
        onConfirm={() => void reject()}
        onCancel={() => setToReject(null)}
      >
        <p>«{toReject?.title}» не попадёт в библиотеку. Ведущий увидит отказ и причину у себя в «Моих играх».</p>
        <label className="field">
          Причина для ведущего (необязательно)
          <textarea maxLength={300} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </ConfirmDialog>
    </section>
  );
}

function isGone(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "not-found";
}
