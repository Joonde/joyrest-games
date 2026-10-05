import type { User } from "firebase/auth";
import { ADMIN_UID } from "./config";
import { asString } from "./convert";
import { lazySubscribe, loadAuth, loadFirestore } from "./firebase";
import type { Role, Unsubscribe, UserProfile } from "./types";

export interface AuthUser {
  uid: string;
  anonymous: boolean;
  email: string | null;
}

function toAuthUser(user: User | null): AuthUser | null {
  return user ? { uid: user.uid, anonymous: user.isAnonymous, email: user.email } : null;
}

/** Колбэк вызывается сразу после восстановления входа и при каждом изменении. */
export function watchAuth(callback: (user: AuthUser | null) => void, onError: (error: Error) => void): Unsubscribe {
  return lazySubscribe(async () => {
    const { auth, sdk } = await loadAuth();
    return sdk.onAuthStateChanged(auth, (user) => callback(toAuthUser(user)));
  }, onError);
}

export async function signInHost(email: string, password: string): Promise<void> {
  const { auth, sdk } = await loadAuth();
  await sdk.signInWithEmailAndPassword(auth, email.trim(), password);
}

/**
 * Анонимный вход гостя или экрана зала. Если уже есть вход (любой), он сохраняется:
 * гость с погасшим экраном возвращается под тем же uid.
 */
export async function ensureSignedIn(): Promise<AuthUser> {
  const { auth, sdk } = await loadAuth();
  await auth.authStateReady();
  const current = toAuthUser(auth.currentUser);
  if (current) return current;
  const credential = await sdk.signInAnonymously(auth);
  return { uid: credential.user.uid, anonymous: true, email: null };
}

export async function signOutUser(): Promise<void> {
  const { auth, sdk } = await loadAuth();
  await sdk.signOut(auth);
}

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "host";
}

/**
 * Профиль ведущего. Для владельца агентства профиль создаётся при первом входе,
 * чтобы не заводить его руками в консоли.
 */
export async function loadUserProfile(user: AuthUser): Promise<UserProfile | null> {
  if (user.anonymous) return null;
  const { db, sdk } = await loadFirestore();
  const ref = sdk.doc(db, "users", user.uid);
  const snap = await sdk.getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    return {
      uid: user.uid,
      role: isRole(data.role) ? data.role : "host",
      name: asString(data.name, user.email ?? ""),
      active: data.active === true,
    };
  }
  if (user.uid === ADMIN_UID) {
    const profile: UserProfile = {
      uid: user.uid,
      role: "admin",
      name: "Администратор",
      active: true,
    };
    await sdk.setDoc(ref, { role: profile.role, name: profile.name, active: profile.active });
    return profile;
  }
  return null;
}

export function describeAuthError(error: unknown): string {
  // Не догрузился чанк Firebase: браузер бросает TypeError без кода.
  if (error instanceof TypeError) return "Нет связи с интернетом. Проверьте сеть и попробуйте снова.";
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Неверная почта или пароль.";
    case "auth/too-many-requests":
      return "Слишком много попыток. Подождите минуту и попробуйте снова.";
    case "auth/network-request-failed":
      return "Нет связи с интернетом. Проверьте сеть и попробуйте снова.";
    case "auth/user-disabled":
      return "Аккаунт отключён. Обратитесь к администратору.";
    case "auth/operation-not-allowed":
    case "auth/admin-restricted-operation":
      return "Этот способ входа выключен в консоли Firebase.";
    default:
      return "Не получилось войти. Попробуйте ещё раз.";
  }
}
