import { useEffect, useState, type FormEvent } from "react";
import { cleanName, isValidName, NAME_MAX_LENGTH } from "../core/names";
import { experienceLabel, levelTitle } from "../core/levels";
import { pointsLabel } from "../core/points";
import { PROFESSIONS, professionOf, professionTitle, type Profession } from "../core/professions";
import { retentionCutoff, SESSION_RETENTION_DAYS } from "../core/retention";
import {
  authService,
  permissions,
  sessionsRepo,
  staffRepo,
  useLoad,
  usersRepo,
  venuesRepo,
  type CleanupReport,
  type CreatedHost,
  type HostAccount,
  type UserProfile,
} from "../data";
import { ConfirmDialog, useConfirm } from "../components/ConfirmDialog";
import { ActionMenu } from "../components/Menu";
import { ListSkeleton } from "../components/Skeleton";
import { LoadFailedInline } from "../components/Status";
import { Toast, useToast } from "../components/Toast";
import { LevelDialog, PointsDialog } from "./HostStaff";


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

/**
 * «Управление ведущими» — вторая вкладка «Команды JoyRest», только у владельца (`/admin`,
 * `/studio/team?tab=manage`): добавить, отключить, квалификация, баллы, доступ к базе площадок.
 * Любое изменение — только после подтверждения.
 */
export function HostsManager({ profile }: { profile: UserProfile }) {
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
  const [dialog, confirm] = useConfirm();
  const [group, setGroup] = useState<"hosts" | "pros">("hosts");
  const [toProfession, setToProfession] = useState<{ host: HostAccount; value: Profession } | null>(null);

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

  function setVenueAccess(host: HostAccount, access: boolean) {
    const repo = venuesRepo;
    if (!repo) return;
    confirm({
      title: access ? `Открыть базу площадок для ${host.name}?` : `Закрыть базу площадок для ${host.name}?`,
      text: access
        ? "Ведущий увидит все площадки с контактами и заявки клиентов с телефонами и сможет собирать предложения."
        : "Ведущий перестанет видеть площадки и заявки клиентов. Его QR-анкеты продолжат работать.",
      confirmLabel: access ? "Открыть базу" : "Закрыть базу",
      run: async () => {
        setBusyUid(host.uid);
        try {
          await repo.setAccess(host.uid, access);
          update((list) => list.map((h) => (h.uid === host.uid ? { ...h, venueAccess: access } : h)));
          showToast(access ? `${host.name}: база площадок открыта` : `${host.name}: база площадок закрыта`);
        } finally {
          setBusyUid(null);
        }
      },
    });
  }

  function askEnable(host: HostAccount) {
    confirm({
      title: `Включить доступ для ${host.name}?`,
      text: "Ведущий снова сможет входить в студию и запускать игры.",
      confirmLabel: "Включить доступ",
      run: async () => {
        setBusyUid(host.uid);
        try {
          await usersRepo.setHostActive(host.uid, true);
          update((list) => list.map((h) => (h.uid === host.uid ? { ...h, active: true } : h)));
          showToast(`${host.name}: доступ включён`);
        } finally {
          setBusyUid(null);
        }
      },
    });
  }

  const allHosts = hosts.status === "ready" ? hosts.data : [];
  const shownHosts = allHosts.filter((h) => (group === "hosts" ? h.role === "admin" || professionOf(h.profession) === "host" : h.role !== "admin" && professionOf(h.profession) !== "host"));

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
    <>
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
        {usersRepo.setProfession && (
          <div className="seg" role="group" aria-label="Кого показать">
            <button type="button" className={group === "hosts" ? "seg__btn is-on" : "seg__btn"} aria-pressed={group === "hosts"} onClick={() => setGroup("hosts")}>
              Ведущие
            </button>
            <button type="button" className={group === "pros" ? "seg__btn is-on" : "seg__btn"} aria-pressed={group === "pros"} onClick={() => setGroup("pros")}>
              Другие профессии
            </button>
          </div>
        )}
        <h2>
          {group === "hosts" ? "Все ведущие" : "Профессии JoyRest"}
          {hosts.status === "ready" ? `: ${shownHosts.length}` : ""}
        </h2>
        <p className="muted">
          {group === "hosts"
            ? "Отключённый ведущий не может войти в студию и запускать игры. Его игры и история сохраняются."
            : "Диджеи, музыканты, фокусники и другие: видят команду и свою страницу, игр у них нет. Профессию можно поменять в «⋯»."}
        </p>
        {hosts.status === "ready" && shownHosts.length === 0 && <p className="muted">{group === "hosts" ? "Ведущих пока нет." : "Пока никого: добавьте человека выше и выберите профессию."}</p>}
        {hosts.status === "loading" && <ListSkeleton count={2} bare />}
        {hosts.status === "error" && <LoadFailedInline onRetry={retry} />}
        {hosts.status === "ready" && (
          <ul className="people">
            {shownHosts.map((host) => (
              <li key={host.uid} className={host.active ? undefined : "people__item--off"}>
                <div className="people__text">
                  <span className="people__name line-clamp">{host.name}</span>
                  <span className="muted small line-clamp">{host.email || "почта не указана"}</span>
                  <span className="small">
                    {host.role === "admin" ? "Администратор" : professionTitle(host.profession)} ·{" "}
                    <span className={host.active ? "success" : "error"}>{host.active ? "активен" : "отключён"}</span>
                  </span>
                  {staffRepo && host.role !== "admin" && professionOf(host.profession) === "host" && (
                    <ul className="meta" aria-label={`Квалификация и баллы: ${host.name}`}>
                      <li>{levelTitle(host.level) ?? "Без квалификации"}</li>
                      {host.experienceSince ? <li>Стаж: {experienceLabel(host.experienceSince, Date.now())}</li> : null}
                      <li>{pointsLabel(host.points ?? 0)}</li>
                      {venuesRepo && host.venueAccess && <li>База площадок</li>}
                    </ul>
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
                          askEnable(host);
                        }
                      }}
                    >
                      {host.active ? "Отключить" : "Включить"}
                    </button>
                    {(resetPassword || staffRepo || venuesRepo) && (
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
                          ...(usersRepo.setProfession && permissions.canSetHostActive(profile, host)
                            ? [{ label: "Профессия", onClick: () => setToProfession({ host, value: professionOf(host.profession) }) }]
                            : []),
                          ...(venuesRepo && permissions.canGrantVenueAccess(profile, host)
                            ? [
                                {
                                  label: host.venueAccess ? "Закрыть базу площадок" : "Открыть базу площадок",
                                  onClick: () => void setVenueAccess(host, !host.venueAccess),
                                },
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

      <ConfirmDialog
        open={toProfession !== null}
        title={`Профессия: ${toProfession?.host.name ?? ""}`}
        confirmLabel="Сохранить профессию"
        busy={busyUid !== null}
        error={dialogError}
        onCancel={() => setToProfession(null)}
        onConfirm={() => {
          const target = toProfession;
          if (!target || !usersRepo.setProfession) return;
          setBusyUid(target.host.uid);
          setDialogError(null);
          usersRepo
            .setProfession(target.host.uid, target.value)
            .then(() => {
              update((list) => list.map((h) => (h.uid === target.host.uid ? { ...h, profession: target.value } : h)));
              showToast(`${target.host.name}: ${professionTitle(target.value).toLowerCase()}`);
              setToProfession(null);
            })
            .catch(() => setDialogError("Не получилось сохранить. Проверьте интернет."))
            .finally(() => setBusyUid(null));
        }}
      >
        <div className="row profession-chips">
          {PROFESSIONS.map((p) => (
            <button key={p.id} type="button" className="pick-chip" aria-pressed={toProfession?.value === p.id} onClick={() => setToProfession((cur) => (cur ? { ...cur, value: p.id } : cur))}>
              {p.title}
            </button>
          ))}
        </div>
        <p className="muted small">Ведущий проводит игры. Другие профессии видят команду и свою страницу, игр у них нет — их игры и история сохраняются.</p>
      </ConfirmDialog>
      {dialog}
      <Toast text={toast} />
    </>
  );
}

function AddHostForm({ onCreated }: { onCreated: (created: CreatedHost) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [profession, setProfession] = useState<Profession>("host");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const cleanedName = cleanName(name);
    if (!isValidName(cleanedName)) {
      setError("Введите имя.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await usersRepo.createHost(email, cleanedName, usersRepo.setProfession ? profession : undefined);
      setEmail("");
      setName("");
      setProfession("host");
      onCreated(created);
    } catch (e) {
      setError(authService.describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Добавить в команду</h2>
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
      {usersRepo.setProfession && (
        <fieldset className="stack stack--tight">
          <legend>Профессия</legend>
          <div className="row profession-chips">
            {PROFESSIONS.map((p) => (
              <button key={p.id} type="button" className="pick-chip" aria-pressed={profession === p.id} onClick={() => setProfession(p.id)}>
                {p.title}
              </button>
            ))}
          </div>
          {profession !== "host" && <p className="muted small">Не ведущий: увидит команду и свою страницу, игр у него не будет.</p>}
        </fieldset>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn--block" type="submit" disabled={busy}>
        {busy ? "Создаём аккаунт…" : profession === "host" ? "Добавить ведущего" : `Добавить: ${professionTitle(profession).toLowerCase()}`}
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
