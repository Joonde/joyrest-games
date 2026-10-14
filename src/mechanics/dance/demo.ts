// «Танцевальный батл» для «Библиотеки JoyRest»: карточки без видео — музыку ведущий включает сам
// (или добавляет в копии игры ссылки на ролики и треки из «Музыки»).
// Батлы по стилям (джаз-фанк, диско, латина) — блоки «Танцевального вечера» в «Мероприятии из блоков».
import { newCard, parseDance, type DanceCard, type DanceKind } from "./content";
import { styleById } from "./styles";

const CARDS: Array<[DanceKind, string, string, string]> = [
  ["dance", "Макарена", "Вся команда выходит и повторяет за ведущим", "latin"],
  ["karaoke", "«Ты неси меня, река»", "Поёт один участник, команда — на подпевках", ""],
  ["battle", "Батл «Дискотека 90-х»", "Каждая команда показывает 30 секунд лучших движений", "party"],
  ["dance", "Летка-енка паровозиком", "Вся команда, можно звать гостей из зала", "folk"],
  ["karaoke", "«Звезда по имени Солнце»", "Дуэт: два участника команды", ""],
  ["battle", "Батл «Медленный танец»", "Самая красивая пара от каждой команды", "slow"],
  ["dance", "Танец маленьких утят", "Чем смешнее — тем лучше", "party"],
  ["karaoke", "«Седьмой лепесток»", "Вся команда хором", ""],
  ["battle", "Батл «Рок-звезда»", "Воздушная гитара под общий трек", "rocknroll"],
];

function card([kind, title, note, style]: [DanceKind, string, string, string], i: number, prefix = "d"): DanceCard {
  return { ...newCard(kind, style), id: `${prefix}${i + 1}`, title, note, video: { source: "none", url: "", name: "" } };
}

const SETTINGS = { battlePoints: 100, minRate: 10, maxRate: 100, voteTime: 30 };

export const DEMO_DANCE = {
  title: "Танцевальный батл: хиты для всех",
  content: parseDance({ cards: CARDS.map((c, i) => card(c, i)), ...SETTINGS }),
};

/** Батл одного стиля из готовых карточек стиля. */
function styleDemo(styleId: string) {
  const style = styleById(styleId);
  const cards = (style?.cards ?? []).map(([kind, title, note], i) => card([kind, title, note, styleId], i, `${styleId}`));
  return { title: `Танцевальный батл: ${style?.title.toLowerCase() ?? styleId}`, styleId, content: parseDance({ cards, ...SETTINGS }) };
}

export const DEMO_DANCE_STYLES = ["jazz", "disco", "latin"].map(styleDemo);
