import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";

export function Home() {
  return (
    <main className="page page--center">
      <Logo kind="emblem" className="logo--form" />
      <p className="muted" style={{ textAlign: "center" }}>
        Радость без хлопот
      </p>
      <Link className="btn btn--block" to="/j">
        Я гость: ввести код
      </Link>
      <Link className="btn btn--secondary btn--block" to="/studio">
        Я ведущий
      </Link>
    </main>
  );
}
