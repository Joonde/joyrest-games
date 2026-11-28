/**
 * Управляемое командное лобби (docs/TEAM_LOBBY_AND_COLLABORATION_TZ_2026-11-22.md, разделы 4–6): чистые правила без
 * базы и сети. Ими пользуются сервер (`server/src/teamLobby.ts`) и пульт. Случайность — аргументом: сервер передаёт
 * криптостойкий `randomInt`, тесты — свой.
 */
import type { Participant, TeamFormation, TeamFormationMode } from "../data/types";

export const TEAM_LIMITS = {
  minTeams: 1,
  maxTeams: 20,
  defaultTeams: 6,
  minMembers: 2,
  maxMembers: 10,
  defaultMembers: 10,
  /** Расчётный максимум платформы — 100 гостей на сессию (решение владельца): `teamCount × maxMembers ≤ 100`. */
  maxSeats: 100,
} as const;

const MODES = new Set<TeamFormationMode>(["self", "randomTeams"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const intIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Настройки ведущего: `null` — годятся, иначе код отказа (ТЗ, раздел 17). */
export function settingsError(teamCount: unknown, maxMembers: unknown): "invalid-argument" | "capacity-limit" | null {
  if (!intIn(teamCount, TEAM_LIMITS.minTeams, TEAM_LIMITS.maxTeams)) return "invalid-argument";
  if (!intIn(maxMembers, TEAM_LIMITS.minMembers, TEAM_LIMITS.maxMembers)) return "invalid-argument";
  return teamCount * maxMembers > TEAM_LIMITS.maxSeats ? "capacity-limit" : null;
}

export function isFormationMode(value: unknown): value is TeamFormationMode {
  return MODES.has(value as TeamFormationMode);
}

/**
 * Хранимые настройки (`sessions.team_formation`). Нет, не объект или неизвестный режим — прежнее лобби (`null`), без
 * ошибок (ТЗ 12.4). Неверные числа не роняют телефон: остаются как есть, а действия ведущего проверяет `settingsError`.
 */
export function parseTeamFormation(value: unknown): TeamFormation | null {
  if (!isRecord(value) || !isFormationMode(value.mode)) return null;
  const excluded = Array.isArray(value.excluded) ? value.excluded.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  return {
    mode: value.mode,
    teamCount: typeof value.teamCount === "number" && Number.isFinite(value.teamCount) ? value.teamCount : TEAM_LIMITS.defaultTeams,
    maxMembers: typeof value.maxMembers === "number" && Number.isFinite(value.maxMembers) ? value.maxMembers : TEAM_LIMITS.defaultMembers,
    revision: typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    distributed: value.distributed === true,
    excluded,
  };
}

/**
 * Последняя `revision` хранимого значения — и у прежнего лобби (`{ mode: "legacy", revision }` после возврата из
 * управляемого): новая `revision` продолжает её, а не начинается с 1 (запоздалый запрос старого лобби не пройдёт).
 */
export function formationRevision(value: unknown): number {
  return isRecord(value) && typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
}

/** Настройки для гостей и экрана: без списка исключённых (его видит только пульт). */
export function publicFormation(formation: TeamFormation): TeamFormation {
  const { excluded: _excluded, ...rest } = formation;
  return rest;
}

/** Новые настройки при создании сессии: `{ mode, teamCount?, maxMembers? }`; неверные — `null` (`mode: "legacy"` — прежнее лобби, это решает вызывающий). */
export function newFormation(value: unknown): TeamFormation | null {
  if (!isRecord(value) || !isFormationMode(value.mode)) return null;
  const teamCount = value.teamCount ?? TEAM_LIMITS.defaultTeams;
  const maxMembers = value.maxMembers ?? TEAM_LIMITS.defaultMembers;
  if (settingsError(teamCount, maxMembers)) return null;
  return { mode: value.mode, teamCount: teamCount as number, maxMembers: maxMembers as number, revision: 1, distributed: false, excluded: [] };
}

/**
 * Название для сравнения: без смайлика и знаков в начале, без регистра, «ё» = «е», пробелы схлопнуты (ТЗ 6.1.4).
 * «🦊 Лисы», «лисы» и «ЛИСЫ!» — одно название; «Лисы 2» — другое.
 */
export function teamNameKey(name: string): string {
  return name
    .normalize("NFC")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Готовые названия случайных команд (ТЗ 6.2.9): не «Команда N» — экран зала при скрытых названиях сам подписывает
 * команды «Команда N» по порядку, и «Команда 4», показанная как «Команда 2», запутала бы зал.
 */
export const AUTO_TEAM_NAMES = [
  "🦊 Лисы",
  "🦉 Совы",
  "🐺 Волки",
  "🐻 Медведи",
  "🦁 Львы",
  "🐯 Тигры",
  "🦅 Орлы",
  "🐬 Дельфины",
  "🐝 Пчёлы",
  "🦄 Единороги",
  "🐧 Пингвины",
  "🦒 Жирафы",
  "🐼 Панды",
  "🦩 Фламинго",
  "🐢 Черепахи",
  "🦔 Ежи",
  "🐙 Осьминоги",
  "🦋 Бабочки",
  "🐿️ Белки",
  "🦌 Олени",
  "🐳 Киты",
  "🦜 Попугаи",
  "🐨 Коалы",
  "🦘 Кенгуру",
] as const;

export type RandomInt = (maxExclusive: number) => number;

/** Перемешивание Фишера — Йетса (новый массив). */
export function shuffled<T>(items: readonly T[], randomInt: RandomInt): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** `count` разных готовых названий, не совпадающих с занятыми (по `teamNameKey`); не хватило списка — с номером. */
export function autoTeamNames(count: number, taken: readonly string[], randomInt: RandomInt): string[] {
  const used = new Set(taken.map(teamNameKey));
  const out: string[] = [];
  for (const name of shuffled(AUTO_TEAM_NAMES, randomInt)) {
    if (out.length >= count) break;
    if (used.has(teamNameKey(name))) continue;
    used.add(teamNameKey(name));
    out.push(name);
  }
  for (let n = 2; out.length < count; n++) {
    for (const base of AUTO_TEAM_NAMES) {
      if (out.length >= count) break;
      const name = `${base} ${n}`;
      if (used.has(teamNameKey(name))) continue;
      used.add(teamNameKey(name));
      out.push(name);
    }
  }
  return out;
}

/** Полное случайное распределение (ТЗ 6.2.5–7): по кругу `shuffled[i] → team[i % teamCount]`, размеры отличаются ≤ 1. */
export function planDistribution(players: readonly string[], teamCount: number, randomInt: RandomInt): string[][] {
  const teams: string[][] = Array.from({ length: teamCount }, () => []);
  shuffled(players, randomInt).forEach((pid, i) => teams[i % teamCount]?.push(pid));
  return teams;
}

/**
 * «Распределить оставшихся» (ТЗ 6.2.13, 6.3.8–9): каждого — в самую малочисленную команду со свободным местом (при
 * равенстве — случайную). Мест не хватило — остаток отдельным списком; переполненной команды не бывает.
 */
export function planAutoAssign(
  players: readonly string[],
  teams: ReadonlyArray<{ id: string; size: number }>,
  maxMembers: number,
  randomInt: RandomInt,
): { assigned: Array<[pid: string, teamId: string]>; rest: string[] } {
  const sizes = shuffled(teams, randomInt).map((t) => ({ id: t.id, size: t.size }));
  const assigned: Array<[string, string]> = [];
  const rest: string[] = [];
  for (const pid of shuffled(players, randomInt)) {
    let best: { id: string; size: number } | null = null;
    for (const team of sizes) if (team.size < maxMembers && (!best || team.size < best.size)) best = team;
    if (!best) {
      rest.push(pid);
      continue;
    }
    best.size += 1;
    assigned.push([pid, best.id]);
  }
  return { assigned, rest };
}

export interface CaptainCandidate {
  id: string;
  joinedAt: number | null;
  online: boolean;
  noCaptain: boolean;
}

/** По времени входа, затем по id (ТЗ 6.1.8). */
const byJoin = (a: CaptainCandidate, b: CaptainCandidate) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id);

/**
 * Выбор капитана системой (ТЗ 6.5): согласные на связи → все на связи → согласные не на связи → все. `random` —
 * случайно внутри группы (распределение), иначе первый по времени входа (выход капитана). `unwilling` — капитаном стал
 * отметивший «Не хочу быть капитаном»: пульт предупреждает ведущего.
 */
export function pickCaptain(candidates: readonly CaptainCandidate[], randomInt?: RandomInt): { id: string; unwilling: boolean } | null {
  const groups = [
    candidates.filter((c) => c.online && !c.noCaptain),
    candidates.filter((c) => c.online),
    candidates.filter((c) => !c.noCaptain),
    [...candidates],
  ];
  for (const group of groups) {
    if (group.length === 0) continue;
    const chosen = randomInt ? group[randomInt(group.length)] : [...group].sort(byJoin)[0];
    if (chosen) return { id: chosen.id, unwilling: chosen.noCaptain };
  }
  return null;
}

/**
 * Команды, где капитан отметил «Не хочу быть капитаном» (ТЗ 6.5): пульт показывает предупреждение. Не хранится — по
 * участникам; покрывает и случай, когда галочку поставил уже действующий капитан.
 */
export function unwillingCaptains(participants: readonly Participant[]): string[] {
  const byId = new Map(participants.map((p) => [p.id, p]));
  return participants
    .filter((t) => t.kind === "team")
    .filter((t) => {
      const captain = byId.get(t.captainUid);
      return captain?.kind === "player" && captain.teamId === t.id && captain.noCaptain === true;
    })
    .map((t) => t.id);
}
