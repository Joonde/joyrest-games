import { useId, useMemo } from "react";
import monogramSvg from "../../public/brand/joyrest-monogram.svg?inline-svg";
import { qrSvg } from "../brand/qrSvg";
import { uniquifyIds } from "../brand/svgMarkup";

interface Props {
  value: string;
  label: string;
  className?: string;
}

/**
 * QR-код JoyRest: всегда тёмные модули на кремовой плашке при любой теме,
 * уровень коррекции H, монограмма J✦R в центре.
 */
export function QrCode({ value, label, className }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const html = useMemo(() => qrSvg(value, uniquifyIds(monogramSvg, `qr${uid}`)).svg, [value, uid]);
  return (
    <div
      className={["qr", className].filter(Boolean).join(" ")}
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
