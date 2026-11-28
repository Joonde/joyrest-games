/** Модель пульта «Игр Матрёшки»: поток комнаты → последняя корректная сводка, серверные часы, ошибки и таблица платформы. */
import type { Leaderboard, LeaderboardEntry, RoomClosedReason, RoomLoopStats, RoomOfflinePlayer, RoomStreamEvent } from "../../../data/types";
import type { HostView } from "../rules/types";
import type { errorParts } from "./link";

export interface HostModel {
  view: HostView | null;
  moment: string;
  version: number;
  paused: boolean;
  pauseSince: number | null;
  restored: boolean;
  players: number;
  online: number;
  offline: RoomOfflinePlayer[];
  loop: RoomLoopStats | null;
  skew: number;
  closed: RoomClosedReason | null;
  seq: number;
}

export function emptyHost(): HostModel {
  return { view: null, moment: "", version: 0, paused: false, pauseSince: null, restored: false, players: 0, online: 0, offline: [], loop: null, skew: 0, closed: null, seq: 0 };
}

const PHASES = new Set(["lobby", "trial", "chance", "dobivka", "final", "podium", "finished"]);

export function isHostView(data: unknown): data is HostView {
  if (typeof data !== "object" || data === null) return false;
  const v = data as Partial<HostView>;
  return typeof v.phase === "string" && PHASES.has(v.phase) && typeof v.stage === "string" && typeof v.moment === "string" && typeof v.can === "object" && v.can !== null && Array.isArray(v.players) && Array.isArray(v.plan) && Array.isArray(v.returnable);
}

export function applyHost(m: HostModel, e: RoomStreamEvent, localNow: number): HostModel {
  switch (e.type) {
    case "host":
      return {
        view: isHostView(e.data) ? e.data : m.view,
        moment: e.moment,
        version: e.version,
        paused: e.paused,
        pauseSince: e.paused ? (m.pauseSince ?? e.at) : null,
        restored: e.restored,
        players: e.players,
        online: e.online,
        offline: e.offline,
        loop: e.loop,
        skew: e.at - localNow,
        closed: null,
        seq: m.seq + 1,
      };
    case "room":
      return { ...m, paused: e.paused, pauseSince: e.paused ? (m.pauseSince ?? e.at) : null, skew: e.at - localNow, seq: m.seq + 1 };
    case "closed":
      return { ...m, closed: e.reason };
    default:
      return m;
  }
}

/** Точка, на которой стоят отсчёты: серверный `pausedAt` важнее локального события паузы. */
export function pausedMomentOf(m: HostModel): number | null {
  const fromView = m.view?.pausedAt ?? null;
  if (fromView !== null) return fromView;
  return m.paused ? m.pauseSince : null;
}

export function leftOf(until: number | null, serverNow: number, pausedAt: number | null): number | null {
  if (until === null) return null;
  return Math.max(0, until - (pausedAt ?? serverNow));
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function nextLabel(v: HostView): string {
  if (v.phase === "dobivka") return "К сетке финала";
  const last = v.trialIndex + 1 >= v.plan.length;
  if (!last) return "Открыть следующую матрёшку";
  return v.inGame > v.F ? "Перейти к добивке" : "К сетке финала";
}

export function duelLabel(v: HostView): string {
  const f = typeof v.final === "object" && v.final !== null ? v.final as { stage?: unknown; at?: { round?: unknown }; rounds?: unknown } : null;
  if (!f) return "Начать дуэль";
  if (f.stage === "bracket") return "Начать первую дуэль";
  const at = f.at;
  const rounds = f.rounds;
  if (at && Array.isArray(rounds) && at.round === rounds.length - 1) return "К чемпиону";
  return "Следующая дуэль";
}

/** Короткие понятные отказы; `moved` молча ждёт свежую сводку. */
export function commandError(code: string, reason: string): string | null {
  if (code === "failed-precondition") {
    switch (reason) {
      case "moved": return null;
      case "no-players": return "Пока мало игроков — дождитесь гостей.";
      case "paused": return "Игра на паузе — сначала «Продолжить».";
      case "limit": return "Уже добавлено максимум 60 секунд.";
      case "finished": return "Игра уже завершена.";
      case "wrong-phase":
      case "no-player":
      case "not-out":
      case "not-player": return "Игра уже изменилась — проверьте текущий этап.";
      default: return "Сейчас это сделать нельзя — игра ушла дальше.";
    }
  }
  if (code === "permission-denied") return "Управлять игрой может только ведущий этой игры.";
  if (code === "not-found") return "Игра не найдена — откройте пульт заново из студии.";
  if (code === "invalid-argument") return "Не получилось — обновите пульт.";
  return "Нет связи — проверьте интернет и нажмите ещё раз.";
}

/** Сводки с местами: сетка, дуэли, чемпион, пьедестал и завершение. */
export function syncsLeaderboard(v: HostView): boolean {
  return (v.phase === "final" || v.phase === "podium" || v.phase === "finished") && Array.isArray(v.standings);
}

/** Итоги solo: запись по pid; опоздавшие болельщики удаляются из платформенной таблицы и не попадают в результаты. */
export function leaderboardChange(v: HostView, board: Leaderboard): Record<string, LeaderboardEntry | null> {
  if (!Array.isArray(v.standings)) return {};
  const change: Record<string, LeaderboardEntry | null> = {};
  for (const row of v.standings) {
    const current = board[row.pid];
    if (current && current.name === row.name && current.kind === "player" && current.score === row.points && current.group === undefined) continue;
    change[row.pid] = { name: row.name, kind: "player", score: row.points };
  }
  for (const player of v.players) {
    if (player.late && board[player.pid]) change[player.pid] = null;
  }
  return change;
}

export type ErrorParts = ReturnType<typeof errorParts>;
