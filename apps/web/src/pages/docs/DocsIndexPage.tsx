import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { usePolicy } from "../../auth/usePolicy";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useLocale, useT } from "../../i18n/LocaleContext";
import { PageHeader } from "../../components/PageHeader";
import { Icon } from "../../components/Icon";
import { DOCS_MANIFEST } from "../../docs/content/manifest";

interface Entry {
  to: string;
  slug: string;
  visible: boolean;
}

export function DocsIndexPage() {
  const t = useT();
  useDocumentTitle(t("docs.index.title"));
  const { user } = useAuth();
  const { isAdmin, isManager } = usePolicy();
  const { locale } = useLocale();

  const titleFor = (slug: string) => {
    const entry = DOCS_MANIFEST.find((d) => d.slug === slug);
    return locale === "ja" ? (entry?.titleJa ?? slug) : (entry?.titleEn ?? slug);
  };

  const entries: Entry[] = [
    { to: "/docs/quick-start", slug: "quick-start", visible: true },
    { to: "/docs/visitor", slug: "public-visitor-guide", visible: true },
    { to: "/docs/onboarding", slug: "researcher-onboarding", visible: true },
    { to: "/docs/researcher", slug: "researcher-guide", visible: Boolean(user) },
    { to: "/docs/admin", slug: "admin-guide", visible: isManager },
    { to: "/docs/maintenance", slug: "site-maintainer-guide", visible: isAdmin },
  ];

  return (
    <>
      <PageHeader title={t("docs.index.title")} description={t("docs.index.description")} />
      <div className="container container--narrow">
        <ul className="docs-index-list">
          {entries
            .filter((e) => e.visible)
            .map((e) => (
              <li key={e.to}>
                <Link to={e.to} className="docs-index-list__link">
                  {titleFor(e.slug)} <Icon name="arrow-right" size={14} />
                </Link>
              </li>
            ))}
        </ul>
        {!user && <p className="form-hint">{t("docs.index.moreAfterLogin")}</p>}
      </div>
    </>
  );
}
