// Шаблоны только для робота-ведущего и «Снимков игр» (в библиотеку не попадают).
/**
 * Только для робота: квиз с раундами и суперигрой в конце каждого раунда (в библиотеке такого шаблона нет) —
 * чтобы суперигра (заставка, выбор уровней, ответы, очки раунда, музыка и звуки) проходилась при каждом прогоне.
 */
function superLevels(topic: string) {
  return [100, 200, 300, 500].map((points, i) => ({ points, text: `${topic}: вопрос уровня ${i + 1}`, answers: [`ответ${i + 1}`], imageId: null }));
}
function robotQ(id: string, text: string, round: string | null) {
  return { id, kind: "choice", text, options: ["Верно", "Неверно", "Мимо"], correct: 0, alsoCorrect: [], answers: [], steps: 1, pictures: [], timeLimit: 20, points: 100, imageId: null, trackId: null, trackStart: 0, trackLength: 15, round };
}
export const ROBOT_DEMOS = [
  {
    mechanic: "quiz",
    title: "Робот: раунды и суперигра",
    hint: "",
    content: {
      questions: [
        robotQ("rs1", "Кино: первый вопрос", "Кино"),
        robotQ("rs2", "Кино: второй вопрос", null),
        { id: "rs3", kind: "super", text: "Суперигра «Кино»", options: [], correct: -1, alsoCorrect: [], answers: [], steps: 1, pictures: [], timeLimit: 90, points: 100, imageId: null, trackId: null, trackStart: 0, trackLength: 15, round: null, levels: superLevels("Кино"), superStyle: "chests", penalty: "halfTop" },
        robotQ("rs4", "Музыка: первый вопрос", "Музыка"),
        robotQ("rs5", "Музыка: второй вопрос", null),
        { id: "rs6", kind: "super", text: "Суперигра «Музыка»", options: [], correct: -1, alsoCorrect: [], answers: [], steps: 1, pictures: [], timeLimit: 90, points: 100, imageId: null, trackId: null, trackStart: 0, trackLength: 15, round: null, levels: superLevels("Музыка"), superStyle: "crowns", penalty: "halfAll" },
      ],
      settings: { intro: true, board: "rounds", phoneImages: false, raceTarget: 5 },
    },
  },
];
