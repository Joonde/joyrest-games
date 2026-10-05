/**
 * Открытый ответ сравнивается без учёта регистра, ё/е, пробелов и знаков препинания:
 * «Ёлка!», «елка» и « Е Л К А » — один и тот же ответ.
 */
export function normalizeAnswer(input: string): string {
  return input
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Подходит ли ответ гостя под один из верных. */
export function matchesAnswer(input: string, accepted: string[]): boolean {
  const value = normalizeAnswer(input);
  return value.length > 0 && accepted.some((a) => normalizeAnswer(a) === value);
}
