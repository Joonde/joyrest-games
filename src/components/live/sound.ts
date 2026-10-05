import { useEffect, useState } from "react";

// Звуки экрана зала синтезируются на месте (Web Audio): никаких файлов и загрузок.
// Звук играет только на экране зала, никогда на телефонах гостей (CLAUDE.md, раздел 7).

export type SoundName = "tick" | "correct" | "fanfare";

const MUTE_KEY = "joyrest.soundOff";
const listeners = new Set<(muted: boolean) => void>();
let muted = readMuted();
let ctx: AudioContext | null = null;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Браузер разрешает звук только после касания: вызываем из обработчика нажатия. */
export function unlockSound(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function soundReady(): boolean {
  return ctx !== null && ctx.state === "running";
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Приватный режим: настройка действует до перезагрузки.
  }
  if (!value) unlockSound();
  listeners.forEach((l) => l(value));
}

export function useMuted(): boolean {
  const [value, setValue] = useState(muted);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

function tone(freq: number, start: number, duration: number, volume = 0.18, type: OscillatorType = "sine"): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = ctx.currentTime + start;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export function playSound(name: SoundName): void {
  if (muted || !soundReady()) return;
  if (name === "tick") tone(880, 0, 0.12, 0.12, "triangle");
  if (name === "correct") {
    tone(660, 0, 0.25);
    tone(990, 0.14, 0.45);
  }
  if (name === "fanfare") {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.16, 0.35, 0.16, "triangle"));
    tone(1047, 0.7, 1.1, 0.14, "triangle");
    tone(784, 0.7, 1.1, 0.1, "triangle");
  }
}
