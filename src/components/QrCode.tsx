import QRCode from "qrcode";
import { useEffect, useState } from "react";

interface Props {
  value: string;
  label: string;
}

export function QrCode({ value, label }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 512, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value]);

  return <div className="qr">{src && <img src={src} alt={label} />}</div>;
}
