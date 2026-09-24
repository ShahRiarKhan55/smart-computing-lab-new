import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useT } from "../i18n/LocaleContext";

export function NotFoundPage() {
  const t = useT();
  useDocumentTitle(t("title.notFound"));
  return (
    <div className="container not-found">
      <p className="eyebrow">404</p>
      <h1>{t("title.notFound")}</h1>
      <p>{t("notFound.body")}</p>
      <Link to="/" className="btn btn--primary">
        <Icon name="arrow-left" size={14} /> {t("notFound.backToHome")}
      </Link>
    </div>
  );
}
