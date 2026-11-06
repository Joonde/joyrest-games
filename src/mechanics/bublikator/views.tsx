/**
 * «Бубликатор» на платформе: телефон гостя — настоящий (Блок 2b), экран зала, пульт и конструктор — заглушки до 2c–2d
 * (механика скрыта, `HIDDEN_MECHANICS`: ведущие её не видят).
 */
import { lazy, Suspense } from "react";
import { ListSkeleton } from "../../components/Skeleton";
import type { EditorProps, HostControlsProps, PlayerViewProps, ViewProps } from "../types";
import type { BubContent } from "./rules/types";

/**
 * Телефон гостя — отдельный чанк (аудит 2b, №17): его код и стили качает только гость «Бубликатора», а не гость любой
 * игры из общего чанка реестра.
 */
const Phone = lazy(() => import("./phone/PlayerView").then((m) => ({ default: m.BublikatorPhoneView })));

/** Телефон гостя: личный поток игровой комнаты и пачки нажатий (поток экрана телефон не слушает). */
export function BublikatorPlayerView(props: PlayerViewProps<BubContent, never>) {
  return (
    <Suspense fallback={<ListSkeleton count={3} />}>
      <Phone {...props} />
    </Suspense>
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
