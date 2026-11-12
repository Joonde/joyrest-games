# «Бубликатор»: ритмичная музыка полёта — своя для каждой из 5 тем, создана кодом (права наши; решение владельца 12 ноября 2026).
# Звучит только во время полёта (экран зала, `flightMusicOf`), в последние 30 с перелёта экран ускоряет её (playbackRate).
# Каждая тема — 16 тактов 4/4, бесшовный круг: бас, барабаны, аккорды и своя фигура мелодии. Мелодии придуманы заново.
#   space     — ля минор, 120: синтезаторное арпеджио, пэд, бочка и хлопок (космос)
#   pirates   — ре минор, 112: «гармошка» (два расстроенных квадрата с тремоло), бас «умпа», бубен (пиратская джига)
#   submarine — ми минор, 108: сонар каждые 2 такта, глубокий пульсирующий бас, приглушённые тарелочки
#   wedding   — соль мажор, 116: колокольчики, мягкий поп-бит, пиццикато
#   newyear   — до мажор, 124: бубенцы восьмыми, челеста, бас и бочка (праздничный марш)
# Запуск: python3 scripts/sounds/bublikator-flight.py <папка> → <тема>.wav; mp3:
#   for t in space pirates submarine wedding newyear; do ffmpeg -y -i <папка>/$t.wav -codec:a libmp3lame -b:a 112k \
#     public/sounds/bub-flight-$t-1.mp3; done
import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
OUT.mkdir(parents=True, exist_ok=True)
f = lambda m: 440.0 * 2 ** ((m - 69) / 12)
HP = butter(4, 5000, "hp", fs=SR, output="sos")
BP = butter(2, [1200, 4000], "bp", fs=SR, output="sos")
LP = butter(2, 1800, "lp", fs=SR, output="sos")


def env(n, a=0.004, d=None):
    e = np.ones(n)
    k = max(1, int(a * SR))
    e[:k] = np.linspace(0, 1, k)
    if d:
        e *= np.exp(-np.arange(n) / (d * SR))
    return e


def sine(m, dur, d=0.6):
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * f(m) * t) * env(n, 0.006, d)


def saw(m, dur, d=0.4, bright=6):
    n = int((dur + 0.2) * SR)
    t = np.arange(n) / SR
    out = sum(np.sin(2 * np.pi * f(m) * h * t) / h for h in range(1, bright + 1))
    return sosfilt(LP, out) * env(n, 0.005, d)


def square(m, dur, detune=0.0, d=None):
    n = int((dur + 0.1) * SR)
    t = np.arange(n) / SR
    fr = f(m) * (1 + detune)
    out = sum(np.sin(2 * np.pi * fr * h * t) / h for h in (1, 3, 5, 7))
    e = env(n, 0.01, d)
    k = int(dur * SR)
    e[k:] *= np.exp(-np.arange(n - k) / (0.04 * SR))
    return out * e


def bell(m, dur):
    n = int((dur + 1.2) * SR)
    t = np.arange(n) / SR
    fr = f(m)
    return (np.sin(2 * np.pi * fr * t) * np.exp(-t / 0.8) + 0.35 * np.sin(2 * np.pi * fr * 3.01 * t) * np.exp(-t / 0.25)) * env(n, 0.002)


def pad(ms, dur):
    n = int((dur + 0.5) * SR)
    t = np.arange(n) / SR
    out = sum(np.sin(2 * np.pi * f(m) * t + 0.3 * np.sin(2 * np.pi * 0.5 * t)) for m in ms) / len(ms)
    e = np.minimum(1, t / 0.3) * np.minimum(1, np.maximum(0, (dur + 0.5 - t) / 0.5))
    return out * e


def kick():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    fr = 48 + 80 * np.exp(-t / 0.025)
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.11)


def snare(rng):
    n = int(0.2 * SR)
    t = np.arange(n) / SR
    return sosfilt(BP, rng.standard_normal(n)) * np.exp(-t / 0.05) * 0.8 + np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.03) * 0.3


def hat(rng, d=0.02):
    n = int(0.1 * SR)
    t = np.arange(n) / SR
    return sosfilt(HP, rng.standard_normal(n)) * np.exp(-t / d)


def ping():
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 1480 * t) * np.exp(-t / 0.35) * env(n, 0.003) + 0.3 * np.sin(2 * np.pi * 2960 * t) * np.exp(-t / 0.15)


THEMES = {
    # bpm, аккорды (бас, голоса), фигура мелодии на такт (ступени аккорда по восьмым, None — пауза)
    "space": (120, [(45, [57, 60, 64]), (41, [57, 60, 65]), (48, [55, 60, 64]), (43, [55, 59, 62])], [0, 1, 2, 1, 2, 0, 1, 2]),
    "pirates": (112, [(38, [57, 62, 65]), (36, [55, 60, 64]), (34, [58, 62, 65]), (33, [57, 61, 64])], [2, None, 1, 0, 2, None, 1, 2]),
    "submarine": (108, [(40, [55, 59, 64]), (36, [55, 60, 64]), (43, [55, 59, 62]), (38, [57, 62, 66])], [0, None, None, 2, None, 1, None, None]),
    "wedding": (116, [(43, [59, 62, 67]), (38, [57, 62, 66]), (40, [59, 64, 67]), (36, [60, 64, 67])], [2, 1, 0, None, 1, 2, 0, None]),
    "newyear": (124, [(36, [60, 64, 67]), (45, [60, 64, 69]), (41, [60, 65, 69]), (43, [59, 62, 67])], [0, 2, 1, 2, 0, 2, 1, None]),
}


def render(theme):
    bpm, chords, figure = THEMES[theme]
    rng = np.random.default_rng(len(theme) * 17)
    Q = 60 / bpm
    BAR = 4 * Q
    BARS = 16
    L = int(SR * BAR * BARS)
    TAIL = int(SR * 3)
    mix = np.zeros((2, L + TAIL))

    def add(sig, start, pan=0.0, gain=1.0):
        s = int(start * SR)
        end = min(s + len(sig), L + TAIL)
        if end <= s:
            return
        mix[0, s:end] += sig[: end - s] * gain * np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
        mix[1, s:end] += sig[: end - s] * gain * np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)

    for b in range(BARS):
        root, voices = chords[b % len(chords)]
        t0 = b * BAR
        lift = 12 if b % 8 >= 4 else 0  # вторая половина фразы — мелодия октавой выше
        # Барабаны.
        for beat in range(4):
            if theme == "pirates":
                add(kick(), t0 + beat * Q, gain=0.32 if beat % 2 == 0 else 0.0)
                add(hat(rng, 0.05), t0 + beat * Q + Q / 2, pan=0.4, gain=0.06)  # бубен
            elif theme == "submarine":
                add(kick(), t0 + beat * Q, gain=0.3 if beat in (0, 2) else 0.12)
            else:
                add(kick(), t0 + beat * Q, gain=0.32 if beat in (0, 2) else (0.18 if theme == "newyear" else 0.0))
            if beat in (1, 3):
                add(snare(rng), t0 + beat * Q, pan=0.1, gain=0.11 if theme != "submarine" else 0.05)
        for e in range(8):
            g = 0.045 if e % 2 else 0.028
            if theme == "newyear":
                g *= 1.6  # бубенцы
            add(hat(rng, 0.03 if theme == "newyear" else 0.015), t0 + e * Q / 2, pan=0.5, gain=g)
        # Бас.
        if theme == "pirates":
            for beat in range(4):
                add(sine(root + (7 if beat % 2 else 0), Q * 0.45, 0.25), t0 + beat * Q, gain=0.26)
        elif theme == "submarine":
            for e in range(8):
                add(sine(root, Q * 0.4, 0.15), t0 + e * Q / 2, gain=0.24)
        else:
            for beat, dur in ((0, 0.9), (1.5, 0.4), (2, 0.9), (3.5, 0.4)):
                add(sine(root + (12 if beat == 3.5 else 0), dur * Q, 0.4), t0 + beat * Q, gain=0.26)
        # Аккорды.
        if theme == "space":
            add(pad(voices, BAR), t0, gain=0.06)
        elif theme == "pirates":
            for beat in (1, 3):
                for k, v in enumerate(voices):
                    add(square(v, Q * 0.4, 0.004 * (k - 1)), t0 + beat * Q, pan=0.3 * (k - 1), gain=0.025)
        elif theme == "submarine":
            add(pad([v - 12 for v in voices], BAR), t0, gain=0.07)
            if b % 2 == 0:
                add(ping(), t0, pan=-0.3, gain=0.08)
        elif theme == "wedding":
            for beat in (1, 3):
                for k, v in enumerate(voices):
                    add(sine(v, Q * 0.3, 0.12), t0 + beat * Q + k * 0.01, pan=0.3 * (k - 1), gain=0.05)  # пиццикато
        else:
            add(pad(voices, BAR), t0, gain=0.045)
        # Мелодия — фигура по восьмым.
        for e, step in enumerate(figure):
            if step is None:
                continue
            m = voices[step % len(voices)] + 12 + lift
            t = t0 + e * Q / 2
            if theme == "space":
                add(saw(m, Q / 2, 0.18), t, pan=0.25 if e % 2 else -0.25, gain=0.07)
            elif theme == "pirates":
                tone = square(m, Q / 2 * 0.9, 0.003) + square(m, Q / 2 * 0.9, -0.003)
                trem = 1 + 0.25 * np.sin(2 * np.pi * 6 * np.arange(len(tone)) / SR)
                add(tone * trem, t, pan=-0.1, gain=0.035)
            elif theme == "submarine":
                add(bell(m - 12, Q), t, pan=0.3, gain=0.06)
            elif theme == "wedding":
                add(bell(m, Q / 2), t, pan=0.1, gain=0.09)
            else:
                add(bell(m + (12 if e % 4 == 0 else 0), Q / 2), t, pan=-0.15, gain=0.08)  # челеста
    # Бесшовный круг: хвост — в начало.
    mix[:, :TAIL] += mix[:, L : L + TAIL]
    mix = mix[:, :L]
    mix *= 0.85 / np.abs(mix).max()
    pcm = (np.clip(mix.T, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(OUT / f"{theme}.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{theme}.wav: {L / SR:.1f} с, {bpm} уд/мин")


for name in THEMES:
    render(name)
