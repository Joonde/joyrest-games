/**
 * Сводки «Бубликатора»: экран (без тайн — ни диверсантов, ни ложных приказов, ни чужих приказов), личное каждому телефону
 * (свои приборы, свой приказ, своя роль; пометка ложного приказа — только диверсанту) и пульт. Время — по часам сервера.
 */
import { FIRE_STREAK, GLITCH_SHOW_MS, FLIP_MS, KICK_AFTER_MS, REPAIR_MS, SPEED_WINDOW_MS } from "./constants";
import { activeMembers, captainOf, crewMembers, crewPlayers, crewTitle, liveCrews, lobbyCrewCount } from "./crews";
import { crewLook } from "./names";
import { cardStats, crewTotal, gameNow, legResultOf, meteorPower, meteorShield, orderSeconds, places, toServer, voteCandidates, voteVoters, type Env } from "./game";
import type { BubState, Crew, CrewSummary, EventKind, HostView, Member, PanelControlView, PersonalView, ScreenCrewView, ScreenView } from "./types";

type ViewEnv = Pick<Env, "now" | "online" | "paused">;

/**
 * Общее для всех телефонов за одну рассылку — считается один раз, а не на каждый телефон: места, капитаны, щиты, лобби,
 * сводки экипажей, кандидаты голосования.
 */
export interface Frame {
  now: number;
  st: Map<Crew, { score: number; place: number }>;
  captains: Map<number, Member | null>;
  shields: Map<number, number>;
  lobby: { crews: Array<{ id: number; name: string; count: number; full: boolean }>; max: number } | null;
  summaries: Map<number, { view: CrewSummary; key: string }>;
  candidates: Map<number, Array<{ pid: string; name: string }>>;
}

export function frameOf(s: BubState, env: ViewEnv): Frame {
  const now = gameNow(s, env);
  const online = (pid: string) => env.online(pid);
  const crews = liveCrews(s);
  const ev = s.leg?.event ?? null;
  const captains = new Map<number, Member | null>();
  const shields = new Map<number, number>();
  for (const c of crews) {
    captains.set(c.id, captainOf(s, c.id, online));
    if (ev?.kind === "meteor" && ev.started && ev.crews.includes(c.id)) shields.set(c.id, meteorShield(s, ev, c.id, online, now));
  }
  let lobby: Frame["lobby"] = null;
  if (s.phase === "lobby") {
    const count = new Map<number, number>();
    for (const m of activeMembers(s)) if (m.crew !== null) count.set(m.crew, (count.get(m.crew) ?? 0) + 1);
    const max = s.content.crewSize.max;
    lobby = {
      crews: Array.from({ length: lobbyCrewCount(s) }, (_, id) => ({ id, name: crewTitle(s, id), count: count.get(id) ?? 0, full: (count.get(id) ?? 0) >= max })),
      max,
    };
  }
  return { now, st: standings(s), captains, shields, lobby, summaries: new Map(), candidates: new Map() };
}

/**
 * Состав экипажа (кто, роль, на связи): уходит телефонам экипажа отдельно (`{ t: "crew" }`) и только при переменах — состав
 * меняется редко. Корпус и место меняются часто — они в личном (`ship`), малым кусочком.
 */
function summaryOf(s: BubState, crew: Crew, env: ViewEnv, f: Frame): { view: CrewSummary; key: string } {
  const known = f.summaries.get(crew.id);
  if (known) return known;
  const members = crewMembers(s, crew.id);
  const view: CrewSummary = {
    id: crew.id,
    name: crew.name,
    color: crew.color,
    icon: crew.icon,
    members: members.map((x) => ({ name: x.name, online: env.online(x.pid), role: x.role })),
    offline: members.filter((x) => x.role !== "out" && !env.online(x.pid)).map((x) => x.name),
  };
  const out = { view, key: JSON.stringify(view) };
  f.summaries.set(crew.id, out);
  return out;
}

function candidatesOf(s: BubState, crew: number, f: Frame): Array<{ pid: string; name: string }> {
  const known = f.candidates.get(crew);
  if (known) return known;
  const list = voteCandidates(s, crew).map((x) => ({ pid: x.pid, name: x.name }));
  f.candidates.set(crew, list);
  return list;
}

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
  const online = (pid: string) => env.online(pid);
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
    const sos = ev?.kind === "sos" && ev.started && c.sos ? { progress: c.sos.progress, done: c.sos.done, captain: captainOf(s, c.id, online)?.name ?? null } : null;
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
      shield: ev?.kind === "meteor" && ev.started && ev.crews.includes(c.id) ? Math.round(meteorShield(s, ev, c.id, online, now)) : null,
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
              return { id, name: crewTitle(s, id), color: look.color, icon: look.icon, count: names.length, names };
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
            const ms = voteVoters(s, c.id);
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

/**
 * Личное телефона. `withCrew` — со сводкой экипажа (снимок при подписке и опрос); рассылка шлёт сводку отдельно
 * (`{ t: "crew" }`) и только при переменах.
 */
export function personalView(s: BubState, pid: string, env: ViewEnv, frame?: Frame, withCrew = true): PersonalView | null {
  const m = s.members[pid];
  if (!m) return null;
  const f = frame ?? frameOf(s, env);
  const now = f.now;
  const crew = m.crew === null ? undefined : s.crews.find((c) => c.id === m.crew && !c.gone);
  const st = f.st;
  const leg = s.leg;
  const owner = m.role === "double" && m.doubleOf !== null ? m.doubleOf : pid;
  const ownerPanel = s.members[owner]?.panel ?? [];
  const panel: PanelControlView[] = ownerPanel
    .map((id) => s.controls[id])
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => ({ id: c.id, name: c.name, type: c.type, state: c.state, icon: c.icon ?? null, tint: c.tint ?? null }));
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
          // Сколько всего дали на приказ (с «Медленнее»/«Быстрее» и сгоревшими секундами) — для полоски на телефоне.
          total: Math.max(left, order.due - order.issuedClock),
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
            view.meteor = { power: Math.round(meteorPower(ev, pid, now)), shield: Math.round(f.shields.get(crew.id) ?? 0) };
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
            const cap = f.captains.get(crew.id) ?? null;
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
  // Голосуют экипажем, в котором были на старте перелёта (пересадка на «Привале» этого не меняет).
  const voteAt = leg?.roster?.[pid] ?? m.crew;
  const voteCrew = voteAt === null || voteAt === undefined ? undefined : s.crews.find((c) => c.id === voteAt);
  const vote =
    stageNow === "vote" && leg?.voteEnds != null && voteCrew
      ? {
          endsAt: toServer(s, leg.voteEnds),
          candidates: candidatesOf(s, voteCrew.id, f).filter((x) => x.pid !== pid),
          mine: m.vote,
          none: voteCrew.saboteur === null,
        }
      : null;
  const result = stageNow === "voted" && voteCrew ? (leg?.vote ?? []).find((r) => r.crew === voteCrew.id) : undefined;
  const voted = stageNow === "voted" && voteCrew ? (result ? { guessed: result.guessed, saboteur: result.name, me: result.saboteur === pid, none: false } : { guessed: false, saboteur: "", me: false, none: true }) : null;
  const flip = leg?.flip?.startedAt ?? null;
  const glitch = leg?.glitch?.startedAt ?? null;
  const final = (s.phase === "podium" || s.phase === "finished") && crew ? cardStats(crew) : null;
  const card =
    final && crew
      ? {
          place: st.get(crew)?.place ?? 1,
          total: crewTotal(crew),
          // Вместе с влитыми экипажами — как и очки (`crewTotal`).
          crewOrders: final.orders,
          myOrders: m.done,
          firstFinishes: final.firsts,
          legs: final.legs,
          guessed: crew.guessed,
          bestShield: final.shield,
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
      captain: crew !== undefined && f.captains.get(crew.id)?.pid === pid,
      doubleOf: m.doubleOf !== null ? (s.members[m.doubleOf]?.name ?? null) : null,
      pending: m.pending,
      done: m.done,
      legDone: m.legDone,
      moved: m.moved,
    },
    ...(withCrew ? { crew: crew ? summaryOf(s, crew, env, f).view : null } : {}),
    ship: crew ? { place: st.get(crew)?.place ?? 1, hull: round1(crew.hull) } : null,
    lobby: f.lobby ? { crews: f.lobby.crews, choice: m.crew, max: f.lobby.max } : null,
    endsAt: endsAtOf(s),
    panel,
    flipUntil: flip !== null && now < flip + FLIP_MS ? toServer(s, flip + FLIP_MS) : null,
    glitchAt: glitch !== null ? toServer(s, glitch) : null,
    order: orderView,
    event,
    repair: crew?.repair ? { until: toServer(s, crew.repair.startedAt + REPAIR_MS), mine: crew.repair.by?.[pid] ?? 0, taps: crew.repair.taps, target: crew.repair.target } : null,
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
 * Ключ поля личного для сравнения (рассылка всем 500 телефонам — часто, поэтому частые поля — без JSON): остаток времени
 * приказа и «сколько держат» меняются каждый шаг — телефон считает их сам. Название, вид и текст у прибора и приказа с тем же
 * id не меняются — в ключе только id и то, что меняется.
 */
function fieldKey(key: string, value: unknown): string {
  if (value === null || typeof value !== "object") return typeof value === "string" ? `s${value}` : String(value);
  switch (key) {
    case "panel": {
      let k = "";
      for (const c of value as PanelControlView[]) k += `${c.id}:${c.state},`;
      return k;
    }
    case "order": {
      const o = value as NonNullable<PersonalView["order"]>;
      return `${o.id}|${o.frozen ? "f" : Math.round((o.dueAt ?? 0) / 250)}|${o.mark === true ? 1 : 0}|${o.mine ? 1 : 0}`;
    }
    case "ship": {
      const sh = value as NonNullable<PersonalView["ship"]>;
      return `${sh.place}|${sh.hull}`;
    }
    case "me": {
      const me = value as PersonalView["me"];
      return `${me.name}|${me.role}|${me.crew}|${me.captain ? 1 : 0}|${me.doubleOf}|${me.pending ? 1 : 0}|${me.done}|${me.legDone}|${me.moved}`;
    }
    case "event": {
      const e = value as NonNullable<PersonalView["event"]>;
      return JSON.stringify({ ...e, pull: e.pull ? { ...e.pull, held: e.pull.held > 0 } : undefined });
    }
    default:
      return JSON.stringify(value) ?? "null";
  }
}

/**
 * Личное целиком для снимка (подписка, переподключение, опрос): телефон начинает с него, поэтому прошлая рассылка этому
 * телефону забывается — следующая уходит целиком (и состав экипажа), а не кусочками от того, что телефон уже не помнит.
 * Иначе поле, вернувшееся к значению прошлой рассылки, на телефоне «застревало» на значении снимка (ревью 6 ноября 2026).
 */
export function personalSnapshot(s: BubState, pid: string, env: ViewEnv): PersonalView | null {
  s.rt.sent.delete(pid);
  s.rt.sentCrew.delete(pid);
  s.rt.dirty.add(pid);
  return personalView(s, pid, env);
}

/**
 * Личное — только при переменах: сразу тем, у кого что-то случилось (приказ, прибор, событие), и всем раз в 0,5 с
 * (место, корпус, кто на связи). Уходят только изменившиеся поля (`{ t: "me", me: { …изменившееся } }`; первое — целиком,
 * `full: true`): телефон дописывает их к последнему личному (снимок при подписке — всё сразу). Состав экипажа — отдельно.
 */
export function flushPersonal(s: BubState, env: ViewEnv & Pick<Env, "send">): void {
  const now = gameNow(s, env);
  const sweep = now - s.rt.lastSweep >= 500;
  if (!sweep && s.rt.dirty.size === 0) return;
  const pids = sweep ? Object.keys(s.members) : [...s.rt.dirty];
  if (sweep) s.rt.lastSweep = now;
  s.rt.dirty.clear();
  const f = frameOf(s, env);
  for (const pid of pids) {
    const m = s.members[pid];
    if (!m || m.gone) continue;
    const crew = m.crew === null ? undefined : s.crews.find((c) => c.id === m.crew && !c.gone);
    const summary = crew ? summaryOf(s, crew, env, f) : null;
    const crewKey = summary?.key ?? "";
    if (s.rt.sentCrew.get(pid) !== crewKey) {
      s.rt.sentCrew.set(pid, crewKey);
      env.send(pid, { t: "crew", crew: summary?.view ?? null });
    }
    const view = personalView(s, pid, env, f, false);
    if (!view) continue;
    const before = s.rt.sent.get(pid);
    const keys: Record<string, string> = {};
    const changed: Record<string, unknown> = {};
    let any = false;
    for (const [k, value] of Object.entries(view)) {
      const key = fieldKey(k, value);
      keys[k] = key;
      if (before?.[k] !== key) {
        changed[k] = value;
        any = true;
      }
    }
    if (!any) continue;
    s.rt.sent.set(pid, keys);
    env.send(pid, before ? { t: "me", me: changed } : { t: "me", me: view, full: true });
  }
}
