// «Винное казино» для «Библиотеки JoyRest»: пример вечера на 4 бутылки. Паспорта — образец: перед вечером
// ведущий копирует игру и вписывает свои вина (название, цвет, страну, сорт, год).
import { createWine, parseWine } from "./content";

const base = createWine();

export const DEMO_WINE = {
  title: "Винное казино: 4 бутылки",
  content: parseWine({
    ...base,
    wines: [
      { id: "v1", name: "Совиньон Блан из Новой Зеландии", color: "white", world: "new", sweetness: "dry", country: "Новая Зеландия", grape: "Совиньон Блан", year: base.yearFrom + 7, note: "Образец — впишите своё вино" },
      { id: "v2", name: "Кьянти", color: "red", world: "old", sweetness: "dry", country: "Италия", grape: "Санджовезе", year: base.yearFrom + 5, note: "Образец — впишите своё вино" },
      { id: "v3", name: "Розовое из Прованса", color: "rose", world: "old", sweetness: "dry", country: "Франция", grape: "Гренаш", year: base.yearFrom + 8, note: "Сорт не из списка — выигрывает «Другой»" },
      { id: "v4", name: "Саперави", color: "red", world: "old", sweetness: "semisweet", country: "Грузия", grape: "Саперави", year: null, note: "Без года — выигрывает «Без года»" },
    ],
  }),
};
