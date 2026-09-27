import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RESOURCE_TYPE_METADATA, isHttpUrl, type ResourceDetail } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { ResourceFormModal, type ResourceFormPayload } from "../components/ResourceFormModal";
import { ResourceTypeBadge } from "../components/ResourceTypeBadge";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { Icon } from "../components/Icon";
import { VisibilityBadge } from "../components/VisibilityField";
import { formatDate } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";
import { RESOURCE_METADATA_LABEL_KEY, RESOURCE_TYPE_LABEL_KEY } from "../i18n/labels";

/**
 * One lab resource. A hidden resource is a 404 from the API, so this page can't tell "doesn't exist" from
 * "not yours to see" and neither can a visitor: the not-found message covers both. Every text field is
 * rendered as TEXT (React escapes it; line breaks are kept by CSS) — never as HTML — and the link is only
 * ever an http(s) URL (the API guarantees it; it is re-checked here).
 */
export function ResourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
  const { locale, t } = useLocale();
  const { data: r, loading, error, status, reload } = useApiResource<ResourceDetail>(`/resources/${id}`);

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const crumbsTo = [{ label: t("nav.resources"), to: "/resources" }];

  if (loading && (!r || r.id !== id)) {
    return (
      <>
        <PageHeader crumbs={[...crumbsTo, { label: t("common.loading") }]} title={t("common.loading")} />
        <div className="container">
          <LoadingState label={t("resource.loadingResource")} variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || (!r && error)) {
    return (
      <>
        <PageHeader
          crumbs={[...crumbsTo, { label: status === 404 ? t("common.notFoundCrumb") : t("common.error") }]}
          title={status === 404 ? t("resource.notFoundTitle") : t("resource.couldNotLoad")}
        />
        <div className="container">
          <ErrorState message={status === 404 ? t("resource.notFoundMsg") : t("resource.couldNotLoad")} onRetry={status === 404 ? undefined : reload} />
          <Link to="/resources" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> {t("resource.allResources")}
          </Link>
        </div>
      </>
    );
  }
  if (!r) return null;

  const link = (to: string, label: string) => (
    <Link to={to} className="link">
      {label}
    </Link>
  );
  const facts: { key: string; label: string; value: React.ReactNode }[] = [
    { key: "type", label: t("resource.factType"), value: t(RESOURCE_TYPE_LABEL_KEY[r.resourceType]) },
    ...(r.version ? [{ key: "version", label: t("resource.factVersion"), value: r.version }] : []),
    ...(r.vendor ? [{ key: "vendor", label: t("resource.factVendor"), value: r.vendor }] : []),
    ...(r.identifier ? [{ key: "identifier", label: t("resource.factIdentifier"), value: r.identifier }] : []),
    ...(r.url && isHttpUrl(r.url)
      ? [
          {
            key: "link",
            label: t("resource.factLink"),
            value: (
              <a className="link resource-link" href={r.url} target="_blank" rel="noopener noreferrer">
                {r.url}
              </a>
            ),
          },
        ]
      : []),
    { key: "owner", label: t("resource.factOwner"), value: r.owner ? link(`/team/${r.owner.id}`, r.owner.name) : t("resource.formerMember") },
    ...(r.researcher ? [{ key: "researcher", label: t("resource.factResearcher"), value: link(`/team/${r.researcher.id}`, r.researcher.name) }] : []),
    { key: "updated", label: t("resource.factUpdated"), value: <time dateTime={r.updatedAt}>{formatDate(r.updatedAt, locale)}</time> },
    { key: "created", label: t("resource.factCreated"), value: <time dateTime={r.createdAt}>{formatDate(r.createdAt, locale)}</time> },
    ...(r.projects.length > 0
      ? [
          {
            key: "projects",
            label: t("resource.factProjects"),
            value: (
              <ul className="resource-facts__list">
                {r.projects.map((p) => (
                  <li key={p.id}>{link(`/projects/${p.id}`, p.title)}</li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    ...(r.researchArea ? [{ key: "area", label: t("resource.factArea"), value: link(`/research/${r.researchArea.id}`, r.researchArea.title) }] : []),
    ...(r.group ? [{ key: "group", label: t("resource.factGroup"), value: link(`/groups/${r.group.id}`, r.group.title) }] : []),
    ...(r.knowledgeDoc ? [{ key: "doc", label: t("resource.factDoc"), value: link(`/knowledge/${r.knowledgeDoc.id}`, r.knowledgeDoc.title) }] : []),
    ...(r.publication ? [{ key: "publication", label: t("resource.factPublication"), value: link(`/publications/${r.publication.id}`, r.publication.title) }] : []),
    ...(r.event ? [{ key: "event", label: t("resource.factEvent"), value: link(`/events/${r.event.id}`, r.event.title) }] : []),
  ];

  const metadata = RESOURCE_TYPE_METADATA[r.resourceType].filter((k) => r.metadata[k]);
  const hasRepro = metadata.length > 0 || r.environment !== "";

  return (
    <>
      <PageHeader crumbs={[...crumbsTo, { label: r.name }]} title={r.name} />

      <div className="container">
        {r.canEdit && (
          <AdminBar
            text={`${policy.isManager ? policy.roleLabel : t("common.loggedIn")}: ${t("resource.manageBar")}`}
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => setEditing(true)}>
                  {t("common.edit")}
                </button>
                {r.canDelete && (
                  <button className="btn btn--danger btn--sm" type="button" onClick={() => setDeleting(true)}>
                    {t("common.delete")}
                  </button>
                )}
              </>
            }
          />
        )}

        <div className="detail-layout knowledge-detail resource-detail">
          <div className="detail-layout__a">
            <div className="detail-meta">
              <ResourceTypeBadge type={r.resourceType} />
              <VisibilityBadge visibility={r.visibility} />
            </div>

            {r.description && (
              <section aria-labelledby="resource-description">
                <h2 className="sr-only" id="resource-description">
                  {t("resource.descriptionHeading")}
                </h2>
                <div className="knowledge-body">{r.description}</div>
              </section>
            )}

            <section className="detail-section repro-details" aria-labelledby="resource-repro">
              <h2 className="panel__title" id="resource-repro">
                {t("resource.reproHeading")}
              </h2>
              <p className="text-muted">{t("resource.reproHint")}</p>
              {!hasRepro && <p>{t("resource.reproEmpty")}</p>}
              {metadata.length > 0 && (
                <dl className="event-facts resource-repro__facts">
                  {metadata.map((k) => (
                    <div key={k}>
                      <dt>{t(RESOURCE_METADATA_LABEL_KEY[k])}</dt>
                      <dd className="resource-repro__value">{r.metadata[k]}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {r.environment && (
                <>
                  <h3 className="repro-group__title">{t("resource.reproNotes")}</h3>
                  <div className="knowledge-body resource-repro__notes">{r.environment}</div>
                </>
              )}
            </section>
          </div>

          <aside className="detail-layout__aside" aria-labelledby="resource-details">
            <section className="panel">
              <h2 className="panel__title" id="resource-details">
                {t("resource.detailsHeading")}
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

      <ResourceFormModal
        open={editing}
        title={t("resource.editTitle")}
        initial={r}
        canSetVisibility={policy.canChangeVisibility}
        onClose={() => setEditing(false)}
        onSubmit={async (payload: ResourceFormPayload) => {
          await apiFetch(`/resources/${r.id}`, { method: "PUT", body: JSON.stringify(payload) });
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleting}
        title={t("resource.deleteTitle")}
        message={t("resource.deleteConfirm", { name: r.name })}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await apiFetch(`/resources/${r.id}`, { method: "DELETE" });
          navigate("/resources");
        }}
      />
    </>
  );
}
