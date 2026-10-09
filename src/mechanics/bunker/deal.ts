// Тайные карты «Бункера» на пульте: каждому телефону — его персонаж своим ключом, всё тайное игры —
// ключом ведущего. Шифрование то же, что в «Мафии» (`../mafia/seal`).
import { CATS } from "./decks";
import type { Secrets } from "./logic";
import { isKey, newKey, seal, unseal } from "../mafia/seal";
import { isSpecial, type Character } from "./specials";
import { isRef } from "./decks";

/** Карта телефона: свой персонаж и личные заметки. */
export interface PhoneCard {
  char: Character;
  notes: string[];
}

export function keysOf(answers: Array<{ pid: string; value: unknown }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of answers) {
    const k = typeof a.value === "object" && a.value !== null ? (a.value as Record<string, unknown>).key : null;
    if (isKey(k)) out[a.pid] = k;
  }
  return out;
}

const memoryKeys = new Map<string, string>();

/** Ключ ведущего для этой игры (на устройстве пульта). */
export function hostKey(sessionId: string): string {
  const name = `joyrest.bunker.host.${sessionId}`;
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

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** Все карты одной длины (в байтах): по длине шифра не понять, у кого больше заметок. */
export function padAll<T extends object>(items: Record<string, T>, min = 600): Record<string, T & { _: string }> {
  const longest = Math.max(min, ...Object.values(items).map((d) => bytes({ ...d, _: "" })));
  const out: Record<string, T & { _: string }> = {};
  for (const [k, d] of Object.entries(items)) out[k] = { ...d, _: "#".repeat(Math.max(0, longest - bytes({ ...d, _: "" }))) };
  return out;
}

/** Зашифровать: телефоны — свои карты, ведущий — всё. */
export async function sealAll(secrets: Secrets, keys: Record<string, string>, host: string): Promise<{ sealed: Record<string, string>; hostSeal: string }> {
  const cards: Record<string, PhoneCard> = {};
  for (const [pid, char] of Object.entries(secrets.chars)) if (keys[pid]) cards[pid] = { char, notes: secrets.notes[pid] ?? [] };
  const sealed: Record<string, string> = {};
  for (const [pid, card] of Object.entries(padAll(cards))) sealed[pid] = await seal(keys[pid] as string, card);
  return { sealed, hostSeal: await seal(host, secrets) };
}

export function parseChar(v: unknown): Character | null {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  if (!isSpecial(d.special)) return null;
  const out: Record<string, string> = {};
  for (const c of CATS) {
    if (!isRef(c, d[c])) return null;
    out[c] = d[c] as string;
  }
  return { ...(out as Record<(typeof CATS)[number], string>), special: d.special };
}

export function parseSecrets(v: unknown): Secrets | null {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  const chars: Record<string, Character> = {};
  for (const [k, c] of Object.entries((d.chars as Record<string, unknown>) ?? {})) {
    const ch = parseChar(c);
    if (ch) chars[k] = ch;
  }
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((n): n is number => typeof n === "number") : []);
  const notes: Record<string, string[]> = {};
  for (const [k, n] of Object.entries((d.notes as Record<string, unknown>) ?? {})) if (Array.isArray(n)) notes[k] = n.filter((x): x is string => typeof x === "string");
  return { chars, bunker: list(d.bunker), threats: list(d.threats), notes };
}

export async function secretsFromHost(host: string, hostSeal: string | null): Promise<Secrets | null> {
  return hostSeal ? parseSecrets(await unseal(host, hostSeal)) : null;
}

/** Своя карта телефона. */
export async function openPhoneCard(key: string, sealed: unknown): Promise<PhoneCard | null> {
  const d = await unseal(key, sealed);
  if (typeof d !== "object" || d === null) return null;
  const char = parseChar((d as Record<string, unknown>).char);
  const notes = (d as Record<string, unknown>).notes;
  return char ? { char, notes: Array.isArray(notes) ? notes.filter((x): x is string => typeof x === "string") : [] } : null;
}

/** Второй пульт без ключа ведущего: персонажи по картам телефонов (тайное бункера ему не видно). */
export async function charsFromCards(sealed: Record<string, string>, keys: Record<string, string>): Promise<Record<string, Character>> {
  const out: Record<string, Character> = {};
  for (const [pid, text] of Object.entries(sealed)) {
    const key = keys[pid];
    if (!key) continue;
    const card = await openPhoneCard(key, text);
    if (card) out[pid] = card.char;
  }
  return out;
}

