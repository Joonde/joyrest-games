/** Ссылка для гостя: её кодирует QR. */
export function playUrl(code: string): string {
  return `${window.location.origin}/play/${code}`;
}

/**
 * Пульт этой игры (решение владельца 1 ноября 2026): QR на экране зала — ведущий сканирует телефоном и сразу
 * попадает на пульт. Сам адрес прав не даёт: пульт открывается только у вошедшего ведущего этой игры.
 */
export function pultUrl(code: string): string {
  return `${window.location.origin}/host/${code}`;
}

/** Адрес без протокола для показа на экране зала. */
export function joinHint(): string {
  return `${window.location.host}/j`;
}

/** Короткая подпись ссылки для гостя без протокола: «joyrest.ru/play/659142». */
export function playUrlHint(code: string): string {
  return `${window.location.host}/play/${code}`;
}

/** Публичная ссылка на итоги игры: открывается без входа. */
export function resultsUrl(resultId: string): string {
  return `${window.location.origin}/results/${resultId}`;
}

/** Адрес сайта без протокола: «games.joy-rest.ru». */
export function joinHost(): string {
  return window.location.host;
}

/** «Помощь зала» по QR: голос без входа в игру (`/vote/:code`). */
export function voteUrl(code: string): string {
  return `${window.location.origin}/vote/${code}`;
}
