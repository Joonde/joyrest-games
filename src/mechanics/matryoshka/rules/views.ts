/**
 * Что видят экран зала, телефон и пульт «Игр Матрёшки» (docs/matryoshka.md, «Кто что видит»). Экран — без тайн (крепкий лёд
 * до раскрытия, фигуры до `unbox`, будущие фразы, `stop` раньше 3 с, жесты до показа, верный ответ до возвращения, зерно);
 * телефон — только своё (кроме соперника в своей дуэли и пары дуэлянтов для ставки); пульт — всё нужное ведущему, тайн нет.
 * Времена наружу — по часам сервера (`toServer`).
 */
import { BOARD_PAGE_MS, BOARD_PAGE_ROWS, BOXES, CATCH_FROM_MS, HEAD_TURN_MS, PERSONAL_EVERY_MS, PHONE_LEAD_MS, SCREEN_BYTES_MAX, SCREEN_LEAD_MS, SCREEN_NAME_MAX } from "./constants";
import { questionsOf } from "./content";
import { gameNow, toServer, type Env } from "./env";
import { project, speedOf } from "./freeze";
import { boxCounts, gingerSub } from "./ginger";
import { chairsSub } from "./chairs";
import { hopSub, sideShares } from "./hopscotch";
import { available, canReturn, chanceAvailable, moment } from "./game";
import { championOf, fans, inGame, standings } from "./members";
import { ropeSub } from "./rope";
import { SHAPE_TITLES } from "./shapes";
import type { HostView, MatState, Member, PersonalView, ScreenPlayer, ScreenView, TrialState } from "./types";

type ViewEnv = Pick<Env, "now" | "online" | "paused">;

/** Флаги игрока на экране. */
export const F_HOLD = 1;
export const F_DONE = 2;
export const F_FAIL = 4;
export const F_OFFLINE = 8;
export const F_BRAVE = 16;
export const F_OUT = 32;

/**
 * Первые `max` знаков строки — **целыми** знаками (второе ревью 3a: `.slice` резал эмодзи пополам, и на экране был «�»): по
 * графемам (`Intl.Segmenter` — семья 👨‍👩‍👧‍👦 и флаг — один знак), где его нет — по кодовым точкам (`Array.from`).
 */
let segmenter: Intl.Segmenter | null | undefined;
/** Знаки, после которых обрезка `.slice` может разорвать знак: суррогаты, склейка (ZWJ), селекторы, комбинируемые знаки. */
const COMPLEX = /[\uD800-\uDFFF\u200D\uFE00-\uFE0F\u0300-\u036F\u0483-\u0489\u1AB0-\u1AFF\u20D0-\u20FF]/;
const clipped = new Map<string, string>();

export function clipText(text: string, max: number): string {
  if (max <= 0) return "";
  // Знаков (графем) не больше, чем кодовых единиц: короткая строка — как есть, без разбора; простой текст — `.slice`.
  if (text.length <= max) return text;
  if (!COMPLEX.test(text)) return text.slice(0, max);
  const key = `${max}|${text}`;
  const known = clipped.get(key);
  if (known !== undefined) return known;
  const out = clipComplex(text, max);
  if (clipped.size >= 4096) clipped.clear();
  clipped.set(key, out);
  return out;
}

function clipComplex(text: string, max: number): string {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    if (!segmenter) segmenter = new Seg("ru", { granularity: "grapheme" });
    let out = "";
    let n = 0;
    for (const { segment } of segmenter.segment(text)) {
      if (n >= max) break;
      out += segment;
      n += 1;
    }
    return out;
  }
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
}

function nameOf(m: Member | undefined): string {
  return clipText(m?.name ?? "", SCREEN_NAME_MAX);
}

function numOf(s: MatState, pid: string): number {
  return s.members[pid]?.num ?? 0;
}

function srv(s: MatState, t: number | null): number | null {
  return t === null || !Number.isFinite(t) ? null : Math.round(toServer(s, t));
}

/** Сколько выбыло игрой (без убранных и опоздавших). */
function outCount(s: MatState): number {
  return Object.values(s.members).filter((m) => m.role === "fan" && m.everOut && !m.late).length;
}

// ------------------------------------------------------------------ экран

function trialScreen(s: MatState, tr: TrialState, env: ViewEnv, names: Set<string>): Record<string, unknown> {
  const now = gameNow(s, env);
  const out: Record<string, unknown> = {
    index: tr.index,
    count: s.plan.length,
    kind: tr.kind,
    stage: tr.stage,
    stageAt: srv(s, tr.stageAt),
    stageEnds: srv(s, tr.stageEnds),
    A: tr.A,
    T: tr.T,
    seeding: tr.seeding,
    auto: tr.auto,
    guessers: Object.keys(tr.guesses).length,
  };
  const p = tr.play;
  const offline = (pid: string) => (env.online(pid) ? 0 : F_OFFLINE);
  if (p?.kind === "freeze") {
    const v = speedOf(p);
    // Текущая фраза — последняя начавшаяся (фразы идут встык): новая видна с первого же мгновения, прошлая — ещё 0,5 с после
    // своего конца, только если новой нет (аудит 3a: раньше новая фраза приходила на 0,5 с позже и мелодию нельзя было свести).
    let current: (typeof p.gazes)[number] | undefined;
    for (let i = p.gazes.length - 1; i >= 0; i -= 1) {
      const g = p.gazes[i];
      if (g && g.ph <= now) {
        if (now < g.e + 500) current = g;
        break;
      }
    }
    const players: ScreenPlayer[] = [];
    const last = p.lastCatch;
    const lastSet = new Set(last?.pids ?? []);
    for (const pid of tr.participants) {
      const r = p.runners[pid];
      if (!r) continue;
      const pr = project(p, r, now);
      players.push([numOf(s, pid), Math.round(pr.path), (r.holding ? F_HOLD : 0) | (pr.finished ? F_DONE : 0) | (lastSet.has(pid) ? F_FAIL : 0) | offline(pid)]);
    }
    for (const [num] of [...players].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      const pid = tr.participants.find((x) => numOf(s, x) === num);
      if (pid) names.add(pid);
    }
    for (const pid of (last?.pids ?? []).slice(0, 10)) names.add(pid);
    out.play = {
      runEnds: srv(s, p.runEnds),
      speed: Math.round(v * 1_000_000) / 1000,
      phrase: current ? { start: srv(s, current.ph), at: srv(s, current.a), end: srv(s, current.e), decoy: srv(s, current.d), window: srv(s, current.a + CATCH_FROM_MS), head: srv(s, current.a - HEAD_TURN_MS) } : null,
      caught: last ? { gaze: last.gaze, count: last.pids.length, nums: last.pids.slice(0, 10).map((pid) => numOf(s, pid)) } : null,
      players,
    };
  } else if (p?.kind === "ginger") {
    const sub = gingerSub(p, now);
    const per = (p.unboxEnds - p.pickEnds) / BOXES;
    const shown = sub === "pick" ? 0 : sub === "unbox" ? Math.min(BOXES, Math.floor((now - p.pickEnds) / per) + 1) : BOXES;
    const players: ScreenPlayer[] = tr.participants.map((pid) => {
      const r = p.runners[pid];
      return [numOf(s, pid), r?.c ?? 0, (r?.doneAt !== null && r?.doneAt !== undefined ? F_DONE : 0) | (r?.cracked ? F_FAIL : 0) | offline(pid)];
    });
    out.play = {
      sub,
      pickEnds: srv(s, p.pickEnds),
      unboxEnds: srv(s, p.unboxEnds),
      traceEnds: srv(s, p.traceEnds),
      picked: Object.values(p.runners).filter((r) => r.box !== null).length,
      counts: sub === "pick" ? null : boxCounts(p),
      boxes: p.boxes.slice(0, shown),
      whole: players.filter((x) => x[2] & F_DONE).length,
      cracked: players.filter((x) => x[2] & F_FAIL).length,
      players,
    };
  } else if (p?.kind === "chairs") {
    const r = p.rounds[p.round];
    if (r) {
      const sub = chairsSub(r, now);
      const lead = now >= r.stopAt - SCREEN_LEAD_MS;
      for (const pid of (r.seated ?? []).slice(-5)) names.add(pid);
      out.play = {
        round: p.round,
        sub,
        chairs: r.chairs,
        inRound: r.players.length,
        musicAt: srv(s, r.musicAt),
        stopAt: lead ? srv(s, r.stopAt) : null,
        decoyAt: r.decoyAt !== null && now >= r.decoyAt - SCREEN_LEAD_MS ? srv(s, r.decoyAt) : null,
        appearAt: now >= r.stopAt ? srv(s, r.appearAt) : null,
        closeAt: now >= r.stopAt ? srv(s, r.closeAt) : null,
        // Конец рассадки выдаёт момент остановки (seatEnds − stop постоянно ± 0,6 с) — только с остановки (аудит 3a).
        seatEnds: now >= r.stopAt ? srv(s, r.seatEnds) : null,
        seated: r.seated?.map((pid) => numOf(s, pid)) ?? null,
        players: tr.participants.map((pid) => [numOf(s, pid), p.stats[pid]?.rounds ?? 0, (r.players.includes(pid) ? F_HOLD : 0) | offline(pid)] as ScreenPlayer),
      };
    }
  } else if (p?.kind === "rope") {
    const sub = ropeSub(p, now);
    const side = (k: 0 | 1) => Object.values(p.sides).filter((x) => x === k).length;
    const fanSide = (k: 0 | 1) => Object.values(p.fanSides).filter((x) => x === k).length;
    out.play = {
      sub,
      splitEnds: srv(s, p.splitEnds),
      attempt: p.attempt,
      attemptAt: srv(s, p.attemptAt),
      attemptEnds: srv(s, p.attemptEnds),
      restEnds: srv(s, p.restEnds),
      knot: Math.round(p.knot * 10) / 10,
      wins: p.wins,
      players: [side(0), side(1)],
      fans: [fanSide(0), fanSide(1)],
      power: p.power.map((x) => Math.round(x * 10) / 10),
      sides: tr.participants.map((pid) => [numOf(s, pid), p.sides[pid] ?? -1, offline(pid)] as ScreenPlayer),
    };
  } else if (p?.kind === "hopscotch") {
    const r = p.rows[p.row];
    const sub = hopSub(p, now);
    const revealBraves = r !== undefined && r.braves !== null && r.chooseAt !== null && now >= r.chooseAt;
    for (const pid of r?.braves ?? []) names.add(pid);
    out.play = {
      row: p.row,
      sub,
      braveAt: srv(s, r?.braveAt ?? null),
      braveEnds: srv(s, r?.braveEnds ?? null),
      jumpEnds: srv(s, r?.jumpEnds ?? null),
      chooseEnds: srv(s, r?.chooseEnds ?? null),
      crackEnds: srv(s, r?.crackEnds ?? null),
      braves: (r?.braves ?? []).map((pid) => ({
        num: numOf(s, pid),
        // Куда прыгнул — с начала выбора остальных; чем кончилось — только на раскрытии (решение владельца 10).
        side: revealBraves ? (r?.picks[pid] ?? null) : null,
        picked: r?.picks[pid] !== undefined,
      })),
      jumpers: r?.jumpers.length ?? 0,
      picked: r ? Object.keys(r.picks).length : 0,
      solid: r?.fell !== null && r?.fell !== undefined ? r.solid : null,
      shares: r?.fell ? sideShares(r.picks) : null,
      fell: r?.fell?.map((pid) => numOf(s, pid)) ?? null,
      fallen: Object.keys(p.fallen).length,
      rows: p.rows.map((row) => (row.fell === null ? null : { solid: row.solid, fell: row.fell.length })),
    };
  }
  const o = tr.outcome;
  if (o && (tr.stage === "reveal" || tr.stage === "results")) {
    for (const pid of o.out.slice(0, 10)) names.add(pid);
    for (const pid of o.order.slice(0, 3)) names.add(pid);
    out.outcome = {
      out: o.out.map((pid) => numOf(s, pid)),
      lost: o.lost.length,
      top: o.order.slice(0, 3).map((pid) => numOf(s, pid)),
      fails: o.fails,
      guessBest: o.best.map((pid) => numOf(s, pid)),
      guessNear: o.near.length,
      chance: chanceAvailable(s),
    };
    for (const pid of o.best.slice(0, 5)) names.add(pid);
  }
  return out;
}

export function screenView(s: MatState, env: ViewEnv): ScreenView {
  const names = new Set<string>(s.justOut);
  const view: ScreenView = {
    phase: s.phase,
    style: s.content.style,
    board: s.board,
    inGame: inGame(s).length,
    out: outCount(s),
    fans: fans(s).length,
    piggy: s.piggy,
    // Только номера: имена — в `names` (раньше имя повторялось дважды, сводка на 100 гостях выходила за 4 КБ — аудит 3a).
    justOut: s.justOut.map((pid) => numOf(s, pid)),
    names: {},
  };
  if (s.phase === "lobby") {
    const list = Object.values(s.members)
      .filter((m) => !m.gone)
      .sort((a, b) => a.num - b.num);
    view.lobby = { count: list.length, marks: list.slice(0, 100).map((m) => [...m.name.trim()][0] ?? "•") };
  }
  if (s.phase === "trial" && s.trial) view.trial = trialScreen(s, s.trial, env, names);
  if (s.phase === "chance" && s.chance) {
    const c = s.chance;
    const q = questionsOf(s.content)[c.question];
    const shown = c.stage !== "offer";
    for (const pid of c.returned) names.add(pid);
    view.chance = {
      stage: c.stage,
      stageEnds: srv(s, c.stageEnds),
      eligible: c.eligible.length,
      count: c.count,
      answered: Object.keys(c.answers).length,
      q: shown ? (q?.q ?? "") : null,
      options: shown ? (q?.options ?? []) : null,
      correct: c.stage === "back" || c.stage === "done" ? (q?.correct ?? null) : null,
      returned: c.returned.map((pid) => numOf(s, pid)),
    };
  }
  if (s.phase === "dobivka" && s.dobivka) {
    const d = s.dobivka;
    const r = d.rows.at(-1);
    for (const pid of d.out) names.add(pid);
    view.dobivka = {
      stage: d.stage,
      stageEnds: srv(s, d.stageEnds),
      need: d.need,
      row: d.rows.length - 1,
      chooseEnds: srv(s, r?.chooseEnds ?? null),
      crackEnds: srv(s, r?.crackEnds ?? null),
      picked: r ? Object.keys(r.picks).length : 0,
      solid: r?.fell ? r.solid : null,
      shares: r?.fell ? sideShares(r.picks) : null,
      fell: r?.fell?.map((pid) => numOf(s, pid)) ?? null,
      fallen: Object.keys(d.fallen).length,
      out: d.out.map((pid) => numOf(s, pid)),
    };
  }
  if ((s.phase === "final" || s.phase === "podium" || s.phase === "finished") && s.final) {
    const f = s.final;
    for (const pid of f.seeds) names.add(pid);
    const d = f.duel;
    const show = d !== null && (d.stage === "show" || d.stage === "over");
    const last = d?.history.at(-1);
    const champ = championOf(s);
    if (s.bestFan) names.add(s.bestFan);
    view.final = {
      stage: f.stage,
      size: f.size,
      seeds: f.seeds.map((pid) => numOf(s, pid)),
      rounds: f.rounds.map((r) => r.map(([a, b]) => [a ? numOf(s, a) : 0, b ? numOf(s, b) : 0])),
      winners: f.winners.map((r) => r.map((w) => (w && s.members[w] ? numOf(s, w) : w === null ? null : 0))),
      at: f.at,
      duel: d
        ? {
            a: numOf(s, d.a),
            b: numOf(s, d.b),
            wins: d.wins,
            roundNo: d.roundNo,
            stage: d.stage,
            stageEnds: srv(s, d.stageEnds),
            picked: [d.picks[d.a] !== undefined, d.picks[d.b] !== undefined],
            gestures: show && last ? [last.ga, last.gb] : null,
            auto: show ? [d.auto[d.a] !== undefined, d.auto[d.b] !== undefined] : null,
            last: show && last ? { winner: last.winner ? numOf(s, last.winner) : 0, bySpeed: last.bySpeed } : null,
            bets: Object.keys(d.bets).length,
            winner: d.winner ? numOf(s, d.winner) : null,
            forfeit: d.forfeit,
          }
        : null,
      champion: champ ? numOf(s, champ) : null,
      bestFan: s.bestFan ? { num: numOf(s, s.bestFan), score: s.members[s.bestFan]?.fanScore ?? 0 } : null,
    };
  }
  if (s.phase === "podium" || s.phase === "finished") {
    // Убранные на пьедестал и в «восьмёрку» экрана не выходят (аудит 3a); их место — в таблице.
    const top = standings(s)
      .filter((x) => !x.removed)
      .slice(0, 8);
    for (const x of top) names.add(x.pid);
    view.podium = { top: top.map((x) => ({ num: x.num, place: x.place, points: x.points })) };
  }
  if (s.board && s.phase !== "lobby") {
    const list = inGame(s);
    const pages = Math.max(1, Math.ceil(list.length / BOARD_PAGE_ROWS));
    const page = Math.floor(env.now / BOARD_PAGE_MS) % pages;
    view.scoreboard = { total: list.length, page, pages, rows: list.slice(page * BOARD_PAGE_ROWS, (page + 1) * BOARD_PAGE_ROWS).map((m) => [m.num, m.hearts]) };
  }
  for (const pid of names) {
    const m = s.members[pid];
    if (m) view.names[m.num] = nameOf(m);
  }
  return fitScreen(view);
}

const utf8 = new TextEncoder();

/** Размер сводки в байтах UTF-8 (как уходит в поток). */
export function screenBytes(view: ScreenView): number {
  return utf8.encode(JSON.stringify(view)).length;
}

/**
 * Сводка в пределе `SCREEN_BYTES_MAX` байт: длинные имена укорачиваются (24 → 8 знаков, по 4), потом имена отбрасываются с
 * конца (большие номера) — экран покажет номер без имени. Номера и всё остальное — как есть.
 */
export function fitScreen(view: ScreenView): ScreenView {
  if (screenBytes(view) <= SCREEN_BYTES_MAX) return view;
  for (let max = SCREEN_NAME_MAX - 4; max >= 8; max -= 4) {
    for (const k of Object.keys(view.names)) view.names[Number(k)] = clipText(view.names[Number(k)] ?? "", max);
    if (screenBytes(view) <= SCREEN_BYTES_MAX) return view;
  }
  const keys = Object.keys(view.names);
  while (keys.length > 0 && screenBytes(view) > SCREEN_BYTES_MAX) {
    const k = keys.pop();
    if (k !== undefined) delete view.names[Number(k)];
  }
  return view;
}

// ------------------------------------------------------------------ телефон

function trialPersonal(s: MatState, tr: TrialState, m: Member, now: number): Record<string, unknown> {
  const out: Record<string, unknown> = { index: tr.index, kind: tr.kind, stage: tr.stage, stageEnds: srv(s, tr.stageEnds), seeding: tr.seeding };
  const p = tr.play;
  const mine = tr.participants.includes(m.pid) && m.role === "player";
  if (m.role === "fan" && (tr.stage === "open" || tr.stage === "rules") && s.content.fanBets && tr.kind !== "rope") {
    out.guess = { open: true, max: inGame(s).length, mine: tr.guesses[m.pid] ?? null };
  }
  if (p?.kind === "freeze" && mine) {
    const r = p.runners[m.pid];
    const next = p.gazes.find((g) => g.e > now && g.a - PHONE_LEAD_MS <= now);
    const last = p.lastCatch;
    out.freeze = {
      runEnds: srv(s, p.runEnds),
      speed: Math.round(speedOf(p) * 1_000_000) / 1000,
      path: Math.round((r?.path ?? 0) / 10) * 10,
      holding: r?.holding ?? false,
      finished: r?.finishedAt !== null && r?.finishedAt !== undefined,
      caught: r?.caught ?? 0,
      // Поворот — за 1 с (L4): `at` — «ЗАМРИ!», `end` — конец взгляда.
      gaze: next ? { n: p.gazes.indexOf(next), at: srv(s, next.a), end: srv(s, next.e) } : null,
      caughtNow: last !== null && last.pids.includes(m.pid) ? last.gaze : null,
    };
  } else if (p?.kind === "ginger" && mine) {
    const r = p.runners[m.pid];
    const sub = gingerSub(p, now);
    const shape = r && r.box !== null && sub !== "pick" ? (p.boxes[r.box] ?? null) : null;
    out.ginger = { sub, pickEnds: srv(s, p.pickEnds), unboxEnds: srv(s, p.unboxEnds), traceEnds: srv(s, p.traceEnds), box: r?.box ?? null, auto: r?.auto ?? false, shape, shapeTitle: shape ? SHAPE_TITLES[shape] : null, c: r?.c ?? 0, cracked: r?.cracked ?? false, done: r?.doneAt !== null && r?.doneAt !== undefined };
  } else if (p?.kind === "chairs" && mine) {
    const r = p.rounds[p.round];
    if (r) {
      const inRound = r.players.includes(m.pid);
      const lead = now >= r.stopAt - PHONE_LEAD_MS;
      const seatNo = r.seated ? r.seated.indexOf(m.pid) : -1;
      out.chairs = {
        round: p.round,
        sub: chairsSub(r, now),
        inRound,
        chairs: r.chairs,
        stopAt: lead && inRound ? srv(s, r.stopAt) : null,
        appearAt: lead && inRound ? srv(s, r.appearAt) : null,
        closeAt: lead && inRound ? srv(s, r.closeAt) : null,
        tapped: r.sits[m.pid] !== undefined,
        seated: r.seated === null ? null : seatNo >= 0,
        chair: seatNo >= 0 ? seatNo + 1 : null,
        rounds: p.stats[m.pid]?.rounds ?? 0,
      };
    }
  } else if (p?.kind === "rope") {
    const side = p.sides[m.pid] ?? p.fanSides[m.pid] ?? null;
    if (side !== null || m.role === "fan") {
      out.rope = { sub: ropeSub(p, now), side, fan: p.sides[m.pid] === undefined, attempt: p.attempt, attemptEnds: srv(s, p.attemptEnds), restEnds: srv(s, p.restEnds), knot: Math.round(p.knot), wins: p.wins, taps: p.taps[m.pid]?.total ?? 0 };
    }
  } else if (p?.kind === "hopscotch" && mine) {
    const r = p.rows[p.row];
    if (r) {
      const sub = hopSub(p, now);
      const jumper = r.jumpers.includes(m.pid);
      const showBraves = r.chooseAt !== null && now >= r.chooseAt;
      out.hop = {
        row: p.row,
        sub,
        jumper,
        braveAt: srv(s, r.braveAt),
        braveEnds: srv(s, r.braveEnds),
        jumpEnds: srv(s, r.jumpEnds),
        chooseEnds: srv(s, r.chooseEnds),
        brave: r.braves?.includes(m.pid) ?? false,
        braveTapped: r.braveTaps[m.pid] !== undefined,
        braves: showBraves ? (r.braves ?? []).map((pid) => r.picks[pid] ?? null) : null,
        pick: r.picks[m.pid] ?? null,
        fell: p.fallen[m.pid] !== undefined,
        solid: r.fell !== null ? r.solid : null,
        coins: m.coins,
      };
    }
  }
  const o = tr.outcome;
  if (o && (tr.stage === "reveal" || tr.stage === "results")) {
    const place = o.order.indexOf(m.pid);
    out.result = {
      place: place >= 0 ? place + 1 : null,
      of: o.order.length,
      lostHeart: o.lost.includes(m.pid),
      out: o.out.includes(m.pid),
      fails: o.fails,
      guess: tr.guesses[m.pid] ?? null,
      guessPoints: o.best.includes(m.pid) ? 3 : o.near.includes(m.pid) ? 1 : 0,
    };
  }
  return out;
}

export function personalView(s: MatState, pid: string, env: ViewEnv): PersonalView | null {
  const m = s.members[pid];
  if (!m) return null;
  const now = gameNow(s, env);
  const view: PersonalView = { num: m.num, name: m.name, role: m.role, late: m.late, hearts: m.hearts, lives: s.content.lives, phase: s.phase, style: s.content.style, coins: m.coins, fanScore: m.fanScore, returned: m.returned, removed: m.removed };
  if (s.phase === "lobby") view.lobby = { count: Object.values(s.members).filter((x) => !x.gone).length };
  if (s.phase === "trial" && s.trial) view.trial = trialPersonal(s, s.trial, m, now);
  if (s.phase === "chance" && s.chance) {
    const c = s.chance;
    const q = questionsOf(s.content)[c.question];
    const eligible = c.eligible.includes(pid);
    const shown = eligible && c.stage !== "offer";
    view.chance = {
      stage: c.stage,
      stageAt: srv(s, c.stageAt),
      stageEnds: srv(s, c.stageEnds),
      eligible,
      q: shown ? (q?.q ?? "") : null,
      options: shown ? (q?.options ?? []) : null,
      answered: c.answers[pid]?.i ?? null,
      correct: eligible && (c.stage === "back" || c.stage === "done") ? (q?.correct ?? null) : null,
      returned: c.returned.includes(pid),
    };
  }
  if (s.phase === "dobivka" && s.dobivka) {
    const d = s.dobivka;
    const r = d.rows.at(-1);
    const jumper = m.role === "player" && d.fallen[pid] === undefined;
    view.dobivka = {
      stage: d.stage,
      stageEnds: srv(s, d.stageEnds),
      row: d.rows.length - 1,
      jumper,
      chooseEnds: srv(s, r?.chooseEnds ?? null),
      pick: r?.picks[pid] ?? null,
      fell: d.fallen[pid] !== undefined,
      solid: r?.fell ? r.solid : null,
      out: d.out.includes(pid),
    };
  }
  if ((s.phase === "final" || s.phase === "podium" || s.phase === "finished") && s.final) {
    const f = s.final;
    const d = f.duel;
    const champ = championOf(s);
    const final: Record<string, unknown> = { stage: f.stage, finalist: f.seeds.includes(pid), seed: f.seeds.indexOf(pid) + 1 || null, champion: champ === pid, bestFan: s.bestFan === pid };
    if (d && f.stage === "duel") {
      const duelist = pid === d.a || pid === d.b;
      const show = d.stage === "show" || d.stage === "over";
      const last = d.history.at(-1);
      const who = (x: string) => ({ num: numOf(s, x), name: nameOf(s.members[x]) });
      if (duelist) {
        const other = pid === d.a ? d.b : d.a;
        const meA = pid === d.a;
        final.duel = {
          me: meA ? 0 : 1,
          opponent: who(other),
          wins: d.wins,
          roundNo: d.roundNo,
          stage: d.stage,
          stageEnds: srv(s, d.stageEnds),
          pick: d.picks[pid]?.g ?? null,
          auto: show ? d.auto[pid] !== undefined : false,
          gestures: show && last ? [last.ga, last.gb] : null,
          winner: d.winner === null ? null : d.winner === pid,
        };
      } else if (m.role === "fan") {
        final.watch = { a: who(d.a), b: who(d.b), wins: d.wins, stage: d.stage, stageEnds: srv(s, d.stageEnds), bet: d.bets[pid] === undefined ? null : d.bets[pid] === d.a ? 0 : 1, betOpen: d.stage === "bets", winner: d.winner === null ? null : d.winner === d.a ? 0 : 1 };
      }
    }
    view.final = final;
  }
  if (s.phase === "podium" || s.phase === "finished") {
    const me = standings(s).find((x) => x.pid === pid);
    view.podium = me ? { place: me.place, points: me.points } : null;
  }
  return view;
}

/** Снимок личного (подписка и опрос): запоминается как отправленный — дальше рассылка только при переменах. */
export function personalSnapshot(s: MatState, pid: string, env: ViewEnv): PersonalView | null {
  const view = personalView(s, pid, env);
  s.rt.sent.set(pid, { key: JSON.stringify(view), at: env.now });
  s.rt.urgent.delete(pid);
  return view;
}

/**
 * Рассылка личного: срочным (моменты, поимка, своё действие, смена шага) — сразу, остальным — не чаще раза в 0,5 с, и только
 * если вид изменился (`{ t: "me", me }` целиком).
 */
export function flushPersonal(s: MatState, env: ViewEnv & Pick<Env, "send">): void {
  const sweep = env.now - s.rt.lastPersonal >= PERSONAL_EVERY_MS;
  if (!sweep && s.rt.urgent.size === 0) return;
  const targets = sweep ? Object.keys(s.members) : [...s.rt.urgent];
  if (sweep) s.rt.lastPersonal = env.now;
  for (const pid of targets) {
    const view = personalView(s, pid, env);
    if (!view) continue;
    const key = JSON.stringify(view);
    const sent = s.rt.sent.get(pid);
    if (sent?.key === key) continue;
    s.rt.sent.set(pid, { key, at: env.now });
    env.send(pid, { t: "me", me: view });
  }
  s.rt.urgent.clear();
}

// ------------------------------------------------------------------ пульт

export function hostView(s: MatState, env: ViewEnv): HostView {
  const now = gameNow(s, env);
  const tr = s.trial;
  const view: HostView = {
    moment: moment(s),
    phase: s.phase,
    stage: s.phase === "trial" ? (tr?.stage ?? "-") : s.phase === "chance" ? (s.chance?.stage ?? "-") : s.phase === "dobivka" ? (s.dobivka?.stage ?? "-") : s.phase === "final" ? (s.final?.stage ?? "-") : s.phase,
    can: available(s),
    F: s.F,
    inGame: inGame(s).length,
    out: outCount(s),
    fans: fans(s).length,
    piggy: s.piggy,
    target: tr && s.phase === "trial" && tr.A > 0 ? { A: tr.A, T: tr.T, need: Math.max(0, tr.A - tr.T), seeding: tr.seeding } : null,
    players: Object.values(s.members)
      .sort((a, b) => a.num - b.num)
      .map((m) => ({ pid: m.pid, num: m.num, name: m.name, role: m.role, hearts: m.hearts, online: env.online(m.pid), outAt: m.outAt, late: m.late })),
    plan: s.plan,
    played: s.playedTrials,
    trialIndex: s.trialIndex,
    startCount: s.startCount,
    // Тот же список, что принимает «Вернуть» (выбывшие игрой и убранные), по номеру (аудит 3a).
    returnable: Object.values(s.members)
      .filter((m) => canReturn(m))
      .sort((a, b) => a.num - b.num)
      .map((m) => m.pid),
  };
  if (s.phase === "lobby") view.lobbyCount = Object.values(s.members).filter((m) => !m.gone).length;
  if (tr && s.phase === "trial") {
    const p = tr.play;
    const t: Record<string, unknown> = { index: tr.index, kind: tr.kind, stage: tr.stage, stageEnds: srv(s, tr.stageEnds), guessers: Object.keys(tr.guesses).length, auto: tr.auto };
    if (p?.kind === "freeze") t.freeze = { runEnds: srv(s, p.runEnds), extra: p.extra, gazes: p.gazes.length, judged: p.judged, finished: Object.values(p.runners).filter((r) => r.finishedAt !== null).length, caught: Object.values(p.runners).filter((r) => r.caught > 0).length, holding: Object.values(p.runners).filter((r) => r.holding).length };
    if (p?.kind === "ginger") t.ginger = { sub: gingerSub(p, now), traceEnds: srv(s, p.traceEnds), extra: p.extra, done: Object.values(p.runners).filter((r) => r.doneAt !== null).length, cracked: Object.values(p.runners).filter((r) => r.cracked).length, picked: Object.values(p.runners).filter((r) => r.box !== null).length };
    if (p?.kind === "chairs") {
      const r = p.rounds[p.round];
      t.chairs = { round: p.round, chairs: r?.chairs ?? 0, inRound: r?.players.length ?? 0, sat: r ? Object.keys(r.sits).length : 0, seated: r?.seated?.length ?? null };
    }
    if (p?.kind === "rope") t.rope = { sub: ropeSub(p, now), attempt: p.attempt, knot: Math.round(p.knot), wins: p.wins, attemptEnds: srv(s, p.attemptEnds) };
    if (p?.kind === "hopscotch") {
      const r = p.rows[p.row];
      t.hop = { row: p.row, sub: hopSub(p, now), braves: r?.braves?.length ?? 0, picked: r ? Object.keys(r.picks).length : 0, fallen: Object.keys(p.fallen).length, stop: p.stop };
    }
    if (tr.outcome) t.outcome = { out: tr.outcome.out.length, lost: tr.outcome.lost.length, fails: tr.outcome.fails, guessBest: tr.outcome.best.length };
    view.trial = t;
  }
  if (s.chance && s.phase === "chance") {
    const c = s.chance;
    view.chance = { stage: c.stage, stageEnds: srv(s, c.stageEnds), eligible: c.eligible.length, count: c.count, answered: Object.keys(c.answers).length, returned: c.returned };
  }
  if (s.dobivka && s.phase === "dobivka") {
    const d = s.dobivka;
    const r = d.rows.at(-1);
    view.dobivka = { stage: d.stage, need: d.need, rows: d.rows.length, picked: r ? Object.keys(r.picks).length : 0, fallen: Object.keys(d.fallen).length, out: d.out };
  }
  if (s.final) {
    const f = s.final;
    const d = f.duel;
    view.final = {
      stage: f.stage,
      seeds: f.seeds,
      rounds: f.rounds,
      winners: f.winners,
      at: f.at,
      duel: d ? { a: d.a, b: d.b, wins: d.wins, roundNo: d.roundNo, stage: d.stage, stageEnds: srv(s, d.stageEnds), picked: [d.picks[d.a] !== undefined, d.picks[d.b] !== undefined], online: [env.online(d.a), env.online(d.b)], winner: d.winner, ties: d.ties } : null,
      champion: championOf(s),
      bestFan: s.bestFan,
    };
  }
  if (s.phase === "final" || s.phase === "podium" || s.phase === "finished") view.standings = standings(s);
  return view;
}
