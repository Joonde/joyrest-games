# «Мафия»: ночная тема — своя, создана кодом (права наши). Ре минор, 60 уд/мин, 96 с, бесшовный круг.
# Запуск: python3 scripts/sounds/mafia-night.py → night.wav; mp3: ffmpeg -i night.wav -codec:a libmp3lame -b:a 128k public/sounds/mafia-night-1.mp3
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
SR = 44100
BAR = 4.0
CH = 3  # тактов на аккорд
CHORDS = [  # MIDI-ноты аккордов (без баса), бас отдельно
    ([62, 65, 69, 76], 38),  # Dm(add9-ish)
    ([62, 65, 69, 70], 34),  # Bbmaj7 / D
    ([62, 67, 70, 74], 31),  # Gm
    ([61, 64, 69, 71], 33),  # A sus/7 — тайна
    ([62, 65, 69, 72], 38),  # Dm7
    ([60, 65, 69, 72], 36),  # F/C
    ([62, 65, 70, 74], 34),  # Bb
    ([61, 64, 67, 69], 33),  # A7 (полутон C# — напряжение)
]
L = int(SR * BAR * CH * len(CHORDS))
TAIL = int(SR * 8)
rng = np.random.default_rng(7)
f = lambda m: 440.0 * 2 ** ((m - 69) / 12)
mixL = np.zeros(L + TAIL); mixR = np.zeros(L + TAIL)

def add(sig, start, pan=0.0, gain=1.0):
    s = int(start * SR); n = len(sig)
    if s < 0: s += L
    l = gain * np.cos((pan + 1) * np.pi / 4); r = gain * np.sin((pan + 1) * np.pi / 4)
    end = min(s + n, L + TAIL)
    mixL[s:end] += sig[: end - s] * l * np.sqrt(2); mixR[s:end] += sig[: end - s] * r * np.sqrt(2)

def env(n, a, rel):
    e = np.ones(n); A = int(a * SR); R = int(rel * SR)
    e[:A] = np.sin(np.linspace(0, np.pi / 2, A)) ** 2
    e[n - R:] *= np.cos(np.linspace(0, np.pi / 2, R)) ** 2
    return e

def pad(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for det in (-0.07, 0.0, 0.06):
        fr = f(m) * 2 ** (det / 12)
        ph = rng.uniform(0, 2 * np.pi)
        for h in range(1, 6):
            out += np.sin(2 * np.pi * fr * h * t + ph * h) * (0.55 ** (h - 1)) / h
    trem = 1 + 0.12 * np.sin(2 * np.pi * 0.17 * t + rng.uniform(0, 6))
    return out * trem * env(n, 2.2, 2.6) / 6

def bell(m, dur=4.5):
    n = int(dur * SR); t = np.arange(n) / SR; fr = f(m)
    out = (np.sin(2 * np.pi * fr * t) * np.exp(-t / 1.6)
           + 0.35 * np.sin(2 * np.pi * fr * 2.0 * t) * np.exp(-t / 0.9)
           + 0.18 * np.sin(2 * np.pi * fr * 3.01 * t) * np.exp(-t / 0.5)
           + 0.08 * np.sin(2 * np.pi * fr * 4.2 * t) * np.exp(-t / 0.25))
    a = int(0.004 * SR); out[:a] *= np.linspace(0, 1, a)
    return out

def bass(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    out = np.sin(2 * np.pi * f(m) * t) + 0.3 * np.sin(2 * np.pi * f(m) * 2 * t) + 0.25 * np.sin(2 * np.pi * f(m) / 2 * t)
    return out * env(n, 1.5, 3.0)

seg = BAR * CH
for i, (notes, root) in enumerate(CHORDS):
    t0 = i * seg
    for k, m in enumerate(notes):
        add(pad(m - 12, seg + 2.5), t0 - 0.6, pan=(k - 1.5) * 0.35, gain=0.11)
    add(bass(root, seg + 2.0), t0 - 0.3, gain=0.16)
    # музыкальная шкатулка: редкие ноты аккорда октавой выше, мягкий ритм
    pool = sorted(set(n + 12 for n in notes) | set(n + 24 for n in notes[:2]))
    beats = np.arange(0, seg, 0.5)
    for b in beats:
        if (b % 2 == 0 and rng.random() < 0.55) or rng.random() < 0.14:
            m = int(rng.choice(pool))
            add(bell(m), t0 + b + rng.uniform(0, 0.03), pan=rng.uniform(-0.6, 0.6), gain=0.05 + 0.03 * rng.random())
    # раз в два аккорда — «вопрос»: нисходящая фраза с полутоном (тайна)
    if i % 2 == 1:
        phrase = [notes[-1] + 12, notes[-1] + 11, notes[1] + 12]
        for j, m in enumerate(phrase):
            add(bell(m, 5.5), t0 + seg - 3.5 + j * 0.75, pan=0.3, gain=0.05)

# ночной воздух: мягкий шум с медленной волной
noise = rng.standard_normal(L + TAIL)
sos = butter(2, [300, 1600], btype="band", fs=SR, output="sos")
air = sosfilt(sos, noise)
tt = np.arange(L + TAIL) / SR
air *= 0.012 * (0.6 + 0.4 * np.sin(2 * np.pi * tt / 24.0))
mixL += air; mixR += np.roll(air, 1500)

# бесшовный круг: хвост — в начало
for ch in (mixL, mixR):
    ch[:TAIL] += ch[L:L + TAIL]
mixL = mixL[:L]; mixR = mixR[:L]

# реверберация (круговая свёртка — стык не слышен)
ir_n = int(SR * 3.8); it = np.arange(ir_n) / SR
def ir(seed):
    r = np.random.default_rng(seed).standard_normal(ir_n) * np.exp(-it / 1.1)
    return sosfilt(butter(1, 5000, fs=SR, output="sos"), r)
def circ(x, h):
    n = len(x) + len(h)
    y = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)
    out = y[: len(x)].copy(); out[: len(h)] += y[len(x): len(x) + len(h)]
    return out
wetL = circ(mixL, ir(1)); wetR = circ(mixR, ir(2))
wetL /= np.max(np.abs(wetL)); wetR /= np.max(np.abs(wetR))
dry = max(np.max(np.abs(mixL)), np.max(np.abs(mixR)))
L_ = 0.55 * mixL / dry + 0.45 * wetL; R_ = 0.55 * mixR / dry + 0.45 * wetR
# мягкий срез низа и верха
hp = butter(2, 35, btype="high", fs=SR, output="sos")
L_ = sosfilt(hp, L_); R_ = sosfilt(hp, R_)
st = np.stack([L_, R_], axis=1)
rms = np.sqrt(np.mean(st ** 2))
st *= 0.165 / rms  # около −18 dBFS RMS: фон, не громче лобби
st = np.tanh(st * 1.1) / 1.1
print("peak", np.max(np.abs(st)), "rms", np.sqrt(np.mean(st ** 2)), "sec", L / SR)
pcm = (st * 32767).astype(np.int16)
import wave
with wave.open("night.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
