/** Настройки телефона гостя на этом устройстве (localStorage; недоступен — значения по умолчанию, игра не ломается). */
import type { ShakeChoice } from "./shake";

const VIBRATION_KEY = "joyrest.bub.vibration";
const SHAKE_KEY = "joyrest.bub.shake";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Нет хранилища (частный режим) — помним до перезагрузки.
  }
}

/** Вибрация: по умолчанию включена. */
export function loadVibration(): boolean {
  return read(VIBRATION_KEY) !== "off";
}

export function saveVibration(on: boolean): void {
  write(VIBRATION_KEY, on ? null : "off");
}

export function loadShakeChoice(): ShakeChoice {
  return read(SHAKE_KEY) === "tap" ? "tap" : null;
}

export function saveShakeChoice(choice: ShakeChoice): void {
  write(SHAKE_KEY, choice);
}
