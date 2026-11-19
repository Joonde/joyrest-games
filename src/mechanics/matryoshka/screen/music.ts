/**
 * Музыка экрана «Игр Матрёшки» нотами (чистые функции, без звука): песенка «Замри!» под назначенные фразы, плясовая «Стульев»,
 * барабан «Каната», тихая музыкальная шкатулка лобби. Всё своё, создано кодом (решение владельца: своя музыка, без чужих
 * мелодий и без голоса). Время нот — часы сервера; играет `audio.ts`.
 *
 * Песенка: фраза делится на 6 долей — «Раз» на доле 0, «два» на 2, «три» на 4, «за-» на 5 и «-мри» ровно в T (последняя нота
 * фразы — в момент поворота). Между словами — перебор балалайки и бас. Внутри обманки (0,3 с) нот нет — музыка «спотыкается».
 * Во время взгляда — тихое сердце «тук-тук».
 */
import type { PhraseV } from "./view";

export type Voice = "pluck" | "strum" | "bass" | "accent" | "tamb" | "box" | "heart" | "tom" | "squeeze";

export interface Note {
  /** Устойчивый ключ ноты (одна и та же нота не планируется дважды). */
  id: string;
  /** Время по часам сервера, мс. */
  t: number;
  voice: Voice;
  /** Частоты (аккорд — несколько). */
  freq: number[];
  /** Длительность, с. */
  dur: number;
  gain: number;
}

const A4 = 440;
/** Частота по номеру полутона от ля первой октавы. */
export const hz = (semi: number): number => A4 * Math.pow(2, semi / 12);
// Ноты (полутона от A4).
const N = { E2: -29, A2: -24, D3: -19, E3: -17, A3: -12, C4: -9, D4: -7, E4: -5, F4: -4, G4: -2, A4: 0, B4: 2, C5: 3, D5: 5, E5: 7, Fs4: -3, Fs5: 9, G5: 10, A5: 12, B5: 14, Cs5: 4, Gs4: -1 } as const;
const chord = (...s: number[]): number[] => s.map(hz);
const AM = chord(N.A3, N.C4, N.E4);
const EM = chord(N.E3, N.Gs4 - 12, N.B4 - 12);

/** Окно обманки (нот нет). */
export const DECOY_GAP_MS = 300;
/** Сердце во время взгляда — раз в столько. */
export const HEART_MS = 900;

/** Ноты одной фразы песенки «Раз, два, три — замри!» (последняя — ровно в `at`). */
export function chantNotes(p: PhraseV): Note[] {
  const span = p.at - p.start;
  if (!(span > 0)) return [];
  const beat = span / 6;
  const key = `ch${p.start}:${p.at}`;
  const out: Note[] = [];
  const melody: Array<[number, number, string]> = [
    [0, N.A4, "раз"],
    [2, N.A4, "два"],
    [4, N.C5, "три"],
    [5, N.B4, "за"],
  ];
  for (const [b, semi, w] of melody) out.push({ id: `${key}:m${w}`, t: p.start + b * beat, voice: "pluck", freq: [hz(semi), hz(semi + 12)], dur: Math.min(0.9, beat * 0.9), gain: 0.5 });
  // «-мри» — акцент в T.
  out.push({ id: `${key}:mri`, t: p.at, voice: "accent", freq: [hz(N.E5), hz(N.A4), hz(N.C5)], dur: 1.2, gain: 0.62 });
  // Перебор: доля делится на 2 (длинная — на 4), аккорд ля минор, на «за-» — ми мажор.
  const sub = beat > 1100 ? 4 : 2;
  for (let i = 0; i < 6 * sub; i += 1) {
    const t = p.start + (i * beat) / sub;
    if (i % sub === 0 && i / sub !== 1 && i / sub !== 3) continue; // на словах перебор не дублируем
    const onE = i >= 5 * sub;
    out.push({ id: `${key}:s${i}`, t, voice: "strum", freq: onE ? EM : AM, dur: 0.22, gain: 0.22 });
  }
  for (let b = 0; b < 6; b += 1) out.push({ id: `${key}:b${b}`, t: p.start + b * beat, voice: "bass", freq: [hz(b === 5 ? N.E2 : b % 2 ? N.E2 : N.A2)], dur: Math.min(0.6, beat * 0.8), gain: 0.42 });
  out.push({ id: `${key}:bT`, t: p.at, voice: "bass", freq: [hz(N.A2)], dur: 0.9, gain: 0.5 });
  const quiet = p.decoy;
  return out.filter((n) => quiet === null || n.t < quiet || n.t >= quiet + DECOY_GAP_MS).sort((a, b) => a.t - b.t);
}

/** Сердце во время взгляда: тихое «тук-тук» с T до конца взгляда. */
export function heartNotes(p: PhraseV): Note[] {
  const out: Note[] = [];
  for (let t = p.at + 500, i = 0; t < p.end - 150; t += HEART_MS, i += 1) {
    out.push({ id: `hr${p.at}:${i}a`, t, voice: "heart", freq: [hz(N.A2 - 12)], dur: 0.16, gain: 0.5 });
    out.push({ id: `hr${p.at}:${i}b`, t: t + 190, voice: "heart", freq: [hz(N.A2 - 12)], dur: 0.14, gain: 0.35 });
  }
  return out;
}

// ------------------------------------------------------------------ плясовая «Стульев» (своя, ре мажор, 2/4, 132 удара в минуту)

export const DANCE_BEAT_MS = 60_000 / 132;
/** Мелодия восьмыми (полутона от A4; null — пауза), 32 восьмые = 4 такта по 2 доли… ×2. */
const DANCE_TUNE: Array<number | null> = [
  N.D5, N.Fs5, N.A5, N.Fs5, N.G5, N.E5, N.Cs5, N.E5,
  N.D5, N.Fs5, N.A5, N.B5, N.A5, N.G5, N.Fs5, N.E5,
  N.Fs5, N.A5, N.B5, N.A5, N.G5, N.Fs5, N.E5, N.Cs5,
  N.D5, N.E5, N.Fs5, N.E5, N.D5, null, N.D5, null,
];
const D_MAJ = chord(N.D4, N.Fs4, N.A4);
const A_MAJ = chord(N.Cs5 - 12, N.E4, N.A4);
const G_MAJ = chord(N.D4, N.G4, N.B4);
const DANCE_CHORDS = [D_MAJ, D_MAJ, A_MAJ, A_MAJ, D_MAJ, G_MAJ, A_MAJ, D_MAJ];
const DANCE_BASS = [N.D3, N.A2, N.D3, N.A2, N.E3 - 12, N.A2, N.D3, N.A2];

/** Пауза плясовой на обманке «Стульев» (музыка замирает и играет дальше). */
export const DANCE_DECOY_MS = 600;

/**
 * Ноты плясовой в окне [from, to): от `musicAt`, обрывается в `stopAt` (известна экрану за 3 с), на обманке — пауза 0,6 с.
 * `speed` < 1 — медленнее (лобби — музыкальная шкатулка).
 */
export function danceNotes(from: number, to: number, musicAt: number, stopAt: number | null, decoyAt: number | null, opts: { box?: boolean; speed?: number } = {}): Note[] {
  const eighth = DANCE_BEAT_MS / 2 / (opts.speed ?? 1);
  const out: Note[] = [];
  const first = Math.max(0, Math.ceil((from - musicAt) / eighth));
  for (let i = first; ; i += 1) {
    const t = musicAt + i * eighth;
    if (t >= to) break;
    if (stopAt !== null && t >= stopAt) break;
    if (decoyAt !== null && t >= decoyAt && t < decoyAt + DANCE_DECOY_MS) continue;
    const step = i % DANCE_TUNE.length;
    const bar = Math.floor(i / 4) % DANCE_CHORDS.length;
    const m = DANCE_TUNE[step];
    const id = `dn${musicAt}:${i}`;
    if (opts.box) {
      if (m !== null && m !== undefined) out.push({ id: `${id}m`, t, voice: "box", freq: [hz(m)], dur: 0.6, gain: 0.32 });
      if (i % 4 === 0) out.push({ id: `${id}b`, t, voice: "box", freq: [hz((DANCE_BASS[bar] ?? N.D3) + 12)], dur: 0.8, gain: 0.18 });
      continue;
    }
    if (m !== null && m !== undefined) out.push({ id: `${id}m`, t, voice: "squeeze", freq: [hz(m)], dur: (eighth / 1000) * 0.9, gain: 0.26 });
    if (i % 2 === 0) out.push({ id: `${id}b`, t, voice: "bass", freq: [hz(DANCE_BASS[bar] ?? N.D3)], dur: 0.2, gain: 0.4 });
    else out.push({ id: `${id}c`, t, voice: "strum", freq: DANCE_CHORDS[bar] ?? D_MAJ, dur: 0.16, gain: 0.2 });
    out.push({ id: `${id}t`, t, voice: "tamb", freq: [0], dur: 0.06, gain: i % 2 === 0 ? 0.18 : 0.1 });
  }
  return out;
}

/** «Канат»: «тянем-потянем» — том на каждую долю (120 ударов), к концу попытки чаще. */
export function ropeNotes(from: number, to: number, attemptAt: number, attemptEnds: number): Note[] {
  const out: Note[] = [];
  const beat = 500;
  for (let i = Math.max(0, Math.ceil((from - attemptAt) / (beat / 2))); ; i += 1) {
    const t = attemptAt + (i * beat) / 2;
    if (t >= to || t >= attemptEnds) break;
    const late = attemptEnds - t < 4000;
    if (i % 2 === 1 && !late) continue;
    out.push({ id: `rp${attemptAt}:${i}`, t, voice: "tom", freq: [i % 4 === 0 ? 110 : 82], dur: 0.25, gain: i % 2 === 0 ? 0.5 : 0.3 });
  }
  return out;
}
