/**
 * Своя фоновая музыка механики по кругу («Бубликатор»: ритмичная музыка полёта — решение владельца 12 ноября 2026). Один плеер
 * на экран, через шину фоновой музыки (ползунок «🎵 Фон», «Выключить звук» и микшер действуют и на неё), плавный вход и выход,
 * темп — `playbackRate` (браузер сохраняет высоту тона). Пауза останавливает трек на месте: «Продолжить» — с того же места.
 */
import { bedBuses } from "./sound";

/** Разрешён ли звук на этом экране (повтор для механик: им не нужен весь `sound.ts`). */
export { useSoundReady } from "./sound";

let el: HTMLAudioElement | null = null;
let gain: GainNode | null = null;
let url: string | null = null;
let stopTimer = 0;

function ramp(to: number, seconds: number): void {
  const b = bedBuses();
  if (!b || !gain) return;
  const t = b.ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(to, t + Math.max(0.05, seconds));
}

/** Играть `src` по кругу (тот же — продолжить с места), темп `rate`, громкость `volume` с плавным входом. false — звук не разрешён. */
export async function playLoop(src: string, rate: number, volume: number, fadeIn = 2): Promise<boolean> {
  const b = bedBuses();
  if (!b) return false;
  if (!el || !gain) {
    el = new Audio();
    el.loop = true;
    el.preload = "auto";
    el.preservesPitch = true;
    gain = b.ctx.createGain();
    gain.gain.value = 0;
    b.ctx.createMediaElementSource(el).connect(gain).connect(b.bed);
  }
  window.clearTimeout(stopTimer);
  if (url !== src) {
    el.src = src;
    url = src;
  }
  el.playbackRate = rate;
  if (el.paused) {
    try {
      await el.play();
    } catch {
      return false;
    }
  }
  ramp(volume, fadeIn);
  return true;
}

/** Темп звучащей музыки (последние 30 с перелёта — быстрее). */
export function setLoopRate(rate: number): void {
  if (el) el.playbackRate = rate;
}

/** Плавно остановить на месте (пауза, конец полёта). */
export function stopLoop(fade = 1.5): void {
  if (!el || el.paused) return;
  ramp(0, fade);
  const player = el;
  window.clearTimeout(stopTimer);
  stopTimer = window.setTimeout(() => player.pause(), fade * 1000 + 150);
}

/** Звучит ли сейчас (для проверок). */
export function loopPlaying(): string | null {
  return el && !el.paused ? url : null;
}
