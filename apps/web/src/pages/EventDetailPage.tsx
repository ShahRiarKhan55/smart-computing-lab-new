import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isEventPast, type LabEvent, type ProjectSummary } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { Badge } from "../components/Badge";
import { EventFormModal, type EventFormPayload } from "../components/EventFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { Icon } from "../components/Icon";
import { VisibilityBadge } from "../components/VisibilityField";
import { formatEventWhen } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";
import { EVENT_KIND_LABEL_KEY } from "../i18n/labels";

/**
 * One event. A hidden event is a 404 from the API, so this page can't tell "doesn't exist" from
 * "not yours to see" and neither can a visitor: the not-found message covers both.
 */
export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
  const { locale, t } = useLocale();
  const { data: event, loading, error, status, reload } = useApiResource<LabEvent>(`/events/${id}`);

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  const crumbsTo = [{ label: t("nav.events"), to: "/events" }];

  if (loading && (!event || event.id !== id)) {
    return (
      <>
        <PageHeader crumbs={[...crumbsTo, { label: t("common.loading") }]} title={t("common.loading")} />
        <div className="container">
          <LoadingState label={t("events.loadingEvent")} variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || (!event && error)) {
    return (
      <>
        <PageHeader crumbs={[...crumbsTo, { label: t("common.notFoundCrumb") }]} title={t("events.notFoundTitle")} />
        <div className="container">
          <ErrorState message={status === 404 ? t("events.notFoundMsg") : t("events.couldNotLoad")} onRetry={status === 404 ? undefined : reload} />
          <Link to="/events" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> {t("events.allEvents")}
          </Link>
        </div>
      </>
    );
  }
  if (!event) return null;

  async function openEdit() {
    if (policy.isManager && !projects) {
      try {
        setProjects(await apiFetch<ProjectSummary[]>("/projects"));
      } catch {
        // The project link is optional; the rest of the form still works.
      }
    }
    setEditing(true);
  }

  const past = isEventPast(event);

  return (
    <>
      <PageHeader crumbs={[...crumbsTo, { label: event.title }]} title={event.title} />

      <div className="container">
        {event.canEdit && (
          <AdminBar
            text={`${policy.isManager ? policy.roleLabel : t("common.loggedIn")}: ${t("events.manageBar")}`}
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={openEdit}>
                  {t("common.edit")}
                </button>
                {event.canDelete && (
                  <button className="btn btn--danger btn--sm" type="button" onClick={() => setDeleting(true)}>
                    {t("common.delete")}
                  </button>
                )}
              </>
            }
          />
        )}

        <div className="detail-layout event-detail">
          <div className="detail-layout__a">
            <div className="detail-meta">
              <Badge variant="brand" upper>
                {t(EVENT_KIND_LABEL_KEY[event.kind])}
              </Badge>
              {past && <Badge upper>{t("events.pastBadge")}</Badge>}
              {event.allDay && <Badge>{t("events.allDayBadge")}</Badge>}
              <VisibilityBadge visibility={event.visibility} />
            </div>
            <section aria-labelledby="event-about">
              <h2 className="sr-only" id="event-about">
                {t("events.aboutHeading")}
              </h2>
              {event.description ? <p className="prose event-detail__desc">{event.description}</p> : <p className="text-sm text-muted">{t("events.noDescription")}</p>}
            </section>
          </div>

          <aside className="detail-layout__aside" aria-labelledby="event-details">
            <section className="panel">
              <h2 className="panel__title" id="event-details">
                {t("events.detailsHeading")}
              </h2>
              <dl className="event-facts">
                <div>
                  <dt>{t("events.whenLabel")}</dt>
                  <dd>
                    <Icon name="clock" size={14} /> <time dateTime={event.startsAt}>{formatEventWhen(event, locale)}</time>
                  </dd>
                </div>
                {event.location && (
                  <div>
                    <dt>{t("events.whereLabel")}</dt>
                    <dd>
                      <Icon name="map-pin" size={14} /> <span>{event.location}</span>
                    </dd>
                  </div>
                )}
                {event.organizer && (
                  <div>
                    <dt>{t("events.organizerLabel")}</dt>
                    <dd>
                      <Icon name="user" size={14} />{" "}
                      <Link to={`/team/${event.organizer.id}`} className="link">
                        {event.organizer.name}
                      </Link>
                    </dd>
                  </div>
                )}
                {event.project && (
                  <div>
                    <dt>{t("events.relatedProject")}</dt>
                    <dd>
                      <Icon name="folder" size={14} />{" "}
                      <Link to={`/projects/${event.project.id}`} className="link">
                        {event.project.title}
                      </Link>
                    </dd>
                  </div>
                )}
                {event.url && (
                  <div>
                    <dt>{t("events.moreInfo")}</dt>
                    <dd>
                      <a href={event.url} target="_blank" rel="noopener noreferrer" className="link">
                        {event.url}
                        <Icon name="external" size={13} />
                        <span className="sr-only">{t("publications.opensInNewTab")}</span>
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          </aside>
        </div>
      </div>

      <EventFormModal
        open={editing}
        title={t("events.editTitle")}
        initial={event}
        canSetVisibility={policy.canChangeVisibility}
        projects={policy.isManager ? projects : null}
        onClose={() => setEditing(false)}
        onSubmit={async (payload: EventFormPayload) => {
          await apiFetch(`/events/${event.id}`, { method: "PUT", body: JSON.stringify(payload) });
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleting}
        title={t("events.deleteTitle")}
        message={t("events.deleteConfirm", { title: event.title })}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await apiFetch(`/events/${event.id}`, { method: "DELETE" });
          navigate("/events");
        }}
      />
    </>
  );
}
