// Подписи «Кости лжеца» по-русски: «6 троек», «одна шестёрка», «5 костей».
import type { Bid } from "./logic";

const FACE_NAMES = ["", "единиц", "двоек", "троек", "четвёрок", "пятёрок", "шестёрок"];
const FACE_ONE = ["", "единица", "двойка", "тройка", "четвёрка", "пятёрка", "шестёрка"];
const FACE_FEW = ["", "единицы", "двойки", "тройки", "четвёрки", "пятёрки", "шестёрки"];

/** «пять троек», «одна шестёрка». */
export function bidText(b: Bid): string {
  if (b.q === 1) return `одна ${FACE_ONE[b.f]}`;
  const d = b.q % 10;
  const h = b.q % 100;
  const word = d === 1 && h !== 11 ? FACE_ONE[b.f] : d >= 2 && d <= 4 && (h < 12 || h > 14) ? FACE_FEW[b.f] : FACE_NAMES[b.f];
  return `${b.q} ${word}`;
}

/** «1 кость», «3 кости», «5 костей». */
export function diceWord(n: number): string {
  const d = n % 10;
  const h = n % 100;
  return `${n} ${d === 1 && h !== 11 ? "кость" : d >= 2 && d <= 4 && (h < 12 || h > 14) ? "кости" : "костей"}`;
}
