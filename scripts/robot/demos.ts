// Шаблоны только для робота-ведущего и «Снимков игр» (в библиотеку не попадают).
/**
 * Только для робота: квиз с раундами и суперигрой в конце каждого раунда (в библиотеке такого шаблона нет) —
 * чтобы суперигра (заставка, выбор уровней, ответы, очки раунда, музыка и звуки) проходилась при каждом прогоне.
 */
function superLevels(topic: string) {
  return [100, 200, 300, 500].map((points, i) => ({ points, text: `${topic}: вопрос уровня ${i + 1}`, answers: [`ответ${i + 1}`], imageId: null }));
}
/** Уровни всех форматов (25 октября 2026): варианты, по порядку, число с треком, свой ответ. */
function mixedLevels(topic: string) {
  return [
    { points: 100, text: `${topic}: выберите вариант`, answers: [""], imageId: null, kind: "choice", options: ["Верно", "Неверно", "Мимо"], correct: [0] },
    { points: 200, text: `${topic}: расставьте по порядку`, answers: [""], imageId: null, kind: "order", options: ["Первый", "Второй", "Третий"] },
    { points: 300, text: `${topic}: угадайте число`, answers: [""], imageId: null, kind: "number", number: 1961, unit: "год", tolerance: 2, trackId: "robot-level", trackStart: 10, trackLength: 15 },
    { points: 500, text: `${topic}: свой ответ`, answers: ["ответ4"], imageId: null },
  ];
}
function robotQ(id: string, text: string, round: string | null) {
  return { id, kind: "choice", text, options: ["Верно", "Неверно", "Мимо"], correct: 0, alsoCorrect: [], answers: [], steps: 1, pictures: [], timeLimit: 20, points: 100, imageId: null, trackId: null, trackStart: 0, trackLength: 15, round };
}
export const ROBOT_DEMOS = [
  {
    mechanic: "quiz",
    title: "Робот: раунды, аукцион и суперигра",
    hint: "",
    content: {
      questions: [
        robotQ("rs1", "Кино: первый вопрос", "Кино"),
        // «Музыка на ответ» (23 октября 2026): у робота музыки нет — экран не должен падать и ждать трек.
        { ...robotQ("rs2", "Кино: второй вопрос", null), answerMusic: { trackId: "robot-answer", start: 30, length: 10, fadeIn: 2, fadeOut: 3 } },
        // Аукцион (23 октября 2026): ставки, жребий при равных, ответ выигравшего на телефоне.
        { ...robotQ("ra1", "Аукцион: в каком году вышел «Титаник»?", null), kind: "auction", options: ["1997", "1999", "2001"], correct: 0, points: 200, timeLimit: 30, topic: "Кино 90-х", auctionAnswer: "choice", betTime: 20 },
        { id: "rs3", kind: "super", text: "Суперигра «Кино»", options: [], correct: -1, alsoCorrect: [], answers: [], steps: 1, pictures: [], timeLimit: 90, points: 100, imageId: null, trackId: null, trackStart: 0, trackLength: 15, round: null, levels: superLevels("Кино"), superStyle: "chests", penalty: "halfTop", superVote: true, voteTime: 20 },
        robotQ("rs4", "Музыка: первый вопрос", "Музыка"),
        robotQ("rs5", "Музыка: второй вопрос", null),
        { ...robotQ("ra2", "Аукцион: кто спел «Yesterday»?", null), kind: "auction", options: [], correct: -1, answers: ["Beatles", "Битлз"], points: 200, timeLimit: 30, topic: "", auctionAnswer: "open", betTime: 20 },
        { id: "rs6", kind: "super", text: "Суперигра «Музыка»", options: [], correct: -1, alsoCorrect: [], answers: [], steps: 1, pictures: [], timeLimit: 90, points: 100, imageId: null, trackId: null, trackStart: 0, trackLength: 15, round: null, levels: mixedLevels("Музыка"), superStyle: "crowns", penalty: "halfAll", superVote: true, voteTime: 20 },
        // Гонка «Кто первый» (25 октября 2026): финиш за одно деление — бонус первому, «Назад» снимает.
        { ...robotQ("rb1", "Гонка: узнайте песню", "Гонка"), kind: "buzz", options: [], correct: -1, answers: ["Песня"], steps: 1 },
        { ...robotQ("rb2", "Гонка: ещё песня", null), kind: "buzz", options: [], correct: -1, answers: ["Песня 2"], steps: 1 },
      ],
      settings: { intro: true, board: "rounds", phoneImages: false, raceTarget: 1, raceBonus: 200, drawEffect: "wheel" },
    },
  },
];
