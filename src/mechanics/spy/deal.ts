// Раздача «Шпиона» на пульте: карты шифруются ключами телефонов (как в «Мафии»), тайна партии — ключом ведущего.
import { isKey, newKey, seal, unseal } from "../mafia/seal";
import type { SpyContent } from "./content";
import { cardOf, paddedAll, parseCard, parseSecret, type SpyCard, type SpySecret } from "./logic";

/** Ключи телефонов из ответов шага раздачи. */
export function keysOf(answers: Array<{ pid: string; value: unknown }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of answers) {
    const k = typeof a.value === "object" && a.value !== null ? (a.value as Record<string, unknown>).key : null;
    if (isKey(k)) out[a.pid] = k;
  }
  return out;
}

const memoryKeys = new Map<string, string>();

/** Ключ ведущего (на устройстве пульта): им шифруется тайна партии — для пульта и игроков без телефона. */
export function hostKey(sessionId: string): string {
  const name = `joyrest.spy.host.${sessionId}`;
  try {
    const saved = localStorage.getItem(name);
    if (isKey(saved)) return saved;
    const key = newKey();
    localStorage.setItem(name, key);
    return key;
  } catch {
    const known = memoryKeys.get(sessionId);
    if (known) return known;
    const key = newKey();
    memoryKeys.set(sessionId, key);
    return key;
  }
}

/** Карты всем телефонам — своими ключами, все одной длины; тайна партии — ключом ведущего. */
export async function sealDeal(seats: string[], secret: SpySecret, content: SpyContent, keys: Record<string, string>, host: string): Promise<{ sealed: Record<string, string>; hostSeal: string }> {
  const cards: Record<string, SpyCard> = {};
  for (const pid of seats) if (keys[pid]) cards[pid] = cardOf(pid, secret, seats, content);
  const sealed: Record<string, string> = {};
  for (const [pid, card] of Object.entries(paddedAll(cards))) sealed[pid] = await seal(keys[pid] as string, card);
  return { sealed, hostSeal: await seal(host, secret) };
}

/** Тайна партии из `hostSeal` (тот же пульт, что раздавал). */
export async function secretFromHost(host: string, hostSeal: string | null): Promise<SpySecret | null> {
  if (!hostSeal) return null;
  return parseSecret(await unseal(host, hostSeal));
}

/**
 * Тайна по картам телефонов (второй пульт: ключа ведущего нет, но ключи телефонов он видит). Игроки без
 * телефона остаются неизвестны — `complete: false`.
 */
export async function secretFromCards(seats: string[], sealed: Record<string, string>, keys: Record<string, string>): Promise<{ secret: SpySecret | null; complete: boolean }> {
  const spies: string[] = [];
  const roles: Record<string, string> = {};
  let location: number | null = null;
  let known = 0;
  for (const pid of seats) {
    const key = keys[pid];
    const text = sealed[pid];
    if (!key || !text) continue;
    const card = parseCard(await unseal(key, text));
    if (!card) continue;
    known++;
    if (card.spy) spies.push(pid);
    else {
      roles[pid] = card.role;
      if (card.location !== null) location = card.location;
    }
  }
  if (location === null) return { secret: null, complete: false };
  return { secret: { location, spies, roles }, complete: known === seats.length };
}

/** Выбор ведущего за игроков без телефона (голос, догадка): на устройстве пульта. */
export function loadManual(scope: string, step: number): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(`joyrest.spy.manual.${scope}.${step}`) ?? "{}") as unknown;
    const out: Record<string, string> = {};
    if (typeof raw === "object" && raw !== null) for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function saveManual(scope: string, step: number, value: Record<string, string>): void {
  try {
    localStorage.setItem(`joyrest.spy.manual.${scope}.${step}`, JSON.stringify(value));
  } catch {
    // Нет хранилища — выбор живёт до перезагрузки пульта.
  }
}
