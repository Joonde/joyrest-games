/**
 * Экран зала «Игр Матрёшки» — отдельный чанк (телефону гостя не нужны роспись, музыка и доски экрана). Чанк не скачался —
 * import() пробует ещё два раза с паузой (тот же загрузчик, что у «Бубликатора»), потом — «Не загрузилось — Повторить».
 */
import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { ListSkeleton } from "../../../components/Skeleton";
import type { ViewProps } from "../../types";
import { importWithRetry, type ChunkLoad } from "../../bublikator/phone/chunk";
import type { MatContent } from "../rules/types";

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
        <p className="muted">Экран игры не скачался — проверьте интернет и нажмите «Повторить».</p>
        <div className="actions">
          <button type="button" className="btn btn--block" onClick={this.props.onRetry}>
            Повторить
          </button>
        </div>
      </section>
    );
  }
}

type ScreenModule = typeof import("./ScreenView");
const chunk: ChunkLoad<ScreenModule> = { load: () => import("./ScreenView"), again: (url, n) => import(/* @vite-ignore */ `${url}?retry=${n}`) as Promise<ScreenModule> };
const state: { url: string | null; n: number } = { url: null, n: 0 };
const make = () => lazy(() => importWithRetry(chunk, state).then((m) => ({ default: m.MatryoshkaHallView })));
let first: ReturnType<typeof make> | null = null;

/** Экран зала: поток экрана игровой комнаты (без тайн), все этапы рисует сам (`standalone`). */
export function MatryoshkaScreenLazy(props: ViewProps<MatContent>) {
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
}
