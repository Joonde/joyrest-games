/** Общие состояния публичных страниц базы площадок: загрузка, анкеты закрыты, нет связи. */
import { Logo } from "../../components/Logo";
import { ListSkeleton } from "../../components/Skeleton";
import { Pending } from "../../components/Status";

export function PublicSkeleton() {
  return (
    <Pending
      label="Загружаем анкету"
      skeleton={
        <main className="page">
          <Logo kind="full" className="logo--form" />
          <ListSkeleton count={4} />
        </main>
      }
    />
  );
}

export function FormClosed() {
  return (
    <main className="page page--center">
      <Logo kind="full" className="logo--form" />
      <section className="card card--center">
        <h2>Анкета пока закрыта</h2>
        <p>Мы скоро откроем приём анкет. Если вы хотите связаться с нами сейчас — напишите в Telegram.</p>
        <a className="btn btn--secondary btn--block" href="https://t.me/JoyRest">
          Написать в Telegram
        </a>
      </section>
    </main>
  );
}

export function FormFailed({ onRetry, text = "Не удалось открыть страницу. Проверьте интернет." }: { onRetry: () => void; text?: string }) {
  return (
    <main className="page page--center">
      <Logo kind="full" className="logo--form" />
      <section className="card card--center">
        <h2>Нет связи</h2>
        <p>{text}</p>
        <button className="btn btn--block" type="button" onClick={onRetry}>
          Попробовать ещё раз
        </button>
      </section>
    </main>
  );
}
