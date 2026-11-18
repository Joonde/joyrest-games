/** Виды «Игр Матрёшки» на платформе: телефон, экран, пульт и конструктор — отдельные чанки. */
import type { EditorProps, HostControlsProps, PlayerViewProps, ViewProps } from "../types";
import type { MatContent } from "./rules/types";
import { MatryoshkaHostLazy } from "./host/lazy";
import { MatryoshkaEditorLazy } from "./editor/lazy";

function Soon({ what }: { what: string }) {
  return <section className="card card--center"><h2>Игры Матрёшки</h2><p className="muted">{what} появится в следующем блоке — игра готовится.</p></section>;
}

export function MatryoshkaEditor(props: EditorProps<MatContent>) { return <MatryoshkaEditorLazy {...props} />; }
export function MatryoshkaScreenView(_props: ViewProps<MatContent>) { return <Soon what="Экран зала" />; }
export function MatryoshkaPlayerView(_props: PlayerViewProps<MatContent, never>) { return <Soon what="Телефон гостя" />; }
export function MatryoshkaHostControls(props: HostControlsProps<MatContent>) { return <MatryoshkaHostLazy {...props} />; }
