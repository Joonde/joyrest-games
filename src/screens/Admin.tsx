import { Link } from "react-router-dom";
import { HostGate } from "../components/HostGate";

export function Admin() {
  return (
    <HostGate requireAdmin>
      {(user) => (
        <main className="page">
          <h1>Ведущие</h1>
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
