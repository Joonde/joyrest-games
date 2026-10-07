import { DEFAULTS, type QuestionKind, type QuizContent, type QuizQuestion } from "./content";

function q(id: string, kind: QuestionKind, text: string, rest: Partial<QuizQuestion>): QuizQuestion {
  return { id, kind, text, options: [], correct: -1, answers: [], ...DEFAULTS[kind], imageId: null, round: null, ...rest };
}

/** Демо-квиз для «Библиотеки JoyRest»: 8 вопросов всех типов на новогоднюю тему. */
export const DEMO_QUIZ: { title: string; content: QuizContent } = {
  title: "Демо-квиз: Новогодняя вечеринка",
  content: {
    questions: [
      q("demo1", "choice", "В какой стране впервые стали наряжать ёлку к Рождеству?", {
        options: ["Германия", "Франция", "Россия", "Италия"],
        correct: 0,
      }),
      q("demo2", "speed", "Сколько раз бьют куранты в новогоднюю полночь?", {
        options: ["10", "12", "24", "60"],
        correct: 1,
      }),
      q("demo3", "open", "Как зовут внучку Деда Мороза?", { answers: ["Снегурочка", "Снегурка"] }),
      q("demo4", "choice", "Какой салат называют «шубой»?", {
        options: ["Оливье", "Мимоза", "Селёдка под шубой", "Винегрет"],
        correct: 2,
      }),
      q("demo5", "speed", "Где официально живёт Дед Мороз?", {
        options: ["В Великом Устюге", "В Мурманске", "В Суздале", "На Северном полюсе"],
        correct: 0,
      }),
      q("demo6", "open", "Какое дерево наряжают на Новый год?", { answers: ["ёлка", "ель", "сосна"] }),
      q("demo7", "choice", "В каком фильме звучит фраза «С лёгким паром!»?", {
        options: ["«Ирония судьбы, или С лёгким паром!»", "«Карнавальная ночь»", "«Морозко»", "«Чародеи»"],
        correct: 0,
      }),
      q("demo8", "choice", "Какой знак зодиака у тех, кто родился 31 декабря?", {
        options: ["Стрелец", "Козерог", "Водолей"],
        correct: 1,
      }),
    ],
  },
};
