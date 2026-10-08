/**
 * Вход ведущих на своём сервере: `/api/auth/me`, `login`, `logout`, `password`.
 * Профиль приходит вместе со входом — отдельного запроса за ним нет.
 * Гости и экран зала входят анонимно — по устройству (`/api/auth/device`, cookie `__Host-jr_d`).
 */
import type { AuthService, AuthUser } from "../contracts";
import { describeAuthError } from "../authErrors";
import { Cancelled, withRetry } from "../retry";
import type { Role, UserProfile } from "../types";
import { api, ApiError, asRecord, asText } from "./api";

interface Me {
  user: AuthUser | null;
  profile: UserProfile | null;
}

function parseRole(value: unknown): Role {
  return value === "admin" ? "admin" : "host";
}

export function parseProfile(value: unknown): UserProfile | null {
  const data = asRecord(value);
  const uid = asText(data.uid);
  if (!uid) return null;
  const profile: UserProfile = {
    uid,
    role: parseRole(data.role),
    name: asText(data.name),
    active: data.active === true,
    email: asText(data.email),
    mustChangePassword: data.mustChangePassword === true,
  };
  const level = data.level;
  if (level === "intern" || level === "novice" || level === "host" || level === "top") profile.level = level;
  if (typeof data.experienceSince === "number") profile.experienceSince = data.experienceSince;
  if (data.venueAccess === true) profile.venueAccess = true;
  // «Ведущий» — по умолчанию, в профиле не храним (так было до профессий).
  if (typeof data.accessRole === "string" && /^[a-z]{2,20}$/.test(data.accessRole)) profile.accessRole = data.accessRole;
  if (typeof data.profession === "string" && data.profession !== "host" && /^[a-z]{2,20}$/.test(data.profession)) profile.profession = data.profession;
  return profile;
}

function parseMe(value: unknown): Me {
  const data = asRecord(value);
  const user = asRecord(data.user);
  const uid = asText(user.uid);
  return {
    user: uid ? { uid, anonymous: false, email: asText(user.email) || null } : null,
    profile: parseProfile(data.profile),
  };
}

type Listener = (user: AuthUser | null) => void;
const listeners = new Set<Listener>();
/** Последний известный вход: профиль для useAuth без второго запроса. */
let last: Me | null = null;

async function fetchMe(): Promise<Me> {
  last = parseMe(await api("GET", "/api/auth/me"));
  return last;
}

function emit(user: AuthUser | null): void {
  listeners.forEach((listener) => listener(user));
}

/** Профиль вошедшего: из последнего ответа сервера или свежим запросом. */
export async function loadServerProfile(user: AuthUser): Promise<UserProfile | null> {
  if (last?.user?.uid === user.uid) return last.profile;
  const me = await fetchMe();
  return me.user?.uid === user.uid ? me.profile : null;
}

export const serverAuthService: AuthService = {
  watch(callback, onError) {
    let cancelled = false;
    const listener: Listener = (user) => {
      if (!cancelled) callback(user);
    };
    listeners.add(listener);
    // Каждый экран спрашивает сервер заново: профиль свежий (например, после смены пароля).
    withRetry(fetchMe, () => cancelled)
      .then((me) => listener(me.user))
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof Cancelled)) onError(error instanceof Error ? error : new Error(String(error)));
      });
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  },

  async signInHost(email, password) {
    last = parseMe(await api("POST", "/api/auth/login", { email: email.trim(), password }));
    emit(last.user);
  },

  // Гость или экран зала: устройство в cookie (180 дней), вошедший ведущий остаётся собой.
  async ensureSignedIn() {
    const data = asRecord(await api("POST", "/api/auth/device"));
    const uid = asText(data.uid);
    if (!uid) throw new ApiError("unavailable", 0);
    return { uid, anonymous: data.anonymous !== false, email: asText(data.email) || null };
  },

  async signOut() {
    await api("POST", "/api/auth/logout");
    last = { user: null, profile: null };
    emit(null);
  },

  async changePassword(currentPassword, newPassword) {
    await api("POST", "/api/auth/password", { currentPassword, newPassword });
    if (last?.profile) last = { ...last, profile: { ...last.profile, mustChangePassword: false } };
  },

  describeError: describeAuthError,
};
