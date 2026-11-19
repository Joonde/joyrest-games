import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hardwareRepo, type LeaderboardEntry, type Session } from "../../data";
import type { HardwareBinding, HardwareSource } from "../../core/hardware";
import type { LocalPressEvent } from "../../data";
import { ConfirmDialog } from "../ConfirmDialog";
import { teamColorVar } from "../../themes/registry";
import { useHardwareCompanion } from "./useHardwareCompanion";

/** На время пилота эмулятор доступен ведущим; `VITE_HARDWARE_EMULATOR=false` скрывает его. */
export const HARDWARE_EMULATOR = import.meta.env.DEV || import.meta.env.VITE_HARDWARE_EMULATOR !== "false";

type VirtualDevice = {
  source: HardwareSource;
  hardwareId: string;
  alias: string;
};

type DeviceView = VirtualDevice & {
  binding: HardwareBinding | null;
  connected: boolean;
  /** Отдельный виртуальный вход или событие из локальной программы. */
  origin: "emulator" | "companion";
};

const newId = (prefix: string) => `${prefix}${crypto.getRandomValues(new Uint32Array(2)).join("")}`;

export function HardwarePanel({ session, onToast }: { session: Session; onToast: (text: string) => void }) {
  const [bindings, setBindings] = useState<HardwareBinding[]>([]);
  const [unbound, setUnbound] = useState<VirtualDevice[]>([]);
  const [offline, setOffline] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPid, setManualPid] = useState<string | null>(null);
  const [wizardPid, setWizardPid] = useState<string | null>(null);
  const [wizardDone, setWizardDone] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [tested, setTested] = useState<string[]>([]);
  const [transfer, setTransfer] = useState<{ device: DeviceView; participantId: string } | null>(null);

  const entries = useMemo(() => Object.entries(session.leaderboard) as Array<[string, LeaderboardEntry]>, [session.leaderboard]);
  const nameOf = useCallback((pid: string) => session.leaderboard[pid]?.name ?? "Участник", [session.leaderboard]);

  const refresh = useCallback(async () => {
    if (!hardwareRepo) return [];
    const list = await hardwareRepo.list(session.id);
    setBindings(list);
    return list;
  }, [session.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    if (!hardwareRepo) {
      setLoading(false);
      return;
    }
    hardwareRepo
      .list(session.id)
      .then((list) => {
        if (active) setBindings(list);
      })
      .catch(() => active && setError("Не удалось загрузить привязки кнопок."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [session.id]);

  const companion = useHardwareCompanion(handleLocalPress);

  const devices = useMemo<DeviceView[]>(() => {
    const map = new Map<string, DeviceView>();
    for (const device of companion.devices) {
      map.set(`${device.source}:${device.hardwareId}`, { ...device, binding: null, origin: "companion" });
    }
    for (const device of unbound) {
      const key = `${device.source}:${device.hardwareId}`;
      if (!map.has(key)) map.set(key, { ...device, binding: null, connected: !offline.includes(`free:${key}`), origin: "emulator" });
    }
    for (const binding of bindings) {
      const key = `${binding.source}:${binding.hardwareId}`;
      const existing = map.get(key);
      map.set(key, {
        source: binding.source,
        hardwareId: binding.hardwareId,
        alias: binding.alias,
        binding,
        connected: existing?.connected ?? !offline.includes(binding.id),
        origin: existing?.origin ?? "emulator",
      });
    }
    return [...map.values()];
  }, [bindings, companion.devices, offline, unbound]);
  const devicesRef = useRef(devices);
  const bindingsRef = useRef(bindings);
  const manualRef = useRef(manualPid);
  const wizardRef = useRef(wizardPid);
  const wizardDoneRef = useRef(wizardDone);
  const testModeRef = useRef(testMode);
  devicesRef.current = devices;
  bindingsRef.current = bindings;
  manualRef.current = manualPid;
  wizardRef.current = wizardPid;
  wizardDoneRef.current = wizardDone;
  testModeRef.current = testMode;

  const addVirtual = (source: HardwareSource): VirtualDevice => {
    const count = devices.filter((device) => device.source === source).length + 1;
    const device = { source, hardwareId: newId(`${source}-`), alias: source === "usb" ? `USB №${count}` : `Кнопка ${count}` };
    setUnbound((current) => [...current, device]);
    return device;
  };

  async function performAssign(device: DeviceView, participantId: string): Promise<boolean> {
    if (!hardwareRepo || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const binding: HardwareBinding = {
        id: device.binding?.id ?? newId("binding-"),
        sessionId: session.id,
        participantId,
        source: device.source,
        hardwareId: device.hardwareId,
        alias: device.alias,
      };
      await hardwareRepo.save(session.id, binding);
      await refresh();
      setUnbound((current) => current.filter((item) => item.hardwareId !== device.hardwareId || item.source !== device.source));
      setManualPid(null);
      setTransfer(null);
      onToast(`${device.alias} назначена: ${nameOf(participantId)}`);
      return true;
    } catch {
      setError("Не удалось сохранить кнопку. Проверьте связь и повторите.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function assign(device: DeviceView, participantId: string) {
    if (device.binding && device.binding.participantId !== participantId) {
      setTransfer({ device, participantId });
      return;
    }
    void performAssign(device, participantId);
  }

  async function remove(binding: HardwareBinding) {
    if (!hardwareRepo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await hardwareRepo.remove(session.id, binding.id);
      setUnbound((current) => [...current, { source: binding.source, hardwareId: binding.hardwareId, alias: binding.alias }]);
      await refresh();
      onToast(`${binding.alias} отвязана`);
    } catch {
      setError("Не удалось отвязать кнопку.");
    } finally {
      setBusy(false);
    }
  }

  function startWizard() {
    const first = entries.find(([pid]) => !bindings.some((binding) => binding.participantId === pid))?.[0] ?? entries[0]?.[0] ?? null;
    setWizardPid(first);
    setWizardDone(false);
  }

  async function wizardAssignDevice(device: DeviceView) {
    if (!wizardPid) return;
    if (device.binding && device.binding.participantId !== wizardPid) {
      setTransfer({ device, participantId: wizardPid });
      return;
    }
    if (await performAssign(device, wizardPid)) setWizardDone(true);
  }

  async function wizardAssign(source: HardwareSource) {
    if (!wizardPid) return;
    const existing = devices.find((device) => device.source === source && !device.binding && device.connected);
    const device = existing ?? { ...addVirtual(source), binding: null, connected: true, origin: "emulator" as const };
    await wizardAssignDevice(device);
  }

  function nextWizard() {
    const next = entries.find(([pid]) => !bindings.some((binding) => binding.participantId === pid))?.[0] ?? null;
    setWizardPid(next);
    setWizardDone(false);
  }

  /** Единственный путь записи в игровой сервер. Не блокируем одновременные нажатия разных устройств. */
  async function buzz(device: DeviceView, eventId: string) {
    if (!hardwareRepo || !device.binding || !device.connected) return;
    setError(null);
    try {
      const result = await hardwareRepo.buzz(session.id, device.binding.id, eventId);
      if (result === "sent") onToast(`${nameOf(device.binding.participantId)}: нажатие принято`);
      else if (result === "duplicate") onToast("Это событие уже обработано");
      else onToast("Нажатие не принято: нет открытого buzz-шага или команда уже ответила");
    } catch {
      setError("Нажатие не подтверждено сервером. Проверьте связь и повторите.");
    }
  }

  async function press(device: DeviceView) {
    if (device.origin === "companion") {
      try {
        await companion.press(device.source, device.hardwareId);
      } catch {
        setError("Не удалось отправить нажатие в локальную программу.");
      }
      return;
    }
    await buzz(device, newId("event-"));
  }

  async function testPress(device: DeviceView) {
    if (device.origin === "companion") {
      try {
        await companion.press(device.source, device.hardwareId);
      } catch {
        setError("Не удалось отправить проверочное нажатие.");
      }
      return;
    }
    if (device.binding) setTested((current) => current.includes(device.binding!.participantId) ? current : [...current, device.binding!.participantId]);
  }

  /** Реальный путь локального события: проверка, назначение или запись через серверный hardware-buzz. */
  function handleLocalPress(event: LocalPressEvent) {
    const device = devicesRef.current.find((item) => item.source === event.source && item.hardwareId === event.hardwareId);
    if (!device || !device.connected) {
      onToast(`Неизвестная кнопка: ${event.hardwareId}`);
      return;
    }
    if (testModeRef.current) {
      if (device.binding) setTested((current) => current.includes(device.binding!.participantId) ? current : [...current, device.binding!.participantId]);
      else onToast(`${device.alias}: кнопка не назначена`);
      return;
    }
    if (wizardRef.current && !wizardDoneRef.current) {
      void wizardAssignDevice(device);
      return;
    }
    if (manualRef.current) {
      assign(device, manualRef.current);
      return;
    }
    if (!device.binding) {
      onToast(`${device.alias}: кнопка не назначена`);
      return;
    }
    void buzz(device, event.eventId);
  }

  if (!hardwareRepo) {
    return (
      <section className="card">
        <h2>Физические кнопки</h2>
        <p className="muted">Доступны только на собственном сервере JoyRest. В Firebase-версии используйте кнопки на телефонах гостей.</p>
      </section>
    );
  }

  if (!HARDWARE_EMULATOR) {
    return (
      <section className="card">
        <h2>Физические кнопки</h2>
        <p className="muted">Аппаратный модуль пока не подключён. Кнопки на телефонах продолжают работать.</p>
      </section>
    );
  }

  return (
    <section className="card hardware-panel">
      <div className="hardware-panel__head">
        <div>
          <p className="eyebrow">Эмулятор оборудования</p>
          <h2>Физические кнопки</h2>
          <p className="muted small">Виртуальные Bluetooth и USB работают через настоящий серверный приём. Реальное оборудование пока не подключено.</p>
        </div>
        <span className="hardware-panel__status">{devices.filter((device) => device.connected).length} на связи</span>
      </div>

      <div className="hardware-companion">
        <div className="hardware-companion__status">
          <strong>{companion.status === "connected" ? "Локальный канал подключён" : companion.status === "pairing" ? "Подключаем локальный канал…" : companion.status === "unavailable" ? "Программа JoyRest Кнопки не запущена" : companion.status === "error" ? "Ошибка локального канала" : "Нужно сопряжение с программой"}</strong>
          <span className="muted small">{companion.token ? `Устройств в программе: ${companion.devices.length}` : "Запустите hardware-companion и введите код из её консоли."}</span>
        </div>
        {!companion.token && (
          <div className="hardware-companion__pair">
            <input aria-label="Код сопряжения" inputMode="numeric" maxLength={6} placeholder="Код из программы" value={companion.pairCode} onChange={(event) => companion.setPairCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
            <button type="button" className="btn btn--small" disabled={companion.status === "pairing" || companion.pairCode.length !== 6} onClick={() => void companion.pair()}>Сопрячь</button>
          </div>
        )}
        {companion.error && <p className="error" role="alert">{companion.error}</p>}
        <details className="muted small">
          <summary>Как запустить локальную программу</summary>
          <p>В отдельном терминале: <code>cd hardware-companion && npm start</code>. Код одноразовый, токен хранится только в этой вкладке.</p>
        </details>
      </div>

      <div className="actions hardware-panel__actions">
        <button type="button" className="btn" disabled={busy || entries.length === 0} onClick={startWizard}>Назначить по очереди</button>
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => addVirtual("bluetooth")}>+ Bluetooth</button>
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => addVirtual("usb")}>+ USB</button>
        <button type="button" className="btn btn--quiet" disabled={assignedCount(bindings) === 0} onClick={() => { setTestMode((current) => !current); setTested([]); }}>
          {testMode ? "Закончить проверку" : "Проверить кнопки"}
        </button>
      </div>

      {wizardPid && (
        <div className="hardware-wizard">
          <p className="eyebrow">Назначение по очереди</p>
          <h3>{nameOf(wizardPid)}</h3>
          {!wizardDone ? (
            <>
              <p className="muted small">Выберите, какая виртуальная кнопка нажата этой командой.</p>
              <div className="actions">
                <button type="button" className="btn" disabled={busy} onClick={() => void wizardAssign("bluetooth")}>Нажать Bluetooth</button>
                <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void wizardAssign("usb")}>Нажать USB</button>
                <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => setWizardPid(null)}>Закончить</button>
              </div>
            </>
          ) : (
            <>
              <p role="status">Кнопка назначена. Нажатие в игре не создано.</p>
              <div className="actions">
                <button type="button" className="btn" onClick={nextWizard}>{bindings.length >= entries.length ? "Завершить назначение" : "Следующая команда"}</button>
                <button type="button" className="btn btn--quiet" onClick={() => setWizardPid(null)}>Закрыть</button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Загружаем привязки…</p>}
      <div className="hardware-list">
          {entries.map(([pid, entry]) => {
            const binding = bindings.find((item) => item.participantId === pid);
            const device = binding ? devices.find((item) => item.binding?.id === binding.id) : null;
            const isTested = tested.includes(pid);
            return (
              <div className={`hardware-row ${isTested ? "is-tested" : ""}`} key={pid}>
                <div className="hardware-row__team">
                  {entry.colorIndex !== undefined && <span className="hardware-row__color" style={{ background: teamColorVar(entry.colorIndex) }} />}
                  <div><strong>{entry.name}</strong><span className="muted small">{entry.kind === "team" ? "Команда" : "Игрок"}</span></div>
                </div>
                <div className="hardware-row__device">
                  {binding ? <><strong>{binding.alias}</strong><span className="muted small">{binding.source === "usb" ? "USB" : "Bluetooth"} · {device?.connected ? "на связи" : "нет связи"}</span></> : <span className="muted">Не назначена</span>}
                </div>
                <div className="actions hardware-row__actions">
                  <button type="button" className="btn btn--small btn--secondary" disabled={busy} onClick={() => setManualPid(manualPid === pid ? null : pid)}>{binding ? "Изменить" : "Назначить"}</button>
                  {binding && <button type="button" className="btn btn--small btn--quiet" disabled={busy} onClick={() => device && setOffline((current) => current.includes(binding.id) ? current.filter((id) => id !== binding.id) : [...current, binding.id])}>{device?.connected ? "Отключить" : "Подключить"}</button>}
                  {binding && <button type="button" className="btn btn--small btn--quiet" disabled={busy} onClick={() => void remove(binding)}>Отвязать</button>}
                  {testMode && binding && <button type="button" className="btn btn--small" disabled={!device?.connected} onClick={() => device && void testPress(device)}>{isTested ? "Проверено" : "Проверить"}</button>}
                  {!testMode && binding && <button type="button" className="btn btn--small" disabled={!device?.connected || busy} onClick={() => device && void press(device)}>Нажать в игру</button>}
                </div>
                {manualPid === pid && (
                  <div className="hardware-picker">
                    <p className="muted small">Выберите свободную кнопку или устройство, которое нужно переназначить.</p>
                    <div className="hardware-picker__devices">
                      {devices.filter((item) => item.connected).map((item) => (
                        <button type="button" className="btn btn--small btn--secondary" disabled={busy} key={`${item.source}:${item.hardwareId}`} onClick={() => assign(item, pid)}>
                          {item.alias} · {item.binding ? nameOf(item.binding.participantId) : "свободна"}
                        </button>
                      ))}
                      <button type="button" className="btn btn--small" disabled={busy} onClick={() => { const created = addVirtual("bluetooth"); assign({ ...created, binding: null, connected: true, origin: "emulator" }, pid); }}>+ Bluetooth</button>
                      <button type="button" className="btn btn--small" disabled={busy} onClick={() => { const created = addVirtual("usb"); assign({ ...created, binding: null, connected: true, origin: "emulator" }, pid); }}>+ USB</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        {entries.length === 0 && <p className="muted">Сначала добавьте игроков или команды в сессию.</p>}
      </div>

      {testMode && <p className="hardware-test" role="status">Проверка: {tested.length} из {bindings.length}. Ответы и очки не меняются.</p>}

      <ConfirmDialog
        open={transfer !== null}
        title="Переназначить кнопку?"
        confirmLabel="Переназначить"
        busy={busy}
        onCancel={() => setTransfer(null)}
        onConfirm={() => transfer && void performAssign(transfer.device, transfer.participantId)}
      >
        {transfer && <p>«{transfer.device.alias}» сейчас принадлежит участнику «{nameOf(transfer.device.binding?.participantId ?? "")}». После переноса прежний участник останется без физической кнопки.</p>}
      </ConfirmDialog>
    </section>
  );
}

function assignedCount(bindings: HardwareBinding[]): number {
  return bindings.length;
}
