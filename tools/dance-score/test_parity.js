// Сверка JS-порта (dance_score_v2.js) с Python-оригиналом на фикстурах.
// Проверяет: калибровку (базис f/n, rot_scale), признаки (vert/mag/gyro/tilt/valid),
// итоговые очки, грейды по движениям, события Scorer.
// Использование: node test_parity.js <dance_score_v2.js> <fixtures_dir>
const fs = require("fs"), path = require("path");
const [, , scoreJs, fixturesDir] = process.argv;
const V2 = require(scoreJs);

const refData = JSON.parse(fs.readFileSync(path.join(fixturesDir, "ref.json"), "utf8"));
const ref = refData.ref, moves = refData.moves;

let nBad = 0;
const bad = (msg) => { nBad++; console.log("  ✗ " + msg); };
const ok = (msg) => console.log("  ✓ " + msg);
const corr = (a, b) => {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sa = 0, sb = 0, sab = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sa += x * x; sb += y * y; sab += x * y; }
  return sab / (Math.sqrt(sa * sb) + 1e-12);
};
const toEv = (list) => ({
  t: list.map((e) => e.t),
  accg: list.map((e) => e.accg),
  acc: list.every((e) => e.acc === null) ? null : list.map((e) => e.acc),
  rot: list.map((e) => e.rot),
});

for (const f of fs.readdirSync(path.join(fixturesDir, "guests")).sort()) {
  const G = JSON.parse(fs.readFileSync(path.join(fixturesDir, "guests", f), "utf8"));
  const E = G.expected;
  console.log(`\n=== ${f} (Python: ${E.points} очков, flip=${E.flip}) ===`);
  // 1. калибровка
  const cal = V2.calibrate(toEv(G.calib_events));
  if (!cal.ok) bad(`калибровка: not ok (${cal.why.join("; ")})`);
  else {
    const df = Math.hypot(...cal.f.map((q, i) => q - E.calib.f[i]));
    const dn = Math.hypot(...cal.n.map((q, i) => q - E.calib.n[i]));
    if (df > 0.05) bad(`калибровка: f расходится на ${df.toFixed(3)}`); else ok(`калибровка: f близок (Δ${df.toFixed(4)})`);
    if (dn > 0.05) bad(`калибровка: n расходится на ${dn.toFixed(3)}`); else ok(`калибровка: n близко (Δ${dn.toFixed(4)})`);
    if (Math.abs(cal.rot_scale - E.calib.rot_scale) > 1e-6) bad(`калибровка: rot_scale ${cal.rot_scale} ≠ ${E.calib.rot_scale}`);
  }
  // 2. признаки
  const F = V2.phoneFeatures(toEv(G.dance_events), "v2", cal);
  if (!F) bad("phoneFeatures вернул null");
  else {
    for (const key of ["vert", "mag", "gyro", "tilt", "valid"]) {
      const mine = F[key], exp = E.features[key];
      if (!mine) { bad(`признак ${key}: нет в JS`); continue; }
      const md = Math.max(...mine.slice(0, exp.length).map((q, i) => Math.abs(q - exp[i])));
      const varies = new Set(exp).size > 2 || new Set(mine).size > 2;
      const c = corr(mine, exp);
      if (!varies) {
        if (mine.slice(0, exp.length).every((q, i) => q === exp[i])) ok(`признак ${key}: массивы совпадают`); else bad(`признак ${key}: константные, но разные`);
      } else if (c < 0.999) bad(`признак ${key}: корреляция ${c.toFixed(5)}, макс.расхождение ${md.toExponential(1)}`);
      else ok(`признак ${key}: корр ${c.toFixed(6)}, макс.расхождение ${md.toExponential(1)}`);
    }
  }
  // 3. оценка
  if (F) {
    const sc = new V2.Scorer(ref, moves, "v2");
    const r = sc.run(F);
    const pts = r.reduce((a, x) => a + (x ? x.pts : 0), 0);
    const dPts = pts - E.points;
    if (Math.abs(dPts) > E.points * 0.05 + 30) bad(`очки: JS ${pts} vs Python ${E.points} (Δ${dPts})`);
    else ok(`очки: JS ${pts} vs Python ${E.points} (Δ${dPts})`);
    if (sc.flip !== E.flip) bad(`flip: JS ${sc.flip} vs Python ${E.flip}`); else ok(`flip: ${sc.flip}`);
    const gJS = r.map((x) => (x ? x.grade : null));
    const mism = gJS.filter((g, i) => g !== E.grades[i]).length;
    if (mism) bad(`грейды: ${mism}/${E.grades.length} не совпадают`); else ok(`грейды: все ${E.grades.length} совпадают`);
    const tJS = r.map((x) => (x ? Math.round(x.total * 100) / 100 : null));
    const maxDt = Math.max(...tJS.map((t, i) => (t === null || E.totals[i] === null) ? 0 : Math.abs(t - E.totals[i])));
    if (maxDt > 3) bad(`total по движениям: расхождение до ${maxDt.toFixed(1)}`); else ok(`total по движениям: max Δ${maxDt.toFixed(2)}`);
  }
}
console.log(nBad ? `\nИТОГ: ${nBad} проблем` : "\nИТОГ: всё совпало");
process.exit(nBad ? 1 : 0);
