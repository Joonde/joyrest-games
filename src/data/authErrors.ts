/**
 * Тексты ошибок входа и управления ведущими. Свой сервер отвечает теми же кодами, что Firebase
 * (`auth/invalid-credential`, `permission-denied`, …), поэтому тексты общие для обеих реализаций.
 */
import { errorCodeOf } from "./retry";

export function describeAuthError(error: unknown): string {
  // Не догрузился чанк Firebase: браузер бросает TypeError без кода.
  if (error instanceof TypeError) return "Нет связи с интернетом. Проверьте сеть и попробуйте снова.";
  const code = errorCodeOf(error);
  // Ключ Firebase или список доменов не пускают с этого адреса (перенос на новом сервере).
  if (code === "auth/unauthorized-domain" || code.startsWith("auth/requests-from-referer")) {
    return "Firebase не пускает вход с этого адреса. Добавьте адрес сайта в консоли Firebase: Authentication → Settings → Authorized domains.";
  }
  switch (code) {
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
    case "resource-exhausted":
      // Свой сервер: 429 — частые попытки, 413/507 — место для картинок.
      return error instanceof Error && "status" in error && (error.status === 413 || error.status === 507)
        ? "На сервере не хватает места для картинок. Напишите администратору."
        : "Слишком много попыток. Подождите минуту и попробуйте снова.";
    case "auth/network-request-failed":
    case "unavailable":
      return "Нет связи с интернетом. Проверьте сеть и попробуйте снова.";
    case "auth/user-disabled":
      return "Аккаунт отключён. Обратитесь к администратору.";
    case "auth/operation-not-allowed":
    case "auth/admin-restricted-operation":
      return "Этот способ входа выключен в консоли Firebase.";
    case "unauthenticated":
      return "Вход устарел. Выйдите и войдите снова.";
    case "permission-denied":
      return "Недостаточно прав для этого действия.";
    case "invalid-argument":
      return "Проверьте, что поля заполнены верно.";
    case "unimplemented":
      return "Эта часть ещё переезжает на новый сервер.";
    default:
      return "Не получилось. Попробуйте ещё раз.";
  }
}
