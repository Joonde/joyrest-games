import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../../core/format";
import { HOST_GAMES_FOLDER } from "../../core/games";
import { errorCodeOf, proposalsRepo, type LibraryProposal } from "../../data";
import { ConfirmDialog } from "../../components/ConfirmDialog";

interface Props {
  /** Ждущие проверки предложения (грузит список библиотеки — ему нужно их число для вкладки). */
  proposals: LibraryProposal[];
  /** Предложение решено — убрать из списка. */
  onRemoved: (id: string) => void;
  /** Принятая игра появилась в библиотеке — список библиотеки надо обновить. */
  onAccepted: () => void;
  /** Открыть папку «Игры от ведущих JoyRest» в библиотеке. */
  onOpenFolder: () => void;
  onToast: (text: string) => void;
}

/**
 * Предложения ведущих в библиотеку (CLAUDE.md, раздел 3) — своя страничка вкладки «Библиотека JoyRest» у владельца
 * (решение владельца 22 октября 2026). Принятая игра ложится в папку «Игры от ведущих JoyRest» внизу библиотеки.
 */
export function ProposalsBlock({ proposals, onRemoved, onAccepted, onOpenFolder, onToast }: Props) {
  const repo = proposalsRepo;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toReject, setToReject] = useState<LibraryProposal | null>(null);
  const [reason, setReason] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (!repo) return null;
  const remove = onRemoved;

  async function accept(proposal: LibraryProposal) {
    if (!repo) return;
    setBusyId(proposal.id);
    try {
      await repo.accept(proposal.id);
      remove(proposal.id);
      onAccepted();
      onToast(`«${proposal.title}» — в папке «${HOST_GAMES_FOLDER}»`);
    } catch (error) {
      if (isGone(error) || errorCodeOf(error) === "failed-precondition") {
        // Игру удалили или предложение уже решено — убираем его из списка.
        remove(proposal.id);
        onToast("Ведущий удалил эту игру — предложение закрыто.");
      } else onToast("Не удалось принять. Проверьте интернет.");
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
      <h2 id="proposals-title">{proposals.length > 0 ? `Предложения ведущих: ${proposals.length}` : "Предложения ведущих"}</h2>
      <p className="muted">
        Ведущие предлагают свои игры в библиотеку. Принятая игра копируется в папку «{HOST_GAMES_FOLDER}» внизу библиотеки — её
        сразу видят все ведущие, у автора игра остаётся. Из папки игру можно перенести в общие разделы: «⋯ → Перенести в общие
        разделы библиотеки».
      </p>
      {proposals.length === 0 && <p className="muted empty">Новых предложений нет.</p>}
      <div className="actions">
        <button type="button" className="btn btn--secondary btn--block" onClick={onOpenFolder}>
          Открыть папку «{HOST_GAMES_FOLDER}»
        </button>
      </div>
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
