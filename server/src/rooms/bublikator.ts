/**
 * «Бубликатор» в игровой комнате быстрого канала (docs/bublikator.md). Правила — чистые функции
 * `src/mechanics/bublikator/rules/` (их же возьмут экраны); здесь только переходник к `RoomGame`: контекст комнаты — это
 * `Env` правил (время сервера, кто на связи, случайность из зерна, личные события, контрольные точки).
 */
import { BATCH_MS, BUBLIKATOR, MOVES_PER_SECOND, OFFLINE_MS, TAPS_PER_SECOND } from "../../../src/mechanics/bublikator/rules/constants";
import { command, createState, input, join, moment, pause, restore, resume, snapshot, tick, type InEvent } from "../../../src/mechanics/bublikator/rules/game";
import { flushPersonal, hostView, personalSnapshot, screenView } from "../../../src/mechanics/bublikator/rules/views";
import type { BubState } from "../../../src/mechanics/bublikator/rules/types";
import type { RoomContext, RoomGame } from "./engine";

function contentOf(snapshot: unknown): unknown {
  return typeof snapshot === "object" && snapshot !== null ? (snapshot as { content?: unknown }).content : undefined;
}

export const bublikator: RoomGame<BubState> = {
  id: BUBLIKATOR,
  // ТЗ: «без связи» — 4 с; пустая пачка — раз в 2 с; движения приборов уходят сразу отдельными запросами.
  offlineMs: OFFLINE_MS,
  // Движения (5 в секунду) + сводки тапов, тряски, «Тяги», SOS и голос — с запасом; свои лимиты — в правилах.
  eventsPerSecond: MOVES_PER_SECOND + TAPS_PER_SECOND,
  screenHz: 5,
  batchMs: () => BATCH_MS,
  create: (init, ctx: RoomContext) => createState(contentOf(init.snapshot), init.playMode === "teams", ctx),
  onJoin: (state, player, ctx) => join(state, player, ctx),
  onInput(state, player, events, ctx) {
    input(state, player.pid, events as InEvent[], ctx);
    flushPersonal(state, ctx);
  },
  onCommand(state, cmd, args, ctx) {
    const outcome = command(state, cmd, args, ctx);
    flushPersonal(state, ctx);
    return outcome;
  },
  moment: (state) => moment(state),
  // Баллы ведущему: телефон «играл в перелёте N», если его пачка с событиями дошла до игры в полёте (решение владельца
  // 13 ноября 2026; тренировка, взлёт, привал и голосование — не перелёт).
  playUnit: (state) => (state.phase === "leg" && state.leg?.stage === "fly" ? state.legIndex : null),
  tick(state, ctx) {
    tick(state, ctx);
    flushPersonal(state, ctx);
  },
  // Пауза: время игры встаёт (команды пульта на паузе отсчитывают от момента паузы); продолжение сдвигает часы игры.
  onPause: (state, ctx) => pause(state, ctx),
  onResume: (state, pausedMs, ctx) => resume(state, pausedMs, ctx),
  screen: (state, view) => screenView(state, view),
  // Снимок личного: следующая рассылка этому телефону — целиком (он начинает со снимка, а не с прошлой рассылки).
  personal: (state, pid, view) => personalSnapshot(state, pid, view),
  host: (state, view) => hostView(state, view),
  snapshot: (state) => snapshot(state),
  restore: (data) => restore(data),
};
