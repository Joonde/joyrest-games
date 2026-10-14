import { board } from "./board";
import { DEMO_BOARD } from "./board/demo";
import { checkers } from "./checkers";
import { DEMO_CHECKERS } from "./checkers/demo";
import { dance } from "./dance";
import { DEMO_DANCE, DEMO_DANCE_STYLES } from "./dance/demo";
import { stage } from "./stage";
import { DEMO_STAGE_DANCE, DEMO_STAGE_KARAOKE } from "./stage/demo";
import { quest } from "./quest";
import { millionaire } from "./millionaire";
import { survival } from "./survival";
import { dragon } from "./dragon";
import { olymp } from "./olymp";
import { createOlymp } from "./olymp/content";
import { DEMO_DRAGON, DEMO_DRAGON_KIDS } from "./dragon/demo";
import { DEMO_SURVIVAL } from "./survival/demo";
import { DEMO_MILLIONAIRE } from "./millionaire/demo";
import { DEMO_QUEST, DEMO_QUEST_ADULT } from "./quest/demo";
import { lotto } from "./lotto";
import { mafia } from "./mafia";
import { durak } from "./durak";
import { createDurak } from "./durak/content";
import { truth } from "./truth";
import { perudo } from "./perudo";
import { wager } from "./wager";
import { DEMO_WAGER } from "./wager/demo";
import { wine } from "./wine";
import { DEMO_WINE } from "./wine/demo";
import { createPerudo } from "./perudo/content";
import { DEMO_TRUTH, DEMO_TRUTH_ADULT } from "./truth/demo";
import { story } from "./story";
import { bunker } from "./bunker";
import { createBunker } from "./bunker/content";
import { createStory } from "./story/content";
import { createMafia } from "./mafia/content";
import { DEMO_LOTTO } from "./lotto/demo";
import { quiz } from "./quiz";
import { evening } from "./evening";
import { DEMO_MELODY, DEMO_QUIZ } from "./quiz/demo";
import { questionsLabel } from "../core/results";
import type { AnyMechanic, Mechanic, Step, ValidationError } from "./types";

/**
 * Механика в реестре. Формат содержимого знает только сама механика, а ядро передаёт
 * ей то, что вернул её же `parse`, поэтому стирание типа здесь безопасно.
 */
function register<Content, AnswerValue, S extends Step>(mechanic: Mechanic<Content, AnswerValue, S>): AnyMechanic {
  return mechanic as unknown as AnyMechanic;
}

/** Реестр механик. Новая механика подключается одной строкой здесь. */
export const mechanics: AnyMechanic[] = [register(quiz), register(lotto), register(board), register(checkers), register(dance), register(stage), register(quest), register(millionaire), register(survival), register(dragon), register(olymp), register(mafia), register(durak), register(truth), register(perudo), register(wager), register(wine), register(story), register(bunker), register(evening)];

export function getMechanic(id: string | null): AnyMechanic | undefined {
  return id ? mechanics.find((m) => m.id === id) : undefined;
}

const HINTS: Record<string, string> = {
  quiz: "Варианты ответа, открытый ответ, на скорость, картинки и музыка («Угадай мелодию»).",
  lotto: "Карточки песен у гостей, музыка на экране зала, «Лото!» — кто первым соберёт линию.",
  quest: "Поле 40–100 клеток на экране, кубик на телефоне капитана, в клетках — задания, вопросы, танцы, бонусы и ловушки.",
  stage: "Поле как в «Своей игре»: плитка переворачивается и показывает, кто выходит танцевать или петь (до 5 человек, пары, вся команда, батлы). Видео Just Dance или караоке — с пульта: пауза, перемотка, на весь экран. Зрители дарят очки, батл решает зал.",
  dance: "Команды по очереди выбирают батл, танец или караоке; оценивают другие команды. Видео — ссылка или файл на экране зала.",
  checkers: "Две команды, доска на экране: верный и быстрый ответ — ход, взятые шашки — очки.",
  olymp: "Ролевая история про греческих богов: команда — бог, ведущий читает сцены, d100 решает исход, голосование за путь, бои с боссом, три концовки.",
  dragon: "Капитаны выбирают героя и свойства, команды бьют дракона: вопросы, задания, кубик; жизни, гибель, несколько боёв.",
  survival: "До 30 раундов из вопросов и заданий, каждый 5-й — войнушка со ставками, аукцион билета освобождения.",
  millionaire: "15 (или 12) вопросов с вариантами, у каждой команды своя лестница на экране, несгораемые ступени и 6 подсказок.",
  bunker: "Катастрофа: мест в бункере — на половину игроков. Тайные карты персонажей на телефонах, особые условия, голосование, финал с угрозами.",
  story: "Игра на знакомство: пять разделов — чья история, сочиняем историю со словами с бумажек, что было дальше, две правды и ложь, кто это сказал. Гости пишут о себе на телефонах, угадывают друг друга.",
  perudo: "Кости лжеца из «Пиратов Карибского моря»: свои кости тайно на телефоне, ставки по кругу, «Не верю!» и вскрытие на экране. Игроки или команды, до 10 стаканов.",
  wager: "Ответ — число: команды пишут догадки, на экране они выстраиваются по возрастанию с коэффициентами, все ставят фишки на самую точную. Можно выиграть, даже не зная ответа.",
  wine: "18+. Дегустация как казино: гости пробуют вино и ставят фишки на телефоне — цвет, Свет, сладость, страна, сорт, год. «Открыть бутылку» — паспорт на экране и выигрыши по коэффициентам.",
  truth: "Ходы по очереди: игрок касается на телефоне «Правда» или «Действие», карточка открывается на экране. Колода обычная и 18+, задания от гостей.",
  durak: "Подкидной и переводной: стол с крупье на экране, свои карты веером на телефоне. 10 колод на выбор, голосование гостей за колоду.",
  mafia: "Клубная классика: Мафия, Дон, Комиссар, Доктор и мирные. Тайные карты на телефонах, ночные ходы, тайное голосование.",
  board: "Поле категорий и стоимостей, кнопка «кто первый», треки, картинки, «Кот в мешке» (вопрос другому игроку) и «Аукцион» со ставками.",
  evening: "Целый вечер по одному коду: от 1 до 5 игр подряд. Гости входят один раз, после каждого блока — его победители и общий счёт, в конце — награждение по сумме.",
};

/** Механики, которые можно выбрать при создании игры. */
export const selectableMechanics: Array<{ id: string; title: string; hint: string }> = mechanics.map((m) => ({
  id: m.id,
  title: m.title,
  hint: HINTS[m.id] ?? "",
}));

export function mechanicTitle(id: string | null): string {
  if (!id) return "Без игры";
  return getMechanic(id)?.title ?? id;
}

/** Содержимое новой игры выбранной механики. */
export function newContent(mechanicId: string): unknown {
  return getMechanic(mechanicId)?.create() ?? null;
}

/** Число вопросов (шагов с приёмом ответов). */
export function countQuestions(mechanicId: string, content: unknown): number {
  const mechanic = getMechanic(mechanicId);
  if (!mechanic) return 0;
  return mechanic.steps(mechanic.parse(content)).filter((step) => step.answerable).length;
}

/** Ошибки игры: с ними игру нельзя запустить. Неизвестная механика — тоже ошибка. */
export function validateGame(mechanicId: string, content: unknown): ValidationError[] {
  const mechanic = getMechanic(mechanicId);
  if (!mechanic) return [{ path: "", message: "Эта механика пока не поддерживается." }];
  return mechanic.validate(mechanic.parse(content));
}

/** Картинки игры: копируются вместе с ней. */
export function gameMediaIds(mechanicId: string, content: unknown): string[] {
  const mechanic = getMechanic(mechanicId);
  return mechanic ? mechanic.mediaIds(mechanic.parse(content)) : [];
}

/** Готовые игры для «Библиотеки JoyRest»: admin добавляет их одной кнопкой. */
export const demoGames: Array<{ mechanic: string; title: string; hint: string; content: unknown; ageRating?: "0+" | "12+" | "18+"; playMode?: "solo" | "teams"; themeId?: string }> = [
  { mechanic: quiz.id, title: DEMO_QUIZ.title, hint: "8 вопросов всех типов: варианты, открытый ответ, на скорость.", content: DEMO_QUIZ.content },
  {
    mechanic: quiz.id,
    title: DEMO_MELODY.title,
    hint: "8 вопросов в трёх раундах: на экране звучит фрагмент, гости выбирают песню. Треки добавьте в копии игры или включайте со своего плеера.",
    content: DEMO_MELODY.content,
  },
  {
    mechanic: lotto.id,
    title: DEMO_LOTTO.title,
    hint: "28 песен, карточки 4×4, побеждает первая линия. Треки добавьте в копии игры или включайте со своего плеера.",
    content: DEMO_LOTTO.content,
  },
  {
    mechanic: board.id,
    title: DEMO_BOARD.title,
    hint: "Два раунда по 4 категории и 5 вопросов (второй дороже), «Коты в мешке» и «Аукционы». Клетки с треками и картинками добавьте в копии игры.",
    content: DEMO_BOARD.content,
    themeId: "studio",
  },
  {
    mechanic: checkers.id,
    title: DEMO_CHECKERS.title,
    hint: "30 вопросов на общие знания, две команды: белые и чёрные.",
    playMode: "teams",
    content: DEMO_CHECKERS.content,
  },
  {
    mechanic: dance.id,
    title: DEMO_DANCE.title,
    hint: "9 карточек: танцы, караоке и батлы. Музыку включаете сами или добавляете ссылки на ролики в копии игры.",
    content: DEMO_DANCE.content,
    playMode: "teams",
    themeId: "dancefloor",
  },
  ...DEMO_DANCE_STYLES.map((d) => ({
    mechanic: dance.id,
    title: d.title,
    hint: `${d.content.cards.length} карточек одного стиля — блок «Танцевального вечера». Ссылки на ролики добавьте в копии игры.`,
    content: d.content,
    playMode: "teams" as const,
    themeId: "dancefloor",
  })),
  {
    mechanic: stage.id,
    title: DEMO_STAGE_DANCE.title,
    hint: "4 категории по 5 плиток: активные, медленные, джаз-дэнс и батлы. Видео Just Dance добавьте ссылками или файлами в копии игры.",
    content: DEMO_STAGE_DANCE.content,
    playMode: "teams",
    themeId: "dancefloor",
  },
  {
    mechanic: stage.id,
    title: DEMO_STAGE_KARAOKE.title,
    hint: "4 категории по 5 плиток: соло, дуэты, хором и вокальные батлы. Видео караоке добавьте ссылками или файлами в копии игры.",
    content: DEMO_STAGE_KARAOKE.content,
    playMode: "teams",
    themeId: "dancefloor",
  },
  { mechanic: quest.id, title: DEMO_QUEST.title, hint: "40 клеток: задания, вопросы, танцы, караоке, бонусы и ловушки.", content: DEMO_QUEST.content, playMode: "teams", themeId: "adventure" },
  { mechanic: quest.id, title: DEMO_QUEST_ADULT.title, hint: "40 клеток для взрослой компании: тосты, танцы, вопросы про напитки (можно безалкогольные).", content: DEMO_QUEST_ADULT.content, ageRating: "18+", playMode: "teams", themeId: "gatsby" },
  { mechanic: millionaire.id, title: "Кто хочет стать миллионером", hint: "45 вопросов на 15 ступенях: хватит на 3 команды, 6 подсказок.", content: DEMO_MILLIONAIRE, playMode: "teams", themeId: "studio" },
  { mechanic: survival.id, title: "Гонка на выживание", hint: "30 раундов: вопросы, задания с тайными словами капитанам (30 секунд на команду), 6 войнушек и 3 аукциона билета.", content: DEMO_SURVIVAL, playMode: "teams", themeId: "adventure" },
  { mechanic: olymp.id, title: "Олимп: Вечная зима", hint: "История на 1–2 часа: 10 богов, проверки d100, развилки, Поля Асфоделей и дворец Аида, бои с волками, тенями, Цербером и Пожирателем зимы, три концовки.", content: createOlymp(), playMode: "teams", ageRating: "18+", themeId: "winter" },
  { mechanic: olymp.id, title: "Олимп: Метка Тёмного мира", hint: "Вторая история, 1–1,5 часа: кто-то крадёт огонь очага Гестии. Лемнос или Дельфы, море, Лабиринт Крита, Минотавр и Вестник Эреба, три концовки.", content: { ...createOlymp(), story: "mark" }, playMode: "teams", ageRating: "18+", themeId: "adventure" },
  { mechanic: dragon.id, title: "Бой с драконом", hint: "2 боя по 8 заданий: вопросы, силовые задания, песни и кубик; 10 героев.", content: DEMO_DRAGON, playMode: "teams", themeId: "adventure" },
  { mechanic: truth.id, title: "Правда или действие", hint: "40 карточек для любой компании: 20 вопросов и 20 заданий, 3 круга, задания от гостей.", content: DEMO_TRUTH, playMode: "solo" },
  { mechanic: truth.id, title: "Правда или действие 18+", hint: "Обычная колода и 16 карточек для взрослой вечеринки.", content: DEMO_TRUTH_ADULT, playMode: "solo", ageRating: "18+" },
  { mechanic: mafia.id, title: "Мафия", hint: "Клубная классика для 5–30 игроков: 3 партии подряд, роли по числу игроков, речь 60 с, голосование 30 с.", content: createMafia(), playMode: "solo", ageRating: "12+" },
  { mechanic: wager.id, title: DEMO_WAGER.title, hint: "7 вопросов с ответом-числом: Эйфелева башня, Эльбрус, Байкал и другие. 3–7 команд.", content: DEMO_WAGER.content, playMode: "teams" },
  { mechanic: wine.id, title: DEMO_WINE.title, hint: "Образец вечера на 4 бутылки: скопируйте и впишите свои вина. Фишки — на телефонах гостей.", content: DEMO_WINE.content, ageRating: "18+", playMode: "solo" },
  { mechanic: perudo.id, title: "Перудо — кости лжеца", hint: "Как в «Пиратах Карибского моря»: 5 костей у каждого, единицы — джокеры, «Не верю!», «Ровно!» и «Палифико». 2–10 игроков или команд.", content: createPerudo(), playMode: "solo" },
  { mechanic: durak.id, title: "Дурак подкидной", hint: "2–6 игроков за столом с крупье: 3 партии, таймер хода 30 с, колода «Классика JoyRest» (гости могут выбрать другую голосованием).", content: createDurak(), playMode: "solo" },
  { mechanic: durak.id, title: "Дурак переводной", hint: "Переводной на 2–6 игроков, первый отбой без перевода, погоны, колода «Готика».", content: { ...createDurak(), variant: "perevodnoy", deckStyle: "gothic", table: "graphite" }, playMode: "solo" },
  { mechanic: bunker.id, title: "Бункер", hint: "Классика: 3 партии по 5 раундов, 6 карт персонажа и особое условие, 2 угрозы в финале. 4–16 игроков.", content: createBunker(), playMode: "solo", ageRating: "12+" },
  { mechanic: bunker.id, title: "Бункер: Возрождение", hint: "Для 8+ игроков: среди спасшихся нужна пара, чтобы продолжить род, и 3 угрозы в финале.", content: { ...createBunker(), rebirth: true, threats: 3 }, playMode: "solo", ageRating: "12+" },
  { mechanic: story.id, title: "Давайте знакомиться", hint: "5 разделов на знакомство: истории гостей, смешные предложения со словами с бумажек, «что было дальше», две правды и ложь, 8 вопросов «кто это сказал».", content: createStory(), playMode: "teams" },
  { mechanic: dragon.id, title: "Бой с драконом: для детей", hint: "2 боя с добрыми драконами: простые вопросы и весёлые задания, 4 жизни.", content: DEMO_DRAGON_KIDS, playMode: "teams", themeId: "adventure" },
];

/** «8 вопросов» или «28 песен» — смотря какая игра. */
export function stepsLabel(mechanicId: string, content: unknown): string {
  const n = countQuestions(mechanicId, content);
  if (mechanicId === lotto.id) {
    const d10 = n % 10;
    const d100 = n % 100;
    const word = d10 === 1 && d100 !== 11 ? "песня" : d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14) ? "песни" : "песен";
    return `${n} ${word}`;
  }
  return questionsLabel(n);
}
