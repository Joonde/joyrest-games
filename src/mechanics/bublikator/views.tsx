/**
 * «Бубликатор» на платформе: телефон гостя — настоящий (Блок 2b), экран зала, пульт и конструктор — заглушки до 2c–2d
 * (механика скрыта, `HIDDEN_MECHANICS`: ведущие её не видят).
 */
import { useMemo } from "react";
import { formatSessionCode } from "../../core/code";
import type { EditorProps, HostControlsProps, PlayerViewProps, ViewProps } from "../types";
import type { BubContent } from "./rules/types";
import { BublikatorPhone } from "./phone/Phone";
import { roomLink } from "./phone/roomLink";

/** Телефон гостя: личный поток игровой комнаты и пачки нажатий (поток экрана телефон не слушает). */
export function BublikatorPlayerView({ session, participant }: PlayerViewProps<BubContent, never>) {
  const link = useMemo(() => roomLink(session.id), [session.id]);
  const name = participant.name.replace(/^\p{Extended_Pictographic}️?\s*/u, "");
  return <BublikatorPhone link={link} name={name || participant.name} code={formatSessionCode(session.code)} />;
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
