/**
 * Сводки «Бубликатора»: экран (без тайн — ни диверсантов, ни ложных приказов, ни чужих приказов), личное каждому телефону
 * (свои приборы, свой приказ, своя роль; пометка ложного приказа — только диверсанту) и пульт. Время — по часам сервера.
 */
import { FIRE_STREAK, GLITCH_SHOW_MS, FLIP_MS, KICK_AFTER_MS, REPAIR_MS, SPEED_WINDOW_MS } from "./constants";
import { activeMembers, captainOf, crewMembers, crewPlayers, liveCrews, lobbyCrewCount } from "./crews";
import { crewLook, crewName } from "./names";
import { crewTotal, gameNow, legResultOf, meteorShield, orderSeconds, places, toServer, type Env } from "./game";
import type { BubState, Crew, EventKind, HostView, PanelControlView, PersonalView, ScreenCrewView, ScreenView } from "./types";

type ViewEnv = Pick<Env, "now" | "online">;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function speedOf(c: Crew): number {
  let sum = 0;
  for (let i = 1; i < c.impulses.length; i += 2) sum += c.impulses[i] ?? 0;
  return sum / (SPEED_WINDOW_MS / 1000);
}

/** Очки перелёта сейчас (на «Привале» — итог) и места: во время перелёта — по ним, на пьедестале — по общему счёту. */
function standings(s: BubState): Map<Crew, { score: number; place: number }> {
  const crews = liveCrews(s);
  const byTotal = s.phase === "podium" || s.phase === "finished" || s.phase === "crews" || s.phase === "drill" || s.phase === "lobby";
  const score = new Map(crews.map((c) => [c, byTotal ? crewTotal(c) : legResultOf(s, c).total]));
  const placeOf = places(crews, (c) => score.get(c) ?? 0);
  return new Map(crews.map((c) => [c, { score: score.get(c) ?? 0, place: placeOf.get(c) ?? 1 }]));
}

function endsAtOf(s: BubState): number | null {
  if (s.phase === "drill" && s.drill && !s.drill.over) return toServer(s, s.drill.endsAt);
  const leg = s.leg;
  if (s.phase !== "leg" || !leg) return null;
  if (leg.stage === "launch") return toServer(s, leg.launchEnds);
  if (leg.stage === "vote" && leg.voteEnds !== null) return toServer(s, leg.voteEnds);
  return null;
}

function flightOf(s: BubState): ScreenView["flight"] {
  const leg = s.leg;
  if (s.phase !== "leg" || !leg) return null;
  return { elapsed: Math.round(leg.flight), duration: leg.duration, stopped: leg.event?.started === true };
}

function eventView(s: BubState): ScreenView["event"] {
  const ev = s.leg?.event;
  if (!ev) return null;
  return {
    id: ev.id,
    kind: ev.kind,
    warn: !ev.started,
    startsAt: toServer(s, ev.startAt),
    endsAt: toServer(s, ev.endAt),
    seq: ev.kind === "sos" ? (ev.seq ?? []) : null,
    task: ev.task ?? null,
    crews: ev.crews,
  };
}

function dockView(s: BubState): ScreenView["dock"] {
  const leg = s.leg;
  if (s.phase !== "leg" || !leg || (leg.stage !== "dock" && leg.stage !== "vote" && leg.stage !== "voted")) return null;
  const rows = liveCrews(s)
    .map((c) => {
      const r = c.legs[leg.index];
      return r ? { ...r, crew: c.id, name: c.name } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.place - b.place);
  const streak = rows.reduce<{ crew: number; streak: number } | null>((best, r) => (r.streak > 0 && (!best || r.streak > best.streak) ? { crew: r.crew, streak: r.streak } : best), null);
  const shield = rows.reduce<{ crew: number; shield: number } | null>((best, r) => (r.shield > 0 && (!best || r.shield > best.shield) ? { crew: r.crew, shield: r.shield } : best), null);
  return { rows, bestStreak: streak, bestShield: shield };
}

function podiumView(s: BubState): ScreenView["podium"] {
  if (s.phase !== "podium" && s.phase !== "finished") return null;
  const crews = liveCrews(s);
  const placeOf = places(crews, crewTotal);
  return crews.map((c) => ({ crew: c.id, name: c.name, place: placeOf.get(c) ?? 1, total: crewTotal(c) })).sort((a, b) => a.place - b.place);
}

export function screenView(s: BubState, env: ViewEnv): ScreenView {
  const now = gameNow(s, env);
  const st = standings(s);
  const crews = liveCrews(s);
  const speeds = new Map(crews.map((c) => [c, speedOf(c)]));
  const moving = crews.filter((c) => c.finishedAt === null);
  const avg = moving.length > 0 ? moving.reduce((a, c) => a + (speeds.get(c) ?? 0), 0) / moving.length : 0;
  const ev = s.leg?.event ?? null;
  const crewViews: ScreenCrewView[] = crews.map((c) => {
    const members = crewMembers(s, c.id).filter((m) => m.role !== "out");
    const speed = speeds.get(c) ?? 0;
    const pull =
      ev?.kind === "pull" && ev.started && c.pull
        ? {
            held: c.pull.holdStart === null ? 0 : Math.max(0, now - c.pull.holdStart),
            escaped: c.pull.escaped,
            failed: c.pull.failed,
            notHolding: crewPlayers(s, c.id)
              .filter((p) => env.online(p.pid) && ev.holds?.[p.pid]?.on !== true)
              .map((p) => p.name),
            drifting: !c.pull.escaped && !c.pull.failed,
          }
        : null;
    const sos = ev?.kind === "sos" && ev.started && c.sos ? { progress: c.sos.progress, done: c.sos.done, captain: captainOf(s, c.id, (pid: string) => env.online(pid))?.name ?? null } : null;
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      place: st.get(c)?.place ?? 1,
      members: members.length,
      online: members.filter((m) => env.online(m.pid)).length,
      names: members.map((m) => m.name),
      dist: round1(c.dist),
      score: st.get(c)?.score ?? 0,
      total: crewTotal(c),
      hull: round1(c.hull),
      speed: round1(speed),
      ratio: avg > 0 ? round1(speed / avg) : 1,
      repair: c.repair ? { until: toServer(s, c.repair.startedAt + REPAIR_MS), taps: c.repair.taps, target: c.repair.target } : null,
      finished: c.finishedAt !== null,
      streak: c.streak,
      fire: c.streak >= FIRE_STREAK,
      shield: ev?.kind === "meteor" && ev.started && ev.crews.includes(c.id) ? Math.round(meteorShield(s, ev, c.id, (pid: string) => env.online(pid))) : null,
      pull,
      sos,
      okSeq: c.okSeq,
      failSeq: c.failSeq,
      salutes: c.salutes,
    };
  });
  const best = s.phase === "leg" ? crews.reduce<{ crew: number; streak: number } | null>((b, c) => (c.streak > 0 && (!b || c.streak > b.streak) ? { crew: c.id, streak: c.streak } : b), null) : null;
  const leg = s.leg;
  const glitch = leg?.glitch?.startedAt ?? null;
  const lobby =
    s.phase === "lobby"
      ? (() => {
          const count = lobbyCrewCount(s);
          const active = activeMembers(s);
          return {
            crews: Array.from({ length: count }, (_, id) => {
              const look = crewLook(id, count);
              const names = active.filter((m) => m.crew === id).map((m) => m.name);
              return { id, name: crewName(s.content.theme, id), color: look.color, icon: look.icon, count: names.length, names };
            }),
            waiting: active.filter((m) => m.crew === null).map((m) => m.name),
            max: s.content.crewSize.max,
          };
        })()
      : null;
  const vote =
    s.phase === "leg" && leg?.stage === "vote" && leg.voteEnds !== null
      ? (() => {
          const voted: Record<string, number> = {};
          const voters: Record<string, number> = {};
          for (const c of crews) {
            if (c.saboteur === null) continue;
            const ms = crewMembers(s, c.id).filter((m) => m.role !== "out");
            voters[String(c.id)] = ms.length;
            voted[String(c.id)] = ms.filter((m) => m.vote !== null).length;
          }
          return { endsAt: toServer(s, leg.voteEnds), voted, voters };
        })()
      : null;
  return {
    phase: s.phase,
    stage: s.phase === "leg" ? (leg?.stage ?? null) : null,
    leg: s.legIndex,
    legs: s.content.legs,
    theme: s.content.theme,
    difficulty: s.content.difficulty,
    endsAt: endsAtOf(s),
    flight: flightOf(s),
    crews: crewViews,
    lobby,
    event: eventView(s),
    glitchUntil: glitch !== null && now < glitch + GLITCH_SHOW_MS ? toServer(s, glitch + GLITCH_SHOW_MS) : null,
    best,
    ordersDone: crews.reduce((a, c) => a + c.done, 0),
    dock: dockView(s),
    vote,
    // Диверсанты раскрываются только после голосования.
    reveal: s.phase === "leg" && leg?.stage === "voted" ? (leg.vote ?? []) : null,
    podium: podiumView(s),
  };
}

export function personalView(s: BubState, pid: string, env: ViewEnv): PersonalView | null {
  const m = s.members[pid];
  if (!m) return null;
  const now = gameNow(s, env);
  const crew = m.crew === null ? undefined : s.crews.find((c) => c.id === m.crew && !c.gone);
  const st = standings(s);
  const leg = s.leg;
  const owner = m.role === "double" && m.doubleOf !== null ? m.doubleOf : pid;
  const ownerPanel = s.members[owner]?.panel ?? [];
  const panel: PanelControlView[] = ownerPanel
    .map((id) => s.controls[id])
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => ({ id: c.id, name: c.name, type: c.type, state: c.state, icon: c.icon ?? null }));
  const order = m.order;
  const frozen = s.phase === "leg" && (leg?.event?.started === true || crew?.repair !== null);
  const ctl = order ? s.controls[order.control] : undefined;
  const orderView: PersonalView["order"] = order
    ? (() => {
        const left = Math.max(0, order.due - (crew?.clock ?? 0));
        const view: NonNullable<PersonalView["order"]> = {
          id: order.id,
          text: order.text,
          control: ctl?.name ?? "",
          mine: ctl?.owner === pid,
          dueAt: frozen ? null : toServer(s, now + left),
          left,
          frozen,
        };
        // Неприметная точка у края — только диверсанту и только у его ложного приказа.
        if (order.fake && crew?.saboteur === pid) view.mark = true;
        return view;
      })()
    : null;
  const ev = leg?.event ?? null;
  const joined = ev !== null && crew !== undefined && (ev.started ? ev.crews.includes(crew.id) : crew.finishedAt === null);
  const event: PersonalView["event"] = ev
    ? (() => {
        const view: NonNullable<PersonalView["event"]> = { id: ev.id, kind: ev.kind, warn: !ev.started, startsAt: toServer(s, ev.startAt), endsAt: toServer(s, ev.endAt), joined };
        if (ev.task !== undefined) view.task = ev.task;
        if (crew && ev.started && joined) {
          if (ev.kind === "meteor") {
            const p = ev.power?.[pid];
            view.meteor = { power: p ? Math.round(Math.min(100, Math.max(p.shake, (p.taps / 60) * 100))) : 0, shield: Math.round(meteorShield(s, ev, crew.id, (pid: string) => env.online(pid))) };
          }
          if (ev.kind === "pull" && crew.pull) {
            view.pull = {
              holding: ev.holds?.[pid]?.on === true,
              held: crew.pull.holdStart === null ? 0 : Math.max(0, now - crew.pull.holdStart),
              escaped: crew.pull.escaped,
              failed: crew.pull.failed,
              members: crewPlayers(s, crew.id)
                .filter((p) => env.online(p.pid))
                .map((p) => ({ name: p.name, holding: ev.holds?.[p.pid]?.on === true })),
            };
          }
          if (ev.kind === "sos" && crew.sos) {
            const cap = captainOf(s, crew.id, (pid: string) => env.online(pid));
            view.sos = {
              captain: cap?.pid === pid,
              captainName: cap?.name ?? null,
              progress: crew.sos.progress,
              length: ev.seq?.length ?? 0,
              blockedUntil: crew.sos.blockedUntil > now ? toServer(s, crew.sos.blockedUntil) : null,
              done: crew.sos.done,
            };
          }
        }
        return view;
      })()
    : null;
  const stageNow = s.phase === "leg" ? (leg?.stage ?? null) : null;
  // Окно роли одного вида у всех экипажа с диверсантом: по телефону роль не угадать.
  const role = s.phase === "leg" && crew?.saboteur != null && (stageNow === "launch" || stageNow === "fly") ? { saboteur: crew.saboteur === pid, seen: m.roleSeen } : null;
  const vote =
    stageNow === "vote" && leg?.voteEnds != null && crew
      ? {
          endsAt: toServer(s, leg.voteEnds),
          candidates: crewMembers(s, crew.id)
            .filter((x) => x.panel.length > 0 && x.pid !== pid)
            .map((x) => ({ pid: x.pid, name: x.name })),
          mine: m.vote,
          none: crew.saboteur === null,
        }
      : null;
  const result = stageNow === "voted" && crew ? (leg?.vote ?? []).find((r) => r.crew === crew.id) : undefined;
  const voted = stageNow === "voted" && crew ? (result ? { guessed: result.guessed, saboteur: result.name, me: result.saboteur === pid, none: false } : { guessed: false, saboteur: "", me: false, none: true }) : null;
  const flip = leg?.flip?.startedAt ?? null;
  const glitch = leg?.glitch?.startedAt ?? null;
  const card =
    (s.phase === "podium" || s.phase === "finished") && crew
      ? {
          place: st.get(crew)?.place ?? 1,
          total: crewTotal(crew),
          crewOrders: crew.legs.reduce((a, r) => a + (r?.done ?? 0), 0),
          myOrders: m.done,
          firstFinishes: crew.legs.filter((r) => r?.first === true).length,
          legs: crew.legs.filter((r) => r !== undefined && r !== null).length,
          guessed: crew.guessed,
          bestShield: Math.max(0, ...crew.legs.map((r) => r?.shield ?? 0)),
          ribbon: m.ribbons > 0,
        }
      : null;
  const legResult = crew && leg ? crew.legs[leg.index] : undefined;
  return {
    phase: s.phase,
    stage: stageNow,
    leg: s.legIndex,
    legs: s.content.legs,
    theme: s.content.theme,
    difficulty: s.content.difficulty,
    me: {
      pid,
      name: m.name,
      role: m.role,
      crew: m.crew,
      captain: crew !== undefined && captainOf(s, crew.id, (pid: string) => env.online(pid))?.pid === pid,
      doubleOf: m.doubleOf !== null ? (s.members[m.doubleOf]?.name ?? null) : null,
      pending: m.pending,
      done: m.done,
      legDone: m.legDone,
      moved: m.moved,
    },
    crew: crew
      ? {
          id: crew.id,
          name: crew.name,
          color: crew.color,
          icon: crew.icon,
          place: st.get(crew)?.place ?? 1,
          hull: round1(crew.hull),
          members: crewMembers(s, crew.id).map((x) => ({ name: x.name, online: env.online(x.pid), role: x.role })),
          offline: crewMembers(s, crew.id)
            .filter((x) => x.role !== "out" && !env.online(x.pid))
            .map((x) => x.name),
        }
      : null,
    lobby:
      s.phase === "lobby"
        ? {
            crews: Array.from({ length: lobbyCrewCount(s) }, (_, id) => {
              const count = activeMembers(s).filter((x) => x.crew === id).length;
              return { id, name: crewName(s.content.theme, id), count, full: count >= s.content.crewSize.max };
            }),
            choice: m.crew,
            max: s.content.crewSize.max,
          }
        : null,
    endsAt: endsAtOf(s),
    panel,
    flipUntil: flip !== null && now < flip + FLIP_MS ? toServer(s, flip + FLIP_MS) : null,
    glitchAt: glitch !== null ? toServer(s, glitch) : null,
    order: orderView,
    event,
    repair: crew?.repair ? { until: toServer(s, crew.repair.startedAt + REPAIR_MS), mine: 0, taps: crew.repair.taps, target: crew.repair.target } : null,
    finished: crew?.finishedAt != null,
    role,
    vote,
    voted,
    dock: legResult && (stageNow === "dock" || stageNow === "vote" || stageNow === "voted") ? { place: legResult.place, score: legResult.total, total: crew ? crewTotal(crew) : 0 } : null,
    card,
  };
}

export function hostView(s: BubState, env: ViewEnv): HostView {
  const now = gameNow(s, env);
  const leg = s.leg;
  const st = standings(s);
  const minutes = leg ? Math.max(1 / 60, leg.flight / 60_000) : 1;
  const crews = liveCrews(s).map((c) => {
    const members = crewMembers(s, c.id);
    const players = members.filter((m) => m.role === "player");
    return {
      id: c.id,
      name: c.name,
      place: st.get(c)?.place ?? 1,
      hull: round1(c.hull),
      rate: players.length > 0 ? round1(c.done / minutes / players.length) : 0,
      dist: round1(c.dist),
      score: st.get(c)?.score ?? 0,
      total: crewTotal(c),
      finished: c.finishedAt !== null,
      repair: c.repair !== null,
      players: players.length,
      doubles: members.filter((m) => m.role === "double").length,
      online: members.filter((m) => env.online(m.pid)).length,
      small: players.length < 3,
      members: members.map((m) => ({
        pid: m.pid,
        name: m.name,
        role: m.role,
        online: env.online(m.pid),
        offlineMs: m.offlineSince === null ? 0 : Math.max(0, now - m.offlineSince),
        removable: m.role !== "out" && m.offlineSince !== null && now - m.offlineSince >= KICK_AFTER_MS,
        pending: m.pending,
      })),
    };
  });
  const enabled = (["meteor", "pull", "sos", "captain"] as EventKind[]).filter((k) => s.content.events[k]);
  const next = leg && leg.stage === "fly" && !leg.event && leg.schedule[0] ? { kind: leg.schedule[0].kind, inMs: Math.max(0, leg.schedule[0].at - leg.flight) } : null;
  const ev = leg?.event ?? null;
  const captain = leg
    ? [...leg.history.filter((h) => h.kind === "captain"), ...(ev?.kind === "captain" ? [{ id: ev.id, kind: ev.kind, task: ev.task }] : [])].map((h) => ({ id: h.id, task: h.task ?? "", stars: leg.ratings[h.id] ?? {} }))
    : [];
  const active = activeMembers(s);
  const screen = screenView(s, env);
  return {
    phase: s.phase,
    stage: s.phase === "leg" ? (leg?.stage ?? null) : null,
    leg: s.legIndex,
    legs: s.content.legs,
    attempt: s.attempts[s.legIndex] ?? 0,
    endsAt: endsAtOf(s),
    flight: flightOf(s),
    orderSeconds: orderSeconds(s),
    crews,
    waiting: s.phase === "lobby" ? active.filter((m) => m.crew === null).map((m) => ({ pid: m.pid, name: m.name })) : [],
    lobbyCrews: screen.lobby?.crews.map((c) => ({ id: c.id, name: c.name, count: c.count })) ?? [],
    event: ev ? { id: ev.id, kind: ev.kind, warn: !ev.started, startsAt: toServer(s, ev.startAt), endsAt: toServer(s, ev.endAt), task: ev.task ?? null } : null,
    next,
    enabled,
    tasks: s.content.captainTasks,
    captain,
    dock: screen.dock,
    vote: screen.vote ? { endsAt: screen.vote.endsAt, voted: Object.values(screen.vote.voted).reduce((a, b) => a + b, 0), voters: Object.values(screen.vote.voters).reduce((a, b) => a + b, 0) } : null,
    reveal: screen.reveal,
    podium: screen.podium,
    canBack: s.phase === "leg" && s.base !== null && (leg?.stage === "dock" || leg?.stage === "vote" || leg?.stage === "voted"),
    removable: active
      .filter((m) => m.role !== "out" && m.offlineSince !== null && now - m.offlineSince >= KICK_AFTER_MS)
      .map((m) => ({ pid: m.pid, name: m.name, crew: m.crew, offlineMs: now - (m.offlineSince ?? now) })),
  };
}

/**
 * Личное — только при переменах: сразу тем, у кого что-то случилось (приказ, прибор, событие), и всем раз в 0,5 с
 * (место, корпус, кто на связи). Одинаковое второй раз не уходит.
 */
export function flushPersonal(s: BubState, env: ViewEnv & Pick<Env, "send">): void {
  const now = gameNow(s, env);
  const sweep = now - s.rt.lastSweep >= 500;
  const pids = sweep ? Object.keys(s.members) : [...s.rt.dirty];
  if (sweep) s.rt.lastSweep = now;
  s.rt.dirty.clear();
  for (const pid of pids) {
    const m = s.members[pid];
    if (!m || m.gone) continue;
    const view = personalView(s, pid, env);
    if (!view) continue;
    // Остаток времени приказа меняется каждый шаг — для сравнения его не берём (телефон считает сам по dueAt).
    const key = JSON.stringify({ ...view, order: view.order ? { ...view.order, left: 0, dueAt: view.order.frozen ? null : Math.round((view.order.dueAt ?? 0) / 250) } : null, event: view.event ? { ...view.event, pull: view.event.pull ? { ...view.event.pull, held: view.event.pull.held > 0 } : undefined } : null });
    if (s.rt.sent.get(pid) === key) continue;
    s.rt.sent.set(pid, key);
    env.send(pid, { t: "me", me: view });
  }
}
