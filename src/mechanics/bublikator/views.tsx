/**
 * «Бубликатор» на платформе: телефон гостя (Блок 2b), экран зала (2c), пульт, конструктор и предпросмотр (2d). Каждый — отдельный
 * чанк: гостю не нужен код экрана и пульта, ведущему на пульте — код конструктора. Чанк не скачался (обрыв сети) — import()
 * пробует ещё два раза с паузой, потом — «Не загрузилось — Повторить» (аудит 2b, круг 2, №2): не пустая страница, шапка
 * платформы остаётся.
 */
import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
import { ListSkeleton } from "../../components/Skeleton";
import type { EditorProps, HostControlsProps, PlayerViewProps, RoomPreviewProps, ViewProps } from "../types";
import { importWithRetry, type ChunkLoad } from "./phone/chunk";
import type { BubContent } from "./rules/types";

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

/**
 * Вид из отдельного чанка с повторами. Новая попытка — новый lazy: React запоминает неудачную загрузку у прежнего; адреса чанка
 * браузер не назвал (Safari) — тот же import() не повторится, «Повторить» перезагружает страницу.
 */
function chunkView<P extends object, M>(chunk: ChunkLoad<M>, pick: (m: M) => ComponentType<P>): ComponentType<P> {
  const state: { url: string | null; n: number } = { url: null, n: 0 };
  const make = () => lazy(() => importWithRetry(chunk, state).then((m) => ({ default: pick(m) })));
  let first: ReturnType<typeof make> | null = null;
  return function ChunkView(props: P) {
    const [attempt, setAttempt] = useState(0);
    const [View, setView] = useState(() => (first ??= make()));
    return (
      <ChunkGuard
        key={attempt}
        onRetry={() => {
          if (state.url === null) {
            window.location.reload();
            return;
          }
          first = make();
          const next = first;
          setView(() => next);
          setAttempt((a) => a + 1);
        }}
      >
        <Suspense fallback={<ListSkeleton count={3} />}>
          <View {...props} />
        </Suspense>
      </ChunkGuard>
    );
  };
}

/** Телефон гостя: личный поток игровой комнаты и пачки нажатий (поток экрана телефон не слушает). */
type PhoneModule = typeof import("./phone/PlayerView");
export const BublikatorPlayerView = chunkView<PlayerViewProps<BubContent, never>, PhoneModule>(
  { load: () => import("./phone/PlayerView"), again: (url, n) => import(/* @vite-ignore */ `${url}?retry=${n}`) as Promise<PhoneModule> },
  (m) => m.BublikatorPhoneView,
);

/** Экран зала: поток экрана игровой комнаты (без тайн), все этапы рисует сам (`standalone`). */
type ScreenModule = typeof import("./screen/ScreenView");
export const BublikatorScreenView = chunkView<ViewProps<BubContent>, ScreenModule>(
  { load: () => import("./screen/ScreenView"), again: (url, n) => import(/* @vite-ignore */ `${url}?retry=${n}`) as Promise<ScreenModule> },
  (m) => m.BublikatorHallView,
);

/** Пульт ведущего: поток `host` и команды комнаты (Блок 2d). */
type HostModule = typeof import("./host/HostControls");
export const BublikatorHostControls = chunkView<HostControlsProps<BubContent>, HostModule>(
  { load: () => import("./host/HostControls"), again: (url, n) => import(/* @vite-ignore */ `${url}?retry=${n}`) as Promise<HostModule> },
  (m) => m.BublikatorHostView,
);

/** Конструктор (Блок 2d). */
type EditorModule = typeof import("./editor/Editor");
export const BublikatorEditor = chunkView<EditorProps<BubContent>, EditorModule>(
  { load: () => import("./editor/Editor"), again: (url, n) => import(/* @vite-ignore */ `${url}?retry=${n}`) as Promise<EditorModule> },
  (m) => m.BublikatorEditorView,
);

/** Предпросмотр и репетиция: игра идёт в комнате в памяти с тестовыми гостями (Блок 2d). */
type PreviewModule = typeof import("./sim/Preview");
export const BublikatorRoomPreview = chunkView<RoomPreviewProps<BubContent>, PreviewModule>(
  { load: () => import("./sim/Preview"), again: (url, n) => import(/* @vite-ignore */ `${url}?retry=${n}`) as Promise<PreviewModule> },
  (m) => m.BublikatorPreview,
);
