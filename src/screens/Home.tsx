import { Link } from "react-router-dom";

export function Home() {
  return (
    <main className="page page--center">
      <div className="stack">
        <h1>JoyRest Games</h1>
        <p className="muted">Радость без хлопот</p>
      </div>
      <Link className="btn btn--block" to="/j">
        Я гость: ввести код
      </Link>
      <Link className="btn btn--secondary btn--block" to="/studio">
        Я ведущий
      </Link>
    </main>
  );
}
