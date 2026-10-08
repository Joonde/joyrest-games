import { Logo } from "../../components/Logo";

/** Письмо с историей: номер, текст, сургучная печать с эмблемой (при открытии автора — сломана). */
export function Letter({ text, label, open = false, size = "screen" }: { text: string; label: string; open?: boolean; size?: "screen" | "phone" }) {
  return (
    <div className={`st-letter st-letter--${size}${open ? " is-open" : ""}`}>
      <span className="st-letter__frame" aria-hidden="true" />
      <span className="st-letter__label">{label}</span>
      <span className="st-letter__quote" aria-hidden="true">
        «
      </span>
      <p className="st-letter__text">{text}</p>
      <span className="st-seal" aria-hidden="true">
        <span className="st-seal__wax" />
        <Logo kind="monogram" tone="cream" title="" className="st-seal__mark" />
      </span>
    </div>
  );
}

