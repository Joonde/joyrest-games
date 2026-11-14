/** Число из цифр с одним разделителем: «1,5», «3.14» (не дата «12.04.1961» и не «1.2.3»). */
const NUMBER_RUN = /\p{N}+(?:[.,]\p{N}+)+/gu;
/** Минус перед числом в начале ответа или после пробела и знака: «-5», «−5», «t = -5» (не «Ту-154» и не «5-6»). */
const MINUS = /(^|[^\p{L}\p{N}])[-−–](?=\p{N})/gu;
const DOT = "\u0001";

/**
 * Число с одним разделителем. Ровно три цифры после него у числа без нуля впереди («1.000», «12,500») — разряды тысяч,
 * сравниваются по цифрам, как раньше; иначе — дробь без лишних нулей: «3.0» = «3», «3,50» = «3.5».
 */
function decimal(run: string): string {
  const m = /^(\p{N}+)[.,](\p{N}+)$/u.exec(run);
  if (!m) return run;
  const [, whole = "", frac = ""] = m;
  if (frac.length === 3 && whole.length <= 3 && !whole.startsWith("0")) return whole + frac;
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole}${DOT}${trimmed}` : whole;
}
const NEG = "\u0002";

/**
 * Открытый ответ сравнивается без учёта регистра, ё/е, пробелов и знаков препинания:
 * «Ёлка!», «елка» и « Е Л К А » — один и тот же ответ.
 * Числа различаются (паспорт квиза, К-Н-7): «1,5» = «1.5», но не «15»; «-5» — не «5»; «3.0» = «3». Разряды тысяч
 * («1.000», «12,500») и дата с несколькими точками («12.04.1961») сравниваются по цифрам, как раньше. Ответ из одних знаков или смайликов («👍», «!!!»)
 * не пропадает: сравнивается как написан, без пробелов, — ведущий видит его и может засчитать.
 */
export function normalizeAnswer(input: string): string {
  const base = input.toLocaleLowerCase("ru").replace(/ё/g, "е").normalize("NFKC");
  const marked = base
    .replace(NUMBER_RUN, decimal)
    .replace(MINUS, `$1${NEG}`);
  const plain = marked
    .replace(/[^\p{L}\p{N}\u0001\u0002]+/gu, "")
    .replace(/\u0001/g, ".")
    .replace(/\u0002/g, "-");
  if (/\p{L}|\p{N}/u.test(plain)) return plain;
  return base.replace(/\s+/g, "");
}

/** Подходит ли ответ гостя под один из верных. */
export function matchesAnswer(input: string, accepted: string[]): boolean {
  const value = normalizeAnswer(input);
  return value.length > 0 && accepted.some((a) => normalizeAnswer(a) === value);
}
