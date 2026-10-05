/** Ссылка для гостя: её кодирует QR. */
export function playUrl(code: string): string {
  return `${window.location.origin}/play/${code}`;
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
