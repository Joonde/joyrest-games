/**
 * Предоплата мероприятия (CLAUDE.md, раздел 3, «Предоплата»; решение владельца 12 ноября 2026).
 * Клиент вносит 2 000 ₽ — бронь даты, они засчитываются в стоимость. Владелец подтверждает, что деньги пришли, менеджер
 * ставит галочку «Предоплата внесена» — и только тогда мероприятие записывается ведущему. Ведущему уходит уже остаток:
 * «к оплате на месте» = стоимость по расчёту − предоплата. Клиент отказался не позже чем за 48 часов до начала —
 * «Вернуть предоплату» закрывает заказ, владелец возвращает деньги; позже предоплата не возвращается.
 * Чистые функции: одни и те же числа в форме, карточке, колокольчике и Telegram.
 */

/** Предоплата — бронь даты (как в «Условиях» сайта). */
export const PREPAY_RUB = 2000;
/** «Вернуть предоплату» работает, пока до начала мероприятия не меньше стольких часов. */
export const REFUND_HOURS = 48;
/** Больше такой стоимости мероприятие не записываем (защита от опечатки с лишним нулём). */
export const PRICE_MAX = 3_000_000;

/** «24 900 ₽» — с обычным пробелом (Telegram и буфер обмена). */
export function rub(n: number): string {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
}

/** Стоимость из формы или тела запроса: целые рубли от предоплаты до `PRICE_MAX`; пусто — null; мусор — undefined. */
export function cleanPrice(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" && /^[\d\s ]+$/.test(value) ? Number(value.replace(/[\s ]/g, "")) : NaN;
  if (!Number.isInteger(n) || n < PREPAY_RUB || n > PRICE_MAX) return undefined;
  return n;
}

/** Сколько клиент платит ведущему на месте: стоимость минус внесённая предоплата. Стоимости нет — null. */
export function dueOnSite(price: number | null | undefined, prepaid: boolean): number | null {
  if (price === null || price === undefined) return null;
  return Math.max(0, price - (prepaid ? PREPAY_RUB : 0));
}

/** Можно ли ещё вернуть предоплату: до начала не меньше 48 часов. */
export function refundOpen(startsAtMs: number, nowMs: number): boolean {
  return startsAtMs - nowMs >= REFUND_HOURS * 3_600_000;
}

/** Строка ведущему (карточка, Telegram): «💰 К оплате на месте: 22 900 ₽ (предоплата 2 000 ₽ уже внесена)». Стоимости нет — пусто. */
export function dueLine(price: number | null | undefined, prepaid: boolean): string {
  const due = dueOnSite(price, prepaid);
  if (due === null) return "";
  return `💰 К оплате на месте: ${rub(due)}${prepaid ? ` (предоплата ${rub(PREPAY_RUB)} уже внесена)` : ""}`;
}

/**
 * Стоимость из вставленного расчёта клиента: строка выбранного формата «✅ Опытный: 24 900 ₽ … — выбран»,
 * у готового пакета — «Цена: 24 900 ₽ — …». Формат не выбран (три цены без «выбран») — null: менеджер впишет сам.
 */
export function priceFromCalc(text: string): number | null {
  const money = (line: string) => {
    const m = /:\s*([\d\s ]{1,12})₽/.exec(line);
    const n = m?.[1] ? cleanPrice(m[1].trim()) : undefined;
    return typeof n === "number" ? n : null;
  };
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const chosen = lines.find((l) => l.startsWith("✅") && /выбран/i.test(l));
  if (chosen) return money(chosen);
  const bundle = lines.find((l) => /^Цена:/i.test(l));
  return bundle ? money(bundle) : null;
}

/** Владельцу в Telegram: менеджер отметил предоплату — проверьте поступление. Без имени, телефона и адреса клиента. */
export function prepaidOwnerText(what: string, when: string, price: number | null, byName: string, link: string): string {
  const money = price === null ? "" : `\nСтоимость ${rub(price)} · на месте клиент платит ${rub(dueOnSite(price, true) ?? 0)}`;
  return `💰 Предоплата ${rub(PREPAY_RUB)} отмечена\n\n${what}\n${when}${money}\nОтметил(а): ${byName || "—"}\n\nПроверьте, что деньги пришли. Мероприятие — в студии:\n${link}`;
}

/** Владельцу в Telegram: клиент отказался вовремя — мероприятие закрыто, нужно вернуть предоплату. Без данных клиента. */
export function refundOwnerText(what: string, when: string, byName: string, link: string): string {
  return `💸 Верните предоплату ${rub(PREPAY_RUB)}\n\n${what}\n${when}\nКлиент отказался, мероприятие закрыто у ведущего и менеджера.\nЗапросил(а): ${byName || "—"}\n\nКому вернуть — имя и телефон клиента в студии. Вернули — нажмите там «Отметить: вернул»:\n${link}`;
}
