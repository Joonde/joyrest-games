import type { Mechanic } from "../types";
import { parseContent } from "./rules/content";
import { BUBLIKATOR, BUBLIKATOR_SUPPORTS } from "./rules/constants";
import type { BubContent } from "./rules/types";
import { BublikatorEditor, BublikatorHostControls, BublikatorPlayerView, BublikatorScreenView } from "./views";

/**
 * «Бубликатор» (ТЗ «Три игры», Блок 2): экипажи кораблей, у каждого 3–4 прибора и один приказ про прибор товарища. Игра
 * идёт в игровой комнате быстрого канала (`server/src/rooms/bublikator.ts`), а не шагами сессии: шагов и очков платформы у
 * механики нет — итоги считает комната. Свой вид на всех этапах (`standalone`), своё награждение (`ownAward`).
 * Пока скрыта (`HIDDEN_MECHANICS`): готов только телефон гостя (2b).
 */
export const bublikator: Mechanic<BubContent, never> = {
  id: BUBLIKATOR,
  title: "Бубликатор",
  supports: BUBLIKATOR_SUPPORTS,
  standalone: { themeId: "joyrest" },
  ownAward: true,
  ownAnswered: true,
  // Музыка полёта — своя, по сводке комнаты (экран, `flightMusicOf`): только в полёте, на паузе встаёт (решение владельца
  // 12 ноября 2026); встроенная музыка платформы (лобби, перерыв) на экране «Бубликатора» не играет.
  ownMusic: true,
  create: () => parseContent(undefined),
  parse: parseContent,
  mediaIds: () => [],
  Editor: BublikatorEditor,
  ScreenView: BublikatorScreenView,
  PlayerView: BublikatorPlayerView,
  HostControls: BublikatorHostControls,
  steps: () => [{ id: "room", answerable: false }],
  score: () => [],
  validate: () => [],
};
