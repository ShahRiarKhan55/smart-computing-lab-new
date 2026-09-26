import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { KnowledgeDocDetail } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { Badge } from "../components/Badge";
import { KnowledgeFormModal, type KnowledgeFormPayload } from "../components/KnowledgeFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { Icon } from "../components/Icon";
import { VisibilityBadge } from "../components/VisibilityField";
import { formatDate } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";
import { KNOWLEDGE_CATEGORY_LABEL_KEY } from "../i18n/labels";

/**
 * One knowledge document. A hidden document is a 404 from the API, so this page can't tell "doesn't
 * exist" from "not yours to see" and neither can a visitor: the not-found message covers both. The body
 * is rendered as TEXT (React escapes it; line breaks are kept by CSS) — never as HTML.
 */
export function KnowledgeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
  const { locale, t } = useLocale();
  const { data: doc, loading, error, status, reload } = useApiResource<KnowledgeDocDetail>(`/knowledge/${id}`);

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const crumbsTo = [{ label: t("nav.knowledge"), to: "/knowledge" }];

  if (loading && (!doc || doc.id !== id)) {
    return (
      <>
        <PageHeader crumbs={[...crumbsTo, { label: t("common.loading") }]} title={t("common.loading")} />
        <div className="container">
          <LoadingState label={t("knowledge.loadingDoc")} variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || (!doc && error)) {
    return (
      <>
        <PageHeader crumbs={[...crumbsTo, { label: t("common.notFoundCrumb") }]} title={t("knowledge.notFoundTitle")} />
        <div className="container">
          <ErrorState message={status === 404 ? t("knowledge.notFoundMsg") : t("knowledge.couldNotLoad")} onRetry={status === 404 ? undefined : reload} />
          <Link to="/knowledge" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> {t("knowledge.allDocs")}
          </Link>
        </div>
      </>
    );
  }
  if (!doc) return null;

  const facts: { key: string; label: string; value: React.ReactNode }[] = [
    { key: "category", label: t("knowledge.factCategory"), value: t(KNOWLEDGE_CATEGORY_LABEL_KEY[doc.category]) },
    {
      key: "author",
      label: t("knowledge.factAuthor"),
      value: doc.author ? (
        <Link to={`/team/${doc.author.id}`} className="link">
          {doc.author.name}
        </Link>
      ) : (
        t("knowledge.formerMember")
      ),
    },
    { key: "updated", label: t("knowledge.factUpdated"), value: <time dateTime={doc.updatedAt}>{formatDate(doc.updatedAt, locale)}</time> },
    { key: "created", label: t("knowledge.factCreated"), value: <time dateTime={doc.createdAt}>{formatDate(doc.createdAt, locale)}</time> },
    ...(doc.project
      ? [{ key: "project", label: t("knowledge.factProject"), value: <Link to={`/projects/${doc.project.id}`} className="link">{doc.project.title}</Link> }]
      : []),
    ...(doc.researchArea
      ? [{ key: "area", label: t("knowledge.factArea"), value: <Link to={`/research/${doc.researchArea.id}`} className="link">{doc.researchArea.title}</Link> }]
      : []),
    ...(doc.group ? [{ key: "group", label: t("knowledge.factGroup"), value: <Link to={`/groups/${doc.group.id}`} className="link">{doc.group.title}</Link> }] : []),
    ...(doc.researcher
      ? [{ key: "researcher", label: t("knowledge.factResearcher"), value: <Link to={`/team/${doc.researcher.id}`} className="link">{doc.researcher.name}</Link> }]
      : []),
  ];

  return (
    <>
      <PageHeader crumbs={[...crumbsTo, { label: doc.title }]} title={doc.title} />

      <div className="container">
        {doc.canEdit && (
          <AdminBar
            text={`${policy.isManager ? policy.roleLabel : t("common.loggedIn")}: ${t("knowledge.manageBar")}`}
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => setEditing(true)}>
                  {t("common.edit")}
                </button>
                {doc.canDelete && (
                  <button className="btn btn--danger btn--sm" type="button" onClick={() => setDeleting(true)}>
                    {t("common.delete")}
                  </button>
                )}
              </>
            }
          />
        )}

        <div className="detail-layout knowledge-detail">
          <div className="detail-layout__a">
            <div className="detail-meta">
              <Badge variant="brand" upper>
                {t(KNOWLEDGE_CATEGORY_LABEL_KEY[doc.category])}
              </Badge>
              <VisibilityBadge visibility={doc.visibility} />
            </div>
            <section aria-labelledby="knowledge-body">
              <h2 className="sr-only" id="knowledge-body">
                {t("knowledge.bodyHeading")}
              </h2>
              <div className="knowledge-body">{doc.body}</div>
            </section>
          </div>

          <aside className="detail-layout__aside" aria-labelledby="knowledge-details">
            <section className="panel">
              <h2 className="panel__title" id="knowledge-details">
                {t("knowledge.detailsHeading")}
              </h2>
              <dl className="event-facts knowledge-facts">
                {facts.map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </aside>
        </div>
      </div>

      <KnowledgeFormModal
        open={editing}
        title={t("knowledge.editTitle")}
        initial={doc}
        canSetVisibility={policy.canChangeVisibility}
        onClose={() => setEditing(false)}
        onSubmit={async (payload: KnowledgeFormPayload) => {
          await apiFetch(`/knowledge/${doc.id}`, { method: "PUT", body: JSON.stringify(payload) });
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleting}
        title={t("knowledge.deleteTitle")}
        message={t("knowledge.deleteConfirm", { title: doc.title })}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await apiFetch(`/knowledge/${doc.id}`, { method: "DELETE" });
          navigate("/knowledge");
        }}
      />
    </>
  );
}
