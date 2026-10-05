import { useId, useMemo } from "react";
import emblemSvg from "../../public/brand/joyrest-emblem.svg?inline-svg";
import logoSvg from "../../public/brand/joyrest-logo.svg?inline-svg";
import monogramSvg from "../../public/brand/joyrest-monogram.svg?inline-svg";
import { hideFromScreenReaders, uniquifyIds, withGradient } from "../brand/svgMarkup";
import { brand, logoGradients } from "../themes/brand";

/** full — полный логотип, monogram — «J✦R», emblem — с аркой для заставки. */
export type LogoKind = "full" | "monogram" | "emblem";
/**
 * theme — цвет из темы (--color-logo); cream / dark — фиксированные;
 * gold / festive — градиенты для будущих свадебной и праздничной тем.
 */
export type LogoTone = "theme" | "cream" | "dark" | "gold" | "festive";

const MARKUP: Record<LogoKind, string> = {
  full: logoSvg,
  monogram: monogramSvg,
  emblem: emblemSvg,
};

const SOLID: Record<"theme" | "cream" | "dark", string> = {
  theme: "var(--color-logo)",
  cream: brand.cream,
  dark: brand.espresso,
};

interface Props {
  kind?: LogoKind;
  tone?: LogoTone;
  className?: string;
  /** Подпись для экранного диктора; пустая строка — декоративный логотип. */
  title?: string;
}

/** Логотип JoyRest из файлов public/brand, встроенный в страницу. */
export function Logo({ kind = "full", tone = "theme", className, title = "JoyRest" }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const html = useMemo(() => {
    let markup = uniquifyIds(MARKUP[kind], uid);
    if (tone === "gold" || tone === "festive") {
      markup = withGradient(markup, logoGradients[tone], `jr-fill-${uid}`);
    }
    return hideFromScreenReaders(markup);
  }, [kind, tone, uid]);

  const color = tone === "gold" || tone === "festive" ? undefined : SOLID[tone];

  return (
    <span
      className={["logo", `logo--${kind}`, className].filter(Boolean).join(" ")}
      style={color ? { color } : undefined}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
