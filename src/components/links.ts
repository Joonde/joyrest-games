/** Ссылка для гостя: её кодирует QR. */
export function playUrl(code: string): string {
  return `${window.location.origin}/play/${code}`;
}

/** Адрес без протокола для показа на экране зала. */
export function joinHint(): string {
  return `${window.location.host}/j`;
}
