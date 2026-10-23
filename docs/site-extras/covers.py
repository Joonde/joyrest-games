"""Обложки игр сайта (site/img/cover-*.svg): арт-деко рамка, лучи, линейный рисунок игры.
Запуск: python3 docs/site-extras/covers.py — перезаписывает файлы в site/img/.
Название игры на обложку не пишем: его выводит HTML фирменным шрифтом."""
import math, os

G, R, S, W, C, V = "#E3C68C", "#E3AA9C", "#A3C2AA", "#D2A0AC", "#F3ECE3", "#B3AADD"
BG = {  # цвет раздела: середина, край
    "quiz": ("#5A4A2E", "#1C160F"), "music": ("#5A3840", "#1A1013"), "dance": ("#5A3A30", "#1B120F"),
    "cards": ("#3E2A2A", "#140E0E"), "active": ("#2F4636", "#0F1712"), "party": ("#4A3A2A", "#17110C"),
    "out": ("#2E4048", "#0E1417"), "custom": ("#56462A", "#1A150C"), "tv": ("#4A3550", "#160F19"),
}

def spark(x, y, s, col=G, op=1):
    return (f'<path d="M{x} {y-s} Q{x} {y} {x+s} {y} Q{x} {y} {x} {y+s} Q{x} {y} {x-s} {y} Q{x} {y} {x} {y-s}Z" '
            f'fill="{col}" stroke="none" opacity="{op}"/>')

def qm(x, y, s=1, col=G):
    return (f'<g transform="translate({x} {y}) scale({s})" stroke="{col}"><path d="M-12 -14 Q-12 -28 0 -28 Q13 -28 13 -15 '
            f'Q13 -6 3 -1 Q0 1 0 8"/><circle cx="0" cy="20" r="2.6" fill="{col}"/></g>')

def glass(x, y, rot, col):
    return (f'<g transform="translate({x} {y}) rotate({rot})" stroke="{col}"><path d="M-20 0 H20 Q20 40 0 46 Q-20 40 -20 0Z"/>'
            f'<path d="M-18 16 H18" opacity=".6"/><path d="M0 46 V86 M-16 86 H16"/></g>')

def star5(cx, cy, r, col):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * .45
        pts.append(f"{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a):.1f}")
    return f'<polygon points="{" ".join(pts)}" stroke="{col}"/>'

def flake(x, y, s, col=C):
    d = "".join(f"M{x} {y} l{s*math.cos(a):.1f} {s*math.sin(a):.1f} " for a in [i * math.pi / 3 for i in range(6)])
    return f'<path d="{d}" stroke="{col}" stroke-width="2.5"/>'

M = {}
M["quiz-author"] = ("quiz", f'''<rect x="38" y="34" width="96" height="136" rx="8"/><path d="M58 64h56M58 84h56M58 104h36" opacity=".55"/>
{qm(86,140,.9,R)}<path d="M168 18 C132 36 110 86 104 150" stroke="{R}"/><path d="M168 18 C166 52 146 96 108 140 M150 52 l-22 4 M140 80 l-20 2" stroke="{R}" opacity=".7"/><path d="M104 150 l-5 16" stroke="{R}"/>''')
M["quiz-company"] = ("quiz", f'''<circle cx="52" cy="102" r="17"/><path d="M22 166 q30-44 60 0"/><circle cx="148" cy="102" r="17"/><path d="M118 166 q30-44 60 0"/>
<circle cx="100" cy="88" r="22" stroke="{R}"/><path d="M60 172 q40-56 80 0" stroke="{R}"/>
<rect x="76" y="6" width="48" height="40" rx="12"/><path d="M94 46 l6 10 l6-10"/>{qm(100,30,.62)}''')
M["quiz-games"] = ("quiz", f'''<g transform="rotate(-12 64 112)"><rect x="28" y="76" width="72" height="72" rx="14"/>
<circle cx="46" cy="94" r="5" fill="{G}"/><circle cx="64" cy="112" r="5" fill="{G}"/><circle cx="82" cy="130" r="5" fill="{G}"/></g>
<g transform="rotate(10 140 90)" stroke="{R}"><rect x="106" y="38" width="68" height="100" rx="9"/>{qm(140,92,1,R)}</g>''')
M["quiz-musicdance"] = ("quiz", f'''<path d="M78 146 V54 l66-18 V128"/><path d="M78 76 l66-18" opacity=".6"/>
<ellipse cx="64" cy="146" rx="16" ry="11" fill="{G}" fill-opacity=".25"/><ellipse cx="130" cy="128" rx="16" ry="11" fill="{G}" fill-opacity=".25"/>
{qm(40,52,.7,R)}{spark(170,150,10,R)}{spark(22,120,7,S)}''')
M["melody"] = ("music", f'''<circle cx="100" cy="100" r="74"/><circle cx="100" cy="100" r="56" opacity=".45"/><circle cx="100" cy="100" r="44" opacity=".3"/>
<circle cx="100" cy="100" r="20" stroke="{R}" fill="{R}" fill-opacity=".3"/><circle cx="100" cy="100" r="3" fill="{G}"/>
<path d="M150 22 v38" stroke="{R}"/><path d="M150 22 l16 6" stroke="{R}"/><ellipse cx="142" cy="60" rx="9" ry="6" stroke="{R}" fill="{R}"/>{qm(40,40,.6,S)}''')
M["sing"] = ("music", f'''<rect x="78" y="22" width="44" height="76" rx="22"/><path d="M78 52h44M78 66h44" opacity=".5"/>
<path d="M62 84 a38 38 0 0 0 76 0"/><path d="M100 122 v30 M78 152 h44"/>
<path d="M46 46 q-12 26 0 52 M28 34 q-20 38 0 76 M154 46 q12 26 0 52 M172 34 q20 38 0 76" stroke="{R}"/>{spark(100,180,8,S)}''')
M["justdance"] = ("dance", f'''<circle cx="104" cy="34" r="14" stroke="{R}"/><path d="M102 50 L94 106"/><path d="M100 64 L62 30 M100 64 L138 82 L162 54"/>
<path d="M94 106 L68 168 M94 106 L128 136 L144 172"/><path d="M40 60 q-10 10 -4 24 M30 46 q-16 18 -6 42 M168 112 q12 8 8 24" stroke="{S}" opacity=".8"/>
{spark(160,24,10,R)}{spark(30,150,7,G)}''')
M["dancelotto"] = ("dance", f'''<rect x="36" y="36" width="128" height="128" rx="10"/><path d="M78.7 36v128M121.3 36v128M36 78.7h128M36 121.3h128" opacity=".5"/>
<circle cx="57" cy="57" r="12" fill="{R}" stroke="{R}" fill-opacity=".55"/><circle cx="143" cy="100" r="12" fill="{R}" stroke="{R}" fill-opacity=".55"/><circle cx="100" cy="143" r="12" fill="{R}" stroke="{R}" fill-opacity=".55"/>
<path d="M96 112 V86 l14-4 V104"/><circle cx="92" cy="112" r="5" fill="{G}"/><circle cx="106" cy="104" r="5" fill="{G}"/>''')
M["dancecourage"] = ("dance", f'''<path d="M100 8 v38"/><circle cx="100" cy="106" r="58"/><ellipse cx="100" cy="106" rx="28" ry="58" opacity=".6"/><ellipse cx="100" cy="106" rx="48" ry="58" opacity=".35"/>
<ellipse cx="100" cy="106" rx="58" ry="20" opacity=".6"/><path d="M48 80 h104 M48 132 h104" opacity=".35"/>
<path d="M66 72 l12 12" stroke="{C}" stroke-width="3"/>{spark(170,60,10,R)}{spark(30,150,9,S)}{spark(166,160,6,C)}{spark(28,50,6,R)}''')
M["spy"] = ("cards", f'''<circle cx="86" cy="86" r="50"/><path d="M122 122 L170 170" stroke-width="12"/>
<path d="M54 80 q32-16 64 0 q-4 22 -16 22 q-16 0 -16-9 q0 9 -16 9 q-12 0 -16-22Z" stroke="{R}" fill="{R}" fill-opacity=".25"/>
<circle cx="72" cy="86" r="4" fill="{C}" stroke="none"/><circle cx="100" cy="86" r="4" fill="{C}" stroke="none"/>''')
cheq = "".join(f'<rect x="{56+i*24}" y="{34+j*22}" width="24" height="22" fill="{G if (i+j)%2==0 else "none"}" stroke="none" opacity=".8"/>' for i in range(4) for j in range(3))
M["survival"] = ("active", f'''<path d="M52 24 V180"/><rect x="56" y="34" width="96" height="66"/>{cheq}
<path d="M40 180 h30" /><path d="M110 150 q30-8 60 -4 M120 166 q26-6 50-2" stroke="{R}" opacity=".8"/>{spark(170,120,8,S)}''')
M["sweet"] = ("active", f'''<circle cx="82" cy="78" r="44" stroke="{R}"/><path d="M82 78 m0-6 a6 6 0 1 1 -6 6 a14 14 0 1 1 14 14 a22 22 0 1 1 -22 -22 a30 30 0 1 1 30 30" stroke="{R}" opacity=".8"/>
<path d="M112 110 L164 172"/><g transform="rotate(-25 150 46)"><ellipse cx="150" cy="46" rx="18" ry="12" stroke="{S}"/><path d="M132 46 l-12 -10 v20z M168 46 l12 -10 v20z" stroke="{S}"/></g>
<circle cx="30" cy="150" r="4" fill="{G}"/><circle cx="50" cy="164" r="4" fill="{G}"/><circle cx="74" cy="172" r="4" fill="{G}"/>''')
M["alco"] = ("active", f'''{glass(74,40,-14,G)}{glass(128,40,14,R)}<path d="M98 22 l-6 -12 M104 20 v-14 M110 22 l6 -12" stroke="{C}"/>
<text x="100" y="186" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="30" font-weight="700" fill="{R}" stroke="none">18+</text>''')
M["meet"] = ("party", f'''<path d="M30 42 h86 a16 16 0 0 1 16 16 v34 a16 16 0 0 1 -16 16 h-50 l-18 18 v-18 h-18 a16 16 0 0 1 -16 -16 v-34 a16 16 0 0 1 16 -16Z"/>
<path d="M84 94 h86 a16 16 0 0 1 16 16 v34 a16 16 0 0 1 -16 16 h-18 v18 l-18 -18 h-50 a16 16 0 0 1 -16 -16 v-34 a16 16 0 0 1 16 -16Z" stroke="{R}"/>
<path d="M127 118 c-6-8 -20-4 -16 6 q4 8 16 16 q12-8 16-16 c4-10 -10-14 -16-6Z" fill="{R}" stroke="{R}"/><path d="M40 66h50M40 82h30" opacity=".5"/>''')
burst = " ".join(f"{100+(70 if i%2==0 else 42)*math.cos(i*math.pi/12-math.pi/2):.1f},{100+(70 if i%2==0 else 42)*math.sin(i*math.pi/12-math.pi/2):.1f}" for i in range(24))
M["commotion"] = ("party", f'''<polygon points="{burst}"/><path d="M100 64 v44" stroke="{R}" stroke-width="10"/><circle cx="100" cy="128" r="6" fill="{R}" stroke="none"/>
<rect x="20" y="30" width="10" height="5" fill="{S}" stroke="none" transform="rotate(30 25 32)"/><rect x="170" y="40" width="10" height="5" fill="{R}" stroke="none" transform="rotate(-20 175 42)"/>
<rect x="166" y="160" width="10" height="5" fill="{V}" stroke="none" transform="rotate(50 171 162)"/><rect x="24" y="166" width="10" height="5" fill="{G}" stroke="none" transform="rotate(-40 29 168)"/>''')
leaves = lambda side: "".join(f'<ellipse cx="{100+side*(58+8*math.sin(i/2))*1:.1f}" cy="{150-i*16}" rx="10" ry="5" transform="rotate({side*(-30-i*8)} {100+side*(58+8*math.sin(i/2)):.1f} {150-i*16})" stroke="{S}"/>' for i in range(6))
M["toasts"] = ("party", f'''<path d="M86 22 h28 l-4 64 q-10 10 -20 0Z"/><path d="M100 92 v56 M84 148h32"/><path d="M89 50 h22" opacity=".5"/>
<circle cx="98" cy="70" r="3" fill="{C}" stroke="none"/><circle cx="104" cy="58" r="2.5" fill="{C}" stroke="none"/><circle cx="99" cy="40" r="2" fill="{C}" stroke="none"/>
<path d="M60 166 q-32-50 -6-110" stroke="{S}"/><path d="M140 166 q32-50 6-110" stroke="{S}"/>{leaves(-1)}{leaves(1)}{spark(100,8,8,R)}''')
M["freeze"] = ("active", f'''<rect x="58" y="146" width="84" height="24" rx="3"/><path d="M50 176 h100"/>
<circle cx="102" cy="40" r="13" stroke="{R}"/><path d="M102 54 L98 104 M100 66 L64 46 M100 66 L134 88 M98 104 L80 144 M98 104 L122 144" stroke="{R}"/>
{flake(36,60,12)}{flake(166,52,10)}{flake(160,120,8)}''')
M["silent"] = ("party", f'''<path d="M48 40 q52 -22 104 0 q6 74 -52 116 q-58 -42 -52 -116Z"/><path d="M68 74 q12-10 24 0 M108 74 q12-10 24 0"/>
<path d="M80 118 h40" stroke="{R}" stroke-width="5"/><path d="M90 112 v12 M100 112 v12 M110 112 v12" stroke="{R}" opacity=".7"/>{spark(170,30,9,R)}{spark(30,150,7,S)}''')
M["orchestra"] = ("music", f'''<ellipse cx="100" cy="100" rx="58" ry="18"/><path d="M42 100 V150 q58 32 116 0 V100"/>
<path d="M50 110 l16 44 l16 -44 l18 48 l18 -48 l16 44 l16 -44" opacity=".5"/>
<path d="M30 24 L92 88 M170 24 L108 88" stroke="{R}" stroke-width="6"/><circle cx="30" cy="24" r="7" fill="{R}" stroke="{R}"/><circle cx="170" cy="24" r="7" fill="{R}" stroke="{R}"/>''')
M["cossacks"] = ("out", f'''<path d="M100 4 v30"/><path d="M70 66 L84 34 h32 L130 66Z" fill="{G}" fill-opacity=".2"/>
<path d="M70 66 L28 176 H172 L130 66Z" fill="{G}" fill-opacity=".1" stroke="{G}" opacity=".5"/>
<path d="M84 124 v48 M116 124 v48 M80 124 h40 M84 124 V92 h32 v32" stroke="{R}"/>{star5(160,34,12,S)}''')
M["snow"] = ("out", f'''<path d="M30 84 q70 -88 140 0"/><path d="M30 84 q17.5 -12 35 0 q17.5 -12 35 0 q17.5 -12 35 0 q17.5 -12 35 0"/>
<path d="M30 84 L100 140 M65 84 L100 140 M135 84 L100 140 M170 84 L100 140 M100 84 V140" opacity=".6"/><rect x="90" y="140" width="20" height="22" rx="3" stroke="{R}"/>
{flake(28,150,10)}{flake(170,150,12)}{flake(150,24,8)}{flake(42,28,7)}''')
M["drop"] = ("out", f'''<g transform="rotate(-24 90 110)"><ellipse cx="70" cy="110" rx="32" ry="20"/><path d="M102 110 H178"/></g>
<path d="M72 34 q-20 30 0 46 q20 -16 0 -46Z" stroke="{S}" fill="{S}" fill-opacity=".3"/><path d="M40 160 q20 12 40 0 M130 46 q10 -14 24 -10" stroke="{R}" opacity=".7"/>''')
M["custom"] = ("custom", f'''<path d="M44 164 L132 76" stroke-width="7"/><path d="M44 164 L64 144" stroke="{C}" stroke-width="7"/>{star5(146,62,26,R)}
{spark(60,50,10,G)}{spark(176,130,8,S)}{spark(96,30,6,C)}{spark(170,24,6,G)}''')

def cover(key):
    sec, motif = M[key]
    mid, edge = BG[sec]
    rays = "".join(f'<path d="M320 192 L{320+520*math.cos(a):.0f} {192+520*math.sin(a):.0f}"/>' for a in [i * math.pi / 18 for i in range(36)])
    fans = ""
    for cx, cy, s, e in [(24, 24, 0, 90), (616, 24, 90, 180), (616, 376, 180, 270), (24, 376, 270, 360)]:
        for r in (16, 26, 36):
            a1, a2 = math.radians(s), math.radians(e)
            fans += f'<path d="M{cx+r*math.cos(a1):.1f} {cy+r*math.sin(a1):.1f} A{r} {r} 0 0 1 {cx+r*math.cos(a2):.1f} {cy+r*math.sin(a2):.1f}"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">
<defs><radialGradient id="b" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="{mid}"/><stop offset="1" stop-color="{edge}"/></radialGradient>
<radialGradient id="h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="{G}" stop-opacity=".22"/><stop offset="1" stop-color="{G}" stop-opacity="0"/></radialGradient>
<clipPath id="c"><rect x="24" y="24" width="592" height="352"/></clipPath></defs>
<rect width="640" height="400" fill="url(#b)"/>
<g clip-path="url(#c)" stroke="{G}" stroke-width="1.2" opacity=".09">{rays}</g>
<circle cx="320" cy="192" r="160" fill="url(#h)"/>
<rect x="14.5" y="14.5" width="611" height="371" fill="none" stroke="{G}" stroke-width="1.5" opacity=".55"/>
<rect x="24.5" y="24.5" width="591" height="351" fill="none" stroke="{G}" stroke-width="1" opacity=".3"/>
<g fill="none" stroke="{G}" stroke-width="1.2" opacity=".55">{fans}</g>
<path d="M290 40 h60 M300 34 l20 -8 l20 8" fill="none" stroke="{G}" stroke-width="1.2" opacity=".5"/>
<g transform="translate(200 72) scale(1.2)" fill="none" stroke="{G}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">{motif}</g>
</svg>
'''

out = os.path.join(os.path.dirname(__file__), "..", "..", "site", "img")
# Рисованные обложки (23 октября 2026) — WebP из docs/site-extras/art, SVG для них больше не пишем.
DRAWN = {"quiz-author", "quiz-company", "quiz-games", "quiz-musicdance", "melody"}
for k in M:
    if k in DRAWN: continue
    with open(os.path.join(out, f"cover-{k}.svg"), "w") as f:
        f.write(cover(k))
print(len(M), "обложек")
