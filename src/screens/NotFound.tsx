import { Link } from "react-router-dom";
import { Message } from "../components/Status";

export function NotFound() {
  return (
    <Message title="Страница не найдена">
      <Link className="btn btn--block" to="/">
        На главную
      </Link>
    </Message>
  );
}
