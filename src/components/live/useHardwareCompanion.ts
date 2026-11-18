import { useCallback, useEffect, useRef, useState } from "react";
import {
  listLocalHardwareDevices,
  localHardwareHealth,
  LocalHardwareError,
  pairLocalHardware,
  pressLocalVirtual,
  streamLocalHardwareEvents,
  type LocalHardwareDevice,
  type LocalPressEvent,
} from "../../data";
import type { HardwareSource } from "../../core/hardware";

export type CompanionStatus = "unavailable" | "disconnected" | "pairing" | "connected" | "error";
const STORAGE_KEY = "joyrest.hardware.local-token";

/** Соединение с локальной программой и восстановление SSE с короткой паузой. */
export function useHardwareCompanion(onPress: (event: LocalPressEvent) => void) {
  const [token, setToken] = useState(() => (typeof sessionStorage === "undefined" ? "" : sessionStorage.getItem(STORAGE_KEY) ?? ""));
  const [status, setStatus] = useState<CompanionStatus>("disconnected");
  const [devices, setDevices] = useState<LocalHardwareDevice[]>([]);
  const [pairCode, setPairCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const callback = useRef(onPress);
  callback.current = onPress;

  const saveToken = useCallback((value: string) => {
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
    setToken(value);
  }, []);

  useEffect(() => {
    let active = true;
    setError(null);
    if (!token) {
      setDevices([]);
      localHardwareHealth().then(
        () => active && setStatus("disconnected"),
        () => active && setStatus("unavailable"),
      );
      return () => {
        active = false;
      };
    }
    setStatus("pairing");
    listLocalHardwareDevices(token)
      .then((list) => {
        if (!active) return;
        setDevices(list);
        setStatus("connected");
      })
      .catch((problem) => {
        if (!active) return;
        if (problem instanceof LocalHardwareError && problem.status === 401) {
          saveToken("");
          setDevices([]);
          setStatus("disconnected");
          setError("Сопряжение устарело. Введите новый код из программы.");
        } else {
          setStatus("error");
          setError("Не удалось получить устройства локальной программы.");
        }
      });
    return () => {
      active = false;
    };
  }, [token, saveToken]);

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let controller: AbortController | null = null;
    const run = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          await streamLocalHardwareEvents(token, controller.signal, (event) => callback.current(event));
          if (!stopped) setStatus("error");
        } catch (problem) {
          if (stopped) break;
          if (problem instanceof LocalHardwareError && problem.status === 401) {
            saveToken("");
            setDevices([]);
            setStatus("disconnected");
            setError("Сопряжение устарело. Введите новый код из программы.");
            break;
          }
          setStatus("error");
        }
        if (!stopped) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    };
    void run();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }, [token, saveToken]);

  const pair = useCallback(async () => {
    setStatus("pairing");
    setError(null);
    try {
      const result = await pairLocalHardware(pairCode.trim());
      const list = await listLocalHardwareDevices(result.token);
      setDevices(list);
      saveToken(result.token);
      setPairCode("");
      setStatus("connected");
      return true;
    } catch {
      setStatus("error");
      setError("Не удалось сопрячь. Проверьте код и что программа запущена.");
      return false;
    }
  }, [pairCode, saveToken]);

  const press = useCallback(async (source: HardwareSource, hardwareId: string) => {
    if (!token) throw new LocalHardwareError(0, "Сначала сопрягите программу");
    return pressLocalVirtual(token, source, hardwareId);
  }, [token]);

  return { token, status, devices, pairCode, setPairCode, pair, press, error };
}
