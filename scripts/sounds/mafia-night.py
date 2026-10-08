# «Мафия»: ночная тема — своя мелодия, создана кодом (права наши). Волшебный вальс в духе сказочного кино:
# челеста, вальсовый бас, струнная подложка, арфа. Ми минор, 3/4, четверть = 120, 64 такта = 96 с, бесшовный круг.
# Мелодия придумана заново (хроматизмы, неаполитанский фа мажор) и не повторяет чужих тем.
# Запуск: python3 scripts/sounds/mafia-night.py → night.wav; mp3: ffmpeg -i night.wav -codec:a libmp3lame -b:a 128k public/sounds/mafia-night-2.mp3
import wave
import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
Q = 0.5  # четверть, с
BAR = 3 * Q
rng = np.random.default_rng(11)
f = lambda m: 440.0 * 2 ** ((m - 69) / 12)

# Мелодия (16 тактов): (нота MIDI, длительность в четвертях)
MELODY = [
    (67, 1), (71, 1), (72, 1), (71, 3),
    (76, 1), (75, 1), (74, 1), (73, 2), (71, 1),
    (69, 1), (72, 1), (76, 1), (79, 2), (78, 1),
    (77, 1), (76, 1), (72, 1), (71, 3),
    (67, 1), (71, 1), (72, 1), (71, 2), (79, 1),
    (78, 1), (77, 1), (76, 1), (75, 3),
    (76, 1), (79, 1), (83, 1), (84, 2), (83, 1),
    (81, 1), (79, 1), (78, 1), (76, 3),
]
CHORDS = {  # аккорд такта: (бас, голоса)
    "Em": (40, [52, 55, 59]), "Am": (45, [57, 60, 64]), "C": (48, [55, 60, 64]), "A": (45, [57, 61, 64]),
    "F": (41, [57, 60, 65]), "B7": (47, [54, 57, 59, 63]),
}
HARM = ["Em", "Em", "C", "A", "Am", "Em", "F", "B7", "Em", "Em", "B7", "B7", "Em", "C", "Am", "Em"]
SECTIONS = [  # (сдвиг мелодии в полутонах или None — без мелодии, громкость мелодии)
    (0, 1.0), (12, 0.75), (None, 0.0), (0, 0.8),
]
L = int(SR * BAR * 16 * len(SECTIONS))
TAIL = int(SR * 8)
mixL = np.zeros(L + TAIL)
mixR = np.zeros(L + TAIL)


def add(sig, start, pan=0.0, gain=1.0):
    s = int(start * SR)
    if s < 0:
        s += L
    n = len(sig)
    l = gain * np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
    r = gain * np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
    end = min(s + n, L + TAIL)
    mixL[s:end] += sig[: end - s] * l
    mixR[s:end] += sig[: end - s] * r


def env(n, a, rel):
    e = np.ones(n)
    A, R = max(1, int(a * SR)), max(1, int(rel * SR))
    e[:A] = np.sin(np.linspace(0, np.pi / 2, A)) ** 2
    e[n - R:] *= np.cos(np.linspace(0, np.pi / 2, R)) ** 2
    return e


def celesta(m, dur):
    n = int((dur + 2.5) * SR)
    t = np.arange(n) / SR
    fr = f(m)
    out = (np.sin(2 * np.pi * fr * t) * np.exp(-t / 1.4)
           + 0.5 * np.sin(2 * np.pi * fr * 4 * t) * np.exp(-t / 0.35)
           + 0.15 * np.sin(2 * np.pi * fr * 2 * t) * np.exp(-t / 0.7)
           + 0.06 * np.sin(2 * np.pi * fr * 7.1 * t) * np.exp(-t / 0.12))
    a = int(0.003 * SR)
    out[:a] *= np.linspace(0, 1, a)
    return out


def harp(m):
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    fr = f(m)
    out = sum(np.sin(2 * np.pi * fr * h * t) * np.exp(-t * (1.2 + h * 0.9)) / h for h in range(1, 6))
    a = int(0.002 * SR)
    out[:a] *= np.linspace(0, 1, a)
    return out


def strings(m, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-0.08, 0.0, 0.07):
        fr = f(m) * 2 ** (det / 12)
        vib = 1 + 0.003 * np.sin(2 * np.pi * 5.2 * t + rng.uniform(0, 6))
        ph = np.cumsum(2 * np.pi * fr * vib / SR)
        for h in range(1, 7):
            out += np.sin(ph * h) * (0.6 ** (h - 1)) / h
    return out * env(n, 0.9, 1.2) / 6


def pluck_bass(m, dur):
    n = int((dur + 0.6) * SR)
    t = np.arange(n) / SR
    fr = f(m)
    out = (np.sin(2 * np.pi * fr * t) + 0.35 * np.sin(2 * np.pi * fr * 2 * t)) * np.exp(-t / 0.9)
    a = int(0.01 * SR)
    out[:a] *= np.linspace(0, 1, a)
    return out


for sec, (shift, mel_gain) in enumerate(SECTIONS):
    t_sec = sec * 16 * BAR
    quiet = shift is None
    # гармония: бас на первую долю, аккорд на вторую и третью (вальс), струны держат аккорд
    for b, name in enumerate(HARM):
        root, voices = CHORDS[name]
        t0 = t_sec + b * BAR
        add(pluck_bass(root, BAR), t0, gain=0.22 if not quiet else 0.14)
        for beat in (1, 2):
            for k, v in enumerate(voices):
                add(harp(v + 12) * 0.5, t0 + beat * Q + k * 0.012, pan=0.25 * (k - 1), gain=0.05 if not quiet else 0.035)
        for k, v in enumerate(voices[:3]):
            add(strings(v, BAR + 1.0), t0 - 0.3, pan=(k - 1) * 0.5, gain=0.07 if not quiet else 0.09)
    # мелодия на челесте
    if not quiet:
        t = t_sec
        for m, beats in MELODY:
            add(celesta(m + shift, beats * Q), t, pan=0.1, gain=0.16 * mel_gain)
            t += beats * Q
    else:
        # тихая середина: редкие звёздочки челесты на тонах аккорда
        for b, name in enumerate(HARM):
            if b % 2 == 0:
                _, voices = CHORDS[name]
                add(celesta(int(rng.choice(voices)) + 24, 2.0), t_sec + b * BAR + Q, pan=rng.uniform(-0.6, 0.6), gain=0.07)
    # волшебный перелив арфы в конце раздела
    end = t_sec + 16 * BAR
    for i, m in enumerate([64, 67, 71, 74, 76, 79, 83, 86, 88]):
        add(harp(m), end - 1.4 + i * 0.07, pan=-0.5 + i * 0.12, gain=0.06)

# бесшовный круг: хвост — в начало
for ch in (mixL, mixR):
    ch[:TAIL] += ch[L:L + TAIL]
mixL, mixR = mixL[:L], mixR[:L]

# реверберация — круговая свёртка (стык не слышен)
ir_n = int(SR * 3.2)
it = np.arange(ir_n) / SR


def ir(seed):
    r = np.random.default_rng(seed).standard_normal(ir_n) * np.exp(-it / 0.9)
    return sosfilt(butter(1, 6000, fs=SR, output="sos"), r)


def circ(x, h):
    n = len(x) + len(h)
    y = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)
    out = y[: len(x)].copy()
    out[: len(h)] += y[len(x): len(x) + len(h)]
    return out


wetL, wetR = circ(mixL, ir(1)), circ(mixR, ir(2))
wetL /= np.max(np.abs(wetL))
wetR /= np.max(np.abs(wetR))
dry = max(np.max(np.abs(mixL)), np.max(np.abs(mixR)))
Lc = 0.6 * mixL / dry + 0.4 * wetL
Rc = 0.6 * mixR / dry + 0.4 * wetR
hp = butter(2, 35, btype="high", fs=SR, output="sos")
st = np.stack([sosfilt(hp, Lc), sosfilt(hp, Rc)], axis=1)
st *= 0.13 / np.sqrt(np.mean(st ** 2))
st = np.tanh(st * 1.1) / 1.1
print("peak", round(float(np.max(np.abs(st))), 3), "sec", L / SR)
with wave.open("night.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
