/** Сравнение текстов без регистра, ё/е и знаков: телефон узнаёт свою историю, пульт — автора. */
export function sameText(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
  return n(a) === n(b) && n(a).length > 0;
}
