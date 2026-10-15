// Шаблон «Шпиона» для «Библиотеки JoyRest»: стандартная колода из 24 локаций, 3 партии по 8 минут.
import { createSpy, type SpyContent } from "./content";

export const DEMO_SPY: { title: string; content: SpyContent } = {
  title: "Шпион",
  content: createSpy(),
};
