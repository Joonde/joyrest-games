# Музыкальное лото: заставка «Откройте карточки» — своя мелодия, создана кодом (права наши, 18 октября 2026).
# Лёгкий тёплый поп: электропиано, круглый бас, колокольчики, мягкие барабаны (бочка, щелчок, шейкер).
# Фа мажор, 4/4, четверть = 104, 32 такта ≈ 74 с, бесшовный круг. Мелодия придумана заново.
# Запуск: python3 scripts/sounds/lotto-intro.py → lotto-intro.wav;
# mp3: ffmpeg -i lotto-intro.wav -codec:a libmp3lame -b:a 128k public/sounds/lotto-intro-1.mp3
import wave
import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
Q = 60 / 104  # четверть, с
BAR = 4 * Q
rng = np.random.default_rng(7)
f = lambda m: 440.0 * 2 ** ((m - 69) / 12)

CHORDS = {  # бас, голоса электропиано
    "F": (41, [57, 60, 65]), "Dm": (38, [57, 62, 65]), "Bb": (46, [58, 62, 65]), "C": (48, [55, 60, 64]),
    "Am": (45, [57, 60, 64]), "Gm": (43, [58, 62, 67]), "C7": (48, [58, 60, 64]),
}
HARM = ["F", "Dm", "Bb", "C", "F", "Am", "Gm", "C7"]
# Мелодия на 8 тактов: (нота, длительность в восьмых); None — пауза. 8 восьмых в такте.
MEL_A = [
    (72, 2), (74, 1), (72, 1), (69, 2), (65, 2),
    (69, 2), (72, 2), (74, 3), (None, 1),
    (74, 1), (72, 1), (70, 2), (69, 2), (67, 2),
    (69, 3), (67, 1), (64, 2), (None, 2),
    (72, 2), (74, 1), (76, 1), (77, 2), (76, 2),
    (72, 2), (69, 2), (72, 3), (None, 1),
    (74, 1), (72, 1), (70, 2), (69, 1), (67, 1), (65, 2),
    (67, 2), (64, 2), (65, 4),
]
MEL_B = [
    (77, 3), (76, 1), (74, 2), (72, 2),
    (74, 2), (69, 2), (72, 4),
    (70, 3), (69, 1), (67, 2), (65, 2),
    (67, 2), (69, 2), (72, 4),
    (77, 3), (79, 1), (77, 2), (76, 2),
    (74, 2), (72, 2), (69, 4),
    (70, 2), (72, 2), (74, 2), (76, 2),
    (77, 6), (None, 2),
]
SECTIONS = [  # (мелодия, громкость мелодии, барабаны)
    (MEL_A, 1.0, True), (MEL_B, 0.9, True), (None, 0.0, False), (MEL_A, 0.85, True),
]
L = int(SR * BAR * 8 * len(SECTIONS))
TAIL = int(SR * 6)
mixL = np.zeros(L + TAIL)
mixR = np.zeros(L + TAIL)


def add(sig, start, pan=0.0, gain=1.0):
    s = int(start * SR)
    n = len(sig)
    l = gain * np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
    r = gain * np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
    end = min(s + n, L + TAIL)
    if end <= s:
        return
    mixL[s:end] += sig[: end - s] * l
    mixR[s:end] += sig[: end - s] * r


def epiano(m, dur):
    n = int((dur + 1.2) * SR)
    t = np.arange(n) / SR
    fr = f(m)
    trem = 1 + 0.12 * np.sin(2 * np.pi * 4.5 * t)
    out = (np.sin(2 * np.pi * fr * t + 0.8 * np.sin(2 * np.pi * fr * t) * np.exp(-t / 0.4)) * np.exp(-t / 1.6)
           + 0.25 * np.sin(2 * np.pi * fr * 2 * t) * np.exp(-t / 0.5)) * trem
    a = int(0.004 * SR)
    out[:a] *= np.linspace(0, 1, a)
    rel = np.ones(n)
    k = int(dur * SR)
    if k < n:
        rel[k:] = np.exp(-np.arange(n - k) / (0.25 * SR))
    return out * rel


def bell(m, dur):
    n = int((dur + 1.5) * SR)
    t = np.arange(n) / SR
    fr = f(m)
    out = (np.sin(2 * np.pi * fr * t) * np.exp(-t / 0.9)
           + 0.35 * np.sin(2 * np.pi * fr * 3.01 * t) * np.exp(-t / 0.3)
           + 0.12 * np.sin(2 * np.pi * fr * 5.4 * t) * np.exp(-t / 0.12))
    a = int(0.002 * SR)
    out[:a] *= np.linspace(0, 1, a)
    return out


def bass(m, dur):
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    fr = f(m)
    out = (np.sin(2 * np.pi * fr * t) + 0.3 * np.sin(2 * np.pi * fr * 2 * t)) * np.exp(-t / 0.7)
    a = int(0.008 * SR)
    out[:a] *= np.linspace(0, 1, a)
    k = int(dur * SR)
    out[k:] *= np.exp(-np.arange(n - k) / (0.05 * SR))
    return out


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    fr = 50 + 70 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.12)


HP = butter(4, 3000, "hp", fs=SR, output="sos")
BP = butter(2, [1200, 4000], "bp", fs=SR, output="sos")


def snap():
    n = int(0.2 * SR)
    t = np.arange(n) / SR
    noise = sosfilt(BP, rng.standard_normal(n))
    return noise * np.exp(-t / 0.05) * 0.8 + np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.03) * 0.3


def shaker():
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    return sosfilt(HP, rng.standard_normal(n)) * np.exp(-t / 0.02)


for sec, (mel, mel_gain, drums) in enumerate(SECTIONS):
    t_sec = sec * 8 * BAR
    quiet = mel is None
    for b, name in enumerate(HARM):
        root, voices = CHORDS[name]
        t0 = t_sec + b * BAR
        # бас: раз, «и» второй, три, «и» четвёртой
        for beat, dur in ((0, 1.4), (1.5, 0.45), (2, 1.4), (3.5, 0.45)):
            add(bass(root + (12 if beat == 3.5 else 0), dur * Q), t0 + beat * Q, gain=0.24 if not quiet else 0.16)
        # электропиано: на вторую и четвёртую долю, мягко
        for beat in (1, 3) if not quiet else (0, 2):
            for k, v in enumerate(voices):
                add(epiano(v, Q * 0.9), t0 + beat * Q + k * 0.008, pan=0.3 * (k - 1), gain=0.06 if not quiet else 0.075)
        if drums:
            for beat in (0, 2):
                add(kick(), t0 + beat * Q, gain=0.3)
            for beat in (1, 3):
                add(snap(), t0 + beat * Q, pan=0.15, gain=0.12)
            for e in range(8):
                add(shaker(), t0 + e * Q / 2, pan=0.5, gain=0.05 if e % 2 else 0.03)
        else:
            # тихая середина: колокольчики по нотам аккорда
            for i, v in enumerate(voices):
                add(bell(v + 12, Q), t0 + i * Q, pan=-0.4 + 0.4 * i, gain=0.07)
    if mel:
        t = t_sec
        for m, eighths in mel:
            dur = eighths * Q / 2
            if m is not None:
                add(bell(m, dur), t, pan=0.1, gain=0.15 * mel_gain)
                add(epiano(m - 12, dur), t, pan=-0.1, gain=0.05 * mel_gain)
            t += dur
    # перелив в конце раздела
    end = t_sec + 8 * BAR
    for i, m in enumerate([77, 81, 84, 86, 89]):
        add(bell(m, 0.4), end - 0.6 + i * 0.09, pan=-0.4 + i * 0.2, gain=0.05)

# бесшовный круг: хвост — в начало
for ch in (mixL, mixR):
    ch[:TAIL] += ch[L:L + TAIL]
mixL, mixR = mixL[:L], mixR[:L]

peak = max(np.abs(mixL).max(), np.abs(mixR).max())
gain = 0.85 / peak
stereo = np.stack([mixL * gain, mixR * gain], axis=1)
pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
with wave.open("lotto-intro.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"lotto-intro.wav: {L / SR:.1f} с")
