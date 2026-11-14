/**
 * Звук экрана «Игр Матрёшки» (Блок 3c): синтез в браузере экрана зала через общий контекст и шины платформы (`sound.ts`):
 * музыка игры — шина фоновой музыки (ползунок «🎵 Фон», микшер пульта, «Выключить звук»), звуки — шина эффектов. Файлов нет —
 * всё своё, создано кодом. Ноты (`music.ts`) планируются по часам сервера наперёд (`Sequencer`): последняя нота песенки звучит
 * ровно в T с поправкой на задержку вывода звука; пауза, новая фраза или уход с экрана снимают запланированное.
 */
import { audioBuses, bedBuses } from "../../../components/live/sound";
import type { Note } from "./music";

let noise: AudioBuffer | null = null;
function noiseOf(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const len = Math.floor(ctx.sampleRate * 1.5);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < len; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  noise = b;
  return b;
}

interface Played {
  stop: (at: number) => void;
}

function env(ctx: AudioContext, g: GainNode, at: number, peak: number, attack: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(attack + 0.02, dur));
  void ctx;
}

/** Одна нота инструментом `voice` в момент `at` (время контекста) на выход `dest`. */
function voiceAt(ctx: AudioContext, dest: AudioNode, n: Note, at: number): Played {
  const nodes: AudioScheduledSourceNode[] = [];
  const out = ctx.createGain();
  out.connect(dest);
  const osc = (type: OscillatorType, f: number, gain: number, to: AudioNode = out, detune = 0): OscillatorNode => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(to);
    nodes.push(o);
    return o;
  };
  const end = at + n.dur + 0.1;
  switch (n.voice) {
    case "pluck":
    case "strum":
    case "accent": {
      // Балалайка: пила и треугольник через фильтр, быстрая атака, затухание.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(n.voice === "strum" ? 2400 : 3600, at);
      lp.frequency.exponentialRampToValueAtTime(700, at + n.dur);
      lp.connect(out);
      n.freq.forEach((f, i) => {
        const delay = n.voice === "strum" ? i * 0.014 : 0;
        const g = ctx.createGain();
        g.connect(lp);
        env(ctx, g, at + delay, n.gain / Math.sqrt(n.freq.length), 0.004, n.dur);
        for (const [type, k, det] of [
          ["sawtooth", 0.5, -6],
          ["triangle", 0.8, 5],
        ] as Array<[OscillatorType, number, number]>) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.setValueAtTime(f, at + delay);
          o.detune.value = det;
          const gg = ctx.createGain();
          gg.gain.value = k;
          o.connect(gg).connect(g);
          o.start(at + delay);
          o.stop(end + delay);
          nodes.push(o);
        }
      });
      if (n.voice === "accent") {
        // Колокольчик поверх «-мри»: чистые синусы, долго звенят.
        const bell = ctx.createGain();
        bell.connect(out);
        env(ctx, bell, at, n.gain * 0.35, 0.003, n.dur * 1.3);
        for (const k of [2, 3.01, 4.2]) {
          const f0 = n.freq[0] ?? 660;
          const o = osc("sine", f0 * (k / 2), 0.4 / k, bell);
          o.start(at);
          o.stop(end + 0.4);
        }
      }
      return { stop: (t) => nodes.forEach((x) => safeStop(x, t)) };
    }
    case "bass": {
      const g = ctx.createGain();
      env(ctx, g, at, n.gain, 0.006, n.dur);
      g.connect(out);
      for (const f of n.freq) {
        const o = osc("triangle", f, 1, g);
        o.start(at);
        o.stop(end);
      }
      return { stop: (t) => nodes.forEach((x) => safeStop(x, t)) };
    }
    case "squeeze": {
      // Гармошка: две пилы с биением через мягкий фильтр.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(n.gain, at + 0.02);
      g.gain.setValueAtTime(n.gain, at + n.dur * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, at + n.dur);
      lp.connect(g).connect(out);
      for (const f of n.freq) {
        for (const det of [-7, 7]) {
          const o = osc("sawtooth", f, 0.35, lp, det);
          o.start(at);
          o.stop(at + n.dur + 0.05);
        }
      }
      return { stop: (t) => nodes.forEach((x) => safeStop(x, t)) };
    }
    case "box": {
      const g = ctx.createGain();
      env(ctx, g, at, n.gain, 0.003, n.dur);
      g.connect(out);
      for (const f of n.freq) {
        osc("sine", f, 0.7, g).start(at);
        osc("sine", f * 4, 0.12, g).start(at);
      }
      nodes.forEach((x) => x.stop(end));
      return { stop: (t) => nodes.forEach((x) => safeStop(x, t)) };
    }
    case "heart":
    case "tom": {
      const g = ctx.createGain();
      env(ctx, g, at, n.gain, 0.004, n.dur);
      g.connect(out);
      const f0 = n.freq[0] ?? 60;
      const o = osc("sine", f0 * 1.6, 1, g);
      o.frequency.exponentialRampToValueAtTime(f0, at + 0.08);
      o.start(at);
      o.stop(end);
      return { stop: (t) => nodes.forEach((x) => safeStop(x, t)) };
    }
    case "tamb": {
      const src = ctx.createBufferSource();
      src.buffer = noiseOf(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6500;
      const g = ctx.createGain();
      env(ctx, g, at, n.gain, 0.002, n.dur);
      src.connect(hp).connect(g).connect(out);
      src.start(at, Math.random());
      src.stop(at + n.dur + 0.05);
      nodes.push(src);
      return { stop: (t) => nodes.forEach((x) => safeStop(x, t)) };
    }
  }
}

function safeStop(n: AudioScheduledSourceNode, at: number): void {
  try {
    n.stop(at);
  } catch {
    // Уже остановлен — ничего.
  }
}

/** Задержка вывода звука (Bluetooth-колонка, телевизор): нота планируется раньше на неё. */
function latency(ctx: AudioContext): number {
  const c = ctx as AudioContext & { outputLatency?: number };
  return Math.min(0.4, Math.max(0, (c.outputLatency ?? 0) || ctx.baseLatency || 0));
}

/**
 * Планировщик нот по часам сервера: каждые ~100 мс экран отдаёт ноты окна [сейчас, сейчас + 0,7 с]; новые ставятся в контекст,
 * уже поставленные не повторяются. `clear()` — снять всё будущее (пауза, новая фраза, уход с экрана).
 */
export class Sequencer {
  private played = new Map<string, { at: number; p: Played }>();

  /** Поставить ноты: `now` — время сервера сейчас (мс). false — звук ещё не разрешён. */
  feed(notes: readonly Note[], now: number): boolean {
    const b = bedBuses();
    if (!b || b.ctx.state !== "running") return false;
    const ctx = b.ctx;
    const base = ctx.currentTime - latency(ctx);
    for (const n of notes) {
      if (this.played.has(n.id)) continue;
      const at = base + (n.t - now) / 1000;
      if (at < ctx.currentTime - 0.03) continue;
      this.played.set(n.id, { at, p: voiceAt(ctx, b.bed, n, Math.max(ctx.currentTime, at)) });
    }
    // Забыть давно отзвучавшее.
    if (this.played.size > 400) for (const [id, x] of this.played) if (x.at < ctx.currentTime - 5) this.played.delete(id);
    return true;
  }

  /** Снять всё, что ещё не прозвучало (и приглушить звучащее). */
  clear(): void {
    const b = bedBuses();
    const t = b ? b.ctx.currentTime : 0;
    for (const x of this.played.values()) if (x.at > t - 2) x.p.stop(t + 0.03);
    this.played.clear();
  }
}

// ------------------------------------------------------------------ звуки (шина эффектов)

export type MatSound = "shuh" | "decoy" | "puff" | "clink" | "krak" | "stop" | "strain" | "ice" | "caught" | "chairs";

/** Звук игры сейчас (или в момент `delay` с от сейчас). */
export function playMat(name: MatSound, delay = 0): void {
  const b = audioBuses();
  if (!b) return;
  const { ctx, effects } = b;
  const at = ctx.currentTime + Math.max(0, delay);
  const out = ctx.createGain();
  out.connect(effects);
  const noiseSrc = (offset = 0): AudioBufferSourceNode => {
    const s = ctx.createBufferSource();
    s.buffer = noiseOf(ctx);
    s.start(at, offset);
    return s;
  };
  const tone = (type: OscillatorType, f: number, from: number, dur: number, peak: number, to?: number): void => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, at + from);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + from + dur);
    const g = ctx.createGain();
    env(ctx, g, at + from, peak, 0.004, dur);
    o.connect(g).connect(out);
    o.start(at + from);
    o.stop(at + from + dur + 0.05);
  };
  switch (name) {
    case "shuh": {
      // Поворот головы: шелест платка — шум с полосой, которая ползёт вверх.
      const s = noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(500, at);
      bp.frequency.exponentialRampToValueAtTime(2800, at + 0.32);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.5, at + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      s.connect(bp).connect(g).connect(out);
      s.stop(at + 0.5);
      break;
    }
    case "decoy": {
      // Вздрогнула: деревянный стук и короткий шорох.
      tone("sine", 820, 0, 0.08, 0.45, 520);
      tone("triangle", 1320, 0.01, 0.05, 0.2);
      const s = noiseSrc(0.3);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2500;
      const g = ctx.createGain();
      env(ctx, g, at, 0.18, 0.003, 0.12);
      s.connect(hp).connect(g).connect(out);
      s.stop(at + 0.2);
      break;
    }
    case "puff": {
      // «Пух» — в сугроб: мягкий низкий шум.
      const s = noiseSrc(0.6);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, at);
      lp.frequency.exponentialRampToValueAtTime(160, at + 0.4);
      const g = ctx.createGain();
      env(ctx, g, at, 0.7, 0.01, 0.42);
      s.connect(lp).connect(g).connect(out);
      s.stop(at + 0.5);
      tone("sine", 140, 0, 0.18, 0.35, 70);
      break;
    }
    case "clink": {
      // Монета в банку: стекло и металл.
      for (const [f, k, d] of [
        [2093, 0.3, 0.25],
        [3136, 0.18, 0.18],
        [4186, 0.12, 0.12],
      ] as Array<[number, number, number]>)
        tone("sine", f, 0, d, k);
      tone("sine", 2637, 0.07, 0.2, 0.16);
      break;
    }
    case "krak": {
      // «Крак!» — пряник треснул: сухой щелчок, треск и глухой удар.
      for (let i = 0; i < 4; i += 1) {
        const s = noiseSrc(0.1 * i);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1800 + i * 700;
        bp.Q.value = 3;
        const g = ctx.createGain();
        const t0 = at + i * 0.035;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.6 - i * 0.1, t0 + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
        s.connect(bp).connect(g).connect(out);
        s.stop(t0 + 0.1);
      }
      tone("sine", 180, 0.02, 0.15, 0.4, 90);
      break;
    }
    case "stop": {
      // Музыка оборвалась: «пластинка» — пила вниз.
      tone("sawtooth", 520, 0, 0.32, 0.22, 60);
      tone("square", 260, 0, 0.18, 0.08, 40);
      break;
    }
    case "chairs": {
      // Стулья появились: деревянный стук.
      tone("sine", 600, 0, 0.07, 0.35, 380);
      tone("sine", 900, 0.06, 0.06, 0.25, 600);
      break;
    }
    case "strain": {
      // Канат натянулся: скрип — пила с вибрато через полосу.
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(95, at);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23;
      const depth = ctx.createGain();
      depth.gain.value = 9;
      lfo.connect(depth).connect(o.frequency);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 950;
      bp.Q.value = 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.3, at + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
      o.connect(bp).connect(g).connect(out);
      o.start(at);
      lfo.start(at);
      o.stop(at + 0.6);
      lfo.stop(at + 0.6);
      break;
    }
    case "ice": {
      // Лёд трескается: частые щелчки и звонкий «стеклянный» отзвук.
      for (let i = 0; i < 6; i += 1) {
        const s = noiseSrc(0.05 * i);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 3000 + i * 400;
        const g = ctx.createGain();
        const t0 = at + i * 0.045 + (i % 2) * 0.012;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.45, t0 + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
        s.connect(hp).connect(g).connect(out);
        s.stop(t0 + 0.08);
      }
      tone("sine", 2960, 0.05, 0.5, 0.1, 2400);
      tone("sine", 140, 0.25, 0.3, 0.3, 60);
      break;
    }
    case "caught": {
      // Поймала: короткий спуск вниз.
      tone("triangle", 660, 0, 0.12, 0.3);
      tone("triangle", 494, 0.12, 0.12, 0.3);
      tone("triangle", 330, 0.24, 0.25, 0.3);
      break;
    }
  }
}
