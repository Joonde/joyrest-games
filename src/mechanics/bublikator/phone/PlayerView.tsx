/** Телефон гостя «Бубликатора» на платформе (отдельный чанк, грузится из `views.tsx` через `lazy`). */
import { useMemo } from "react";
import { formatSessionCode } from "../../../core/code";
import type { PlayerViewProps } from "../../types";
import type { BubContent } from "../rules/types";
import { BublikatorPhone } from "./Phone";
import { roomLink } from "./roomLink";

export function BublikatorPhoneView({ session, participant }: PlayerViewProps<BubContent, never>) {
  const link = useMemo(() => roomLink(session.id), [session.id]);
  const name = participant.name.replace(/^\p{Extended_Pictographic}️?\s*/u, "");
  return <BublikatorPhone link={link} name={name || participant.name} code={formatSessionCode(session.code)} />;
}
