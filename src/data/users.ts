import type { DocumentData } from "firebase/firestore";
import { generateTempPassword } from "../core/password";
import { ADMIN_UID } from "./config";
import type { AuthUser, UsersRepository } from "./contracts";
import { asString, toMillis } from "./convert";
import { loadFirestore, loadSecondaryAuth } from "./firebase";
import type { HostAccount, Role, UserProfile } from "./types";

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "host";
}

export function toHost(uid: string, data: DocumentData, fallbackEmail = ""): HostAccount {
  return {
    uid,
    role: isRole(data.role) ? data.role : "host",
    name: asString(data.name, fallbackEmail),
    active: data.active === true,
    email: asString(data.email, fallbackEmail),
    createdAt: toMillis(data.createdAt),
  };
}

async function usersCol() {
  const { db, sdk } = await loadFirestore();
  return { col: sdk.collection(db, "users"), sdk };
}

export const usersRepository: UsersRepository = {
  /**
   * Для владельца агентства профиль создаётся при первом входе,
   * чтобы не заводить его руками в консоли.
   */
  async loadProfile(user: AuthUser): Promise<UserProfile | null> {
    if (user.anonymous) return null;
    const { col, sdk } = await usersCol();
    const ref = sdk.doc(col, user.uid);
    const snap = await sdk.getDoc(ref);
    const data = snap.data();
    if (data) {
      const { createdAt: _createdAt, ...profile } = toHost(user.uid, data, user.email ?? "");
      return profile;
    }
    if (user.uid === ADMIN_UID) {
      const profile: UserProfile = {
        uid: user.uid,
        role: "admin",
        name: "Администратор",
        active: true,
        email: user.email ?? "",
      };
      await sdk.setDoc(ref, {
        role: profile.role,
        name: profile.name,
        active: profile.active,
        email: profile.email,
        createdAt: sdk.serverTimestamp(),
      });
      return profile;
    }
    return null;
  },

  async listHosts() {
    const { col, sdk } = await usersCol();
    const snap = await sdk.getDocs(col);
    return snap.docs
      .map((d) => toHost(d.id, d.data()))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ru"));
  },

  async createHost(email, name) {
    const cleanEmail = email.trim().toLowerCase();
    const temporaryPassword = generateTempPassword();
    const secondary = await loadSecondaryAuth();
    const credential = await secondary.sdk.createUserWithEmailAndPassword(secondary.auth, cleanEmail, temporaryPassword);
    const uid = credential.user.uid;
    try {
      const { col, sdk } = await usersCol();
      await sdk.setDoc(sdk.doc(col, uid), {
        role: "host",
        name,
        active: true,
        email: cleanEmail,
        createdAt: sdk.serverTimestamp(),
      });
    } catch (error) {
      // Без профиля аккаунт бесполезен, а почта заняла бы место: удаляем его,
      // чтобы администратор мог просто повторить.
      await credential.user.delete().catch(() => undefined);
      throw error;
    } finally {
      await secondary.sdk.signOut(secondary.auth).catch(() => undefined);
    }
    return {
      account: { uid, role: "host", name, active: true, email: cleanEmail, createdAt: Date.now() },
      temporaryPassword,
    };
  },

  async setHostActive(uid, active) {
    const { col, sdk } = await usersCol();
    await sdk.updateDoc(sdk.doc(col, uid), { active });
  },
};
