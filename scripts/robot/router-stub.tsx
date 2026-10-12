// Робот: маршрутизатор не нужен — ссылки и переходы как обычные элементы.
import type { ReactNode } from "react";
export function Link({ to, children, className }: { to: string; children?: ReactNode; className?: string }) {
  return (
    <a href={to} className={className} onClick={(e) => e.preventDefault()}>
      {children}
    </a>
  );
}
export const NavLink = Link;
export const useNavigate = () => () => undefined;
export const useLocation = () => ({ pathname: "/robot", search: "", state: null });
export const useParams = () => ({});
export const useSearchParams = () => [new URLSearchParams(), () => undefined] as const;
