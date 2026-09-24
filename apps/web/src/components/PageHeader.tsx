import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useT } from "../i18n/LocaleContext";

export interface Crumb {
  label: string;
  to?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  /** Small mono label above the title on top-level pages ("Research", "People"). */
  eyebrow?: string;
  /** Detail pages: the path back up (Home / Projects), rendered as a breadcrumb trail ending at the title. */
  crumbs?: Crumb[];
  description?: ReactNode;
  actions?: ReactNode;
}

/** The first thing on every inner page: one <h1>, where you are, and (optionally) what the page is for. */
export function PageHeader({ title, eyebrow, crumbs, description, actions }: PageHeaderProps) {
  const t = useT();
  useDocumentTitle(typeof title === "string" ? title : null);

  return (
    <header className="page-header">
      <div className="page-header__inner">
        {crumbs ? (
          <nav className="breadcrumbs" aria-label={t("a11y.breadcrumb")}>
            <ol>
              <li>
                <Link to="/">{t("common.home")}</Link>
              </li>
              {crumbs.map((c) => (
                <li key={c.label}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
              ))}
            </ol>
          </nav>
        ) : (
          eyebrow && <p className="page-header__eyebrow">{eyebrow}</p>
        )}
        <h1 className="page-header__title">{title}</h1>
        {description && <p className="page-header__desc">{description}</p>}
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </header>
  );
}
