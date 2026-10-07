import { useEffect, useState } from "react";

// Звуки экрана зала синтезируются на месте (Web Audio): никаких файлов и загрузок.
// Звук играет только на экране зала, никогда на телефонах гостей (CLAUDE.md, раздел 7).

/** Набор звуков темы (`ThemeEffects.soundSet`): меняет тиканье, верный ответ и фанфары. */
export type SoundSetName = "classic" | "bells" | "jazz" | "disco" | "soft";
let soundSet: SoundSetName = "classic";

export function setSoundSet(name: SoundSetName): void {
  soundSet = name;
}

export type SoundName = "tick" | "correct" | "fanfare" | "gong" | "drumroll" | "applause" | "wrong" | "whoosh" | "timeUp";

/** Раньше «без звука» запоминалось на устройстве — из-за этого экран молчал на следующих вечерах. */
const OLD_MUTE_KEY = "joyrest.soundOff";
const listeners = new Set<(muted: boolean) => void>();
/** «Выключить звук» на самом экране: только до перезагрузки страницы. */
let muted = false;
forgetOldMute();
let ctx: AudioContext | null = null;
/** Общий выход: «Включить звук / звук включён» на самом экране. */
let master: GainNode | null = null;
/** Эффекты (гонг, аплодисменты…): «Стоп» на пульте заменяет эту шину — всё, что звучит, глохнет. */
let effectsBus: GainNode | null = null;
/** Фоновая музыка: громкость с микшера пульта, приглушается под эффекты. */
let musicBus: GainNode | null = null;
let noise: AudioBuffer | null = null;
/** Микшер пульта (0–1) и «без звука». */
const mix = { music: 0.7, effects: 1, muted: false };
/** Приглушение музыки под эффект: 1 — как есть. */
let duck = 1;
let duckTimer = 0;

let duckUntil = 0;

function forgetOldMute(): void {
  try {
    localStorage.removeItem(OLD_MUTE_KEY);
  } catch {
    // Приватный режим — нечего чистить.
  }
}

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/** Браузер разрешает звук только после касания: вызываем из обработчика нажатия. */
const readyListeners = new Set<(ready: boolean) => void>();

function notifyReady(): void {
  const ready = soundReady();
  readyListeners.forEach((l) => l(ready));
}

export function unlockSound(): void {
  try {
    // iPhone и iPad: без этого Web Audio молчит при включённом переключателе «Бесшумно».
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession && nav.audioSession.type !== "playback") nav.audioSession.type = "playback";
  } catch {
    // Старый Safari — подсказка на экране просит выключить беззвучный режим.
  }
  try {
    if (!ctx) {
      ctx = new AudioContext();
      ctx.addEventListener("statechange", notifyReady);
    }
    // "interrupted" — iOS после блокировки экрана, звонка или Пункта управления.
    if (ctx.state !== "running") void ctx.resume().then(notifyReady, notifyReady);
    notifyReady();
  } catch {
    ctx = null;
  }
}

/**
 * Разрешение звука от любого касания, клика или клавиши — столько раз, сколько нужно: браузер
 * разрешает звук на отпускание пальца (не на нажатие), а iOS снова приостанавливает его после
 * блокировки экрана. Пока звук не идёт, слушаем; когда вкладка снова видна — пробуем продолжить.
 */
export function useSoundUnlock(): void {
  const ready = useSoundReady();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && ctx && ctx.state !== "running") void ctx.resume().then(notifyReady, notifyReady);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  useEffect(() => {
    if (ready) return;
    const unlock = () => unlockSound();
    const events = ["pointerup", "touchend", "click", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, [ready]);
}

/** Включён ли звук браузером (было касание экрана). Пока нет — экран зала просит коснуться. */
export function useSoundReady(): boolean {
  const [ready, setReady] = useState(soundReady);
  useEffect(() => {
    readyListeners.add(setReady);
    setReady(soundReady());
    return () => {
      readyListeners.delete(setReady);
    };
  }, []);
  return ready;
}

export function soundReady(): boolean {
  return ctx !== null && ctx.state === "running";
}

export function setMuted(value: boolean): void {
  muted = value;
  if (ctx && master) master.gain.setTargetAtTime(value ? 0 : 0.9, ctx.currentTime, 0.05);
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

function masterNode(): GainNode | null {
  if (!ctx) return null;
  if (!master) {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
  }
  return master;
}

function effectsLevel(): number {
  return mix.muted ? 0 : mix.effects;
}

function musicLevel(): number {
  return mix.muted ? 0 : mix.music * duck;
}

/** Выход эффектов. */
function out(): AudioNode | null {
  const main = masterNode();
  if (!ctx || !main) return null;
  if (!effectsBus) {
    effectsBus = ctx.createGain();
    effectsBus.gain.value = effectsLevel();
    effectsBus.connect(main);
  }
  return effectsBus;
}

function musicOut(): GainNode | null {
  const main = masterNode();
  if (!ctx || !main) return null;
  if (!musicBus) {
    musicBus = ctx.createGain();
    musicBus.gain.value = musicLevel();
    musicBus.connect(main);
  }
  return musicBus;
}

function applyLevels(): void {
  if (!ctx) return;
  effectsBus?.gain.setTargetAtTime(effectsLevel(), ctx.currentTime, 0.05);
  musicBus?.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.25);
}

/** Микшер с пульта: громкость музыки и эффектов 0–100, «без звука». */
export function setMix(next: { music: number; effects: number; muted: boolean }): void {
  mix.music = Math.min(1, Math.max(0, next.music / 100));
  mix.effects = Math.min(1, Math.max(0, next.effects / 100));
  mix.muted = next.muted;
  applyLevels();
}

/** Музыка тише на время эффекта и потом плавно возвращается. */
function duckMusic(seconds: number): void {
  // Короткий эффект после длинного не возвращает музыку раньше конца длинного.
  const until = Math.max(duckUntil, Date.now() + seconds * 1000);
  duckUntil = until;
  duck = 0.3;
  applyLevels();
  window.clearTimeout(duckTimer);
  duckTimer = window.setTimeout(() => {
    duck = 1;
    duckUntil = 0;
    applyLevels();
  }, until - Date.now());
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

/** Колокольчик: чистый тон и звонкий обертон с долгим хвостом. */
function bell(freq: number, start: number, volume = 0.12, duration = 1.6): void {
  tone(freq, start, duration, volume, "sine");
  tone(freq * 2.76, start, duration * 0.5, volume * 0.35, "sine");
  tone(freq * 5.4, start, duration * 0.25, volume * 0.15, "sine");
}

function tick(): void {
  if (soundSet === "bells") return bell(1760, 0, 0.06, 0.4);
  if (soundSet === "jazz") return burst(0, 0.05, 0.25, { type: "bandpass", freq: 2400, q: 6 });
  if (soundSet === "disco") return burst(0, 0.06, 0.18, { type: "highpass", freq: 7000 });
  if (soundSet === "soft") return tone(1046, 0, 0.18, 0.06, "sine");
  tone(880, 0, 0.12, 0.12, "triangle");
}

function correct(): void {
  if (soundSet === "bells") {
    bell(1318, 0);
    bell(1976, 0.14);
    return;
  }
  if (soundSet === "jazz") {
    // Мажорный септаккорд, мягко, как вибрафон.
    [523, 659, 784, 988].forEach((f) => tone(f, 0, 0.9, 0.06, "triangle"));
    return;
  }
  if (soundSet === "disco") {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.06, 0.18, 0.09, "square"));
    return;
  }
  if (soundSet === "soft") {
    tone(784, 0, 0.6, 0.08);
    tone(1175, 0.16, 0.8, 0.07);
    return;
  }
  tone(660, 0, 0.25);
  tone(990, 0.14, 0.45);
}

function fanfare(): void {
  if (soundSet === "bells") {
    [1046, 1318, 1568, 2093].forEach((f, i) => bell(f, i * 0.18, 0.1));
    bell(2093, 0.8, 0.12, 2.4);
    return;
  }
  if (soundSet === "jazz") {
    [392, 494, 587, 740].forEach((f, i) => tone(f, i * 0.12, 0.5, 0.09, "triangle"));
    [523, 659, 784, 988].forEach((f) => tone(f, 0.6, 1.6, 0.07, "triangle"));
    return;
  }
  if (soundSet === "disco") {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.2, 0.09, "square"));
    [523, 659, 784].forEach((f) => tone(f, 0.75, 1, 0.07, "sawtooth"));
    burst(0.75, 1.2, 0.12, { type: "highpass", freq: 6000 });
    return;
  }
  if (soundSet === "soft") {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.22, 0.9, 0.07, "sine"));
    bell(1568, 0.9, 0.08, 2.2);
    return;
  }
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.16, 0.35, 0.16, "triangle"));
  tone(1047, 0.7, 1.1, 0.14, "triangle");
  tone(784, 0.7, 1.1, 0.1, "triangle");
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

const DUCK_SECONDS: Partial<Record<SoundName, number>> = { gong: 3, drumroll: 3.5, applause: 3.5, fanfare: 2.5, wrong: 1.2, whoosh: 1 };

export function playSound(name: SoundName): void {
  if (muted || !soundReady()) return;
  const duckFor = DUCK_SECONDS[name];
  if (duckFor) duckMusic(duckFor);
  if (name === "tick") tick();
  if (name === "correct") correct();
  if (name === "fanfare") fanfare();
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

/** «Стоп»: заглушить все эффекты, что звучат сейчас (музыку — нет); следующие играют как обычно. */
export function stopAllSounds(): void {
  stopFragment();
  if (!ctx || !effectsBus) return;
  const old = effectsBus;
  effectsBus = null;
  old.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  window.setTimeout(() => old.disconnect(), 400);
  window.clearTimeout(duckTimer);
  duck = 1;
  duckUntil = 0;
  applyLevels();
}

// ---------- Фоновая музыка (файлы ведущих, CLAUDE.md, раздел 7, «Музыка») ----------

let player: HTMLAudioElement | null = null;
let playerSource: MediaElementAudioSourceNode | null = null;

function musicElement(): HTMLAudioElement | null {
  if (!ctx) return null;
  if (!player) {
    player = new Audio();
    player.loop = true;
    player.preload = "auto";
    const bus = musicOut();
    if (!bus) return null;
    // Через Web Audio — чтобы работали микшер и приглушение (у iPhone громкость <audio> не меняется).
    playerSource = ctx.createMediaElementSource(player);
    playerSource.connect(bus);
  }
  return player;
}

/** Включить трек: с начала (новый запуск) или продолжить. false — браузер не дал (нет касания экрана). */
export async function playMusic(url: string, fromStart: boolean): Promise<boolean> {
  if (!soundReady()) return false;
  const el = musicElement();
  if (!el) return false;
  if (el.src !== url) el.src = url;
  if (fromStart) el.currentTime = 0;
  try {
    await el.play();
    return true;
  } catch {
    return false;
  }
}

export function pauseMusic(): void {
  player?.pause();
}

export function stopMusic(): void {
  if (!player) return;
  player.pause();
  player.currentTime = 0;
}

// ---------- Фрагмент трека («Угадай мелодию», музыкальное лото) ----------

let fragmentEl: HTMLAudioElement | null = null;
let fragmentTimer = 0;
/** Фоновая музыка играла до фрагмента — после него продолжится. */
let resumeAfterFragment = false;

function fragmentElement(): HTMLAudioElement | null {
  if (!ctx) return null;
  if (!fragmentEl) {
    fragmentEl = new Audio();
    fragmentEl.preload = "auto";
    const bus = musicOut();
    if (!bus) return null;
    ctx.createMediaElementSource(fragmentEl).connect(bus);
  }
  return fragmentEl;
}

/**
 * Сыграть кусок трека: с `startSec` в течение `lengthSec` (0 — до конца). Фоновая музыка на это
 * время встаёт на паузу. false — браузер не дал включить звук (нужно коснуться экрана).
 */
export async function playFragment(url: string, startSec: number, lengthSec: number): Promise<boolean> {
  if (!soundReady()) return false;
  const el = fragmentElement();
  if (!el) return false;
  window.clearTimeout(fragmentTimer);
  if (player && !player.paused) {
    resumeAfterFragment = true;
    player.pause();
  }
  if (el.src !== url) el.src = url;
  try {
    el.currentTime = Math.max(0, startSec);
    await el.play();
  } catch {
    return false;
  }
  if (lengthSec > 0) fragmentTimer = window.setTimeout(() => stopFragment(), lengthSec * 1000);
  el.onended = () => stopFragment();
  return true;
}

export function stopFragment(): void {
  window.clearTimeout(fragmentTimer);
  fragmentEl?.pause();
  if (resumeAfterFragment) {
    resumeAfterFragment = false;
    void player?.play().catch(() => undefined);
  }
}
