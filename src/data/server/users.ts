/** Ведущие на своём сервере: список, добавление, отключение и новый временный пароль (только admin). */
import type { UsersRepository } from "../contracts";
import type { CreatedHost, HostAccount } from "../types";
import { api, asRecord, asText } from "./api";
import { loadServerProfile, parseProfile } from "./auth";

function parseHost(value: unknown): HostAccount | null {
  const profile = parseProfile(value);
  if (!profile) return null;
  const data = asRecord(value);
  const { mustChangePassword: _mustChange, ...rest } = profile;
  const account: HostAccount = { ...rest, createdAt: typeof data.createdAt === "number" ? data.createdAt : null };
  if (typeof data.points === "number") account.points = data.points;
  return account;
}

function parseCreated(value: unknown): CreatedHost {
  const data = asRecord(value);
  const account = parseHost(data.account);
  const temporaryPassword = asText(data.temporaryPassword);
  if (!account || !temporaryPassword) throw new Error("Сервер прислал неполный ответ");
  return { account, temporaryPassword };
}

export const serverUsersRepository: UsersRepository = {
  async loadProfile(user) {
    if (user.anonymous) return null;
    return loadServerProfile(user);
  },

  async listHosts() {
    const data = await api("GET", "/api/users");
    return (Array.isArray(data) ? data : []).map(parseHost).filter((h): h is HostAccount => h !== null);
  },

  async createHost(email, name) {
    return parseCreated(await api("POST", "/api/users", { email: email.trim().toLowerCase(), name }));
  },

  async setHostActive(uid, active) {
    await api("POST", `/api/users/${encodeURIComponent(uid)}/active`, { active });
  },

  async resetHostPassword(uid) {
    return parseCreated(await api("POST", `/api/users/${encodeURIComponent(uid)}/password`));
  },
};
