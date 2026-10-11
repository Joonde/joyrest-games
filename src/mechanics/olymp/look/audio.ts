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

function pluck(e: Engine, f: number, at: number, vol: number, dest: AudioNode, wet = true): void {
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
  if (wet) g.connect(e.rev);
  s.start(t);
}

// ------------------------------------------------------------------ единая композиция
//
// Фон «Олимпа» — одна непрерывная пьеса, а не набор отдельных мелодий: при смене экрана музыка не
// обрывается и не начинается заново, меняются только инструменты (настроение момента). Пьеса идёт
// по кругу через восемь тональностей (ре минор → фа мажор → до мажор → ля минор → ми минор →
// соль мажор → соль минор → си-бемоль мажор, ~3,5 минуты), в бою — свои тёмные тональности.
// Каждая смена тональности — через общий аккорд и мягкий перебор арфы; затухание — 4 с.

type Q = "M" | "m";
interface Section {
  /** Аккорды: корень (MIDI) и лад; каждый звучит два такта. */
  chords: [number, Q][];
  /** Тоника и лад пентатоники мелодии. */
  tonic: number;
  minor: boolean;
}

const CALM: Section[] = [
  { tonic: 62, minor: true, chords: [[50, "m"], [46, "M"], [53, "M"], [48, "M"]] },
  { tonic: 65, minor: false, chords: [[53, "M"], [48, "M"], [50, "m"], [46, "M"]] },
  { tonic: 60, minor: false, chords: [[48, "M"], [43, "M"], [45, "m"], [41, "M"]] },
  { tonic: 69, minor: true, chords: [[45, "m"], [41, "M"], [48, "M"], [43, "M"]] },
  { tonic: 64, minor: true, chords: [[40, "m"], [48, "M"], [43, "M"], [50, "M"]] },
  { tonic: 67, minor: false, chords: [[43, "M"], [50, "M"], [40, "m"], [48, "M"]] },
  { tonic: 67, minor: true, chords: [[43, "m"], [51, "M"], [46, "M"], [41, "M"]] },
  { tonic: 70, minor: false, chords: [[46, "M"], [41, "M"], [43, "m"], [45, "M"]] },
];
const DARK: Section[] = [
  { tonic: 62, minor: true, chords: [[50, "m"], [46, "M"], [43, "m"], [45, "M"]] },
  { tonic: 64, minor: true, chords: [[40, "m"], [48, "M"], [45, "m"], [47, "M"]] },
  { tonic: 67, minor: true, chords: [[43, "m"], [51, "M"], [48, "m"], [50, "M"]] },
  { tonic: 69, minor: true, chords: [[45, "m"], [41, "M"], [50, "m"], [40, "M"]] },
];

type Layer = "pad" | "bass" | "arp" | "melody" | "drum" | "wind";
/** Настроение момента — громкость инструментов (0…1), рисунок перебора и барабана. */
const MOODS: Record<Exclude<Ambient, "none">, { mix: Record<Layer, number>; dark?: boolean; arp: "slow" | "flow" | "pulse"; drum: number[] }> = {
  card: { mix: { pad: 0.9, bass: 0.5, arp: 0.7, melody: 0.85, drum: 0, wind: 0 }, arp: "slow", drum: [] },
  temple: { mix: { pad: 1, bass: 0.5, arp: 0.45, melody: 0.9, drum: 0, wind: 0.25 }, arp: "slow", drum: [] },
  scene: { mix: { pad: 0.9, bass: 0.5, arp: 0.5, melody: 0.9, drum: 0, wind: 0.8 }, arp: "slow", drum: [] },
  river: { mix: { pad: 0.9, bass: 0.4, arp: 0.45, melody: 0.7, drum: 0, wind: 0.9 }, arp: "slow", drum: [] },
  map: { mix: { pad: 0.8, bass: 0.6, arp: 0.8, melody: 0.7, drum: 0.35, wind: 0.4 }, arp: "flow", drum: [0] },
  spring: { mix: { pad: 0.8, bass: 0.5, arp: 1, melody: 1, drum: 0.2, wind: 0 }, arp: "flow", drum: [0, 2] },
  roll: { mix: { pad: 0.7, bass: 0.7, arp: 0.35, melody: 0.25, drum: 1, wind: 0 }, arp: "pulse", drum: [0, 1, 2, 3] },
  boss: { mix: { pad: 0.85, bass: 1, arp: 0.5, melody: 0.45, drum: 1, wind: 0.5 }, dark: true, arp: "pulse", drum: [0, 1.5, 2] },
};
const LAYER_VOL: Record<Layer, number> = { pad: 0.05, bass: 0.09, arp: 0.09, melody: 0.2, drum: 0.2, wind: 0.09 };

const BEAT = 60 / 70;
const BAR = BEAT * 4;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const triad = (root: number, q: Q) => [0, q === "M" ? 4 : 3, 7].map((i) => root + i);
/** Нота аккорда, ближайшая к `near` (в любой октаве). */
function voice(pc: number, near: number): number {
  let m = pc;
  while (m < near - 6) m += 12;
  while (m > near + 6) m -= 12;
  return m;
}
function pentatonic(sec: Section, lo: number, hi: number): number[] {
  const steps = sec.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (steps.includes((((m - sec.tonic) % 12) + 12) % 12)) out.push(m);
  return out;
}

interface Score {
  ctx: AudioContext;
  master: GainNode;
  layers: Record<Layer, GainNode>;
  mood: Exclude<Ambient, "none">;
  timer: number | null;
  nextBar: number;
  bar: number;
  calm: number;
  dark: number;
  section: Section;
  /** Тёмная ли сейчас пьеса (меняется на границе такта). */
  isDark: boolean;
  melodyNote: number;
  windNode: AudioBufferSourceNode | null;
  stopAt: number | null;
}
let score: Score | null = null;

function makeScore(e: Engine): Score {
  const c = e.ctx;
  const master = c.createGain();
  master.gain.value = 0;
  master.connect(e.music);
  // Эхо храма — после общей громкости: затухание пьесы гасит и его (хвост доигрывает сам).
  const send = c.createGain();
  send.gain.value = 0.7;
  master.connect(send);
  send.connect(e.rev);
  const layers = {} as Record<Layer, GainNode>;
  (["pad", "bass", "arp", "melody", "drum", "wind"] as Layer[]).forEach((l) => {
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(master);
    layers[l] = g;
  });
  // Ветер — непрерывный, громкость задаёт настроение.
  const n = c.createBufferSource();
  n.buffer = e.noise;
  n.loop = true;
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 420;
  f.Q.value = 0.5;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.05;
  const lg = c.createGain();
  lg.gain.value = 170;
  lfo.connect(lg);
  lg.connect(f.frequency);
  n.connect(f);
  f.connect(layers.wind);
  n.start();
  lfo.start();
  return {
    ctx: c,
    master,
    layers,
    mood: "card",
    timer: null,
    nextBar: c.currentTime + 0.15,
    bar: 0,
    calm: 0,
    dark: 0,
    section: CALM[0] as Section,
    isDark: false,
    melodyNote: 69,
    windNode: n,
    stopAt: null,
  };
}

function scheduleBar(e: Engine, s: Score, t: number): void {
  const c = s.ctx;
  const mood = MOODS[s.mood];
  // Граница раздела (8 тактов) или смена светлое ↔ тёмное — следующая тональность.
  const inSection = s.bar % 8;
  let fresh = false;
  if ((mood.dark ?? false) !== s.isDark) {
    s.isDark = mood.dark ?? false;
    s.bar = 0;
    s.section = s.isDark ? (DARK[s.dark % DARK.length] as Section) : (CALM[s.calm % CALM.length] as Section);
    fresh = true;
  } else if (inSection === 0 && s.bar > 0) {
    if (s.isDark) s.dark++;
    else s.calm++;
    s.section = s.isDark ? (DARK[s.dark % DARK.length] as Section) : (CALM[s.calm % CALM.length] as Section);
    fresh = true;
  }
  const sec = s.section;
  const barIn = s.bar % 8;
  const [root, q] = sec.chords[Math.floor(barIn / 2)] as [number, Q];
  const notes = triad(root, q);
  if (fresh) {
    // Мягкий перебор арфы по новой тональности — шов между разделами.
    pentatonic(sec, 67, 86).forEach((m, i) => pluck(e, hz(m), t - c.currentTime + i * 0.07, 0.05, s.layers.arp, false));
  }
  // Подклад: аккорд держится два такта, вступает и уходит внахлёст.
  if (barIn % 2 === 0) {
    const len = BAR * 2;
    notes.forEach((m, j) => {
      [-5, 5].forEach((det) => {
        const o = c.createOscillator();
        o.type = "triangle";
        o.frequency.value = hz(voice(m % 12, 57 + j * 4));
        o.detune.value = det;
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 760;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(LAYER_VOL.pad / (j * 0.4 + 1), t + 1.6);
        g.gain.setValueAtTime(LAYER_VOL.pad / (j * 0.4 + 1), t + len - 0.4);
        g.gain.linearRampToValueAtTime(0, t + len + 2.2);
        o.connect(lp);
        lp.connect(g);
        g.connect(s.layers.pad);
        o.start(t);
        o.stop(t + len + 2.3);
      });
    });
  }
  // Бас: корень аккорда, мягко.
  {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = hz(36 + (root % 12));
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(LAYER_VOL.bass, t + 0.25);
    g.gain.setValueAtTime(LAYER_VOL.bass, t + BAR * 0.7);
    g.gain.linearRampToValueAtTime(0, t + BAR + 0.3);
    o.connect(g);
    g.connect(s.layers.bass);
    o.start(t);
    o.stop(t + BAR + 0.35);
  }
  // Перебор лиры по аккорду.
  const arpNotes = [...notes.map((m) => voice(m % 12, 64)), voice(notes[0] as number, 64) + 12].sort((a, b) => a - b);
  const pattern = mood.arp === "slow" ? [0, 1, 2, 3].map((i) => [i, i]) : mood.arp === "flow" ? [0, 1, 2, 3, 2, 1, 2, 3].map((k, i) => [i / 2, k]) : [0, 0, 1, 0, 2, 0, 1, 0].map((k, i) => [i / 2, k]);
  pattern.forEach(([beat, k]) => {
    const m = (arpNotes[k as number] as number) - (mood.arp === "pulse" ? 12 : 0);
    pluck(e, hz(m), t - c.currentTime + (beat as number) * BEAT, LAYER_VOL.arp * (beat === 0 ? 1.2 : 1), s.layers.arp, false);
  });
  // Мелодия: фраза по пентатонике, сильная доля — на звуке аккорда; каждый 4-й такт — вздох.
  if (barIn % 4 !== 3) {
    const scale = pentatonic(sec, 62, 84);
    const rhythms = [[2, 2], [1, 1, 2], [1.5, 0.5, 2], [1, 1, 1, 1], [3, 1], [2, 1, 1]];
    const rhythm = rhythms[Math.floor(Math.random() * rhythms.length)] as number[];
    let at = 0;
    rhythm.forEach((d, i) => {
      let note: number;
      if (i === 0) {
        const chordTones = scale.filter((m) => notes.some((n) => n % 12 === m % 12));
        const pool = chordTones.length > 0 ? chordTones : scale;
        note = pool.reduce((best, m) => (Math.abs(m - s.melodyNote) < Math.abs(best - s.melodyNote) ? m : best), pool[0] as number);
      } else {
        let idx = scale.indexOf(s.melodyNote);
        if (idx < 0) idx = Math.floor(scale.length / 2);
        const step = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)] as number;
        idx = Math.min(scale.length - 1, Math.max(0, idx + step));
        note = scale[idx] as number;
      }
      s.melodyNote = note;
      pluck(e, hz(note), t - c.currentTime + at * BEAT, LAYER_VOL.melody * (i === 0 ? 1 : 0.85), s.layers.melody, false);
      if (d >= 2) pluck(e, hz(note - 12), t - c.currentTime + at * BEAT + 0.02, LAYER_VOL.melody * 0.35, s.layers.melody, false);
      at += d;
    });
  }
  // Тимпан.
  mood.drum.forEach((beat) => {
    const bt = t + beat * BEAT;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(hz(36 + (root % 12)) * 2, bt);
    o.frequency.exponentialRampToValueAtTime(hz(36 + (root % 12)), bt + 0.35);
    const g = c.createGain();
    g.gain.setValueAtTime(0, bt);
    g.gain.linearRampToValueAtTime(LAYER_VOL.drum * (beat === 0 ? 1 : 0.7), bt + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.8);
    o.connect(g);
    g.connect(s.layers.drum);
    o.start(bt);
    o.stop(bt + 0.85);
  });
  s.bar++;
}

function applyMood(s: Score): void {
  const mix = MOODS[s.mood].mix;
  const now = s.ctx.currentTime;
  (Object.keys(mix) as Layer[]).forEach((l) => s.layers[l].gain.setTargetAtTime(mix[l], now, 1.1));
}

function startScore(e: Engine, mood: Exclude<Ambient, "none">): void {
  if (score && score.ctx !== e.ctx) {
    stopScoreNow(score);
    score = null;
  }
  if (!score) score = makeScore(e);
  const s = score;
  s.mood = mood;
  s.stopAt = null;
  applyMood(s);
  const now = s.ctx.currentTime;
  s.master.gain.cancelScheduledValues(now);
  s.master.gain.setValueAtTime(s.master.gain.value, now);
  s.master.gain.linearRampToValueAtTime(1, now + 3);
  if (s.timer === null) {
    if (s.nextBar < now + 0.1) s.nextBar = now + 0.15;
    s.timer = window.setInterval(() => {
      const cur = s.ctx.currentTime;
      if (s.stopAt !== null && cur >= s.stopAt) {
        stopScoreNow(s);
        if (score === s) score = null;
        return;
      }
      while (s.nextBar < cur + 1.2 && (s.stopAt === null || s.nextBar < s.stopAt)) {
        scheduleBar(e, s, s.nextBar);
        s.nextBar += BAR;
      }
    }, 250);
  }
}

function stopScoreNow(s: Score): void {
  if (s.timer !== null) window.clearInterval(s.timer);
  s.timer = null;
  try {
    s.windNode?.stop();
  } catch {
    // Уже остановлен.
  }
  s.master.disconnect();
}

/** Пьеса затихает плавно (4 с), без обрыва. */
function fadeScore(): void {
  const s = score;
  if (!s || s.stopAt !== null) return;
  const now = s.ctx.currentTime;
  s.master.gain.cancelScheduledValues(now);
  s.master.gain.setValueAtTime(s.master.gain.value, now);
  s.master.gain.linearRampToValueAtTime(0, now + 4);
  s.stopAt = now + 4.2;
}

function setAmbient(kind: Ambient): void {
  if (kind === "none") return fadeScore();
  const e = eng();
  if (!e) return;
  startScore(e, kind);
}

/** Фон экрана зала: одна пьеса на всю игру, момент меняет только инструменты; пока звук не разрешён — молчит. */
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

