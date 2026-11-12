// Механики без раздела в «Как создавать игры» (`src/core/editorGuide.ts`): у них свой вид и свой порядок
// (решение владельца 22 октября 2026). Отдельный маленький модуль — конструктору не нужно грузить всю инструкцию.
export const EDITOR_GUIDE_SKIP: readonly string[] = ["olymp", "aquarium"];

/** Есть ли у игры раздел в «Как создавать игры». */
export function editorGuideFor(mechanic: string): boolean {
  return !EDITOR_GUIDE_SKIP.includes(mechanic);
}
