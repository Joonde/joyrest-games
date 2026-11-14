/**
 * «Игры Матрёшки» на платформе — пока заглушки: Блок 3a — только правила и комната (docs/matryoshka.md). Телефон (3b), экран
 * зала (3c), пульт, конструктор и предпросмотр (3d) — по макетам; механика скрыта (`HIDDEN_MECHANICS`), поэтому эти виды гость
 * и ведущий не увидят, пока игру не откроют.
 */
import type { EditorProps, HostControlsProps, PlayerViewProps, ViewProps } from "../types";
import type { MatContent } from "./rules/types";

function Soon({ what }: { what: string }) {
  return (
    <section className="card card--center">
      <h2>Игры Матрёшки</h2>
      <p className="muted">{what} появится в следующих блоках — игра готовится.</p>
    </section>
  );
}

export function MatryoshkaEditor(_props: EditorProps<MatContent>) {
  return <Soon what="Конструктор" />;
}

export function MatryoshkaScreenView(_props: ViewProps<MatContent>) {
  return <Soon what="Экран зала" />;
}

export function MatryoshkaPlayerView(_props: PlayerViewProps<MatContent, never>) {
  return <Soon what="Телефон гостя" />;
}

export function MatryoshkaHostControls(_props: HostControlsProps<MatContent>) {
  return <Soon what="Пульт" />;
}
