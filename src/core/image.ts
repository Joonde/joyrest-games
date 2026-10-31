// Расчёты для сжатия картинок на устройстве ведущего (само сжатие — src/components/media).

/** Полная картинка для экрана зала: до 1280 px по длинной стороне и около 150 КБ. */
export const FULL_IMAGE = { maxSide: 1280, targetBytes: 150 * 1024, maxBytes: 380 * 1024 } as const;
/** Чёткая для большого экрана (телевизор, проектор): только если исходник больше 1280 px. */
export const HD_IMAGE = { maxSide: 1920, targetBytes: 700 * 1024, maxBytes: 880 * 1024 } as const;
/** Уменьшенная для телефонов в режиме «без экрана». */
export const SMALL_IMAGE = { maxSide: 480, targetBytes: 35 * 1024, maxBytes: 120 * 1024 } as const;

/** Качество кодирования по шагам: от лучшего к меньшему размеру. */
export const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45] as const;

/** Размер, вписанный в квадрат maxSide; маленькие картинки не увеличиваются. */
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** «148 КБ», «1,2 МБ» — для подсказок. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1).replace(".", ",").replace(",0", "")} ГБ`;
  const mb = bytes / 1024 / 1024;
  return mb >= 100 ? `${Math.round(mb)} МБ` : `${mb.toFixed(1).replace(".", ",")} МБ`;
}
