/**
 * Логотип заказчика (оформление под заказчика, `src/core/branding.ts`): на экране зала — в лобби крупно, во время игры —
 * в углу рядом со знаком JoyRest, на слайдах; на телефоне гостя — на входе и в шапке. Нет логотипа или сервера — ничего.
 * Картинка не загрузилась — тихо прячется (игре не мешает).
 */
import { useState } from "react";
import { brandingsRepo, type SessionBranding } from "../data";

export function ClientLogo({ branding, className }: { branding: SessionBranding | null | undefined; className: string }) {
  const [broken, setBroken] = useState(false);
  if (!branding?.logo || !brandingsRepo || broken) return null;
  return (
    <img
      className={`client-logo ${className}`}
      src={brandingsRepo.logoUrl(branding.logo)}
      alt={branding.name ? `Логотип: ${branding.name}` : "Логотип заказчика"}
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}
