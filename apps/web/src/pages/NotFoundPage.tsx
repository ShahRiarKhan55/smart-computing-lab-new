import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <div className="container not-found">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist or may have moved.</p>
      <Link to="/" className="btn btn--primary">
        <Icon name="arrow-left" size={14} /> Back to home
      </Link>
    </div>
  );
}
