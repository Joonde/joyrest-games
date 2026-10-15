import { useEffect, useState, type FormEvent } from "react";
import { cleanName, isValidName, NAME_MAX_LENGTH } from "../core/names";
import { experienceLabel, levelTitle } from "../core/levels";
import { pointsLabel } from "../core/points";
import { ACCESS_ROLES, accessRoleTitle, isAccessRole, type AccessRole } from "../core/accessRoles";
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
import { Fold } from "../components/Fold";
import { ActionMenu, type MenuAction } from "../components/Menu";
import { ListSkeleton } from "../components/Skeleton";
import { LoadFailedInline } from "../components/Status";
import { Toast, useToast } from "../components/Toast";
import { LevelDialog, PointsDialog } from "./HostStaff";


type CleanupState = { status: "running" } | { status: "done"; report: CleanupReport } | { status: "error" };

/**
 * Автоочистка без Cloud Functions: при каждом входе admin удаляются сессии старше
 * 30 дней. Итоги для истории сохраняются перед удалением.
 */
/** Одна очистка за открытие приложения: переключение вкладок «Команды» не запускает её снова. */
let cleanupRun: Promise<CleanupReport> | null = null;

function useSessionCleanup(): CleanupState {
  const [state, setState] = useState<CleanupState>({ status: "running" });
  useEffect(() => {
    let cancelled = false;
    if (!cleanupRun) {
      cleanupRun = sessionsRepo.removeExpired(retentionCutoff(Date.now()));
      cleanupRun.catch(() => {
        cleanupRun = null; // не вышло — попробуем при следующем открытии
      });
    }
    cleanupRun
      .then((report) => !cancelled && setState({ status: "done", report }))
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/**
 * Все действия владельца с человеком команды — одно меню «⋯» и окна (решение владельца 15 октября 2026: те же действия и
 * на вкладке «Управление», и прямо на карточках «Команды»). `update` правит список людей того экрана, где хук.
 */
export function useHostAdmin(profile: UserProfile, update: (fn: (list: HostAccount[]) => HostAccount[]) => void) {
  const [created, setCreated] = useState<IssuedPassword | null>(null);
  const [toDisable, setToDisable] = useState<HostAccount | null>(null);
  const [toReset, setToReset] = useState<HostAccount | null>(null);
  const [toLevel, setToLevel] = useState<HostAccount | null>(null);
  const [toPoints, setToPoints] = useState<HostAccount | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const [dialog, confirm] = useConfirm();
  const [toProfession, setToProfession] = useState<{ host: HostAccount; value: Profession } | null>(null);
  const [toRole, setToRole] = useState<{ host: HostAccount; value: AccessRole | null } | null>(null);

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
      text: "Человек снова сможет входить в студию.",
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

  /** Отключить или включить — с подтверждением. */
  function toggleActive(host: HostAccount) {
    if (host.active) {
      setDialogError(null);
      setToDisable(host);
    } else askEnable(host);
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

  /** Пункты меню «⋯» для человека (что владельцу можно с ним сделать). `withActive` — и «Отключить/Включить». */
  function actionsFor(host: HostAccount, withActive = false): MenuAction[] {
    const isHostPro = host.role !== "admin" && professionOf(host.profession) === "host";
    return [
      { label: "Возможности (PDF)", to: `/studio/abilities?uid=${encodeURIComponent(host.uid)}` },
      ...(withActive && permissions.canSetHostActive(profile, host) ? [{ label: host.active ? "Отключить доступ" : "Включить доступ", onClick: () => toggleActive(host) }] : []),
      ...(staffRepo && isHostPro
        ? [
            { label: "Квалификация и стаж", onClick: () => setToLevel(host) },
            { label: "Баллы", onClick: () => setToPoints(host) },
          ]
        : []),
      ...(usersRepo.setProfession && permissions.canSetHostActive(profile, host)
        ? [{ label: "Профессия", onClick: () => { setDialogError(null); setToProfession({ host, value: professionOf(host.profession) }); } }]
        : []),
      ...(usersRepo.setAccessRole && permissions.canSetAccessRole(profile, host)
        ? [{ label: "Роль доступа", onClick: () => { setDialogError(null); setToRole({ host, value: isAccessRole(host.accessRole) ? host.accessRole : null }); } }]
        : []),
      ...(venuesRepo && permissions.canGrantVenueAccess(profile, host)
        ? [{ label: host.venueAccess ? "Закрыть базу площадок" : "Открыть базу площадок", onClick: () => void setVenueAccess(host, !host.venueAccess) }]
        : []),
      ...(resetPassword && permissions.canResetHostPassword(profile, host)
        ? [{ label: "Новый временный пароль", onClick: () => { setDialogError(null); setToReset(host); } }]
        : []),
    ];
  }

  const elements = (
    <>
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
        title="Отключить доступ?"
        confirmLabel="Отключить"
        busy={busyUid !== null}
        error={dialogError}
        onConfirm={() => toDisable && void setActive(toDisable, false)}
        onCancel={() => setToDisable(null)}
      >
        <p>
          {toDisable?.name} больше не сможет войти в студию. Включить доступ можно в любой момент — игры и история сохраняются.
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
          раз — при входе человек заменит его на свой.
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
          // Стал менеджером по продажам без роли — роль «Менеджер по продажам» ставится сама, иначе он ничего не увидит.
          const giveSalesRole = target.value === "sales" && !target.host.accessRole && usersRepo.setAccessRole && permissions.canSetAccessRole(profile, target.host);
          usersRepo
            .setProfession(target.host.uid, target.value)
            .then(() => (giveSalesRole && usersRepo.setAccessRole ? usersRepo.setAccessRole(target.host.uid, "sales") : undefined))
            .then(() => {
              update((list) =>
                list.map((h) => (h.uid === target.host.uid ? { ...h, profession: target.value, ...(giveSalesRole ? { accessRole: "sales" as AccessRole } : {}) } : h)),
              );
              showToast(`${target.host.name}: ${professionTitle(target.value).toLowerCase()}${giveSalesRole ? " — роль доступа дана" : ""}`);
              setToProfession(null);
            })
            .catch(() => setDialogError("Не получилось сохранить. Проверьте интернет."))
            .finally(() => setBusyUid(null));
        }}
      >
        <ProfessionPicker value={toProfession?.value ?? "host"} onChange={(value) => setToProfession((cur) => (cur ? { ...cur, value } : cur))} />
      </ConfirmDialog>
      <ConfirmDialog
        open={toRole !== null}
        title={`Роль доступа: ${toRole?.host.name ?? ""}`}
        confirmLabel={toRole?.value ? `Дать роль «${accessRoleTitle(toRole.value) ?? ""}»` : "Оставить без роли"}
        busy={busyUid !== null}
        error={dialogError}
        onCancel={() => setToRole(null)}
        onConfirm={() => {
          const target = toRole;
          if (!target || !usersRepo.setAccessRole) return;
          setBusyUid(target.host.uid);
          setDialogError(null);
          usersRepo
            .setAccessRole(target.host.uid, target.value)
            .then(() => {
              update((list) => list.map((h) => (h.uid === target.host.uid ? { ...h, accessRole: target.value } : h)));
              showToast(target.value ? `${target.host.name}: роль «${accessRoleTitle(target.value) ?? ""}»` : `${target.host.name}: без роли`);
              setToRole(null);
            })
            .catch(() => setDialogError("Не получилось сохранить роль. Проверьте интернет."))
            .finally(() => setBusyUid(null));
        }}
      >
        <p className="muted small">
          Роль только добавляет доступ: ведущий остаётся ведущим со своими играми, музыкой и сессиями. Роль у человека одна.
          Ваших прав (люди, роли, баллы, пароли, удаление) нет ни у одной роли.
        </p>
        <div className="stack" role="radiogroup" aria-label="Роль доступа">
          {[{ id: null, title: "Без роли", can: "Только то, что даёт профессия.", cannot: "" }, ...ACCESS_ROLES].map((r) => (
            <label key={r.id ?? "none"} className="choice">
              <input type="radio" name="access-role" checked={(toRole?.value ?? null) === r.id} onChange={() => setToRole((cur) => (cur ? { ...cur, value: r.id } : cur))} />
              <span className="choice__text">
                <span className="choice__title">{r.title}</span>
                <span className="choice__hint">{r.id ? `Может: ${r.can}` : r.can}</span>
                {r.cannot && <span className="choice__hint">Не может: {r.cannot}</span>}
              </span>
            </label>
          ))}
        </div>
      </ConfirmDialog>
      {dialog}
      <Toast text={toast} />
    </>
  );

  return { actionsFor, toggleActive, busyUid, created, setCreated, showToast, elements };
}

/**
 * Управление командой (вкладка «Управление» в «Команде JoyRest»; `/admin` открывает её сразу,
 * `/studio/team?tab=manage`): добавить, отключить, квалификация, баллы, доступ к базе площадок.
 * Любое изменение — только после подтверждения.
 */
export function HostsManager({ profile }: { profile: UserProfile }) {
  const [hosts, retry, update] = useLoad(() => usersRepo.listHosts(), []);
  const cleanup = useSessionCleanup();
  const admin = useHostAdmin(profile, update);
  const [group, setGroup] = useState<"hosts" | "pros">("hosts");

  const allHosts = hosts.status === "ready" ? hosts.data : [];
  const shownHosts = allHosts.filter((h) => (group === "hosts" ? h.role === "admin" || professionOf(h.profession) === "host" : h.role !== "admin" && professionOf(h.profession) !== "host"));

  return (
    <>
      {admin.created ? (
        <CreatedCard created={admin.created} onDone={() => admin.setCreated(null)} onToast={admin.showToast} />
      ) : (
        <AddHostForm
          onCreated={(result) => {
            admin.setCreated({ ...result, kind: "created" });
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
            : "Менеджеры по продажам, диджеи, музыканты и другие. Профессию и роль можно поменять в «⋯»."}
        </p>
        {hosts.status === "ready" && shownHosts.length === 0 && <p className="muted">{group === "hosts" ? "Ведущих пока нет." : "Пока никого: добавьте человека выше и выберите профессию."}</p>}
        {hosts.status === "loading" && <ListSkeleton count={2} bare />}
        {hosts.status === "error" && <LoadFailedInline onRetry={retry} />}
        {hosts.status === "ready" && (
          <ul className="people">
            {shownHosts.map((host) => {
              const actions = admin.actionsFor(host);
              return (
                <li key={host.uid} className={host.active ? undefined : "people__item--off"}>
                  <div className="people__text">
                    <span className="people__name line-clamp">{host.name}</span>
                    <span className="muted small line-clamp">{host.email || "почта не указана"}</span>
                    <span className="small">
                      {host.role === "admin" ? "Администратор" : professionTitle(host.profession)} ·{" "}
                      <span className={host.active ? "success" : "error"}>{host.active ? "активен" : "отключён"}</span>
                    </span>
                    {host.role !== "admin" && accessRoleTitle(host.accessRole) && <span className="small role-tag">Роль: {accessRoleTitle(host.accessRole)}</span>}
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
                      <button type="button" className="btn btn--secondary" disabled={admin.busyUid === host.uid} onClick={() => admin.toggleActive(host)}>
                        {host.active ? "Отключить" : "Включить"}
                      </button>
                      {actions.length > 0 && <ActionMenu icon="dots" label={`Действия: ${host.name}`} actions={actions} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CleanupNote state={cleanup} />
      {admin.elements}
    </>
  );
}

/**
 * Выбор профессии (решение владельца 15 октября 2026): две главные — «Ведущий» и «Менеджер по продажам» — крупными
 * карточками, остальные (у них пока нет своего кабинета: видят команду, свою страницу и календарь) — свёрнуто ниже.
 */
const MAIN_PROFESSIONS: { id: Profession; hint: string }[] = [
  { id: "host", hint: "Проводит игры: свои игры, музыка, пульт, календарь и мероприятия." },
  { id: "sales", hint: "Клиенты и заявки, «Кто может» в дату, запись мероприятий. Роль доступа поставится сама." },
];

export function ProfessionPicker({ value, onChange }: { value: Profession; onChange: (value: Profession) => void }) {
  const others = PROFESSIONS.filter((p) => !MAIN_PROFESSIONS.some((m) => m.id === p.id));
  const otherChosen = others.find((p) => p.id === value);
  return (
    <div className="stack stack--tight">
      <div className="profession-main" role="radiogroup" aria-label="Основные профессии">
        {MAIN_PROFESSIONS.map((m) => (
          <label key={m.id} className="choice profession-main__item">
            <input type="radio" name="profession-main" checked={value === m.id} onChange={() => onChange(m.id)} />
            <span className="choice__text">
              <span className="choice__title">{professionTitle(m.id)}</span>
              <span className="choice__hint">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <Fold title="Другие профессии" value={otherChosen?.title} open={Boolean(otherChosen)}>
        <p className="muted small">Пока без своего кабинета: видят команду, свою страницу и календарь, игр и клиентов у них нет.</p>
        <div className="row profession-chips">
          {others.map((p) => (
            <button key={p.id} type="button" className="pick-chip" aria-pressed={value === p.id} onClick={() => onChange(p.id)}>
              {p.title}
            </button>
          ))}
        </div>
      </Fold>
    </div>
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
      let created = await usersRepo.createHost(email, cleanedName, usersRepo.setProfession ? profession : undefined);
      // Менеджер по продажам сразу получает свою роль доступа — без неё он не увидит ни клиентов, ни заявок.
      if (profession === "sales" && usersRepo.setAccessRole) {
        const ok = await usersRepo.setAccessRole(created.account.uid, "sales").then(() => true, () => false);
        if (ok) created = { ...created, account: { ...created.account, accessRole: "sales" } };
      }
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
          <ProfessionPicker value={profession} onChange={setProfession} />
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
