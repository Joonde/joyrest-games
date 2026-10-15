/**
 * Оформление под заказчика (решение владельца 15 октября 2026): логотип и 1–2 фирменных цвета компании или пары на экране
 * зала, телефонах гостей и пульте; маленький знак JoyRest остаётся. Ведущий выбирает оформление при запуске, сохранённые
 * оформления — у него в студии («Оформления заказчиков»). Логотип — файл на сервере (sha256), цвета — #RRGGBB.
 * Сервер и браузер проверяют одинаково.
 */
export interface SessionBranding {
  /** Чьё оформление: «ООО Ромашка», «Свадьба Ани и Пети». */
  name: string;
  /** 0–2 цвета #RRGGBB: первый — кнопки и акценты, второй — подсветка и градиенты (нет — первый). */
  colors: string[];
  /** sha256 файла логотипа; null — без логотипа. */
  logo: string | null;
}

export interface SavedBranding extends SessionBranding {
  id: string;
  updatedAt: number;
}

export const BRANDING_LIMITS = { name: 60, colors: 2, saved: 50, logoBytes: 600 * 1024, logoSide: 800 } as const;

const COLOR = /^#[0-9a-f]{6}$/i;
const SHA = /^[0-9a-f]{64}$/;

/** Оформление из данных: неизвестное и лишнее отбрасывается; пустое (ни логотипа, ни цветов) — null. */
export function parseBranding(raw: unknown): SessionBranding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  // eslint-disable-next-line no-control-regex
  const name = typeof d.name === "string" ? d.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, BRANDING_LIMITS.name) : "";
  const colors = (Array.isArray(d.colors) ? d.colors : [])
    .filter((c): c is string => typeof c === "string" && COLOR.test(c))
    .map((c) => c.toUpperCase())
    .slice(0, BRANDING_LIMITS.colors);
  const logo = typeof d.logo === "string" && SHA.test(d.logo) ? d.logo : null;
  if (!logo && colors.length === 0) return null;
  return { name, colors, logo };
}

/** Адрес файла логотипа на своём сервере. */
export function brandLogoUrl(sha: string): string {
  return `/api/brandings/logo/${sha}`;
}
