// Черновик автосохранения: вернуть молча или спросить человека. Без React и слоя данных — проверяет `draftRestore.test.ts`.

/**
 * Вернуть черновик молча или спросить человека (QA 22 октября 2026, Р5): молча — только если игра на сервере сейчас той же
 * версии, поверх которой лежат правки (`base` черновика — версия после последнего своего подтверждённого сохранения).
 * Версия неизвестна или игру с тех пор меняли (в том числе сам человек с другого устройства) — спрашиваем: иначе старые
 * правки с этого телефона молча легли бы поверх новых.
 */
export function draftRestoreMode(draft: { base: number | null | undefined }, serverVersion: number | null | undefined): "restore" | "ask" {
  if (draft.base === undefined || serverVersion === undefined) return "ask";
  return draft.base === serverVersion ? "restore" : "ask";
}
