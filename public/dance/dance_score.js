// Оценка «по рисунку движения» для страницы проверки с телефоном. Тот же расчёт, что accscore2.py.
// Запись: {ua, chest:[a,b], start, events:[{t, accg, acc, rot, ori}]}; песня — из dance_data.json.
(function (root) {
  "use strict";
  const G = 9.81, GRID = 50, HOLD_RMS = 0.6;
  const GRADES = [[85, "ИДЕАЛЬНО", 100], [70, "ОТЛИЧНО", 70], [50, "ХОРОШО", 50], [30, "ПОЧТИ", 25], [-1, "МИМО", 0]];
  const range = (a, b, s) => { const r = []; for (let x = a; x <= b + 1e-9; x += s) r.push(Math.round(x * 1000) / 1000); return r; };
  const LAGS = range(-1.5, 2.5, 0.05), LOC = range(-0.15, 0.15, 0.05);

  // --- 3×3 матрицы (массивы по строкам) ---
  const mul = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]; return C; };
  const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
  const mtv = (A, v) => [A[0] * v[0] + A[3] * v[1] + A[6] * v[2], A[1] * v[0] + A[4] * v[1] + A[7] * v[2], A[2] * v[0] + A[5] * v[1] + A[8] * v[2]];
  const norm = v => Math.hypot(v[0], v[1], v[2]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const skew = w => [0, -w[2], w[1], w[2], 0, -w[0], -w[1], w[0], 0];
  const add = (A, B, k = 1) => A.map((x, i) => x + k * B[i]);
  function expm(w) {
    const th = norm(w); if (th < 1e-12) return I3.slice();
    const K = skew(w.map(x => x / th));
    return add(add(I3, K, Math.sin(th)), mul(K, K), 1 - Math.cos(th));
  }
  function rotTo(a, b) {
    const v = cross(a, b), c = dot(a, b);
    if (norm(v) < 1e-9) return c > 0 ? I3.slice() : [1, 0, 0, 0, -1, 0, 0, 0, -1];
    const K = skew(v); return add(add(I3, K), mul(K, K), 1 / (1 + c));
  }
  function ortho(R) {  // Грам — Шмидт по столбцам
    let x = [R[0], R[3], R[6]], y = [R[1], R[4], R[7]];
    const nx = norm(x); x = x.map(q => q / nx);
    const d = dot(x, y); y = y.map((q, i) => q - d * x[i]); const ny = norm(y); y = y.map(q => q / ny);
    const z = cross(x, y);
    return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  }
  const fin = v => Array.isArray(v) && v.length === 3 && v.every(q => q !== null && isFinite(q));
  const median = a => { if (!a.length) return NaN; const s = a.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]); };

  // Знак ускорений: по стандарту в покое accg смотрит вверх, Safari на iPhone — вниз.
  function invertedSign(ev, ua, chest) {
    const dots = [];
    for (const e of ev) {
      if (!fin(e.ori) || !fin(e.accg)) continue;
      const [a, b, c] = e.ori.map(q => q * Math.PI / 180);
      const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
      const R = mul(mul([ca, -sa, 0, sa, ca, 0, 0, 0, 1], [1, 0, 0, 0, cb, -sb, 0, sb, cb]), [cc, 0, sc, 0, 1, 0, -sc, 0, cc]);
      const up = mtv(R, [0, 0, 1]); dots.push(dot(up, e.accg) / (norm(e.accg) + 1e-9));
    }
    if (dots.length > 20) { const m = median(dots); if (Math.abs(m) > 0.5) return [m > 0 ? 1 : -1, "по ориентации телефона"]; }
    const gy = [];
    for (const e of ev) if (e.t >= chest[0] && e.t < chest[1] && fin(e.accg)) gy.push(e.accg[1] / (norm(e.accg) + 1e-9));
    if (gy.length > 10) { const m = median(gy); if (Math.abs(m) > 0.5) return [m > 0 ? 1 : -1, "по позе у груди"]; }
    return [/iPhone|iPad|Macintosh/.test(ua || "") ? -1 : 1, "по модели телефона"];
  }

  // Поворот телефона гироскопом + поправка «где верх» по гравитации. axes — порядок осей вращения, sg — знак.
  function track(ev, sg, axes, kTilt = 0.02) {
    const E = ev.filter(e => isFinite(e.t) && fin(e.accg) && fin(e.rot));
    if (E.length < 10) throw new Error("мало данных датчиков (нужен гироскоп и ускорение)");
    const useA = E.every(e => fin(e.acc));
    const n0 = Math.max(5, E.filter(e => e.t - E[0].t < 0.5).length);
    let up0 = [0, 0, 0]; for (let i = 0; i < n0 && i < E.length; i++) up0 = add(up0, E[i].accg);
    up0 = up0.map(q => q / norm(up0));
    let R = rotTo(up0, [0, 0, 1]);
    const t = [], Rs = [], aw = [], resid = [];
    let wp = null, tp = null;
    for (let i = 0; i < E.length; i++) {
      const e = E[i], w = axes.map(k => e.rot[k] * Math.PI / 180 * sg);
      if (i) {
        const dt = Math.min(0.5, Math.max(0, e.t - tp));
        const c = cross(wp, w), step = w.map((q, k) => 0.5 * (q + wp[k]) * dt + c[k] * dt * dt / 12);
        R = mul(R, expm(step));
      }
      const g = e.accg, gm = norm(g);
      if (Math.abs(gm - G) < 1.0) {
        const upw = mv(R, g.map(q => q / gm));
        resid.push(Math.acos(Math.max(-1, Math.min(1, upw[2]))) * 180 / Math.PI);
        let tg = upw.map((q, k) => q + kTilt * ([0, 0, 1][k] - q)); const n = norm(tg); tg = tg.map(q => q / n);
        R = mul(rotTo(upw, tg), R);
      }
      R = ortho(R);
      t.push(e.t); Rs.push(R);
      aw.push(useA ? mv(R, e.acc) : add(mv(R, g), [0, 0, G], -1));
      wp = w; tp = e.t;
    }
    return { t, Rs, aw, res: resid.length ? median(resid) : 99 };
  }
  function prepare(ev) {
    if (!ev.some(e => fin(e.rot))) throw new Error("нет гироскопа — на этом телефоне игра с движением не работает");
    let best = null;
    for (const axes of [[1, 2, 0], [0, 1, 2]]) for (const sg of [1, -1]) {
      const r = track(ev, sg, axes); r.sg = sg; r.axes = axes;
      if (!best || r.res < best.res) best = r;
    }
    return best;
  }
  // Оси тела: вверх; вперёд — от экрана к спине телефона в позе «у груди, экраном к себе».
  function bodyAxes(t, Rs, chest) {
    let back = [0, 0, 0], n = 0;
    for (let i = 0; i < t.length; i++) if (t[i] >= chest[0] && t[i] < chest[1]) { back = add(back, mv(Rs[i], [0, 0, 1]), -1); n++; }
    if (n) back = back.map(q => q / n);
    back[2] = 0;
    const ok = norm(back) >= 0.3, fwd = ok ? back.map(q => q / norm(back)) : [1, 0, 0], up = [0, 0, 1];
    return { up, fwd, right: cross(fwd, up), ok };
  }
  function gauss(x, sigma) {
    const r = Math.round(4 * sigma), k = []; let s = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * i * i / (sigma * sigma)); k.push(v); s += v; }
    const n = x.length, y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let a = 0; for (let j = -r; j <= r; j++) a += k[j + r] * x[Math.min(n - 1, Math.max(0, i + j))]; y[i] = a / s; }
    return y;
  }
  function interp(xq, xs, ys) {  // xs по возрастанию
    let j = 1; const out = new Float64Array(xq.length);
    for (let i = 0; i < xq.length; i++) {
      const x = xq[i];
      if (x <= xs[0]) { out[i] = ys[0]; continue; }
      if (x >= xs[xs.length - 1]) { out[i] = ys[ys.length - 1]; continue; }
      while (xs[j] < x) j++; while (j > 1 && xs[j - 1] > x) j--;
      const u = (x - xs[j - 1]) / (xs[j] - xs[j - 1]); out[i] = ys[j - 1] + u * (ys[j] - ys[j - 1]);
    }
    return out;
  }
  function phoneAcc(ev, chest) {
    const P = prepare(ev), B = bodyAxes(P.t, P.Rs, chest), t = P.t;
    const cols = [B.up, B.fwd, B.right].map(ax => P.aw.map(a => dot(a, ax)));
    const t0 = t[0], n = Math.floor((t[t.length - 1] - t0) * GRID);
    const tg = new Float64Array(n); for (let i = 0; i < n; i++) tg[i] = t0 + i / GRID;
    const A = cols.map(c => gauss(interp(tg, t, c), 0.05 * GRID));
    const gap = new Uint8Array(n); let j = 1;
    for (let i = 0; i < n; i++) { while (j < t.length - 1 && t[j] < tg[i]) j++; gap[i] = (t[j] - t[j - 1]) > 0.3 ? 1 : 0; }
    return { tg, A, gap, info: { gyro: P.res, fwdOk: B.ok, axes: P.axes.join(""), sg: P.sg } };
  }
  function cardScore(e, m) {  // e, m — [[up, fwd, side], ...]
    let ee = 0, mm = 0, em = 0; const n = e.length;
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ee += e[i][k] * e[i][k]; mm += m[i][k] * m[i][k]; em += e[i][k] * m[i][k]; }
    const re = Math.sqrt(ee / n), rm = Math.sqrt(mm / n), cl = (x) => Math.max(0, Math.min(1, x));
    if (re < HOLD_RMS) return 100 * cl(1 - (rm - 0.8) / 1.5);
    const corr = em / (Math.sqrt(ee * mm) + 1e-9), ratio = rm / re;
    return 100 * cl((corr - 0.2) / 0.5) * cl((ratio - 0.25) / 0.35) * cl((3.5 - ratio) / 1.0);
  }
  const grade = s => { for (const [thr, name, pts] of GRADES) if (s >= thr) return [name, pts]; return ["МИМО", 0]; };

  // Главная: запись + песня + номер танцора (0…) → итог.
  function scoreRecording(rec, song, rate, dancer) {
    const ev = rec.events.map(e => ({ t: e.t, accg: e.accg, acc: e.acc, rot: e.rot, ori: e.ori }));
    const [sign, how] = invertedSign(ev, rec.ua, rec.chest);
    if (sign < 0) for (const e of ev) { if (fin(e.accg)) e.accg = e.accg.map(q => -q); if (fin(e.acc)) e.acc = e.acc.map(q => -q); }
    const ph = phoneAcc(ev, rec.chest), T0 = rec.start || 0;
    const Ef = song.acc[dancer], nE = Ef.length / 3, Ex = [0, 1, 2].map(k => { const a = new Float64Array(nE); for (let i = 0; i < nE; i++) a[i] = Ef[3 * i + k] / 100; return a; });
    const tE = new Float64Array(nE); for (let i = 0; i < nE; i++) tE[i] = i / rate;
    const cards = song.cards.map(c => {
      const ts = []; for (let x = c[0]; x < c[1] - 1e-9; x += 1 / rate) ts.push(x);
      const ex = Ex.map(col => interp(ts, tE, col));
      return { t: c[0], t_hit: c[1], cmd: c[2][dancer], golden: c[3], ts, e: ts.map((_, i) => [ex[0][i], ex[1][i], ex[2][i]]) };
    });
    const tg = ph.tg, g0 = tg[0], gN = tg[tg.length - 1];
    const sample = (tp) => {  // ускорение телефона в моменты tp; null — нет данных
      if (tp[0] < g0 || tp[tp.length - 1] > gN) return "out";
      const out = [];
      for (const x of tp) {
        const u = (x - g0) * GRID, i = Math.min(tg.length - 2, Math.floor(u)), f = u - i;
        if (ph.gap[i] || ph.gap[i + 1]) return null;
        out.push([0, 1, 2].map(k => ph.A[k][i] + f * (ph.A[k][i + 1] - ph.A[k][i])));
      }
      return out;
    };
    let best = null;
    for (const side of [1, -1]) {
      const es = cards.map(c => c.e.map(v => [v[0], v[1], v[2] * side]));
      for (const L of LAGS) {
        let pts = 0; const res = [];
        cards.forEach((c, ci) => {
          let sc = -1;
          for (const dl of LOC) {
            const m = sample(c.ts.map(x => T0 + L + dl + x));
            if (m === "out") { if (sc < 0) sc = -2; continue; }
            if (m) sc = Math.max(sc, cardScore(es[ci], m));
          }
          const [g, p] = sc >= 0 ? grade(sc) : sc === -2 ? ["ВНЕ ЗАПИСИ", 0] : ["НЕТ СВЯЗИ", 0];
          pts += p; res.push({ t: c.t, score: sc < 0 ? null : Math.round(sc), grade: g, golden: c.golden, cmd: c.cmd });
        });
        if (!best || pts > best.pts) best = { pts, res, lag: L, side };
      }
    }
    const counts = {}; for (const [, n] of GRADES) counts[n] = 0; counts["НЕТ СВЯЗИ"] = 0;
    let inRec = 0;
    for (const r of best.res) if (r.grade === "ВНЕ ЗАПИСИ") r.score = null; else { counts[r.grade]++; inRec++; }
    return { points: best.pts, max: inRec * 100, percent: inRec ? Math.round(100 * best.pts / (inRec * 100)) : 0, scored: inRec,
             lag: best.lag, side: best.side, counts, cards: best.res, info: Object.assign(ph.info, { sign: how }) };
  }
  root.DanceScore = { scoreRecording, GRADES };
  if (typeof module !== "undefined") module.exports = root.DanceScore;
})(typeof window !== "undefined" ? window : globalThis);
