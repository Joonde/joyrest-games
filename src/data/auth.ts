import type { User } from "firebase/auth";
import type { AuthService, AuthUser } from "./contracts";
import { lazySubscribe, loadAuth } from "./firebase";

function toAuthUser(user: User | null): AuthUser | null {
  return user ? { uid: user.uid, anonymous: user.isAnonymous, email: user.email } : null;
}

export function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

function describeError(error: unknown): string {
  // Не догрузился чанк Firebase: браузер бросает TypeError без кода.
  if (error instanceof TypeError) return "Нет связи с интернетом. Проверьте сеть и попробуйте снова.";
  switch (errorCode(error)) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Неверная почта или пароль.";
    case "auth/invalid-email":
      return "Проверьте адрес почты.";
    case "auth/email-already-in-use":
      return "Эта почта уже зарегистрирована. Если ведущий отключён — включите его в списке.";
    case "auth/weak-password":
      return "Пароль слишком простой: нужно не меньше 8 символов.";
    case "auth/requires-recent-login":
      return "Выйдите и войдите снова, затем повторите.";
    case "auth/too-many-requests":
      return "Слишком много попыток. Подождите минуту и попробуйте снова.";
    case "auth/network-request-failed":
    case "unavailable":
      return "Нет связи с интернетом. Проверьте сеть и попробуйте снова.";
    case "auth/user-disabled":
      return "Аккаунт отключён. Обратитесь к администратору.";
    case "auth/operation-not-allowed":
    case "auth/admin-restricted-operation":
      return "Этот способ входа выключен в консоли Firebase.";
    case "permission-denied":
      return "Недостаточно прав для этого действия.";
    default:
      return "Не получилось. Попробуйте ещё раз.";
  }
}

export const authService: AuthService = {
  watch(callback, onError) {
    return lazySubscribe(async () => {
      const { auth, sdk } = await loadAuth();
      return sdk.onAuthStateChanged(auth, (user) => callback(toAuthUser(user)));
    }, onError);
  },

  async signInHost(email, password) {
    const { auth, sdk } = await loadAuth();
    await sdk.signInWithEmailAndPassword(auth, email.trim(), password);
  },

  // Гость с погасшим экраном возвращается под тем же uid.
  async ensureSignedIn() {
    const { auth, sdk } = await loadAuth();
    await auth.authStateReady();
    const current = toAuthUser(auth.currentUser);
    if (current) return current;
    const credential = await sdk.signInAnonymously(auth);
    return { uid: credential.user.uid, anonymous: true, email: null };
  },

  async signOut() {
    const { auth, sdk } = await loadAuth();
    await sdk.signOut(auth);
  },

  async changePassword(currentPassword, newPassword) {
    const { auth, sdk } = await loadAuth();
    const user = auth.currentUser;
    if (!user?.email) throw new Error("Нет входа");
    // Firebase требует свежий вход перед сменой пароля: подтверждаем текущим паролем.
    await sdk.reauthenticateWithCredential(user, sdk.EmailAuthProvider.credential(user.email, currentPassword));
    await sdk.updatePassword(user, newPassword);
  },

  describeError,
};
