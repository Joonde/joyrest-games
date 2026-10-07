import { useEffect, useState } from "react";

// Звуки экрана зала синтезируются на месте (Web Audio): никаких файлов и загрузок.
// Звук играет только на экране зала, никогда на телефонах гостей (CLAUDE.md, раздел 7).

export type SoundName = "tick" | "correct" | "fanfare" | "gong" | "drumroll" | "applause" | "wrong" | "whoosh" | "timeUp";

const MUTE_KEY = "joyrest.soundOff";
const listeners = new Set<(muted: boolean) => void>();
let muted = readMuted();
let ctx: AudioContext | null = null;
/** Общая громкость: через неё идут все звуки, «Стоп» глушит всё сразу. */
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

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

function out(): AudioNode | null {
  if (!ctx) return null;
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  return master;
}

function tone(freq: number, start: number, duration: number, volume = 0.18, type: OscillatorType = "sine"): void {
  const dest = out();
  if (!ctx || !dest) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = ctx.currentTime + start;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(dest);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

/** Белый шум (2 с), один на всё время работы экрана. */
function noiseBuffer(): AudioBuffer | null {
  if (!ctx) return null;
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** Всплеск шума через фильтр: удар барабана, хлопок, шелест. */
function burst(
  start: number,
  duration: number,
  volume: number,
  filter: { type: BiquadFilterType; freq: number; q?: number; toFreq?: number },
  attack = 0.003,
): void {
  const dest = out();
  const buffer = noiseBuffer();
  if (!ctx || !dest || !buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const f = ctx.createBiquadFilter();
  f.type = filter.type;
  const t = ctx.currentTime + start;
  f.frequency.setValueAtTime(filter.freq, t);
  if (filter.toFreq) f.frequency.exponentialRampToValueAtTime(filter.toFreq, t + duration);
  f.Q.value = filter.q ?? 1;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(f).connect(gain).connect(dest);
  // Случайное место в шуме, чтобы удары не звучали одинаково; запись не должна кончиться раньше.
  src.start(t, Math.random() * Math.max(0, buffer.duration - duration - 0.1));
  src.stop(t + duration + 0.05);
}

function gong(): void {
  // Неровные обертоны и долгое затухание — как у настоящего гонга.
  [
    [98, 0.32, 5.5],
    [147, 0.18, 4.5],
    [196.5, 0.14, 4],
    [263, 0.09, 3],
    [339, 0.07, 2.4],
    [452, 0.05, 1.8],
  ].forEach(([f, v, d]) => tone(f as number, 0, d as number, v as number, "sine"));
  burst(0, 0.25, 0.25, { type: "lowpass", freq: 900 });
}

function drumroll(): void {
  // Дробь нарастает 2,4 с и заканчивается тарелкой.
  const length = 2.4;
  for (let t = 0; t < length; t += 0.045) {
    burst(t, 0.06, 0.05 + (t / length) * 0.22, { type: "bandpass", freq: 1800, q: 0.8 });
  }
  burst(length, 0.35, 0.4, { type: "lowpass", freq: 160 }, 0.002);
  burst(length, 1.8, 0.28, { type: "highpass", freq: 5000 }, 0.002);
}

function applause(): void {
  // Сотни коротких хлопков в случайные моменты, громкость растёт и спадает.
  const length = 3.2;
  for (let i = 0; i < 260; i++) {
    const t = Math.random() * length;
    const envelope = Math.sin((t / length) * Math.PI) ** 0.6;
    burst(t, 0.05, 0.06 * envelope, { type: "bandpass", freq: 900 + Math.random() * 1600, q: 1.2 });
  }
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
  if (name === "gong") gong();
  if (name === "drumroll") drumroll();
  if (name === "applause") applause();
  if (name === "wrong") {
    tone(110, 0, 0.7, 0.14, "sawtooth");
    tone(116, 0, 0.7, 0.14, "sawtooth");
  }
  if (name === "whoosh") burst(0, 0.7, 0.3, { type: "bandpass", freq: 300, q: 2, toFreq: 4000 }, 0.25);
  if (name === "timeUp") {
    tone(784, 0, 0.3, 0.16, "triangle");
    tone(523, 0.25, 0.6, 0.16, "triangle");
  }
}

/** «Стоп»: заглушить всё, что звучит сейчас; следующие звуки играют как обычно. */
export function stopAllSounds(): void {
  if (!ctx || !master) return;
  const old = master;
  master = null;
  old.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  window.setTimeout(() => old.disconnect(), 400);
}
