import { Link } from "react-router-dom";
import { HostGate } from "../components/HostGate";
import { TopBar } from "../components/TopBar";

export function Admin() {
  return (
    <HostGate requireAdmin>
      {(user) => (
        <main className="page">
          <TopBar title="Ведущие" eyebrow="Администратор" />
          <div className="card">
            <p>Добавление и отключение ведущих появится на этапе 2.</p>
            <p className="muted">Ваш UID: {user.uid}</p>
          </div>
          <Link className="btn btn--ghost" to="/studio">
            Вернуться в студию
          </Link>
        </main>
      )}
    </HostGate>
  );
}
