// «Олимп» — звук экрана зала, как в согласованном прототипе: мягкая лира (струна Карплуса — Стронга),
// арфа, тёплые аккорды, тимпан, ветер и эхо храма. Всё синтезируется в браузере — без файлов и
// лицензий. Звук идёт через общие шины платформы: «Выключить звук» и «Стоп» действуют и на него.
import { useEffect } from "react";
import { audioBuses, useMuted, useSoundReady } from "../../../components/live/sound";

/** Настроение: у каждой локации и момента игры своё. */
export type Ambient = "card" | "scene" | "temple" | "roll" | "map" | "river" | "boss" | "spring" | "none";
export type Sfx = "knock" | "rattle" | "thunder" | "flip" | "pop" | "crit" | "good" | "mid" | "bad" | "fail" | "harp" | "win" | "hit" | "roar";

// Пентатоника без полутонов: любые соседние ноты звучат мягко.
const PEN_D = [146.83, 174.61, 196, 220, 261.63, 293.66, 349.23, 392, 440, 523.25, 587.33];
const PEN_A = [110, 130.81, 146.83, 164.81, 196, 220, 261.63, 293.66, 329.63, 392, 440];
const Dm = [73.42, 110, 146.83, 174.61];
const F = [87.31, 130.81, 174.61, 220];
const C = [65.41, 98, 130.81, 196];
const Am = [55, 82.41, 110, 130.81];
const G = [49, 73.42, 98, 146.83];
const Em = [41.2, 61.74, 82.41, 123.47];

interface Engine {
  ctx: AudioContext;
  music: GainNode;
  effects: AudioNode;
  rev: ConvolverNode;
  revOut: GainNode;
  noise: AudioBuffer;
  lyre: Map<number, AudioBuffer>;
}

let engine: Engine | null = null;

function eng(): Engine | null {
  const buses = audioBuses();
  if (!buses) return null;
  if (engine && engine.ctx === buses.ctx) {
    engine.music = buses.music;
    engine.effects = buses.effects;
    return engine;
  }
  const c = buses.ctx;
  // Просторное эхо храма: длинный мягкий хвост.
  const len = Math.floor(c.sampleRate * 4.5);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
      d[i] = lp * Math.pow(1 - i / len, 2.6);
    }
  }
  const rev = c.createConvolver();
  rev.buffer = ir;
  const revOut = c.createGain();
  revOut.gain.value = 0.55;
  rev.connect(revOut);
  revOut.connect(buses.music);
  const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  engine = { ctx: c, music: buses.music, effects: buses.effects, rev, revOut, noise, lyre: new Map() };
  return engine;
}

/** Струна с мягким щипком и долгим звучанием. */
function lyreBuf(e: Engine, f: number): AudioBuffer {
  const key = Math.round(f);
  const cached = e.lyre.get(key);
  if (cached) return cached;
  const sr = e.ctx.sampleRate;
  const N = Math.max(2, Math.round(sr / f));
  const len = Math.floor(sr * 3.4);
  const b = e.ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  const ring = new Float32Array(N);
  let a = 0;
  let bb = 0;
  for (let i = 0; i < N; i++) {
    a = a * 0.7 + (Math.random() * 2 - 1) * 0.3;
    bb = bb * 0.6 + a * 0.4;
    ring[i] = bb * 2.2;
  }
  for (let i = 0; i < len; i++) {
    const j = i % N;
    const v = ring[j] as number;
    d[i] = v * Math.min(1, i / (sr * 0.006));
    ring[j] = (v + (ring[(j + 1) % N] as number)) * 0.4994;
  }
  e.lyre.set(key, b);
  return b;
}

function pluck(e: Engine, f: number, at: number, vol: number, dest: AudioNode): void {
  const t = e.ctx.currentTime + at;
  const s = e.ctx.createBufferSource();
  s.buffer = lyreBuf(e, f);
  const lp = e.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1900;
  const g = e.ctx.createGain();
  g.gain.value = vol;
  s.connect(lp);
  lp.connect(g);
  g.connect(dest);
  g.connect(e.rev);
  s.start(t);
}

interface Running {
  kind: Ambient;
  stop: () => void;
}
let current: Running | null = null;

function makeAmbient(e: Engine, kind: Ambient): Running {
  const c = e.ctx;
  const out = c.createGain();
  out.gain.value = 0;
  out.connect(e.music);
  out.gain.linearRampToValueAtTime(1, c.currentTime + 4);
  const nodes: AudioScheduledSourceNode[] = [];
  const timers: number[] = [];
  const wind = (vol: number, freq: number) => {
    const n = c.createBufferSource();
    n.buffer = e.noise;
    n.loop = true;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    f.Q.value = 0.5;
    const l = c.createOscillator();
    l.frequency.value = 0.05;
    const lg = c.createGain();
    lg.gain.value = freq * 0.4;
    l.connect(lg);
    lg.connect(f.frequency);
    const g = c.createGain();
    g.gain.value = vol;
    n.connect(f);
    f.connect(g);
    g.connect(out);
    n.start();
    l.start();
    nodes.push(n, l);
  };
  // Тёплый фон: аккорды плавно перетекают друг в друга.
  const pad = (chords: number[][], vol: number, period: number) => {
    let i = 0;
    const play = () => {
      const t = c.currentTime;
      const fs = chords[i % chords.length] as number[];
      i++;
      fs.forEach((fr, j) => {
        [-5, 5].forEach((det) => {
          const o = c.createOscillator();
          o.type = "triangle";
          o.frequency.value = fr;
          o.detune.value = det;
          const lp = c.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = 700;
          const g = c.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(vol / (j + 1.5), t + period * 0.45);
          g.gain.setValueAtTime(vol / (j + 1.5), t + period * 0.75);
          g.gain.linearRampToValueAtTime(0, t + period * 1.5);
          o.connect(lp);
          lp.connect(g);
          g.connect(out);
          g.connect(e.rev);
          o.start(t);
          o.stop(t + period * 1.55);
          nodes.push(o);
        });
      });
      timers.push(window.setTimeout(play, period * 1000));
    };
    play();
  };
  // Мелодия: плавные шаги по пентатонике, неспешный ритм, паузы между фразами.
  const melody = (scale: number[], lo: number, hi: number, vol: number, beat: number) => {
    let k = lo + Math.floor((hi - lo) / 2);
    const phrase = () => {
      const n = 3 + Math.floor(Math.random() * 3);
      let dir = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < n; i++) {
        if (k + dir < lo || k + dir > hi) dir = -dir;
        if (i > 0 && Math.random() < 0.3) dir = -dir;
        k += dir;
        pluck(e, scale[k] as number, i * beat, vol * (i === n - 1 ? 0.85 : 1), out);
        if (i === n - 1) pluck(e, scale[Math.max(lo, k - 2)] as number, i * beat + 0.02, vol * 0.45, out);
      }
      timers.push(window.setTimeout(phrase, (n * beat + 2.2 + Math.random() * 2.4) * 1000));
    };
    timers.push(window.setTimeout(phrase, 1600));
  };
  const tympanon = (every: number, vol: number) => {
    const beat = () => {
      const t = c.currentTime;
      const o = c.createOscillator();
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.35);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.75);
      timers.push(window.setTimeout(beat, every));
    };
    timers.push(window.setTimeout(beat, 600));
  };
  if (kind === "scene") {
    wind(0.1, 500);
    pad([Dm, F, C, Dm], 0.05, 9);
    melody(PEN_D, 2, 8, 0.2, 0.62);
  }
  if (kind === "temple") {
    pad([F, C, Dm, C], 0.05, 9);
    melody(PEN_D, 3, 9, 0.18, 0.6);
  }
  if (kind === "card") {
    pad([F, C, Dm, C], 0.045, 8);
    melody(PEN_D, 5, 10, 0.16, 0.5);
  }
  if (kind === "roll") {
    pad([Dm, Am], 0.05, 7);
    tympanon(1100, 0.18);
  }
  if (kind === "map") {
    wind(0.05, 380);
    pad([Am, F, G, Em], 0.045, 9);
    melody(PEN_A, 3, 9, 0.18, 0.6);
  }
  if (kind === "river") {
    wind(0.08, 320);
    pad([Am, Em, F, Em], 0.045, 10);
    melody(PEN_A, 1, 6, 0.15, 0.7);
  }
  if (kind === "boss") {
    wind(0.07, 260);
    pad([Am, Em], 0.055, 6);
    tympanon(900, 0.22);
  }
  if (kind === "spring") {
    pad([F, C, G, C], 0.04, 8);
    melody(PEN_D, 5, 10, 0.17, 0.42);
  }
  return {
    kind,
    stop() {
      const t = c.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 2.5);
      timers.forEach((x) => window.clearTimeout(x));
      window.setTimeout(() => {
        nodes.forEach((n) => {
          try {
            n.stop();
          } catch {
            // Уже остановлен.
          }
        });
        out.disconnect();
      }, 2700);
    },
  };
}

function setAmbient(kind: Ambient): void {
  if (current?.kind === kind) return;
  current?.stop();
  current = null;
  if (kind === "none") return;
  const e = eng();
  if (!e) return;
  current = makeAmbient(e, kind);
}

/** Фон экрана зала: меняется вместе с моментом игры, плавно; пока звук не разрешён — молчит. */
export function useAmbient(kind: Ambient): void {
  const ready = useSoundReady();
  const muted = useMuted();
  useEffect(() => {
    if (ready && !muted) setAmbient(kind);
    else setAmbient("none");
  }, [kind, ready, muted]);
  useEffect(() => () => setAmbient("none"), []);
}

/** Короткий звук момента: стук кубиков, гром, исход броска, арфа развилки. */
export function sfx(kind: Sfx): void {
  const e = eng();
  if (!e) return;
  const c = e.ctx;
  const t = c.currentTime;
  const dest = e.effects;
  const hit = (at: number, vol: number, freq: number, dur = 0.08) => {
    const n = c.createBufferSource();
    n.buffer = e.noise;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = 1.4;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    n.connect(f);
    f.connect(g);
    g.connect(dest);
    n.start(t + at);
    n.stop(t + at + dur + 0.05);
  };
  const drum = (at: number, vol: number) => {
    const o = c.createOscillator();
    o.frequency.setValueAtTime(95, t + at);
    o.frequency.exponentialRampToValueAtTime(48, t + at + 0.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t + at);
    g.gain.linearRampToValueAtTime(vol, t + at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.9);
    o.connect(g);
    g.connect(dest);
    g.connect(e.rev);
    o.start(t + at);
    o.stop(t + at + 0.95);
  };
  const shimmer = (at: number, vol: number) => {
    [2093, 2637, 3136].forEach((f, i) => {
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t + at + i * 0.06);
      g.gain.linearRampToValueAtTime(vol, t + at + i * 0.06 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + i * 0.06 + 2.4);
      o.connect(g);
      g.connect(e.rev);
      o.start(t + at + i * 0.06);
      o.stop(t + at + 2.6);
    });
  };
  const run = (sc: number[], idx: number[], step: number, vol: number) => idx.forEach((k, i) => pluck(e, sc[k] as number, i * step, vol, dest));
  const thunder = (vol: number, from: number) => {
    const n = c.createBufferSource();
    n.buffer = e.noise;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 2.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    n.connect(f);
    f.connect(g);
    g.connect(dest);
    g.connect(e.rev);
    n.start(t);
    n.stop(t + 2.7);
  };
  if (kind === "knock") {
    hit(0, 0.22, 1600 + Math.random() * 700, 0.05);
    hit(0, 0.16, 480, 0.08);
  }
  if (kind === "rattle") [0, 0.16, 0.3, 0.42, 0.52, 0.6, 0.67].forEach((a, i) => hit(a, 0.3 - i * 0.03, 1600 + Math.random() * 900, 0.05));
  if (kind === "thunder") thunder(0.8, 400);
  if (kind === "roar") {
    thunder(0.6, 260);
    drum(0, 0.35);
  }
  if (kind === "hit") {
    hit(0, 0.35, 900, 0.12);
    drum(0, 0.25);
  }
  if (kind === "flip") run(PEN_D, [3, 4, 5, 6, 7, 8, 9, 10], 0.08, 0.18);
  if (kind === "pop") pluck(e, PEN_D[7 + Math.floor(Math.random() * 4)] as number, 0, 0.14, dest);
  if (kind === "crit") {
    run(PEN_D, [0, 2, 4, 5, 7, 9, 10], 0.11, 0.24);
    shimmer(0.6, 0.05);
    drum(0, 0.3);
  }
  if (kind === "good") {
    run(PEN_D, [2, 4, 5, 7], 0.13, 0.22);
    drum(0, 0.2);
  }
  if (kind === "mid") run(PEN_D, [3, 5], 0.16, 0.2);
  if (kind === "bad") run(PEN_A, [6, 5, 3], 0.2, 0.2);
  if (kind === "fail") {
    drum(0, 0.4);
    run(PEN_A, [5, 3, 1, 0], 0.22, 0.2);
  }
  if (kind === "harp") {
    PEN_A.forEach((f, i) => pluck(e, f * 2, i * 0.07, 0.13, dest));
    [9, 7, 6, 4].forEach((k, i) => pluck(e, (PEN_A[k] as number) * 2, 1.0 + i * 0.22, 0.1, dest));
  }
  if (kind === "win") {
    PEN_D.forEach((f, i) => pluck(e, f * 2, i * 0.06, 0.12, dest));
    shimmer(0.7, 0.04);
  }
}
