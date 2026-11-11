/**
 * «Бубликатор» на платформе: телефон гостя — настоящий (Блок 2b), экран зала, пульт и конструктор — заглушки до 2c–2d
 * (механика скрыта, `HIDDEN_MECHANICS`: ведущие её не видят).
 */
import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
import { ListSkeleton } from "../../components/Skeleton";
import type { EditorProps, HostControlsProps, PlayerViewProps, ViewProps } from "../types";
import { importWithRetry } from "./phone/chunk";
import type { BubContent } from "./rules/types";

type PhoneComponent = ComponentType<PlayerViewProps<BubContent, never>>;

/**
 * Телефон гостя — отдельный чанк (аудит 2b, №17): его код и стили качает только гость «Бубликатора». Чанк не скачался
 * (обрыв сети) — import() пробует ещё два раза с паузой, потом — «Не загрузилось — Повторить» (аудит 2b, круг 2, №2):
 * не пустая страница, шапка платформы остаётся.
 */
type PhoneModule = typeof import("./phone/PlayerView");

/** Чем повторять: адрес чанка (если браузер его назвал) и номер повтора — общий для автоповтора и «Повторить». */
const chunkState: { url: string | null; n: number } = { url: null, n: 0 };
const phoneLoad = {
  load: () => import("./phone/PlayerView"),
  again: (url: string, n: number) => import(/* @vite-ignore */ `${url}?retry=${n}`) as Promise<PhoneModule>,
};

function phoneChunk() {
  return lazy(() => importWithRetry(phoneLoad, chunkState).then((m) => ({ default: m.BublikatorPhoneView as PhoneComponent })));
}

let firstPhone: ReturnType<typeof phoneChunk> | null = null;

class ChunkGuard extends Component<{ onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="card card--center" role="alert">
        <h2>Не загрузилось</h2>
        <p className="muted">Игра не скачалась — проверьте интернет и нажмите «Повторить».</p>
        <div className="actions">
          <button type="button" className="btn btn--block" onClick={this.props.onRetry}>
            Повторить
          </button>
        </div>
      </section>
    );
  }
}

/** Телефон гостя: личный поток игровой комнаты и пачки нажатий (поток экрана телефон не слушает). */
export function BublikatorPlayerView(props: PlayerViewProps<BubContent, never>) {
  const [attempt, setAttempt] = useState(0);
  // Новая попытка — новый lazy: React запоминает неудачную загрузку у прежнего.
  const [Phone, setPhone] = useState(() => (firstPhone ??= phoneChunk()));
  return (
    <ChunkGuard
      key={attempt}
      onRetry={() => {
        // Адреса чанка браузер не назвал (Safari) — тот же import() не повторится: перезагружаем страницу.
        if (chunkState.url === null) {
          window.location.reload();
          return;
        }
        firstPhone = phoneChunk();
        setPhone(() => firstPhone ?? phoneChunk());
        setAttempt((a) => a + 1);
      }}
    >
      <Suspense fallback={<ListSkeleton count={3} />}>
        <Phone {...props} />
      </Suspense>
    </ChunkGuard>
  );
}

function Soon({ what }: { what: string }) {
  return (
    <div className="card card--center">
      <h2>«Бубликатор»</h2>
      <p className="muted">{what} — в следующих блоках. Пока игра есть только на тестовой версии.</p>
    </div>
  );
}

export function BublikatorScreenView(_: ViewProps<BubContent>) {
  void _;
  return <Soon what="Экран зала" />;
}

export function BublikatorHostControls(_: HostControlsProps<BubContent>) {
  void _;
  return <Soon what="Пульт ведущего" />;
}

export function BublikatorEditor(_: EditorProps<BubContent>) {
  void _;
  return <Soon what="Конструктор" />;
}
