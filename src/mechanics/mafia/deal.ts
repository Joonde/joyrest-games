// Раздача и ночные подсказки на пульте: шифрование ключами телефонов и ключом ведущего.
import type { RoleId } from "./content";
import { isRole, paddedAll, roleCard, type RoleCard, type Whisper } from "./logic";
import { isKey, newKey, seal, unseal } from "./seal";

/** Ключи телефонов из ответов шага раздачи. */
export function keysOf(answers: Array<{ pid: string; value: unknown }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of answers) {
    const k = typeof a.value === "object" && a.value !== null ? (a.value as Record<string, unknown>).key : null;
    if (isKey(k)) out[a.pid] = k;
  }
  return out;
}

/** Ключ ведущего (на устройстве пульта): им шифруются все роли — для пульта и игроков без телефона. */
export function hostKey(sessionId: string): string {
  const name = `joyrest.mafia.host.${sessionId}`;
  try {
    const saved = localStorage.getItem(name);
    if (isKey(saved)) return saved;
    const key = newKey();
    localStorage.setItem(name, key);
    return key;
  } catch {
    return memoryKeys.get(sessionId) ?? (memoryKeys.set(sessionId, newKey()).get(sessionId) as string);
  }
}

const memoryKeys = new Map<string, string>();

/** Карты ролей: каждому телефону — своим ключом, все одной длины; все роли — ключом ведущего. */
export async function sealDeal(seats: string[], roles: Record<string, RoleId>, names: Record<string, string>, keys: Record<string, string>, host: string): Promise<{ sealed: Record<string, string>; hostSeal: string }> {
  const cards: Record<string, RoleCard> = {};
  for (const pid of seats) if (keys[pid]) cards[pid] = roleCard(pid, roles, seats, names);
  const sealed: Record<string, string> = {};
  for (const [pid, card] of Object.entries(paddedAll(cards))) sealed[pid] = await seal(keys[pid] as string, card);
  return { sealed, hostSeal: await seal(host, { roles }) };
}

/** Роли из `hostSeal` (тот же пульт, что раздавал). */
export async function rolesFromHost(host: string, hostSeal: string | null): Promise<Record<string, RoleId> | null> {
  if (!hostSeal) return null;
  const data = await unseal(host, hostSeal);
  const raw = typeof data === "object" && data !== null ? (data as Record<string, unknown>).roles : null;
  if (typeof raw !== "object" || raw === null) return null;
  const out: Record<string, RoleId> = {};
  for (const [k, v] of Object.entries(raw)) if (isRole(v)) out[k] = v;
  return out;
}

/** Роли по картам телефонов (второй пульт: ключа ведущего нет, но ключи телефонов он видит). */
export async function rolesFromCards(sealed: Record<string, string>, keys: Record<string, string>): Promise<Record<string, RoleId>> {
  const out: Record<string, RoleId> = {};
  for (const [pid, text] of Object.entries(sealed)) {
    const key = keys[pid];
    if (!key) continue;
    const card = await unseal(key, text);
    const role = typeof card === "object" && card !== null ? (card as Record<string, unknown>).role : null;
    if (isRole(role)) out[pid] = role;
  }
  return out;
}

/** Ночные подсказки: каждому живому с телефоном, все одной длины. */
export async function sealWhispers(items: Record<string, Whisper>, keys: Record<string, string>): Promise<Record<string, string>> {
  const own: Record<string, Whisper> = {};
  for (const [pid, w] of Object.entries(items)) if (keys[pid]) own[pid] = w;
  const out: Record<string, string> = {};
  for (const [pid, w] of Object.entries(paddedAll(own))) out[pid] = await seal(keys[pid] as string, w);
  return out;
}

/** Выбор ведущего за игроков без телефона (ночью и на голосовании): на устройстве пульта. */
export function loadManual(sessionId: string, step: number): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(`joyrest.mafia.manual.${sessionId}.${step}`) ?? "{}") as unknown;
    const out: Record<string, string> = {};
    if (typeof raw === "object" && raw !== null) for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function saveManual(sessionId: string, step: number, value: Record<string, string>): void {
  try {
    localStorage.setItem(`joyrest.mafia.manual.${sessionId}.${step}`, JSON.stringify(value));
  } catch {
    // Нет хранилища — выбор живёт до перезагрузки пульта.
  }
}
