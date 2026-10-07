import { useEffect, useState, type FormEvent } from "react";
import { cleanName, isValidName, NAME_MAX_LENGTH } from "../core/names";
import { experienceLabel, levelTitle } from "../core/levels";
import { pointsLabel } from "../core/points";
import { retentionCutoff, SESSION_RETENTION_DAYS } from "../core/retention";
import {
  authService,
  permissions,
  sessionsRepo,
  staffRepo,
  useLoad,
  usersRepo,
  type CleanupReport,
  type CreatedHost,
  type HostAccount,
  type UserProfile,
} from "../data";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ActionMenu } from "../components/Menu";
import { HostGate } from "../components/HostGate";
import { ListSkeleton, StudioSkeleton } from "../components/Skeleton";
import { LoadFailedInline } from "../components/Status";
import { Toast, useToast } from "../components/Toast";
import { TopBar } from "../components/TopBar";
import { LevelDialog, PointsDialog } from "./HostStaff";

export function Admin() {
  return (
    <HostGate requireAdmin skeleton={<StudioSkeleton />}>
      {(_user, profile) => <AdminContent profile={profile} />}
    </HostGate>
  );
}

type CleanupState = { status: "running" } | { status: "done"; report: CleanupReport } | { status: "error" };

/**
 * Автоочистка без Cloud Functions: при каждом входе admin удаляются сессии старше
 * 30 дней. Итоги для истории сохраняются перед удалением.
 */
function useSessionCleanup(): CleanupState {
  const [state, setState] = useState<CleanupState>({ status: "running" });
  useEffect(() => {
    let cancelled = false;
    sessionsRepo
      .removeExpired(retentionCutoff(Date.now()))
      .then((report) => !cancelled && setState({ status: "done", report }))
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function AdminContent({ profile }: { profile: UserProfile }) {
  const [hosts, retry, update] = useLoad(() => usersRepo.listHosts(), []);
  const cleanup = useSessionCleanup();
  const [created, setCreated] = useState<IssuedPassword | null>(null);
  const [toDisable, setToDisable] = useState<HostAccount | null>(null);
  const [toReset, setToReset] = useState<HostAccount | null>(null);
  const [toLevel, setToLevel] = useState<HostAccount | null>(null);
  const [toPoints, setToPoints] = useState<HostAccount | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  async function setActive(host: HostAccount, active: boolean) {
    setBusyUid(host.uid);
    setDialogError(null);
    try {
      await usersRepo.setHostActive(host.uid, active);
      update((list) => list.map((h) => (h.uid === host.uid ? { ...h, active } : h)));
      setToDisable(null);
      showToast(active ? `${host.name}: доступ включён` : `${host.name}: доступ отключён`);
    } catch {
      if (active) showToast("Не удалось включить. Проверьте интернет.");
      else setDialogError("Не удалось отключить. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusyUid(null);
    }
  }

  // Есть только на своём сервере: у Firebase без Cloud Functions сбросить пароль нельзя.
  const resetPassword = usersRepo.resetHostPassword?.bind(usersRepo);

  async function reset(host: HostAccount) {
    if (!resetPassword) return;
    setBusyUid(host.uid);
    setDialogError(null);
    try {
      const result = await resetPassword(host.uid);
      setToReset(null);
      setCreated({ ...result, kind: "reset" });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setDialogError(authService.describeError(e));
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <main className="page">
      <TopBar
        title="Ведущие"
        actions={[
          { label: "В студию", to: "/studio" },
          { label: "Выйти", onClick: () => void authService.signOut() },
        ]}
      />

      {created ? (
        <CreatedCard created={created} onDone={() => setCreated(null)} onToast={showToast} />
      ) : (
        <AddHostForm
          onCreated={(result) => {
            setCreated({ ...result, kind: "created" });
            update((list) => [result.account, ...list]);
          }}
        />
      )}

      <section className="card">
        <h2>Все ведущие{hosts.status === "ready" ? `: ${hosts.data.length}` : ""}</h2>
        <p className="muted">Отключённый ведущий не может войти в студию и запускать игры. Его игры и история сохраняются.</p>
        {hosts.status === "loading" && <ListSkeleton count={2} bare />}
        {hosts.status === "error" && <LoadFailedInline onRetry={retry} />}
        {hosts.status === "ready" && (
          <ul className="people">
            {hosts.data.map((host) => (
              <li key={host.uid} className={host.active ? undefined : "people__item--off"}>
                <div className="people__text">
                  <span className="people__name line-clamp">{host.name}</span>
                  <span className="muted small line-clamp">{host.email || "почта не указана"}</span>
                  <span className="small">
                    {host.role === "admin" ? "Администратор" : "Ведущий"} ·{" "}
                    <span className={host.active ? "success" : "error"}>{host.active ? "активен" : "отключён"}</span>
                  </span>
                  {staffRepo && host.role !== "admin" && (
                    <span className="small">
                      {levelTitle(host.level) ?? "Квалификация не задана"}
                      {host.experienceSince ? ` · стаж ${experienceLabel(host.experienceSince, Date.now())}` : ""}
                      {` · ${pointsLabel(host.points ?? 0)}`}
                    </span>
                  )}
                </div>
                {permissions.canSetHostActive(profile, host) && (
                  <div className="people__actions">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busyUid === host.uid}
                      onClick={() => {
                        if (host.active) {
                          setDialogError(null);
                          setToDisable(host);
                        } else {
                          void setActive(host, true);
                        }
                      }}
                    >
                      {host.active ? "Отключить" : "Включить"}
                    </button>
                    {(resetPassword || staffRepo) && (
                      <ActionMenu
                        icon="dots"
                        label={`Действия: ${host.name}`}
                        actions={[
                          ...(staffRepo
                            ? [
                                { label: "Квалификация и стаж", onClick: () => setToLevel(host) },
                                { label: "Баллы", onClick: () => setToPoints(host) },
                              ]
                            : []),
                          ...(resetPassword && permissions.canResetHostPassword(profile, host)
                            ? [
                                {
                                  label: "Новый временный пароль",
                                  onClick: () => {
                                    setDialogError(null);
                                    setToReset(host);
                                  },
                                },
                              ]
                            : []),
                        ]}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CleanupNote state={cleanup} />

      <LevelDialog
        host={toLevel}
        onClose={() => setToLevel(null)}
        onSaved={(saved, level, experienceSince) => {
          update((list) => list.map((h) => (h.uid === saved.uid ? { ...h, level, experienceSince } : h)));
          showToast(`${saved.name}: квалификация сохранена`);
        }}
      />
      <PointsDialog
        host={toPoints}
        onClose={() => setToPoints(null)}
        onChanged={(changed, total) => update((list) => list.map((h) => (h.uid === changed.uid ? { ...h, points: total } : h)))}
      />

      <ConfirmDialog
        open={toDisable !== null}
        title="Отключить ведущего?"
        confirmLabel="Отключить"
        busy={busyUid !== null}
        error={dialogError}
        onConfirm={() => toDisable && void setActive(toDisable, false)}
        onCancel={() => setToDisable(null)}
      >
        <p>
          {toDisable?.name} больше не сможет войти в студию и запускать игры. Включить доступ можно в любой момент.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={toReset !== null}
        title="Новый временный пароль?"
        confirmLabel="Выдать пароль"
        busy={busyUid !== null}
        error={dialogError}
        onConfirm={() => toReset && void reset(toReset)}
        onCancel={() => setToReset(null)}
      >
        <p>
          {toReset?.name} выйдет на всех устройствах, старый пароль перестанет действовать. Новый пароль покажем один
          раз — при входе ведущий заменит его на свой.
        </p>
      </ConfirmDialog>

      <Toast text={toast} />
    </main>
  );
}

function AddHostForm({ onCreated }: { onCreated: (created: CreatedHost) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const cleanedName = cleanName(name);
    if (!isValidName(cleanedName)) {
      setError("Введите имя ведущего.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await usersRepo.createHost(email, cleanedName);
      setEmail("");
      setName("");
      onCreated(created);
    } catch (e) {
      setError(authService.describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Добавить ведущего</h2>
      <label className="field">
        Почта
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        Имя
        <input
          autoComplete="off"
          required
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn--block" type="submit" disabled={busy}>
        {busy ? "Создаём аккаунт…" : "Добавить ведущего"}
      </button>
      <p className="muted small">Пароль создастся автоматически и покажется один раз.</p>
    </form>
  );
}

/** Новый ведущий или новый временный пароль существующему. */
type IssuedPassword = CreatedHost & { kind: "created" | "reset" };

/** Временный пароль показывается один раз: он нигде не хранится. */
function CreatedCard({
  created,
  onDone,
  onToast,
}: {
  created: IssuedPassword;
  onDone: () => void;
  onToast: (text: string) => void;
}) {
  const { account, temporaryPassword, kind } = created;
  const loginText = [
    `Вход для ведущего JoyRest Games: ${window.location.origin}/studio`,
    `Почта: ${account.email}`,
    `Временный пароль: ${temporaryPassword}`,
    "После входа задайте свой пароль в меню студии.",
  ].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(loginText);
      onToast("Данные для входа скопированы");
    } catch {
      onToast("Не удалось скопировать — перепишите пароль вручную");
    }
  }

  return (
    <section className="card" aria-live="polite">
      <h2>{kind === "reset" ? `Новый пароль: ${account.name}` : `Добавлен ведущий: ${account.name}`}</h2>
      <p>Передайте ведущему данные для входа. Пароль показывается только сейчас, после входа его можно сменить.</p>
      <dl className="credentials">
        <dt>Почта</dt>
        <dd className="line-clamp">{account.email}</dd>
        <dt>Временный пароль</dt>
        <dd className="credentials__password">{temporaryPassword}</dd>
      </dl>
      <div className="actions">
        <button type="button" className="btn btn--block" onClick={() => void copy()}>
          Скопировать данные для входа
        </button>
        <button type="button" className="btn btn--secondary btn--block" onClick={onDone}>
          Готово
        </button>
      </div>
    </section>
  );
}

function CleanupNote({ state }: { state: CleanupState }) {
  let text: string;
  if (state.status === "running") text = `Проверяем сессии старше ${SESSION_RETENTION_DAYS} дней…`;
  else if (state.status === "error") text = "Автоочистка не удалась — повторим при следующем входе.";
  else if (state.report.deleted === 0) text = `Старых сессий нет. Сессии хранятся ${SESSION_RETENTION_DAYS} дней, итоги игр — всегда.`;
  else {
    text = `Удалено старых сессий: ${state.report.deleted}. Итоги игр сохранены в истории.`;
    if (state.report.more) text += " Остальные удалим при следующем входе.";
  }
  return (
    <p className="muted small" role="status">
      {text}
    </p>
  );
}
