import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSeo, type JsonLd } from "../hooks/useSeo";
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
  /** Overrides the auto-derived <meta name="description"> (Phase 24). When omitted and `description`
   * is a plain string, that string is used (truncated) instead — most pages need nothing extra. */
  seoDescription?: string;
  /** Optional JSON-LD structured data for this page (Phase 24), e.g. a Person or ScholarlyArticle. */
  jsonLd?: JsonLd | JsonLd[];
}

/** The first thing on every inner page: one <h1>, where you are, and (optionally) what the page is for. */
export function PageHeader({ title, eyebrow, crumbs, description, seoDescription, jsonLd, actions }: PageHeaderProps) {
  const t = useT();
  useSeo({
    title: typeof title === "string" ? title : null,
    description: seoDescription ?? (typeof description === "string" ? description : undefined),
    jsonLd,
  });

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
