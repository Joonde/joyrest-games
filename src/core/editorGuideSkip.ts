// Механики без раздела в «Как создавать игры» (`src/core/editorGuide.ts`): у них свой вид и свой порядок
// (решение владельца 22 октября 2026). Отдельный маленький модуль — конструктору не нужно грузить всю инструкцию.
// «Бубликатор» — пока скрыт и без конструктора (Блок 2b — телефон гостя); раздел появится с конструктором в 2d.
export const EDITOR_GUIDE_SKIP: readonly string[] = ["olymp", "aquarium", "bublikator"];

/** Есть ли у игры раздел в «Как создавать игры». */
export function editorGuideFor(mechanic: string): boolean {
  return !EDITOR_GUIDE_SKIP.includes(mechanic);
}
