// «Танцуй как звезда» — движок оценки v2, порт scoring.py на JavaScript.
// Тот же расчёт: калибровка по трём позам, признаки на сетке 50 Гц, оценка движений
// с античитом (переворот, встряхивание), переучиванием задержки после потерь связи.
// Вход событий — как в tanec.html: {t, accg, acc, rot}; эталон — как в poseref.build_ref.
(function (root) {
  "use strict";

  const RATE = 50;
  const G = 9.81;
  const GRADES = [[85, "PERFECT", 100], [70, "SUPER", 70], [50, "GOOD", 50], [30, "OK", 25], [-1, "МИМО", 0]];

  // ---------- утилиты ----------
  const finite3 = (v) => Array.isArray(v) && v.length === 3 && v.every((q) => q !== null && isFinite(q));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const median = (a) => {
    if (!a.length) return NaN;
    const s = a.slice().sort((p, q) => p - q), m = s.length >> 1;
    return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
  };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length); };

  // ---------- фильтр Баттерворта: коэффициенты совпадают с scipy.signal.butter ----------
  function butterCoeffs(order, fc, fs) {
    const warped = 2 * fs * Math.tan(Math.PI * fc / fs);
    const pr = [], pi = [];
    for (let m = 0; m < order; m++) {
      const th = Math.PI * (2 * m + 1 + order) / (2 * order);
      pr.push(warped * Math.cos(th));
      pi.push(warped * Math.sin(th));
    }
    const T = 1 / fs, h = T / 2;
    const zr = [], zi = [];
    for (let m = 0; m < order; m++) {
      const a = 1 + pr[m] * h, b = pi[m] * h, c = 1 - pr[m] * h, d = -pi[m] * h;
      const den = c * c + d * d;
      zr.push((a * c + b * d) / den);
      zi.push((b * c - a * d) / den);
    }
    // знаменатель: полином ∏(1 − z_m z⁻¹) — с комплексными промежуточными значениями
    let ar = [1], ai2 = [0];
    for (let m = 0; m < order; m++) {
      const nr = ar.slice(), ni = ai2.slice();
      nr.push(0); ni.push(0);
      for (let k = 1; k <= m + 1; k++) {
        nr[k] -= ar[k - 1] * zr[m] - ai2[k - 1] * zi[m];
        ni[k] -= ar[k - 1] * zi[m] + ai2[k - 1] * zr[m];
      }
      ar = nr; ai2 = ni;
    }
    const a = ar;
    // числитель: b_k = C·binom(n,k), НКЧ-усиление = 1 → C = sum(a)/2^n
    const asum = a.reduce((x, y) => x + y, 0);
    const C = asum / Math.pow(2, order);
    const b = [];
    let choose = 1;
    for (let k = 0; k <= order; k++) {
      b.push(C * choose);
      choose = choose * (order - k) / (k + 1);
    }
    return { b, a };
  }
  const _filtCache = new Map();
  function _filtCoeffs(order, fc, fs) {
    const key = `${order}/${fc}/${fs}`;
    if (!_filtCache.has(key)) _filtCache.set(key, butterCoeffs(order, fc, fs));
    return _filtCache.get(key);
  }
  // прямая форма II (как scipy.signal.lfilter): состояние z длины n,
  // y = b0·x + z0;  z0 ← b1·x + z1 − a1·y;  z1 ← b2·x − a2·y
  function df2(coef, x, zi) {
    const { b, a } = coef, n = b.length - 1;
    const N = x.length;
    const y = new Array(N);
    const z = zi ? zi.slice() : new Array(n).fill(0);
    for (let i = 0; i < N; i++) {
      const xi = x[i];
      let yi = b[0] * xi + z[0];
      for (let k = 1; k < n; k++) z[k - 1] = b[k] * xi + z[k] - a[k] * yi;
      z[n - 1] = b[n] * xi - a[n] * yi;
      y[i] = yi;
    }
    return y;
  }
  // lfilter с нулевым состоянием (как scipy.signal.lfilter без zi)
  function lfilterCoef(coef, x) { return df2(coef, x, null); }
  // установившееся состояние для постоянного входа c: z = c·[1−b0, b2−a2, …]
  function steadyZi(coef, c) {
    const { b, a } = coef, n = b.length - 1;
    // установившееся состояние DF2 для постоянного входа c (совпадает с lfilter_zi):
    // z0 = c·(1−b0);  z_k = c·Σ_{j>k}(b_j − a_j) для k ≥ 1
    const z = new Array(n).fill(0);
    let acc2 = 0;
    for (let k = n; k >= 2; k--) { acc2 += b[k] - a[k]; z[k - 1] = c * acc2; }
    z[0] = c * (1 - b[0]);
    return z;
  }
  // как scipy.signal.filtfilt: «odd»-отражение краёв (padlen = 3·max(len(a),len(b))),
  // оба прохода — DF2 с установившимся состоянием от первого отсчёта
  function filtfiltCoef(coef, x) {
    const pl = 3 * Math.max(coef.a.length, coef.b.length);
    const n = x.length;
    if (n <= pl) return df2(coef, df2(coef, x.slice().reverse(), steadyZi(coef, x[x.length - 1])).reverse(), steadyZi(coef, x[0])).reverse();
    const ext = [];
    for (let i = pl; i >= 1; i--) ext.push(2 * x[0] - x[i]);
    for (let i = 0; i < n; i++) ext.push(x[i]);
    for (let i = 1; i <= pl; i++) ext.push(2 * x[n - 1] - x[n - 1 - i]);
    // как scipy: оба прохода по полному дополненному сигналу,
    // обратный проход — от последнего отсчёта прямого
    const y0 = df2(coef, ext, steadyZi(coef, ext[0]));
    const y0last = y0[y0.length - 1];
    const y1 = df2(coef, y0.slice().reverse(), steadyZi(coef, y0last)).reverse();
    return y1.slice(pl, pl + n);
  }
  const lowpass = (x, fc, fs = RATE) => lfilterCoef(_filtCoeffs(2, fc, fs), x);

  // ---------- интерполяция на сетку (как np.interp) ----------
  function interpGrid(t, v, grid) {
    const out = new Array(grid.length);
    let j = 1;
    for (let i = 0; i < grid.length; i++) {
      const x = grid[i];
      if (x <= t[0]) { out[i] = v[0]; continue; }
      if (x >= t[t.length - 1]) { out[i] = v[v.length - 1]; continue; }
      while (t[j] < x) j++;
      while (j > 1 && t[j - 1] > x) j--;
      const u = (x - t[j - 1]) / (t[j] - t[j - 1]);
      out[i] = v[j - 1] + u * (v[j] - v[j - 1]);
    }
    return out;
  }

  // ---------- поворот (Родриг) ----------
  function rotV(g, v) {
    const c = cross(g, v);
    const k = cross(g, c);
    return [v[0] + c[0] + k[0], v[1] + c[1] + k[1], v[2] + c[2] + k[2]];
  }

  // ---------- события ----------
  function toEvents(ev) {
    const t = Array.from(ev.t, Number);
    const n = t.length;
    const og = [], oa = [], or_ = [];
    for (let i = 0; i < n; i++) {
      og.push(ev.accg[i] ? [Number(ev.accg[i][0]), Number(ev.accg[i][1]), Number(ev.accg[i][2])] : [NaN, NaN, NaN]);
      oa.push(ev.acc && ev.acc[i] ? [Number(ev.acc[i][0]), Number(ev.acc[i][1]), Number(ev.acc[i][2])] : null);
      or_.push(ev.rot[i] ? [Number(ev.rot[i][0]), Number(ev.rot[i][1]), Number(ev.rot[i][2])] : [NaN, NaN, NaN]);
    }
    if (ev.acc && oa.filter((q) => q !== null).length / n < 0.5) {
      for (let i = 0; i < n; i++) oa[i] = null;
    }
    return { t, accg: og, acc: ev.acc ? oa : null, rot: or_ };
  }
  function cleanEvents(ev) {
    const keep = [];
    for (let i = 0; i < ev.t.length; i++) {
      if (isFinite(ev.t[i]) && finite3(ev.accg[i]) && finite3(ev.rot[i])) keep.push(i);
    }
    const t = [], accg = [], acc = ev.acc ? [] : null, rot = [];
    for (const i of keep) {
      t.push(ev.t[i]); accg.push(ev.accg[i]);
      if (acc) acc.push(ev.acc[i]);
      rot.push(ev.rot[i]);
    }
    // сортировка (стабильная), одинаковые времена — один замер
    const idx = t.map((_, i) => i).sort((a, b) => t[a] - t[b]);
    const t2 = [], accg2 = [], acc2 = acc ? [] : null, rot2 = [];
    for (const i of idx) {
      if (t2.length && t[i] - t2[t2.length - 1] <= 1e-6) continue;
      t2.push(t[i]); accg2.push(accg[i]);
      if (acc2) acc2.push(acc[i]);
      rot2.push(rot[i]);
    }
    return { t: t2, accg: accg2, acc: acc2, rot: rot2 };
  }
  function fillAccHoles(ev) {
    if (!ev.acc) return null;
    const n = ev.t.length, fin = ev.acc.map(finite3);
    if (fin.every(Boolean)) return ev.acc.map((q) => q.slice());
    let longest = 0, i = 0;
    while (i < n) {
      if (!fin[i]) {
        let j = i;
        while (j < n && !fin[j]) j++;
        longest = Math.max(longest, ev.t[Math.min(j, n - 1)] - ev.t[Math.max(i - 1, 0)]);
        i = j;
      } else i++;
    }
    if (fin.filter(Boolean).length < 2 || longest > 0.2) return null;
    const out = [];
    for (let k = 0; k < 3; k++) {
      const tt = [], vv = [];
      for (let q = 0; q < n; q++) if (fin[q]) { tt.push(ev.t[q]); vv.push(ev.acc[q][k]); }
      out.push(interpGrid(tt, vv, ev.t));
    }
    return ev.t.map((_, q) => [out[0][q], out[1][q], out[2][q]]);
  }

  // ---------- калибровка ----------
  function angleDeg(a, b) {
    const c = Math.max(-1, Math.min(1, dot(a, b) / ((norm(a) * norm(b)) + 1e-9)));
    return Math.acos(c) * 180 / Math.PI;
  }
  function calibrate(evRaw, prompts = [0.0, 2.5, 5.0]) {
    const ev0 = cleanEvents(toEvents(evRaw));
    const fail = (why) => ({ ok: false, why, f: [0, 1, 0], n: [0, 0, 1] });
    if (ev0.t.length < 30) return fail(["телефон не присылает данные датчиков"]);
    const t = ev0.t, g = ev0.accg, r = ev0.rot;
    if (t.length < 10 || t[t.length - 1] - t[0] < 1.0) return fail(["телефон прислал слишком мало данных — повтори калибровку"]);
    const w = Math.max(1, Math.round(0.2 * t.length / Math.max(1e-6, t[t.length - 1] - t[0])));
    const gs = g.map((_, i) => {
      const s = [0, 0, 0];
      let c = 0;
      for (let k = Math.max(0, i - (w >> 1)); k < Math.min(t.length, i + (w >> 1) + 1); k++) {
        s[0] += g[k][0]; s[1] += g[k][1]; s[2] += g[k][2]; c++;
      }
      return [s[0] / c, s[1] / c, s[2] / c];
    });
    const gu = gs.map((q) => { const n2 = norm(q) + 1e-9; return [q[0] / n2, q[1] / n2, q[2] / n2]; });
    const still = new Array(t.length).fill(false);
    for (let i = 0; i < t.length; i++) {
      let j = 0;
      while (j < t.length - 1 && t[j] < t[i] + 0.4) j++;
      const drift = Math.acos(Math.max(-1, Math.min(1, dot(gu[i], gu[j])))) * 180 / Math.PI;
      still[i] = Math.abs(norm(g[i]) - G) < 0.8 && drift < 5;
    }
    const names = ["рука вниз", "рука вверх", "рука в сторону"];
    const segs = [], why = [];
    let cursor = 0.0, sideBad = null;
    for (let k = 0; k < 3; k++) {
      let found = null;
      let i = 0;
      while (i < t.length && t[i] < Math.max(prompts[k] + 0.2, cursor)) i++;
      while (i < t.length) {
        if (!still[i]) { i++; continue; }
        let j = i;
        while (j < t.length && still[j]) j++;
        if (t[j - 1] - t[i] >= 0.5) {
          const v = [0, 0, 0];
          for (let q = i; q < j; q++) { v[0] += g[q][0]; v[1] += g[q][1]; v[2] += g[q][2]; }
          v[0] /= (j - i); v[1] /= (j - i); v[2] /= (j - i);
          const good = k === 0 ? true
            : k === 1 ? angleDeg(v, segs[0][0]) > 60
              : 55 <= angleDeg(v, segs[0][0]) && angleDeg(v, segs[0][0]) <= 125 && angleDeg(v, segs[1][0]) > 25;
          if (good) { found = [v, i, j]; break; }
          if (k === 2 && angleDeg(v, segs[1][0]) > 25) sideBad = angleDeg(v, segs[0][0]);
        }
        i = j;
      }
      if (!found) {
        why.push(k === 2 && sideBad !== null
          ? `рука не в сторону: вытяни руку горизонтально в сторону и замри (сейчас ${sideBad.toFixed(0)}° от «рука вниз», нужно 55–125°)`
          : `не дождались позы «${names[k]}» — замри на секунду`);
        break;
      }
      segs.push(found); cursor = t[found[2] - 1];
      if (k === 1 && angleDeg(segs[0][0], found[0]) < 140) {
        why.push(`не получилось: на первом шаге рука должна свободно висеть вдоль тела, на втором — прямо вверх, одним движением за 1–2 секунды (сейчас разница ${angleDeg(segs[0][0], found[0]).toFixed(0)}°, нужно ≥140°)`);
        break;
      }
    }
    let ok = segs.length === 3 && why.length === 0;
    if (ok) {
      const a01 = angleDeg(segs[0][0], segs[2][0]);
      if (!(55 <= a01 && a01 <= 125)) { ok = false; why.push(`рука не в сторону (угол ${a01.toFixed(0)}°)`); }
    }
    if (!ok) return fail(why);
    const dn = segs[0][0], up = segs[1][0], sd = segs[2][0];
    let rotScale = 1.0;
    const a = segs[0][2] - 1, b = segs[1][1];
    let turned = 0;
    if (b > a) for (let i = a; i < b; i++) turned += norm(r[i]) * (t[i + 1] - t[i]);
    const ratio = turned / Math.max(1.0, angleDeg(g[a], g[b]));
    if (ratio < 0.05) rotScale = 57.2958;
    else if (ratio > 0.5) rotScale = 1.0;
    else return fail(["не получилось распознать поворот руки — повтори: рука вниз, замри, потом плавно вверх"]);
    const f = [up[0] - dn[0], up[1] - dn[1], up[2] - dn[2]];
    const nf = norm(f);
    f[0] /= nf; f[1] /= nf; f[2] /= nf;
    const proj = dot(sd, f);
    const s = [sd[0] - proj * f[0], sd[1] - proj * f[1], sd[2] - proj * f[2]];
    const ns = norm(s) + 1e-9;
    const nn = cross(f, [s[0] / ns, s[1] / ns, s[2] / ns]);
    return { ok: true, why: [], f, n: nn, up_angle: angleDeg(dn, up), rot_scale: rotScale, rot_ratio: ratio };
  }

  // ---------- признаки ----------
  function phoneFeatures(evRaw, logic, calib) {
    const ev = cleanEvents(toEvents(evRaw));
    if (!ev.rot.some(finite3)) throw new Error("нет гироскопа — на этом телефоне игра с движением не работает");
    const accFilled = fillAccHoles(ev);
    const n = ev.t.length;
    const grid = [];
    for (let x = Math.ceil(ev.t[0] * RATE) / RATE; x < ev.t[n - 1]; x += 1 / RATE) grid.push(Math.round(x * RATE) / RATE);
    if (grid.length < 50) return null;
    const accg = [0, 1, 2].map((k) => lowpass(interpGrid(ev.t, ev.accg.map((q) => q[k]), grid), 10));
    const scale = (calib && calib.rot_scale) || 1.0;
    // как в scoring.py: гироскоп НЕ сглаживается на 10 Гц
    const rot = [0, 1, 2].map((k) => interpGrid(ev.t, ev.rot.map((q) => q[k] * scale), grid));
    let acc = null, grav = null;
    if (logic === "v2" && accFilled) {
      acc = [0, 1, 2].map((k) => lowpass(interpGrid(ev.t, accFilled.map((q) => q[k]), grid), 10));
      grav = accg.map((col, k) => col.map((q, i) => q - acc[k][i]));
    } else if (logic === "v1") {
      grav = accg.map((col) => lowpass(col, 0.5));
      acc = accg.map((col, k) => col.map((q, i) => q - grav[k][i]));
    } else {
      // комплементарный фильтр: гироскоп + медленная поправка (точный поворот Родрига)
      grav = accg.map(() => new Array(grid.length).fill(0));
      acc = accg.map(() => new Array(grid.length).fill(0));
      let gvec = [accg[0][0], accg[1][0], accg[2][0]];
      for (let i = 0; i < grid.length; i++) {
        if (i > 0) {
          const w = rot.map((col) => col[i] * Math.PI / 180 / RATE);
          const th = norm(w);
          if (th > 1e-9) gvec = rotV(w.map((q) => q / th), gvec);
          const gm = Math.hypot(accg[0][i], accg[1][i], accg[2][i]);
          const calm = Math.abs(gm - G) < 1.5;
          const a2 = calm ? 0.04 : 0.003;
          gvec = gvec.map((q, k2) => (1 - a2) * q + a2 * accg[k2][i]);
        }
        grav[0][i] = gvec[0]; grav[1][i] = gvec[1]; grav[2][i] = gvec[2];
        for (let k2 = 0; k2 < 3; k2++) acc[k2][i] = accg[k2][i] - gvec[k2];
      }
    }
    if (logic === "v2") {
      const b2 = _filtCoeffs(2, 2.5, RATE);
      acc = acc.map((col) => filtfiltCoef(b2, col));
      grav = grav.map((col) => filtfiltCoef(b2, col));
    }
    const gn = grav[0].map((_, i) => {
      const n2 = Math.hypot(grav[0][i], grav[1][i], grav[2][i]) + 1e-9;
      return [grav[0][i] / n2, grav[1][i] / n2, grav[2][i] / n2];
    });
    const vert = acc[0].map((_, i) => acc[0][i] * gn[i][0] + acc[1][i] * gn[i][1] + acc[2][i] * gn[i][2]);
    const side = acc[0].map((_, i) => Math.hypot(
      acc[0][i] - vert[i] * gn[i][0], acc[1][i] - vert[i] * gn[i][1], acc[2][i] - vert[i] * gn[i][2]));
    let mag, gyro;
    if (logic === "v1") {
      mag = acc[0].map((_, i) => Math.hypot(acc[0][i], acc[1][i], acc[2][i]));
      gyro = rot[0].map((_, i) => Math.hypot(rot[0][i], rot[1][i], rot[2][i]));
    } else {
      mag = vert.map((q, i) => Math.hypot(q, side[i]));
      const w2 = calib ? rot[0].map((_, i) => rot[0][i] * calib.n[0] + rot[1][i] * calib.n[1] + rot[2][i] * calib.n[2]) : rot[2];
      gyro = filtfiltCoef(_filtCoeffs(2, 2.5, RATE), w2).map(Math.abs);
    }
    const F = { t: grid, vert, side, mag, gyro, valid: null };
    const valid = new Array(grid.length).fill(0);
    let j = 1;
    for (let i = 0; i < grid.length; i++) {
      while (j < n - 1 && ev.t[j] < grid[i]) j++;
      const d = Math.min(Math.abs(ev.t[j] - grid[i]), Math.abs(ev.t[j - 1] - grid[i]));
      valid[i] = d <= 0.12 ? 1 : 0;
    }
    F.valid = valid;
    if (logic === "v2" && calib) {
      F.tilt = gn.map((q) => Math.acos(Math.max(-1, Math.min(1, -dot(q, calib.f)))) * 180 / Math.PI);
    }
    return F;
  }

  // ---------- оценка ----------
  function grade(s) {
    if (s === null || !isFinite(s)) s = 0.0;
    for (const [thr, name, pts] of GRADES) if (s >= thr) return [name, pts];
    return ["МИМО", 0];
  }
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
  function peaks(x) {
    // как scipy.signal.find_peaks(x, prominence=0.3·max, distance=0.15·RATE)
    let mx = -Infinity;
    for (const q of x) if (q > mx) mx = q;
    if (mx <= 0) return [];
    const thr = 0.3 * mx, minD = Math.round(0.15 * RATE), n = x.length;
    const cand = [];
    for (let i = 1; i < n - 1; i++) {
      if (!(x[i] > x[i - 1] && x[i] >= x[i + 1])) continue;
      let j = i;
      while (j + 1 < n && x[j + 1] === x[i]) j++;
      const mid = (i + j) >> 1;
      let lmin = x[mid];
      for (let k = mid - 1; k >= 0; k--) { lmin = Math.min(lmin, x[k]); if (x[k] > x[mid]) break; }
      let rmin = x[mid];
      for (let k = mid + 1; k < n; k++) { rmin = Math.min(rmin, x[k]); if (x[k] > x[mid]) break; }
      const prom = x[mid] - Math.max(lmin, rmin);
      if (prom >= thr) cand.push([mid, prom]);
    }
    cand.sort((a, b) => x[b[0]] - x[a[0]]);
    const keep = [];
    for (const [i] of cand) {
      let okD = true;
      for (const q of keep) if (Math.abs(q - i) < minD) { okD = false; break; }
      if (okD) keep.push(i);
    }
    return keep.sort((a, b) => a - b);
  }
  function hfShare(x) {
    // как в scoring.py: доля энергии >4 Гц в |rfft(x·hanning)|², сетка 50 Гц
    const n = x.length;
    const meanv = x.reduce((a, b) => a + b, 0) / n;
    const w = x.map((q, i) => (q - meanv) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))));
    const sp2 = (k) => {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) {
        const ang = -2 * Math.PI * k * i / n;
        re += w[i] * Math.cos(ang);
        im += w[i] * Math.sin(ang);
      }
      return re * re + im * im;
    };
    let hi = 0, lo = 0;
    for (let k = 1; k <= (n >> 1); k++) {
      const f = k * RATE / n;
      const p = sp2(k);
      if (f > 4) hi += p;
      if (f > 0.5) lo += p;
    }
    return hi / (lo + 1e-9);
  }
  function pairs(x) {
    if (x == null) return [];
    const out = [];
    const push = (p) => {
      try {
        const a = Number(p[0]), b = Number(p[1]);
        if (isFinite(a) && isFinite(b)) out.push([a, b]);
      } catch (e) { }
    };
    if (Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === "number")) push(x);
    else for (const p of x || []) push(p);
    return out.sort((a, b) => a[0] - b[0]);
  }

  class Scorer {
    constructor(ref, moves, logic, jumps, syncGaps) {
      this.ref = ref; this.moves = moves; this.logic = logic;
      this.lagHist = []; this.lagT = [];
      this.badRun = 0; this.relearns = 0; this.maxLag = 0.6;
      this.jumps = pairs(jumps);
      this.extra = 0.0;
      this.probe = [];
      this.flip = false;
      this.flipVotes = [];
      this.followD = []; this.followDt = [];
      this.followT = [];
      this.probeWin = null;
      this.levelD = [];
      this.followV = []; this.followU = [];
      this.follow = [];
      this.allowRelearn = true;
      this.syncGaps = pairs(syncGaps).filter(([a, b]) => b >= a);
      this.frozen = false;
      this.done = [];
      this.shiftFrom = null;
      this.events = [];
    }
    offset(s) { return this.extra + this.jumps.filter(([vt]) => s >= vt).reduce((a, [, d]) => a + d, 0); }
    window(F, key, s, e, lag) {
      const g = F.t, t50 = this.ref.t50;
      const tq = [];
      for (const q of t50) if (q >= s && q < e) tq.push(q + lag + (this.logic === "v2" ? this.offset(s) : 0));
      if (!tq.length || tq[0] < g[0] || tq[tq.length - 1] > g[g.length - 1]) return null;
      const v = interpGrid(g, F[key], tq);
      if (key === "tilt" && this.flip) return v.map((q) => 180.0 - q);
      return v;
    }
    cover(F, s, e, lag) {
      const v = this.window(F, "valid", s, e, lag);
      return v === null ? 0.0 : v.reduce((a, b) => a + b, 0) / v.length;
    }
    lagRange() {
      if (this.logic === "v1") { const r = []; for (let x = -0.25; x <= 0.2501; x += 0.02) r.push(x); return r; }
      if (this.lagHist.length >= 4) {
        const c = median(this.lagHist.slice(-8));
        const out = [];
        for (let x = Math.max(-0.1, c - 0.15); x <= Math.min(this.maxLag, c + 0.15) + 1e-6; x += 0.02) out.push(Math.round(x * 100) / 100);
        return out;
      }
      const out = [];
      for (let x = -0.1; x <= this.maxLag + 1e-6; x += 0.02) out.push(Math.round(x * 100) / 100);
      return out;
    }
    bestLag(F, m, lags, idx) {
      const R = this.ref;
      const rv = idx.map((i) => R.vert[i]), rm = idx.map((i) => R.mag[i]),
        rg = idx.map((i) => R.gyro[i]),
        rt = R.tilt ? idx.map((i) => R.tilt[i]) : idx.map(() => NaN);
      const s = m.start, e = m.end;
      let best = [-9, null];
      for (const lag of lags) {
        if (this.logic === "v2" && this.cover(F, s, e, lag) < 0.8) continue;
        const gv = this.window(F, "vert", s, e, lag);
        const gm = this.window(F, "mag", s, e, lag);
        if (gv === null) continue;
        let r;
        if (this.logic === "v1") {
          r = (pearson(rv, gv) + pearson(rm, gm)) / 2;
        } else {
          const M = (x) => Math.max(0, Math.min(1, (x - 0.15) / 0.6));
          const gg = this.window(F, "gyro", s, e, lag);
          const parts = [[0.30, M(pearson(rv, gv))], [0.10, M(pearson(rm, gm))],
            [0.15, rg.every(isFinite) ? M(pearson(rg, gg)) : 0.0]];
          const gt = F.tilt && R.tilt && rt.every(isFinite) ? this.window(F, "tilt", s, e, lag) : null;
          if (gt !== null && rt.every(isFinite)) {
            let d = 0;
            for (let i = 0; i < rt.length; i++) d += Math.abs(rt[i] - gt[i]);
            let ts = Math.max(0, Math.min(1, (55 - d / rt.length) / 35));
            ts *= Math.max(0, Math.min(1, (pearson(rv, gv) + 0.1) / 0.3));
            parts.push([0.45, ts]);
          }
          const wsum = parts.reduce((a, [w]) => a + w, 0);
          r = 0.15 + 0.6 * parts.reduce((a, [w, v]) => a + w * v, 0) / wsum;
        }
        if (r > best[0]) best = [r, lag];
      }
      return best;
    }
    finish(F, m, idx, r, lag) {
      const R = this.ref;
      const rm = idx.map((i) => R.mag[i]);
      const gm = this.window(F, "mag", m.start, m.end, lag);
      const shape = Math.max(0, Math.min(1, (r - 0.15) / 0.6)) * 100;
      const rp = peaks(rm), gp = peaks(gm);
      const tol = Math.round((this.logic === "v1" ? 0.12 : 0.15) * RATE);
      let hit = 0;
      for (const p of rp) {
        let d = Infinity;
        for (const q of gp) d = Math.min(d, Math.abs(q - p));
        if (gp.length && d <= tol) hit++;
      }
      const recall = rp.length ? hit / rp.length : 1.0;
      let rhythm;
      if (this.logic === "v1") rhythm = recall * 100;
      else {
        let hitg = 0;
        for (const p of gp) {
          let d = Infinity;
          for (const q of rp) d = Math.min(d, Math.abs(q - p));
          if (rp.length && d <= tol) hitg++;
        }
        const prec = gp.length ? hitg / gp.length : 0.0;
        rhythm = (prec + recall > 0 ? 2 * prec * recall / (prec + recall) : 0) * 100;
      }
      const rmSq = rm.reduce((a, q) => a + q * q, 0) / rm.length;
      const gmSq = gm.reduce((a, q) => a + q * q, 0) / gm.length;
      const ratio = Math.sqrt(gmSq) / (Math.sqrt(rmSq) + 1e-9);
      const [lo, hi] = this.logic === "v1" ? [0.5, 2.0] : [0.6, 2.2];
      let strength;
      if (lo <= ratio && ratio <= hi) strength = 100.0;
      else if (ratio < lo) strength = Math.max(0, Math.min(1, (ratio - 0.15) / (lo - 0.15))) * 100;
      else strength = Math.max(50, Math.min(100, 100 - (ratio - hi) * 25));
      let total;
      if (this.logic === "v1") {
        total = 0.5 * shape + 0.3 * rhythm + 0.2 * strength;
        if (ratio > 3 && shape < 50) total = Math.min(total, 49);
      } else {
        total = shape * (0.55 + 0.45 * (0.6 * rhythm + 0.4 * strength) / 100);
        if (ratio < 0.2) total = 0.0;
        if (hfShare(gm) - hfShare(rm) > 0.25) total = Math.min(total, 25);
      }
      return { total, shape, rhythm, strength, lag, ratio, r, kind: "move" };
    }
    scoreMove(F, m) {
      const R = this.ref, t50 = this.ref.t50;
      const s = m.start, e = m.end;
      const idx = [];
      for (let i = 0; i < t50.length; i++) if (t50[i] >= s && t50[i] < e) idx.push(i);
      if (idx.length < 10) return null;
      const rv = idx.map((i) => R.vert[i]), rm = idx.map((i) => R.mag[i]);
      if (!(rv.every(isFinite) && rm.every(isFinite))) return null;
      const lags = this.lagRange();
      if (this.logic === "v2") {
        const off = this.offset(s);
        if (F.t[0] > s + off + Math.min(...lags) + 0.1 || F.t[F.t.length - 1] < e + off + Math.max(...lags) - 0.1) return null;
        let mx = 0;
        for (const l of lags) mx = Math.max(mx, this.cover(F, s, e, l));
        if (mx < 0.8) return { total: 0.0, shape: 0, rhythm: 0, strength: 0, lag: median(lags), kind: "nodata" };
      }
      if (this.logic === "v2" && m.kind === "hold") {
        if (!F.tilt) return null;
        const lc = median(lags);
        if (this.cover(F, s, e, lc) < 0.8) return { total: 0.0, shape: 0, rhythm: 0, strength: 0, lag: lc, kind: "nodata" };
        const gt = this.window(F, "tilt", s, e, lc), gm = this.window(F, "mag", s, e, lc);
        const rt = idx.map((i) => R.tilt[i]);
        let d = 0;
        for (let i = 0; i < rt.length; i++) d += Math.abs(rt[i] - gt[i]);
        let tiltS = Math.max(0, Math.min(1, (40 - d / rt.length) / 25)) * 100;
        tiltS *= this.followGate(s);
        const aidx = [];
        for (let i = 0; i < t50.length; i++) if (t50[i] >= s - 4.0 && t50[i] < s) aidx.push(i);
        const ga = this.window(F, "mag", s - 4.0, s, lc);
        const gt4 = this.window(F, "tilt", s - 4.0, e, lc);
        const moved = gt4 !== null && gt4.length > 5 && (Math.max(...gt4) - Math.min(...gt4)) >= 20;
        if (ga !== null && aidx.length > 20 && !moved) {
          const rm2 = aidx.map((i) => R.mag[i]);
          const act = Math.sqrt(ga.reduce((a, q) => a + q * q, 0) / ga.length) /
            Math.max(1e-6, Math.sqrt(rm2.reduce((a, q) => a + q * q, 0) / rm2.length));
          tiltS *= Math.max(0, Math.min(1, (act - 0.15) / 0.3));
        }
        const gmSq = gm.reduce((a, q) => a + q * q, 0) / gm.length;
        const rmSq = rm.reduce((a, q) => a + q * q, 0) / rm.length;
        const calm = Math.max(0, Math.min(1, 1 - (Math.sqrt(gmSq) - 3 * Math.sqrt(rmSq) - 2) / 8)) * 100;
        const total = tiltS > 0 ? 0.75 * tiltS + 0.25 * calm : 0.0;
        return { total, shape: tiltS, rhythm: calm, strength: null, lag: lc, kind: "hold" };
      }
      const [r, lag] = this.bestLag(F, m, lags, idx);
      if (lag === null) return null;
      const res = this.finish(F, m, idx, r, lag);
      if (this.logic === "v2") {
        res.cov = this.cover(F, s, e, lag);
        if (!this.frozen) {
          this.done.push([m, idx, res.total]);
          this._learn(F, m, idx, res);
        }
      }
      return res;
    }
    followGate() {
      const f = this.follow.concat(this.followU);
      if (f.length < 3) return 1.0;
      const c = median(f) * (this.flip ? -1 : 1);
      return Math.max(0, Math.min(1, c / 0.2));
    }
    _relearnWindow(s) {
      const c = [];
      for (const [g0] of this.syncGaps) if (g0 - 1.0 <= s && s <= g0 + 26.0) c.push(g0 - 1.0);
      for (const [vt] of this.jumps) if (vt - 1.0 <= s && s <= vt + 26.0) c.push(vt - 1.0);
      return c.length ? Math.max(...c) : null;
    }
    _win0(win) {
      const w = [];
      for (const [g0] of this.syncGaps) if (g0 - 1.0 <= win + 1.0 && win + 1.0 <= g0 + 26.0) w.push(g0 - 1.0);
      return w.length ? Math.min(...w) : win;
    }
    _gapCap(win) {
      let cap = 0.0;
      for (const [g0, g1] of this.syncGaps) if (g0 - 1.0 <= win + 1.0 && win + 1.0 <= g1 + 26.0) cap = Math.max(cap, (g1 - g0) + 0.35);
      for (const [vt, d] of this.jumps) if (vt - 1.0 <= win + 1.0 && win + 1.0 <= vt + 26.0) cap = Math.max(cap, Math.abs(d) + 0.35);
      return cap;
    }
    _shiftPlausible(F, dsh, c, fl, win) {
      const capj = Math.max(0, ...this.jumps.filter(([vt]) => vt - 1.0 <= win + 1.0 && win + 1.0 <= vt + 26.0).map(([, d]) => Math.abs(d) + 0.35));
      if (capj && !this.syncGaps.some(([g0, g1]) => g0 - 1.0 <= win + 1.0 && win + 1.0 <= g1 + 26.0) && Math.abs(dsh) > capj) return false;
      const act = this.syncGaps.filter(([g0, g1]) => g0 - 1.0 <= win + 1.0 && win + 1.0 <= g1 + 26.0 || g0 - 1.0 <= this._win0(win) && this._win0(win) <= g1 + 26.0)
        .reduce((a, [g0, g1]) => a + (g1 - g0), 0);
      const capg = act ? act + 0.12 - Math.max(0.0, this.extra) : 0.0;
      if (dsh > 0 && act && dsh > Math.max(capg, capj || 0)) return false;
      if (!capj && dsh < 0 && this.extra + dsh < -0.15) return false;
      const before = this.done.filter((d) => d[0].end < win);
      if (!capj && (before.length < 3 || median(before.slice(-4).map((d) => d[2])) < 25)) return false;
      const post = this.done.filter((d) => d[0].start >= win).slice(-10);
      if (post.length >= 3) {
        const save = this.flip;
        const pc = [], pn = [];
        for (const [pm] of post) {
          const pidx = [];
          for (let i = 0; i < this.ref.t50.length; i++) if (this.ref.t50[i] >= pm.start && this.ref.t50[i] < pm.end) pidx.push(i);
          pc.push(this.bestLag(F, pm, this.lagRange(), pidx)[0]);
          this.flip = fl;
          pn.push(this.bestLag(F, pm, [c + dsh], pidx)[0]);
          this.flip = save;
        }
        const pc2 = pc.filter((x) => x > -9), pn2 = pn.filter((x) => x > -9);
        if (pc2.length && pn2.length && mean(pn2) < mean(pc2) + 0.03) return false;
      }
      const prev = this.done.filter((d) => d[0].end < win).slice(-3);
      if (prev.length < 2) return true;
      const save = this.flip;
      const rc = [], rn = [];
      for (const [pm] of prev) {
        const pidx = [];
        for (let i = 0; i < this.ref.t50.length; i++) if (this.ref.t50[i] >= pm.start && this.ref.t50[i] < pm.end) pidx.push(i);
        rc.push(this.bestLag(F, pm, this.lagRange(), pidx)[0]);
        this.flip = fl;
        rn.push(this.bestLag(F, pm, [c + dsh], pidx)[0]);
        this.flip = save;
      }
      const rc2 = rc.filter((x) => x > -9), rn2 = rn.filter((x) => x > -9);
      return !(rc2.length && rn2.length && mean(rn2) >= mean(rc2) + 0.05);
    }
    _learn(F, m, idx, res) {
      if (m.kind !== "hold" && F.tilt && this.ref.tilt && idx.every((i) => isFinite(this.ref.tilt[i]))) {
        const gt0 = this.window(F, "tilt", m.start, m.end, res.lag);
        const rt0 = idx.map((i) => this.ref.tilt[i]);
        const w_ = this._relearnWindow(m.start);
        const unsure = w_ !== null && !(this.shiftFrom !== null && this.shiftFrom >= w_);
        const corrS = (a, b) => pearson(a, b) * (this.flip ? -1 : 1);
        if (gt0 !== null && gt0.length === rt0.length && std(gt0) > 3 && std(rt0) > 3 && unsure) {
          this.followU.push(corrS(gt0, rt0));
        }
        if (gt0 !== null && gt0.length === rt0.length && std(gt0) > 3 && std(rt0) > 3 && !unsure) {
          this.follow.push(corrS(gt0, rt0));
          this.followT.push(m.start);
          const okD = res.ratio >= 0.5 && res.ratio <= 2.0 && res.rhythm >= 50 &&
            hfShare(this.window(F, "mag", m.start, m.end, res.lag)) - hfShare(idx.map((i) => this.ref.mag[i])) <= 0.15;
          if (okD) {
            this.followD.push(this.follow[this.follow.length - 1]);
            this.followDt.push(m.start);
            const mg = this.flip ? 180 - mean(gt0) : mean(gt0);
            const mr = mean(rt0);
            this.levelD.push(Math.abs(mr - mg) - Math.abs(mr - (180 - mg)));
          }
          const gv0 = this.window(F, "vert", m.start, m.end, res.lag);
          if (gv0 !== null && pearson(idx.map((i) => this.ref.vert[i]), gv0) > 0.3) this.followV.push(this.follow[this.follow.length - 1]);
          if (!this.flip && this.followV.length >= 4 && median(this.followV.slice(0, 12)) < -0.3) {
            this.flip = true; this.lagHist = []; this.lagT = []; this.events.push(["flip", m.start]);
          } else if (!this.flip && this.followD.length >= 5 && mean(this.followD.slice(0, 12)) < -0.2 && mean(this.levelD.slice(0, 12)) > 8) {
            this.flip = true; this.lagHist = []; this.lagT = []; this.events.push(["flip", m.start]);
          }
        }
      }
      if (!this.flip && this.flipVotes.length < 12 && F.tilt && this.ref.tilt && idx.every((i) => isFinite(this.ref.tilt[i]))) {
        const gt = this.window(F, "tilt", m.start, m.end, res.lag);
        const gm = this.window(F, "mag", m.start, m.end, res.lag);
        const dancing = res.ratio >= 0.5 && res.ratio <= 2.0 && res.rhythm >= 50 && gm !== null &&
          hfShare(gm) - hfShare(idx.map((i) => this.ref.mag[i])) <= 0.15;
        if (gt !== null && dancing) {
          const rt = idx.map((i) => this.ref.tilt[i]);
          let d1 = 0, d2 = 0;
          for (let i = 0; i < rt.length; i++) { d1 += Math.abs(rt[i] - gt[i]); d2 += Math.abs(rt[i] - (180 - gt[i])); }
          this.flipVotes.push(d1 / rt.length - d2 / rt.length);
          const fv = this.flipVotes;
          const cond = (fv.length >= 2 && Math.min(...fv) > 60) ||
            (fv.length >= 4 && mean(fv) > 40) ||
            (fv.length >= 6 && mean(fv) > 15 && fv.filter((q) => q > 0).length / fv.length >= 0.7);
          if (cond && !(this.followD.length >= 2 && mean(this.followD) > 0.2)) {
            this.flip = true; this.lagHist = []; this.lagT = []; this.events.push(["flip", m.start]);
          }
        }
      }
      if (res.total >= 50) {
        this.lagHist.push(res.lag); this.lagT.push(m.start); this.badRun = 0;
      } else this.badRun++;
      if (!this.allowRelearn) return;
      const win = this._relearnWindow(m.start);
      if (win === null) { this.probe = []; return; }
      if (win !== this.probeWin) { this.probe = []; this.probeWin = win; }
      const starts = [...this.syncGaps.filter(([g0, g1]) => g0 - 1.0 <= m.start && m.start <= g1 + 26.0).map(([g0]) => g0 - 1.0),
        ...this.jumps.filter(([vt]) => vt - 1.0 <= m.start && m.start <= vt + 26.0).map(([vt]) => vt - 1.0)];
      const w0 = starts.length ? Math.min(...starts) : win;
      const preF = this.follow.filter((_, i) => this.followT[i] < w0);
      const vetoFlip = (preF.length >= 3 && Math.abs(median(preF)) > 0.2 && (median(preF) > 0) !== this.flip) || preF.length < 3;
      const before = this.lagHist.filter((_, i) => this.lagT[i] < win);
      const c = before.length ? median(before.slice(-8)) : this.lagHist.length ? median(this.lagHist.slice(-8)) : 0.15;
      const saveFlip = this.flip, saveExtra = this.extra;
      const rng = Math.min(2.0, Math.max(1.0, this._gapCap(win)));
      let best = [-9, null, null];
      const glen = Math.max(0, ...this.syncGaps.filter(([g0, g1]) => g0 - 1.0 <= win + 1.0 && win + 1.0 <= g1 + 26.0).map(([g0, g1]) => g1 - g0));
      for (const fl of vetoFlip ? [saveFlip] : [saveFlip, !saveFlip]) {
        this.flip = fl;
        for (let tau = c - rng; tau <= c + rng + 1e-4; tau += 0.02) {
          if (fl === saveFlip && Math.abs(tau - c) < 0.3) continue;
          const [rr] = this.bestLag(F, m, [Math.round(tau * 100) / 100], idx);
          if (rr === null || rr === undefined) continue;
          let r2 = rr;
          if (glen >= 0.5 && Math.abs((tau - c) - glen) <= 0.15) r2 += 0.04;
          if (r2 > best[0]) best = [r2, Math.round((tau - c) * 100) / 100, fl];
        }
      }
      this.flip = saveFlip; this.extra = saveExtra;
      if (best[1] === null) return;
      this.probe.push([best[2], best[1], best[0], res.r]);
      if (this.probe.length >= 2) {
        let [f1, d1, r1, c1] = this.probe[this.probe.length - 2];
        let [f2, d2, r2, c2] = this.probe[this.probe.length - 1];
        let agree = f1 === f2 && Math.abs(d1 - d2) <= 0.08 && Math.min(r1, r2) >= 0.55 && r1 >= c1 + 0.08 && r2 >= c2 + 0.08;
        if (!agree && this.probe.length >= 4) {
          const last = this.probe.slice(-5);
          const same = last.filter((p) => p[0] === f2 && Math.abs(p[1] - d2) <= 0.08 && p[2] >= 0.55 && p[2] >= p[3] + 0.08);
          if (same.length >= 3) { agree = true; d1 = mean(same.map((p) => p[1])); f1 = f2; }
        }
        const pre = this.done.filter((d) => d[0].end < win).slice(-6).map((d) => d[2]);
        const sloppy = pre.length > 0 && median(pre) < 35;
        if (agree && this.probe.length >= 3 && sloppy) {
          const [f0, d0, r0, cc0] = this.probe[this.probe.length - 3];
          agree = f0 === f2 && Math.abs(d0 - d2) <= 0.08 && r0 >= cc0 + 0.08;
        } else if (agree && sloppy) agree = false;
        if (agree) {
          const dsh = (d1 + d2) / 2;
          if (Math.abs(dsh) >= 0.3 && !this._shiftPlausible(F, dsh, c, f2, win)) {
            this.events.push(["reject_shift", m.start, Math.round(dsh * 100) / 100]);
            this.probe = [];
            return;
          }
          if (f2 !== this.flip) {
            this.flip = f2; this.lagHist = []; this.lagT = []; this.events.push(["flip", m.start]);
          }
          if (Math.abs(dsh) >= 0.3) {
            this.extra += dsh;
            this.shiftFrom = win;
            this.relearns++;
            this.events.push(["shift", m.start, Math.round(dsh * 100) / 100]);
            this.lagHist = [c, c, c, c];
            this.lagT = [win - 1, win - 1, win - 1, win - 1];
          }
          this.badRun = 0;
          this.probe = [];
        }
      }
    }
    _graded(F, m) {
      const res = this.scoreMove(F, m);
      if (res) {
        if (!isFinite(res.total)) res.total = 0.0;
        [res.grade, res.pts] = grade(res.total);
        if (m.gold) res.pts *= 2;
      }
      return res;
    }
    run(F) {
      const out = [], state = [];
      for (let i = 0; i < this.moves.length; i++) {
        const m = this.moves[i];
        if (!m.scored || F === null) { out.push(null); state.push(null); continue; }
        const snap = [this.extra, this.lagHist.slice(), this.lagT.slice()];
        const flip0 = this.flip, extra0 = this.extra;
        out.push(this._graded(F, m));
        state.push(snap);
        if (this.logic === "v2" && (this.flip !== flip0 || this.extra !== extra0)) {
          this._rescore(F, out, state, i, this.flip !== flip0, this.extra !== extra0);
        }
      }
      return out;
    }
    _rescore(F, out, state, upto, flipChanged, shiftChanged) {
      const cur = [this.extra, this.lagHist.slice(), this.lagT.slice()];
      this.frozen = true;
      for (let j = 0; j <= upto; j++) {
        if (out[j] === null || !["move", "hold"].includes(out[j].kind) || state[j] === null) continue;
        const mj = this.moves[j];
        let [ex, lh, lt] = state[j];
        const newShift = shiftChanged && this.shiftFrom !== null && mj.start >= this.shiftFrom;
        if (newShift) { ex = cur[0]; lh = cur[1].length ? cur[1] : lh; lt = cur[1].length ? cur[2] : lt; }
        else if (!flipChanged) continue;
        this.extra = ex; this.lagHist = lh.slice(); this.lagT = lt.slice();
        const nw = this._graded(F, mj);
        if (nw) { nw.recalc = true; out[j] = nw; }
      }
      this.extra = cur[0]; this.lagHist = cur[1]; this.lagT = cur[2];
      this.frozen = false;
    }
  }

  const DanceScoreV2 = { calibrate, phoneFeatures, Scorer, GRADES, grade, _butter: butterCoeffs, _dsp: { lfilterCoef, filtfilt: filtfiltCoef } };
  root.DanceScoreV2 = DanceScoreV2;
  if (typeof module !== "undefined") module.exports = DanceScoreV2;
})(typeof window !== "undefined" ? window : globalThis);
