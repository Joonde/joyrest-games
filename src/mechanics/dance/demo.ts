// «Танцевальный батл» для «Библиотеки JoyRest»: карточки без видео — музыку ведущий включает сам
// (или добавляет в копии игры ссылки на ролики и треки из «Музыки»).
import { newCard, parseDance, type DanceCard, type DanceKind } from "./content";

const CARDS: Array<[DanceKind, string, string]> = [
  ["dance", "Макарена", "Вся команда выходит и повторяет за ведущим"],
  ["karaoke", "«Ты неси меня, река»", "Поёт один участник, команда — на подпевках"],
  ["battle", "Батл «Дискотека 90-х»", "Каждая команда показывает 30 секунд лучших движений"],
  ["dance", "Летка-енка паровозиком", "Вся команда, можно звать гостей из зала"],
  ["karaoke", "«Звезда по имени Солнце»", "Дуэт: два участника команды"],
  ["battle", "Батл «Медленный танец»", "Самая красивая пара от каждой команды"],
  ["dance", "Танец маленьких утят", "Чем смешнее — тем лучше"],
  ["karaoke", "«Седьмой лепесток»", "Вся команда хором"],
  ["battle", "Батл «Рок-звезда»", "Воздушная гитара под общий трек"],
];

function card([kind, title, note]: [DanceKind, string, string], i: number): DanceCard {
  return { ...newCard(kind), id: `d${i + 1}`, title, note, video: { source: "none", url: "", name: "" } };
}

export const DEMO_DANCE = {
  title: "Танцевальный батл: хиты для всех",
  content: parseDance({ cards: CARDS.map(card), battlePoints: 100, minRate: 10, maxRate: 100, voteTime: 30 }),
};
