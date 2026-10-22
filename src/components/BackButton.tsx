import { useLocation, useNavigate } from "react-router-dom";

/**
 * «← Назад» на страницах инструкций (решение владельца 22 октября 2026): возвращает туда, откуда пришли
 * (студия, конструктор, «Команда → Инструкции»); открыли страницу по прямой ссылке — в `fallback`.
 */
export function BackButton({ fallback = "/studio", label = "← Назад" }: { fallback?: string; label?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Первая страница вкладки — у неё нет своей истории в приложении.
  const canGoBack = location.key !== "default";
  return (
    <button type="button" className="btn btn--secondary btn--block back-button" onClick={() => (canGoBack ? navigate(-1) : navigate(fallback))}>
      {label}
    </button>
  );
}
