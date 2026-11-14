import { MATRYOSHKA_TITLE } from "../../core/matryoshkaTitle";
import type { Mechanic } from "../types";
import { MATRYOSHKA, MATRYOSHKA_SUPPORTS } from "./rules/constants";
import { parseContent } from "./rules/content";
import type { MatContent } from "./rules/types";
import { MatryoshkaPlayerView } from "./phone/lazy";
import { MatryoshkaScreenLazy } from "./screen/lazy";
import { MatryoshkaEditor, MatryoshkaHostControls } from "./views";

/**
 * «Игры Матрёшки» (ТЗ «Три игры», Блок 3; docs/matryoshka.md): дворовые испытания на вылет, болельщики, финал «Камень,
 * ножницы, бумага». Игра идёт в игровой комнате быстрого канала (`server/src/rooms/matryoshka.ts`): шагов и очков платформы у
 * механики нет — итоги считает комната. Свой вид на всех этапах (`standalone`), своё награждение. Блок 3a — только правила:
 * механика скрыта (`HIDDEN_MECHANICS`), экраны — заглушки, не блок вечера (`NOT_IN_EVENING`).
 */
export const matryoshka: Mechanic<MatContent, never> = {
  id: MATRYOSHKA,
  title: MATRYOSHKA_TITLE,
  supports: MATRYOSHKA_SUPPORTS,
  // После игры — общий финал платформы (технические решения владельца 14 ноября 2026).
  standalone: { themeId: "joyrest", finale: true },
  room: true,
  ownAward: true,
  ownAnswered: true,
  ownMusic: true,
  create: () => parseContent(undefined),
  parse: parseContent,
  mediaIds: () => [],
  Editor: MatryoshkaEditor,
  ScreenView: MatryoshkaScreenLazy,
  PlayerView: MatryoshkaPlayerView,
  HostControls: MatryoshkaHostControls,
  steps: () => [{ id: "room", answerable: false }],
  score: () => [],
  validate: () => [],
};
