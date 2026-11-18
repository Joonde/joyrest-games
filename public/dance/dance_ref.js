// Адаптер: dance_data.json (ускорения руки 15 Гц + карточки) → эталон формата v2 (сетка 50 Гц).
// vert = ускорение вверх, side = горизонтальная составляющая, mag = полный модуль,
// gyro/tilt отсутствуют (веса перенормируются; «держи» оценивается как движение).
(function (root) {
  "use strict";
  const RATE = 50;

  function buildRef(song, dataRate) {
    const acc = song.acc;                       // [[up,fwd,side]×N на танцора]
    const nD = song.dancers;
    const tEnd = song.end;
    const n50 = Math.floor(tEnd * RATE);
    const t50 = [];
    for (let i = 0; i < n50; i++) t50.push(i / RATE);
    const refs = [];
    for (let d = 0; d < nD; d++) {
      const a = acc[d];
      const nA = a.length / 3;
      const tA = [];
      for (let i = 0; i < nA; i++) tA.push(i / dataRate);
      const I = (col) => {
        const v = [];
        let j = 1;
        for (const x of t50) {
          if (x <= tA[0]) { v.push(col[0]); continue; }
          if (x >= tA[tA.length - 1]) { v.push(col[col.length - 1]); continue; }
          while (tA[j] < x) j++;
          const u = (x - tA[j - 1]) / (tA[j] - tA[j - 1]);
          v.push(col[j - 1] + u * (col[j] - col[j - 1]));
        }
        return v;
      };
      const up = [], fwd = [], side = [];
      for (let i = 0; i < nA; i++) { up.push(a[3 * i] / 100); fwd.push(a[3 * i + 1] / 100); side.push(a[3 * i + 2] / 100); }
      const vert = I(up);
      const horiz = I(fwd).map((q, i) => Math.hypot(q, I(side)[i]));
      const mag = vert.map((q, i) => Math.hypot(q, horiz[i]));
      refs.push({ t50, vert, side: horiz, mag, gyro: new Array(n50).fill(0), tilt: null });
    }
    // карточки → движения (все как «move»: «держи» оценивается корреляцией тишины)
    const moves = song.cards.map((c, i) => ({
      start: c[0], end: c[1], kind: "move", scored: true,
      gold: !!c[3], i, name: (c[2] && c[2][0]) || String(i + 1),
    }));
    return { refs, moves };
  }

  // Итоговая оценка записи: калибровка → признаки → судья.
  // rec — как в tanec.html (events с t от performance.now); song — из dance_data.json.
  function scoreRecording(V2, rec, song, dataRate, opts = {}) {
    const t0 = rec.start || 0;
    const ev = {
      t: rec.events.map((e) => e.t - t0),
      accg: rec.events.map((e) => e.accg || [NaN, NaN, NaN]),
      acc: rec.events.every((e) => !e.acc) ? null : rec.events.map((e) => e.acc || [NaN, NaN, NaN]),
      rot: rec.events.map((e) => e.rot || [NaN, NaN, NaN]),
    };
    const cal = V2.calibrate({
      t: rec.calib_events.map((e) => e.t - t0),
      accg: rec.calib_events.map((e) => e.accg),
      acc: rec.calib_events.every((e) => !e.acc) ? null : rec.calib_events.map((e) => e.acc),
      rot: rec.calib_events.map((e) => e.rot),
    });
    if (!cal.ok) return { ok: false, why: cal.why };
    const F = V2.phoneFeatures(ev, "v2", cal);
    if (!F) return { ok: false, why: ["мало данных датчиков"] };
    const { refs, moves } = buildRef(song, dataRate);
    const d = (rec.dancer || 1) - 1;
    const ref = refs[Math.min(d, refs.length - 1)];
    const sc = new V2.Scorer(ref, moves, "v2", opts.jumps, opts.syncGaps);
    const r = sc.run(F);
    let pts = 0, scored = 0;
    const cards = r.map((x, i) => {
      if (!x) return { t: moves[i].start, grade: "ВНЕ ОЦЕНКИ", score: null, golden: moves[i].gold, cmd: moves[i].name };
      if (x.kind === "nodata") return { t: moves[i].start, grade: "НЕТ СВЯЗИ", score: null, golden: moves[i].gold, cmd: moves[i].name };
      const [g, p] = V2.grade(x.total);
      pts += x.pts; scored++;
      return { t: moves[i].start, grade: g, score: Math.round(x.total), golden: moves[i].gold, cmd: moves[i].name };
    });
    const counts = {};
    for (const [, n] of V2.GRADES) counts[n] = 0;
    counts["НЕТ СВЯЗИ"] = 0;
    for (const c of cards) if (counts[c.grade] !== undefined) counts[c.grade]++;
    return {
      ok: true, points: pts, max: scored * 100, percent: scored ? Math.round(100 * pts / (scored * 100)) : 0,
      cards, counts, flip: sc.flip, lag: medianLag(r), events: sc.events,
      info: { calib: cal, gyroOk: true },
    };
  }
  function medianLag(r) {
    const ls = r.filter((x) => x && x.kind === "move").map((x) => x.lag);
    if (!ls.length) return 0;
    ls.sort((a, b) => a - b);
    return ls[ls.length >> 1];
  }

  root.DanceRef = { buildRef, scoreRecording };
  if (typeof module !== "undefined") module.exports = root.DanceRef;
})(typeof window !== "undefined" ? window : globalThis);
