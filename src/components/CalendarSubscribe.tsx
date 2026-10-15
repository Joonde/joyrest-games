/**
 * «Мои мероприятия — в календаре телефона» (решение владельца 15 октября 2026): подписка по секретной ссылке. Телефон сам
 * забирает новые мероприятия, изменения и отмену (обновляет примерно раз в час); напоминания — за день и за 2 часа.
 * iPhone и Mac — ссылка webcal:// открывает «Подписаться»; Android — ссылку копируем и вставляем в Google Календарь
 * на компьютере («Другие календари → Добавить по URL»). Клиента, телефона и адреса в календаре нет.
 */
import { useState } from "react";
import { webcalUrl } from "../core/ics";
import { eventsRepo } from "../data";
import { useConfirm } from "./ConfirmDialog";

export function CalendarSubscribe({ owner = false }: { owner?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, ask] = useConfirm();
  if (!eventsRepo) return null;
  const repo = eventsRepo;

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setUrl(await repo.feed());
    } catch {
      setError("Не получилось получить ссылку. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNote("Ссылка скопирована");
    } catch {
      setNote("Не удалось скопировать — выделите ссылку ниже и скопируйте её.");
    }
  }

  function reset() {
    ask({
      title: "Сменить ссылку?",
      text: "Старая ссылка перестанет работать: календарь, подписанный на неё, больше не обновится. Подпишитесь заново по новой ссылке.",
      confirmLabel: "Сменить ссылку",
      run: async () => {
        setUrl(await repo.resetFeed());
        setNote("Ссылка сменена — подпишитесь заново");
      },
    });
  }

  return (
    <section className="card stack" aria-labelledby="cal-subscribe">
      <h2 id="cal-subscribe">📅 Мероприятия — в календаре телефона</h2>
      <p className="muted small">
        {owner ? "Все мероприятия JoyRest" : "Ваши мероприятия"} появятся в календаре телефона и будут обновляться сами: новые, изменения, отмена. Напоминания —
        за день и за 2 часа. Клиента, телефона и адреса там нет — они в студии.
      </p>
      {!url ? (
        <div className="actions">
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void load()}>
            {busy ? "Готовим ссылку…" : "Подключить календарь телефона"}
          </button>
        </div>
      ) : (
        <div className="stack stack--tight">
          <a className="btn btn--block" href={webcalUrl(url)}>
            iPhone и Mac: подписаться
          </a>
          <button type="button" className="btn btn--secondary btn--block" onClick={() => void copy()}>
            Android и Google: скопировать ссылку
          </button>
          <p className="small">
            <b>Android:</b> откройте calendar.google.com в браузере → «Другие календари» → «＋» → «Добавить по URL» → вставьте ссылку. Через несколько минут
            мероприятия появятся в Google Календаре на телефоне.
          </p>
          <p className="cal-feed-url small" aria-label="Ссылка подписки">
            {url}
          </p>
          <p className="muted small">Ссылка личная — не пересылайте её. Если переслали по ошибке, смените её.</p>
          <button type="button" className="btn btn--quiet btn--block" onClick={reset}>
            Сменить ссылку
          </button>
        </div>
      )}
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {confirm}
    </section>
  );
}
