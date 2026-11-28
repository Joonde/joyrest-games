// Адаптер и оценка «Танцуй как звезда» v2.1: dance_data.json → эталон 50 Гц → очки.
// Улучшения v2.1 (по живой записи 19.11.2026):
//  1. локальный подбор задержки ±0.35 с внутри каждой карточки (живой тайминг джиттерит);
//  2. «держи» оценивается по «тишине с допуском», а не корреляцией;
//  3. глобальная задержка не нужна — карточки независимы, зеркало перебирается как раньше.
(function (root) {
  "use strict";
  const RATE = 50;

  function buildRef(song, dataRate) {
    const acc = song.acc;
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
      const fwdI = I(fwd), sideI = I(side);
      const horiz = fwdI.map((q, i) => Math.hypot(q, sideI[i]));
      const mag = vert.map((q, i) => Math.hypot(q, horiz[i]));
      refs.push({ t50, vert, side: horiz, mag, gyro: new Array(n50).fill(0), tilt: null });
    }
    const moves = song.cards.map((c, i) => ({
      start: c[0], end: c[1], kind: "move", scored: true,
      gold: !!c[3], i, name: (c[2] && c[2][0]) || String(i + 1),
    }));
    return { refs, moves };
  }

  // ---------- математика ----------
  const pearson = (a, b) => {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sa = 0, sb = 0, sab = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sa += x * x; sb += y * y; sab += x * y; }
    const d = Math.sqrt(sa * sb);
    return d > 1e-9 ? sab / d : 0.0;
  };
  const interp = (t, v, xq) => {
    const out = new Array(xq.length);
    let j = 1;
    for (let i = 0; i < xq.length; i++) {
      const x = xq[i];
      if (x <= t[0]) { out[i] = v[0]; continue; }
      if (x >= t[t.length - 1]) { out[i] = v[v.length - 1]; continue; }
      while (t[j] < x) j++;
      while (j > 1 && t[j - 1] > x) j--;
      const u = (x - t[j - 1]) / (t[j] - t[j - 1]);
      out[i] = v[j - 1] + u * (v[j] - v[j - 1]);
    }
    return out;
  };
  function peaks(x) {
    let mx = -Infinity;
    for (const q of x) if (q > mx) mx = q;
    if (mx <= 0) return [];
    const thr = 0.3 * mx, minD = Math.round(0.15 * RATE), n = x.length;
    const cand = [];
    for (let i = 1; i < n - 1; i++) {
      if (!(x[i] > x[i - 1] && x[i] >= x[i + 1])) continue;
      let lmin = x[i];
      for (let k = i - 1; k >= 0; k--) { lmin = Math.min(lmin, x[k]); if (x[k] > x[i]) break; }
      let rmin = x[i];
      for (let k = i + 1; k < n; k++) { rmin = Math.min(rmin, x[k]); if (x[k] > x[i]) break; }
      const prom = x[i] - Math.max(lmin, rmin);
      if (prom >= thr) cand.push([i, prom]);
    }
    cand.sort((a, b) => x[b[0]] - x[a[0]]);
    const keep = [];
    for (const [i] of cand) {
      let ok = true;
      for (const q of keep) if (Math.abs(q - i) < minD) { ok = false; break; }
      if (ok) keep.push(i);
    }
    return keep.sort((a, b) => a - b);
  }
  const rms = (a) => Math.sqrt(a.reduce((s, q) => s + q * q, 0) / a.length);
  const clip01 = (x) => Math.max(0, Math.min(1, x));

  // ---------- оценка одной карточки ----------
  const LAGS = [];
  for (let l = -0.35; l <= 0.7501; l += 0.05) LAGS.push(Math.round(l * 100) / 100);

  function scoreCard(F, ref, m, opts) {
    const s = m.start, e = m.end;
    const idx = [];
    for (let i = 0; i < ref.t50.length; i++) if (ref.t50[i] >= s && ref.t50[i] < e) idx.push(i);
    if (idx.length < 8) return null;
    const tq0 = idx.map((i) => ref.t50[i]);
    if (tq0[0] < F.t[0] - 0.7 || tq0[tq0.length - 1] > F.t[F.t.length - 1] + 0.7) return null;
    const rv = idx.map((i) => ref.vert[i]), rm = idx.map((i) => ref.mag[i]);
    // покрытие данными
    const cover = (lag) => {
      const tq = tq0.map((q) => q + lag);
      let c = 0;
      for (const x of tq) {
        // ближайшее событие
        let lo = 0, hi = F.t.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (F.t[mid] < x) lo = mid; else hi = mid; }
        const d = Math.min(Math.abs(F.t[hi] - x), Math.abs(F.t[lo] - x));
        if (d <= 0.12) c++;
      }
      return c / tq.length;
    };
    // «держи»: оценка по тишине
    if (m.name === "держи" && rms(rm) < 2.0) {
      let best = null;
      for (const lag of LAGS) {
        if (cover(lag) < 0.8) continue;
        const gm = interp(F.t, F.mag, tq0.map((q) => q + lag));
        const r = rms(gm), re = rms(rm);
        // полный балл, если рука гостя тише адаптивного порога (доля от активности записи)
        const cap = (opts && opts.holdCap) || 4.0;
        const sc = 100 * clip01((cap - r) / (cap * 0.7)) * clip01((r / (re + 0.3)));
        if (best === null || sc > best.sc) best = { sc, lag };
      }
      if (!best) return { total: 0, kind: "nodata", lag: 0 };
      return { total: best.sc, shape: best.sc, rhythm: 100, strength: 100, lag: best.lag, kind: "hold" };
    }
    // обычное движение: локальный подбор задержки
    let best = null;
    for (const lag of LAGS) {
      if (cover(lag) < 0.8) continue;
      const gv = interp(F.t, F.vert, tq0.map((q) => q + lag));
      const gm = interp(F.t, F.mag, tq0.map((q) => q + lag));
      const r = 0.6 * pearson(rv, gv) + 0.4 * pearson(rm, gm);
      if (best === null || r > best.r) best = { r, lag, gm };
    }
    if (!best) return { total: 0, kind: "nodata", lag: 0 };
    const shape = clip01((best.r - 0.15) / 0.6) * 100;
    // ритм: F1 пиков mag
    const rp = peaks(rm), gp = peaks(best.gm);
    const tol = Math.round(0.15 * RATE);
    let hit = 0;
    for (const p of rp) {
      let d = Infinity;
      for (const q of gp) d = Math.min(d, Math.abs(q - p));
      if (gp.length && d <= tol) hit++;
    }
    const recall = rp.length ? hit / rp.length : 1.0;
    let hitg = 0;
    for (const p of gp) {
      let d = Infinity;
      for (const q of rp) d = Math.min(d, Math.abs(q - p));
      if (rp.length && d <= tol) hitg++;
    }
    const prec = gp.length ? hitg / gp.length : 0.0;
    const rhythm = (prec + recall > 0 ? 2 * prec * recall / (prec + recall) : 0) * 100;
    // сила: отношение амплитуд
    const ratio = rms(best.gm) / (rms(rm) + 1e-9);
    let strength;
    if (0.6 <= ratio && ratio <= 2.2) strength = 100.0;
    else if (ratio < 0.6) strength = clip01((ratio - 0.15) / 0.45) * 100;
    else strength = Math.max(50, Math.min(100, 100 - (ratio - 2.2) * 25));
    let total = shape * (0.55 + 0.45 * (0.6 * rhythm + 0.4 * strength) / 100);
    if (ratio < 0.2) total = 0.0;
    return { total, shape, rhythm, strength, lag: best.lag, ratio, r: best.r, kind: "move" };
  }

  // ---------- итог по записи ----------
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
    // адаптивный порог «тишины» для «держи»: доля от медианной активности записи
    const act = [];
    for (const m of moves) {
      if (m.name === "держи") continue;
      const idx = [];
      for (let i = 0; i < ref.t50.length; i++) if (ref.t50[i] >= m.start && ref.t50[i] < m.end) idx.push(i);
      if (idx.length < 8) continue;
      const tq0 = idx.map((i) => ref.t50[i]);
      if (tq0[tq0.length - 1] > F.t[F.t.length - 1]) continue;
      act.push(rms(interp(F.t, F.mag, tq0)));
    }
    act.sort((a, b) => a - b);
    const holdCap = act.length ? Math.max(4.0, 0.45 * act[act.length >> 1]) : 4.0;
    let pts = 0, scored = 0;
    const lags = [];
    const cards = moves.map((m) => {
      const x = scoreCard(F, ref, m, Object.assign({ holdCap }, opts));
      if (!x) return { t: m.start, grade: "ВНЕ ЗАПИСИ", score: null, golden: m.gold, cmd: m.name };
      if (x.kind === "nodata") return { t: m.start, grade: "НЕТ СВЯЗИ", score: null, golden: m.gold, cmd: m.name };
      const [g, p] = V2.grade(x.total);
      pts += p; scored++;
      if (x.kind === "move") lags.push(x.lag);
      return { t: m.start, grade: g, score: Math.round(x.total), golden: m.gold, cmd: m.name, lag: x.lag };
    });
    const counts = {};
    for (const [, n] of V2.GRADES) counts[n] = 0;
    counts["НЕТ СВЯЗИ"] = 0;
    for (const c of cards) if (counts[c.grade] !== undefined) counts[c.grade]++;
    lags.sort((a, b) => a - b);
    return {
      ok: true, points: pts, max: scored * 100, percent: scored ? Math.round(100 * pts / (scored * 100)) : 0,
      cards, counts, flip: false, lag: lags.length ? lags[lags.length >> 1] : 0, events: [],
      info: { calib: cal, gyroOk: true },
    };
  }

  root.DanceRef = { buildRef, scoreRecording, scoreCard };
  if (typeof module !== "undefined") module.exports = root.DanceRef;
})(typeof window !== "undefined" ? window : globalThis);
