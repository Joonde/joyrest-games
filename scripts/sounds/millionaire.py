# «Кто хочет стать миллионером»: своя музыка напряжения и короткие звуки — созданы кодом (права наши).
# В духе телевикторины (пульс сердца, тянущийся бас, тикающие арпеджио, удары), но мелодия и гармония
# придуманы заново и не повторяют музыку передачи.
#   think-low  — фон вопроса ступеней 1–6: 96 уд/мин, ре минор, пульс сердца, мягкие тики, 40 с по кругу;
#   think-high — ступени 7–12: 112 уд/мин, бас восьмыми, выше и плотнее, 34 с по кругу;
#   question   — вопрос на экране: взлёт и удар;   lock — «окончательный ответ»: низкий удар с эхом;
#   right      — верно: светлый мажорный перелив;  wrong — неверно: падающий минорный аккорд;
#   lifeline   — подсказка: искристый вихрь.
# Запуск: python3 scripts/sounds/millionaire.py <папка> → wav; mp3:
#   for f in <папка>/*.wav; do ffmpeg -y -i "$f" -codec:a libmp3lame -b:a 128k public/sounds/millionaire-$(basename "$f" .wav)-1.mp3; done
import sys
import wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
rng = np.random.default_rng(7)
f = lambda m: 440.0 * 2 ** ((m - 69) / 12)


def t_(sec):
    return np.arange(int(SR * sec)) / SR


def env(n, a, d, s, r, sustain_len=None):
    """ADSR по секундам; n — длина в сэмплах."""
    out = np.zeros(n)
    A, D, R = int(a * SR), int(d * SR), int(r * SR)
    S = n - A - D - R if sustain_len is None else int(sustain_len * SR)
    S = max(0, S)
    i = 0
    seg = min(A, n)
    out[:seg] = np.linspace(0, 1, A, endpoint=False)[:seg]
    i += A
    if i < n:
        seg = min(D, n - i)
        out[i:i + seg] = np.linspace(1, s, D, endpoint=False)[:seg]
        i += D
    if i < n:
        seg = min(S, n - i)
        out[i:i + seg] = s
        i += S
    if i < n:
        seg = min(R, n - i)
        out[i:i + seg] = np.linspace(s, 0, R)[:seg]
    return out


def lp(x, hz):
    return sosfilt(butter(2, hz, "low", fs=SR, output="sos"), x)


def hp(x, hz):
    return sosfilt(butter(2, hz, "high", fs=SR, output="sos"), x)


def reverb(x, sec=2.2, mix=0.3):
    n = int(sec * SR)
    ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 7, n))
    ir = lp(ir, 6000)
    ir /= np.sqrt(np.sum(ir ** 2))
    wet = fftconvolve(x, ir)[: len(x)]
    return x * (1 - mix) + wet * mix


def saw(freq, tt, detune=0.0):
    out = np.zeros_like(tt)
    for k in (-detune, 0.0, detune):
        ph = (freq * (1 + k) * tt) % 1.0
        out += 2 * ph - 1
    return out / 3


def pad(notes, sec, cutoff=1200, a=1.5, r=1.5):
    tt = t_(sec)
    x = sum(saw(f(m), tt, 0.004) for m in notes) / len(notes)
    x = lp(x, cutoff)
    return x * env(len(tt), a, 0.5, 0.85, r)


def pluck(m, sec=0.35, bright=4000):
    tt = t_(sec)
    x = np.sin(2 * np.pi * f(m) * tt) + 0.35 * np.sin(2 * np.pi * 2 * f(m) * tt) + 0.15 * np.sin(2 * np.pi * 3 * f(m) * tt)
    return lp(x, bright) * np.exp(-tt * 9)


def bell(m, sec=1.6):
    tt = t_(sec)
    fr = f(m)
    x = np.sin(2 * np.pi * fr * tt) + 0.5 * np.sin(2 * np.pi * fr * 2.76 * tt) * np.exp(-tt * 3) + 0.25 * np.sin(2 * np.pi * fr * 5.4 * tt) * np.exp(-tt * 6)
    return x * np.exp(-tt * 2.6)


def kick(sec=0.45, start=110, end=42, gain=1.0):
    tt = t_(sec)
    fr = end + (start - end) * np.exp(-tt * 28)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    return np.sin(ph) * np.exp(-tt * 7) * gain


def heartbeat():
    """«Тук-тук»: два глухих удара."""
    a = kick(0.35, 90, 38, 1.0)
    b = kick(0.35, 80, 36, 0.7)
    out = np.zeros(int(SR * 0.6))
    out[: len(a)] += a
    o = int(SR * 0.17)
    out[o: o + len(b)] += b
    return lp(out, 400)


def tick(sec=0.05):
    tt = t_(sec)
    x = hp(rng.standard_normal(len(tt)), 5000) * np.exp(-tt * 90)
    return x


def whoosh(sec, up=True):
    tt = t_(sec)
    noise = rng.standard_normal(len(tt))
    out = np.zeros_like(noise)
    steps = 24
    seg = len(tt) // steps
    for i in range(steps):
        p = i / steps if up else 1 - i / steps
        hz = 300 + 5000 * p ** 2
        part = noise[i * seg:(i + 1) * seg]
        out[i * seg:(i + 1) * seg] = sosfilt(butter(2, [hz * 0.7, min(hz * 1.4, 18000)], "band", fs=SR, output="sos"), part)
    shape = np.linspace(0, 1, len(tt)) ** 2 if up else np.linspace(1, 0, len(tt)) ** 0.5
    return out * shape


class Mix:
    def __init__(self, sec):
        self.L = np.zeros(int(SR * sec))
        self.R = np.zeros(int(SR * sec))

    def add(self, sig, at, pan=0.0, gain=1.0):
        i = int(at * SR) % len(self.L)
        n = len(sig)
        l, r = gain * np.sqrt((1 - pan) / 2), gain * np.sqrt((1 + pan) / 2)
        # Круг: хвост, вышедший за конец, ложится в начало (бесшовный повтор).
        idx = (np.arange(n) + i) % len(self.L)
        np.add.at(self.L, idx, sig * l)
        np.add.at(self.R, idx, sig * r)


def think(bpm, bars, root, high):
    beat = 60 / bpm
    bar = 4 * beat
    sec = bars * bar
    m = Mix(sec)
    # Гармония по 2 такта: i – VI – iv – V (ре минор), в «high» — выше и с задержаниями.
    prog = [(root, [0, 3, 7, 14]), (root - 4, [0, 4, 7, 14]), (root - 7 + 12, [0, 3, 7, 10]), (root - 5 + 12, [0, 4, 7, 13])]
    for b in range(0, bars, 2):
        base, chord = prog[(b // 2) % len(prog)]
        notes = [base + 12 + c for c in chord]
        m.add(pad(notes, 2 * bar + 1.2, 900 if not high else 1500), b * bar, 0.0, 0.22)
        # Тянущийся бас
        bass_len = 2 * bar
        tt = t_(bass_len)
        bass = lp(saw(f(base - 12), tt, 0.002), 220) * env(len(tt), 0.05, 0.3, 0.8, 0.4)
        m.add(bass, b * bar, 0.0, 0.38 if not high else 0.3)
        if high:
            for k in range(16):
                m.add(lp(saw(f(base - 12), t_(beat / 2 * 0.9), 0.0), 300) * env(int(SR * beat / 2 * 0.9), 0.005, 0.05, 0.6, 0.05), b * bar + k * beat / 2, 0.0, 0.22)
        # Тикающее арпеджио шестнадцатыми — мягко, по краям стерео
        arp = [notes[0] + 12, notes[2] + 12, notes[1] + 12, notes[3] + 12]
        for k in range(32):
            note = arp[k % 4] + (12 if high and k % 8 >= 4 else 0)
            m.add(pluck(note, 0.25, 3500 if not high else 5000), b * bar + k * beat / 4, -0.6 if k % 2 else 0.6, 0.06 if k % 4 else 0.09)
    # Пульс сердца на 1 и 3 доли, в «high» — каждую долю
    for k in range(bars * 4):
        if high or k % 2 == 0:
            m.add(heartbeat(), k * beat, 0.0, 0.55)
        m.add(tick(), k * beat + beat / 2, 0.2, 0.05)
    # Нарастание к середине круга: тихий тремоло-кластер
    tt = t_(sec / 2)
    trem = sum(np.sin(2 * np.pi * f(root + 24 + c) * tt) for c in (0, 1, 7)) * (0.5 + 0.5 * np.sin(2 * np.pi * (6 if high else 4) * tt))
    m.add(trem * np.sin(np.pi * np.linspace(0, 1, len(tt))) ** 2 * 0.03, sec / 4, 0.0, 1.0)
    L, R = reverb(m.L, 2.0, 0.22), reverb(m.R, 2.1, 0.22)
    return L, R


def oneshot(sec):
    return Mix(sec)


def question():
    m = oneshot(3.2)
    m.add(whoosh(1.0, True), 0.0, -0.3, 0.35)
    m.add(kick(0.9, 120, 38, 1.0), 1.0, 0.0, 0.9)
    m.add(pad([50, 57, 62, 65, 69], 2.2, 2500, 0.01, 1.6), 1.0, 0.0, 0.35)
    for i, n in enumerate([74, 77, 81, 86]):
        m.add(bell(n, 1.8), 1.0 + i * 0.06, (-0.5 + i / 3), 0.12)
    return m


def lock():
    m = oneshot(3.6)
    for k in range(3):
        m.add(kick(1.2, 70, 30, 1.0), k * 0.0, 0.0, 1.0 if k == 0 else 0.0)
    m.add(pad([38, 45, 50, 53], 3.0, 600, 0.005, 2.6), 0.0, 0.0, 0.5)
    m.add(bell(62, 3.0), 0.0, 0.0, 0.08)
    return m


def right():
    m = oneshot(4.0)
    m.add(kick(0.6, 140, 50, 0.7), 0.0, 0.0, 0.6)
    for i, n in enumerate([62, 66, 69, 74, 78, 81, 86]):
        m.add(bell(n, 2.2), i * 0.07, -0.6 + i * 0.2, 0.16)
    m.add(pad([50, 57, 62, 66, 69, 74], 3.4, 3500, 0.02, 2.2), 0.05, 0.0, 0.33)
    m.add(whoosh(0.8, False) * 0.5, 0.0, 0.3, 0.2)
    return m


def wrong():
    m = oneshot(3.6)
    m.add(kick(1.0, 80, 32, 1.0), 0.0, 0.0, 0.9)
    chord = [41, 44, 48, 51]
    for i, n in enumerate(chord):
        tt = t_(3.0)
        glide = f(n) * (1 - 0.06 * np.clip(tt / 2.5, 0, 1))
        ph = 2 * np.pi * np.cumsum(glide) / SR
        tone = (np.sin(ph) + 0.4 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph))
        m.add(lp(tone, 1200) * env(len(tt), 0.02, 0.4, 0.7, 1.6), 0.0, -0.3 + i * 0.2, 0.16)
    return m


def lifeline():
    m = oneshot(2.2)
    m.add(whoosh(0.7, True), 0.0, -0.4, 0.25)
    for i, n in enumerate([81, 84, 88, 91, 93, 96, 100]):
        m.add(bell(n, 1.2), 0.25 + i * 0.05, 0.6 - i * 0.18, 0.08)
    return m


def write(path, L, R, fade_in=0.0, fade_out=0.0):
    peak = max(np.max(np.abs(L)), np.max(np.abs(R)), 1e-9)
    L, R = L / peak * 0.89, R / peak * 0.89
    for x in (L, R):
        if fade_in:
            n = int(fade_in * SR)
            x[:n] *= np.linspace(0, 1, n)
        if fade_out:
            n = int(fade_out * SR)
            x[-n:] *= np.linspace(1, 0, n)
    data = (np.stack([L, R], 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    L, R = think(96, 16, 50, False)
    write(f"{out}/think-low.wav", L, R)
    L, R = think(112, 16, 53, True)
    write(f"{out}/think-high.wav", L, R)
    for name, make in (("question", question), ("lock", lock), ("right", right), ("wrong", wrong), ("lifeline", lifeline)):
        m = make()
        L, R = reverb(m.L, 2.4, 0.3), reverb(m.R, 2.5, 0.3)
        write(f"{out}/{name}.wav", L, R, 0.0, 0.3)
