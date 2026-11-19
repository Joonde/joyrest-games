/** Телефон гостя «Игр Матрёшки» на платформе (отдельный чанк, грузится из `lazy.tsx`). */
import { useMemo } from "react";
import { formatSessionCode } from "../../../core/code";
import type { PlayerViewProps } from "../../types";
import type { MatContent } from "../rules/types";
import { MatryoshkaPhone } from "./Phone";
import { roomLink } from "./roomLink";

export function MatryoshkaPhoneView({ session, participant }: PlayerViewProps<MatContent, never>) {
  const link = useMemo(() => roomLink(session.id), [session.id]);
  return <MatryoshkaPhone link={link} name={participant.name} code={formatSessionCode(session.code)} />;
}
