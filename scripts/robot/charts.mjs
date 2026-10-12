// Блок-схемы из отчётов робота: node scripts/robot/charts.mjs <отчёт.json>... > схемы.json
// Склеивает прогоны по играм: переходы этапов (сколько раз), действия, итог (дошла до финала, ошибки).
import fs from "node:fs";

const files = process.argv.slice(2);
const runs = files.flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")));
// Последний прогон каждой конфигурации (повторные — после исправлений) заменяет прежний.
const byKey = new Map();
for (const r of runs) byKey.set(`${r.mechanic}|${r.demo}|${r.mode}|${r.players}|${r.seed}`, r);

const games = {};
for (const r of byKey.values()) {
  const g = (games[r.mechanic] ??= { mechanic: r.mechanic, runs: 0, finished: 0, ticks: 0, problems: [], edges: {}, actions: {}, demos: new Set(), modes: new Set() });
  g.runs += 1;
  if (r.finished) g.finished += 1;
  g.ticks += r.ticks ?? 0;
  g.demos.add(r.demo);
  g.modes.add(`${r.mode} ×${r.players}`);
  for (const [k, v] of Object.entries(r.edges ?? {})) g.edges[k] = (g.edges[k] ?? 0) + v;
  for (const [k, v] of Object.entries(r.actions ?? {})) g.actions[k] = (g.actions[k] ?? 0) + v;
  const bad = [...(r.errors ?? []), ...(r.console ?? []), ...(r.stuck ? [`застрял: ${r.stuck}`] : [])];
  if (bad.length) g.problems.push({ run: `${r.mode} ×${r.players} #${r.seed}`, bad });
}
const out = Object.values(games).map((g) => ({ ...g, demos: [...g.demos], modes: [...g.modes] }));
process.stdout.write(JSON.stringify(out, null, 1));
