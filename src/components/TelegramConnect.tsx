/**
 * «Уведомления в Telegram»: подключить свой Telegram к боту JoyRest — назначенные мероприятия, изменения, отмена
 * и напоминания за сутки и за 3 часа. Одноразовая ссылка t.me/<бот>?start=<код>; после «Старт» в Telegram
 * карточка сама видит подключение (проверка раз в 3 секунды, до 3 минут).
 */
import { useEffect, useState } from "react";
import { telegramRepo, useLoad, type TelegramHealth, type TelegramStatus } from "../data";
import { useConfirm } from "./ConfirmDialog";

export function TelegramConnect({ owner = false }: { owner?: boolean }) {
  const [state, retry, update] = useLoad(() => (telegramRepo ? telegramRepo.status() : Promise.resolve<TelegramStatus>({ available: false, linked: false, username: "" })), []);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, ask] = useConfirm();

  // Ждём «Старт» в Telegram: раз в 3 с проверяем, до 3 минут.
  useEffect(() => {
    if (!url || !telegramRepo) return;
    const repo = telegramRepo;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > 180_000) {
        window.clearInterval(timer);
        return;
      }
      void repo
        .status()
        .then((s) => {
          if (s.linked) {
            update(() => s);
            setUrl(null);
            window.clearInterval(timer);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [url, update]);

  if (!telegramRepo) return null;
  const status = state.status === "ready" ? state.data : null;

  async function connect() {
    if (!telegramRepo) return;
    setBusy(true);
    setError(null);
    try {
      setUrl((await telegramRepo.link()).url);
    } catch {
      setError("Не получилось получить ссылку. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    ask({
      title: "Отключить Telegram?",
      text: "Уведомления о мероприятиях и напоминания больше не придут. Подключить снова можно здесь же.",
      confirmLabel: "Отключить",
      run: async () => {
        await telegramRepo?.unlink();
        update((s) => ({ ...s, linked: false, username: "" }));
      },
    });
  }

  return (
    <section className="card stack" aria-labelledby="tg-connect">
      <h2 id="tg-connect">Уведомления в Telegram</h2>
      <p className="muted small">
        Назначенные вам мероприятия, изменения, отмена и напоминания за сутки и за 3 часа. Имя и телефон клиента в Telegram не приходят — их видно в
        студии.
        {owner && " Владельцу: перешлите боту сообщение клиента или текст заявки — клиент сам попадёт в базу клиентов."}
      </p>
      {state.status === "error" && (
        <button type="button" className="btn btn--quiet" onClick={retry}>
          Не загрузилось — повторить
        </button>
      )}
      {status?.linked ? (
        <>
          <p className="tg-status" role="status">
            ✅ Telegram подключён{status.username ? ` (@${status.username})` : ""}
          </p>
          <div className="actions">
            <button type="button" className="btn btn--quiet btn--block" onClick={disconnect}>
              Отключить Telegram
            </button>
          </div>
        </>
      ) : status && !status.available ? (
        <p className="muted small">Подключение Telegram на этой версии платформы пока недоступно.</p>
      ) : status ? (
        url ? (
          <div className="stack stack--tight">
            <a className="btn btn--block" href={url} target="_blank" rel="noopener noreferrer">
              Открыть бота в Telegram
            </a>
            <p className="small">В Telegram нажмите «Старт» — здесь сразу появится «Telegram подключён». Ссылка работает 30 минут.</p>
          </div>
        ) : (
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void connect()}>
              {busy ? "Готовим ссылку…" : "Подключить Telegram"}
            </button>
          </div>
        )
      ) : (
        state.status !== "error" && <p className="muted small">Проверяем…</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {owner && <BotHealthLine />}
      {confirm}
    </section>
  );
}

const HEALTH_TEXT: Record<TelegramHealth["state"], string> = {
  ok: "на связи — получает сообщения",
  starting: "запускается…",
  conflict: "не получает сообщения: их забирает другая программа (вебхук или другая версия платформы)",
  error: "не отвечает Telegram — проверьте позже",
  off: "на этой версии сообщения не читает (только отправляет)",
};

/** Владельцу: бот на связи? Сколько человек подключили Telegram. */
function BotHealthLine() {
  const [state] = useLoad(() => (telegramRepo ? telegramRepo.health() : Promise.resolve(null)), []);
  if (state.status !== "ready" || !state.data) return null;
  const h = state.data;
  if (!h.configured) return <p className="muted small">Бот не настроен на сервере (sudo joyrest lead-bot).</p>;
  return (
    <p className="small tg-health" role="status">
      Бот{h.username ? ` @${h.username}` : ""}: {HEALTH_TEXT[h.state]}. Подключили Telegram: {h.linkedPeople}.
    </p>
  );
}
