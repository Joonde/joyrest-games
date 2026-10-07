import { useEffect, useState } from "react";
import { formatDate } from "../core/format";
import { HOST_LEVELS } from "../core/levels";
import { isValidManualPoints, MIN_MINUTES, MIN_PHONES, pointsLabel } from "../core/points";
import { staffRepo, type HostAccount, type HostLevel, type PointsEntry } from "../data";
import { ConfirmDialog } from "../components/ConfirmDialog";

/** «ГГГГ-ММ-ДД» для <input type="date"> по местному времени. */
function dateInput(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Квалификация и «опыт с» (CLAUDE.md, «Квалификация, стаж и баллы»). */
export function LevelDialog({
  host,
  onClose,
  onSaved,
}: {
  host: HostAccount | null;
  onClose: () => void;
  onSaved: (host: HostAccount, level: HostLevel | null, experienceSince: number | null) => void;
}) {
  const [level, setLevel] = useState<HostLevel | null>(null);
  const [since, setSince] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLevel(host?.level ?? null);
    setSince(dateInput(host?.experienceSince));
    setError(null);
  }, [host]);

  async function save() {
    if (!host || !staffRepo) return;
    setBusy(true);
    setError(null);
    try {
      await staffRepo.setLevel(host.uid, level, since || null);
      onSaved(host, level, since ? new Date(`${since}T12:00:00`).getTime() : host.createdAt);
      onClose();
    } catch {
      setError("Не удалось сохранить. Проверьте дату и интернет.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={host !== null}
      title={`Квалификация: ${host?.name ?? ""}`}
      confirmLabel="Сохранить"
      busy={busy}
      error={error}
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <fieldset>
        <legend>Квалификация</legend>
        {HOST_LEVELS.map((item) => (
          <label key={item.id} className="choice">
            <input type="radio" name="hostLevel" checked={level === item.id} onChange={() => setLevel(item.id)} />
            <span className="choice__text">
              <span className="choice__title">{item.title}</span>
              <span className="choice__hint">{item.hint}</span>
            </span>
          </label>
        ))}
        <label className="choice">
          <input type="radio" name="hostLevel" checked={level === null} onChange={() => setLevel(null)} />
          <span className="choice__text">
            <span className="choice__title">Не задана</span>
          </span>
        </label>
      </fieldset>
      <label className="field">
        Опыт ведущего с
        <input type="date" value={since} max={dateInput(Date.now())} onChange={(e) => setSince(e.target.value)} />
      </label>
      <p className="muted small">От этой даты считается стаж. Пусто — с даты, когда вы добавили ведущего.</p>
    </ConfirmDialog>
  );
}

/** Баллы ведущего: история и ручное начисление. Видит только владелец. */
export function PointsDialog({
  host,
  onClose,
  onChanged,
}: {
  host: HostAccount | null;
  onClose: () => void;
  onChanged: (host: HostAccount, total: number) => void;
}) {
  const [history, setHistory] = useState<{ total: number; items: PointsEntry[] } | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHistory(null);
    setAmount("");
    setReason("");
    setError(null);
    if (!host || !staffRepo) return;
    let cancelled = false;
    staffRepo
      .listPoints(host.uid)
      .then((data) => !cancelled && setHistory(data))
      .catch(() => !cancelled && setError("Не удалось загрузить историю баллов."));
    return () => {
      cancelled = true;
    };
  }, [host]);

  async function add() {
    if (!host || !staffRepo) return;
    const points = Number(amount.replace(",", ".").replace("−", "-"));
    if (!isValidManualPoints(points)) {
      setError("Баллы — число с шагом 0,5, не ноль, от −100 до 100. Чтобы снять, поставьте минус.");
      return;
    }
    if (!reason.trim()) {
      setError("Напишите, за что баллы.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await staffRepo.addPoints(host.uid, points, reason.trim());
      const data = await staffRepo.listPoints(host.uid);
      setHistory(data);
      onChanged(host, data.total);
      setAmount("");
      setReason("");
    } catch {
      setError("Не удалось начислить. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={host !== null}
      title={`Баллы: ${host?.name ?? ""}`}
      confirmLabel="Начислить"
      busy={busy}
      error={error}
      onConfirm={() => void add()}
      onCancel={onClose}
    >
      <p>
        Всего: <strong>{history ? pointsLabel(history.total) : "…"}</strong>
      </p>
      <p className="muted small">
        За игру баллы начисляются сами: больше {MIN_PHONES} телефонов и не меньше {MIN_MINUTES} минут — до 20 человек
        1 балл, за каждые полные следующие 5 — +0,5. Ведущий баллы не видит.
      </p>
      <label className="field">
        Баллы (минус — снять)
        <input inputMode="decimal" placeholder="Например, 2 или -0,5" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="field">
        За что
        <input maxLength={200} placeholder="Например: отличный отзыв клиента" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {history && history.items.length > 0 && (
        <ul className="points-history">
          {history.items.map((item) => (
            <li key={item.id}>
              <span className={item.points < 0 ? "error" : "success"}>
                {item.points > 0 ? "+" : ""}
                {pointsLabel(item.points)}
              </span>
              <span className="muted small">
                {formatDate(item.createdAt)} · {item.kind === "game" ? "игра " : ""}
                {item.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
      {history && history.items.length === 0 && <p className="muted small">Баллов пока нет.</p>}
    </ConfirmDialog>
  );
}
