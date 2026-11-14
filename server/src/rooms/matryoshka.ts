/**
 * «Игры Матрёшки» в игровой комнате быстрого канала (docs/matryoshka.md). Правила — чистые функции
 * `src/mechanics/matryoshka/rules/` (их же возьмут экраны); здесь только переходник к `RoomGame`: контекст комнаты — это `Env`
 * правил. Пока у игры нет экранов (Блок 3a), комната есть только на тестовой версии (`TEST_ONLY_GAMES`).
 */
import { BATCH_MS, EVENTS_PER_SECOND, MATRYOSHKA, OFFLINE_MS } from "../../../src/mechanics/matryoshka/rules/constants";
import { command, createState, input, join, moment, pause, playedToEnd, playUnit, restore, resume, snapshot, tick } from "../../../src/mechanics/matryoshka/rules/game";
import type { InEvent } from "../../../src/mechanics/matryoshka/rules/env";
import { flushPersonal, hostView, personalSnapshot, screenView } from "../../../src/mechanics/matryoshka/rules/views";
import type { MatState } from "../../../src/mechanics/matryoshka/rules/types";
import type { RoomGame } from "./engine";

function contentOf(snapshot: unknown): unknown {
  return typeof snapshot === "object" && snapshot !== null ? (snapshot as { content?: unknown }).content : undefined;
}

export const matryoshka: RoomGame<MatState> = {
  id: MATRYOSHKA,
  // «Без связи» — 3 с; пачка (и «держу» в «Замри!») — раз в 1 с; «нажал / отпустил» — «сейчас» отдельным запросом.
  offlineMs: OFFLINE_MS,
  eventsPerSecond: EVENTS_PER_SECOND,
  screenHz: 5,
  batchMs: () => BATCH_MS,
  // Режим платформы — только «каждый сам»: командная сессия играет так же, каждый лично (решение владельца 4).
  create: (init, ctx) => createState(contentOf(init.snapshot), ctx),
  onJoin: (state, player, ctx) => {
    join(state, player, ctx);
    flushPersonal(state, ctx);
  },
  onInput(state, player, events, ctx) {
    const played = input(state, player.pid, events as InEvent[], ctx);
    flushPersonal(state, ctx);
    return played;
  },
  onCommand(state, cmd, args, ctx) {
    const outcome = command(state, cmd, args, ctx);
    flushPersonal(state, ctx);
    return outcome;
  },
  moment: (state) => moment(state),
  // Баллы ведущему: раунд = испытание («Второй шанс», «Добивка», финал — свои номера); прогноз, «Канат» болельщика и ставка —
  // тоже игра (docs/matryoshka.md, «Баллы ведущему»).
  playUnit: (state) => playUnit(state),
  // «Сыграна до конца» — чемпион и пьедестал, сыграно не меньше 3 испытаний (решение владельца 8).
  playedToEnd: (state) => playedToEnd(state),
  tick(state, ctx) {
    tick(state, ctx);
    flushPersonal(state, ctx);
  },
  // Пауза: время игры стоит, в «Замри!» все «отпустили» — движок на паузе выбрасывает пачки (L7).
  onPause: (state, ctx) => {
    pause(state, ctx);
    flushPersonal(state, ctx);
  },
  onResume: (state, pausedMs, ctx) => {
    resume(state, pausedMs, ctx);
    flushPersonal(state, ctx);
  },
  screen: (state, view) => screenView(state, view),
  personal: (state, pid, view) => personalSnapshot(state, pid, view),
  host: (state, view) => hostView(state, view),
  snapshot: (state) => snapshot(state),
  restore: (data) => restore(data),
};
