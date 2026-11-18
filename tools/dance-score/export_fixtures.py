"""Экспорт фикстур для сверки JS-порта движка оценки v2 с Python-оригиналом (scoring.py).
Создаёт в out_dir:
  ref.json            эталон поз (t50, vert, side, mag, gyro, tilt) + moves
  guests/*.json       записи гостей: {name, seed, calib_events, dance_events, expected}
где expected — итог Python-движка (очки, грейды по движениям, события Scorer).
Использование: jr-venv/bin/python export_fixtures.py out_dir"""
import json, os, sys
import numpy as np

SIM = "/Users/misha/Movies/joyrest-tancy/razrabotka/sim"
sys.path.insert(0, SIM)
import scoring as S
import poseref as P


def to_pairs(lst):
    return [[float(a), float(b)] for a, b in lst]


def events_json(ev):
    out = []
    acc = ev.get("acc")
    for i, t in enumerate(ev["t"]):
        out.append({
            "t": round(float(t), 4),
            "accg": [round(float(q), 4) for q in ev["accg"][i]],
            "acc": None if acc is None else [round(float(q), 4) for q in acc[i]],
            "rot": [round(float(q), 4) for q in ev["rot"][i]],
        })
    return out


GUESTS = [
    ("excellent", "отличный", lambda s: P.angle_path(delay=0.15, jitter=0.04, seed=s)),
    ("late",      "опаздывает", lambda s: P.angle_path(delay=0.4, jitter=0.06, seed=s)),
    ("sloppy",    "неряшливый", lambda s: P.angle_path(delay=0.25, amp=0.75, jitter=0.08, seed=s)),
    ("lazy",      "вялый", lambda s: P.angle_path(delay=0.25, amp=0.35, jitter=0.08, seed=s)),
    ("standing",  "стоит", lambda s: P.angle_path(amp=0.0, jitter=0.05, seed=s)),
]


def main(out_dir):
    os.makedirs(f"{out_dir}/guests", exist_ok=True)
    ref, moves = P.build_ref()
    refj = {k: [round(float(q), 5) for q in ref[k]] for k in ("t50", "vert", "side", "mag", "gyro", "tilt")}
    json.dump({"ref": refj, "moves": moves}, open(f"{out_dir}/ref.json", "w"), ensure_ascii=False)

    for name, title, th_fn in GUESTS:
        for seed in range(3):
            cal_ev = P.calib_events(seed=seed)
            cal = S.calibrate(cal_ev)
            assert cal["ok"], (name, seed, cal["why"])
            t, th = th_fn(seed)
            ev = P.phone_events(t, th, seed=seed)
            F = S.phone_features(ev, "v2", cal)
            assert F is not None
            sc = S.Scorer(ref, moves, "v2")
            r = sc.run(F)
            pts = sum(x["pts"] for x in r if x)
            expected = {
                "points": pts,
                "grades": [None if x is None else x["grade"] for x in r],
                "totals": [None if x is None else round(float(x["total"]), 2) for x in r],
                "flip": sc.flip, "events": [list(e) for e in sc.events],
                "calib": {"f": cal["f"].tolist(), "n": cal["n"].tolist(), "rot_scale": cal.get("rot_scale", 1.0)},
                "features": {k: [round(float(q), 4) for q in F[k]] for k in ("vert", "side", "mag", "gyro", "tilt", "valid")},
            }
            rec = {"name": name, "title": title, "seed": seed,
                   "calib_events": events_json(cal_ev), "dance_events": events_json(ev),
                   "expected": expected}
            json.dump(rec, open(f"{out_dir}/guests/{name}-{seed}.json", "w"), ensure_ascii=False)
            print(f"{name}-{seed}: {pts} очков, flip={sc.flip}, движений {sum(1 for x in r if x)}")


if __name__ == "__main__":
    main(sys.argv[1])
