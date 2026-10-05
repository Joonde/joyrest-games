import { Link } from "react-router-dom";
import { signOutUser } from "../data";
import { HostGate } from "../components/HostGate";
import { StudioSkeleton } from "../components/Skeleton";
import { TopBar } from "../components/TopBar";

export function Admin() {
  return (
    <HostGate requireAdmin skeleton={<StudioSkeleton />}>
      {(user) => (
        <main className="page">
          <TopBar
            title="Ведущие"
            actions={[
              { label: "В студию", to: "/studio" },
              { label: "Выйти", onClick: () => void signOutUser() },
            ]}
          />
          <div className="card">
            <p>Добавление и отключение ведущих появится на этапе 2.</p>
            <p className="muted">Ваш UID: {user.uid}</p>
          </div>
          <Link className="btn btn--secondary" to="/studio">
            Вернуться в студию
          </Link>
        </main>
      )}
    </HostGate>
  );
}
