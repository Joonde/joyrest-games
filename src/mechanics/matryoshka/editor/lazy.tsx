/** Конструктор «Игр Матрёшки» — отдельный чанк с восстановлением после ошибки загрузки. */
import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { ListSkeleton } from "../../../components/Skeleton";
import type { EditorProps } from "../../types";
import { importWithRetry, type ChunkLoad } from "../../bublikator/phone/chunk";
import type { MatContent } from "../rules/types";

class ChunkGuard extends Component<{ onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="card card--center" role="alert"><h2>Не загрузилось</h2><p className="muted">Конструктор не скачался — проверьте интернет и повторите.</p><button type="button" className="btn btn--block" onClick={this.props.onRetry}>Повторить</button></section>;
  }
}
type EditorModule = typeof import("./Editor");
const chunk: ChunkLoad<EditorModule> = { load: () => import("./Editor"), again: (url, n) => import(/* @vite-ignore */ `${url}?retry=${n}`) as Promise<EditorModule> };
const state: { url: string | null; n: number } = { url: null, n: 0 };
const make = () => lazy(() => importWithRetry(chunk, state).then((m) => ({ default: m.MatryoshkaEditorView })));
let first: ReturnType<typeof make> | null = null;

export function MatryoshkaEditorLazy(props: EditorProps<MatContent>) {
  const [attempt, setAttempt] = useState(0);
  const [View, setView] = useState(() => (first ??= make()));
  return <ChunkGuard key={attempt} onRetry={() => {
    if (state.url === null) { window.location.reload(); return; }
    first = make();
    const next = first;
    setView(() => next);
    setAttempt((a) => a + 1);
  }}><Suspense fallback={<ListSkeleton count={3} />}><View {...props} /></Suspense></ChunkGuard>;
}
