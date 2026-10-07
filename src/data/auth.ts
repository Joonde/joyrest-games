import type { User } from "firebase/auth";
import type { AuthService, AuthUser } from "./contracts";
import { describeAuthError } from "./authErrors";
import { lazySubscribe, loadAuth } from "./firebase";

function toAuthUser(user: User | null): AuthUser | null {
  return user ? { uid: user.uid, anonymous: user.isAnonymous, email: user.email } : null;
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

  describeError: describeAuthError,
};
