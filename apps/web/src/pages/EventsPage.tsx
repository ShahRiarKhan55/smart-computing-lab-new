import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { LabEvent, ProjectSummary } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { SectionHeader } from "../components/SectionHeader";
import { EventCard } from "../components/EventCard";
import { EventFormModal, type EventFormPayload } from "../components/EventFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { useT } from "../i18n/LocaleContext";

type View = "upcoming" | "past";

/** The lab's own events (Phase 16). The Google Calendar Schedule page is a separate, unchanged, shared calendar. */
export function EventsPage() {
  const t = useT();
  const policy = usePolicy();
  const [params] = useSearchParams();
  const view: View = params.get("view") === "past" ? "past" : "upcoming";

  const { data: events, loading, error, reload } = useApiResource<LabEvent[]>(`/events?scope=${view}`);
  const [formModal, setFormModal] = useState<{ open: boolean; item: LabEvent | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<LabEvent | null>(null);
  // Only managers link an event to a project, so only they load the project list (once, on first open).
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const signedIn = Boolean(policy.user);

  async function openForm(item: LabEvent | null) {
    if (policy.isManager && !projects) {
      try {
        setProjects(await apiFetch<ProjectSummary[]>("/projects"));
      } catch {
        // The form still works without the project picker; the link is optional.
      }
    }
    setFormModal({ open: true, item });
  }

  return (
    <>
      <PageHeader eyebrow={t("nav.events")} title={t("events.pageTitle")} description={t("events.pageDescription")} />

      <div className="container">
        {signedIn && (
          <AdminBar
            text={`${policy.isManager ? policy.roleLabel : t("common.loggedIn")}: ${t(policy.isManager ? "events.barManager" : "events.barMember")}`}
            actionLabel={`+ ${t("events.addNew")}`}
            onAction={() => openForm(null)}
          />
        )}

        <div className="events-toolbar">
          <div className="chips" role="group" aria-label={t("events.rangeAria")}>
            {(["upcoming", "past"] as const).map((v) => (
              <Link key={v} to={v === "upcoming" ? "/events" : "/events?view=past"} className={`chip${view === v ? " active" : ""}`} aria-current={view === v ? "true" : undefined}>
                {t(v === "upcoming" ? "events.tab.upcoming" : "events.tab.past")}
              </Link>
            ))}
          </div>
          {signedIn && (
            <Link to="/schedule" className="link events-toolbar__link">
              {t("events.scheduleLink")} <Icon name="arrow-right" size={14} />
            </Link>
          )}
        </div>

        <SectionHeader compact id="events-list" title={t(view === "upcoming" ? "events.listHeadingUpcoming" : "events.listHeadingPast")} />
        {loading && !events && <LoadingState label={t("events.loading")} />}
        {error && <ErrorState message={t("events.errorLoad")} onRetry={reload} />}
        {events && events.length === 0 && (
          <EmptyState title={t(view === "upcoming" ? "events.emptyUpcoming" : "events.emptyPast")}>{t(view === "upcoming" ? "events.emptyUpcomingHint" : "events.emptyPastHint")}</EmptyState>
        )}
        {events && events.length > 0 && (
          <div className="grid grid--wide">
            {events.map((e) => (
              <EventCard key={e.id} event={e} onEdit={() => openForm(e)} onDelete={() => setDeleteTarget(e)} />
            ))}
          </div>
        )}
      </div>

      <EventFormModal
        open={formModal.open}
        title={formModal.item ? t("events.editTitle") : t("events.newTitle")}
        initial={formModal.item}
        canSetVisibility={policy.canChangeVisibility}
        projects={policy.isManager ? projects : null}
        onClose={() => setFormModal({ open: false, item: null })}
        onSubmit={async (payload: EventFormPayload) => {
          await apiFetch(formModal.item ? `/events/${formModal.item.id}` : "/events", {
            method: formModal.item ? "PUT" : "POST",
            body: JSON.stringify(payload),
          });
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("events.deleteTitle")}
        message={deleteTarget ? t("events.deleteConfirm", { title: deleteTarget.title }) : ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await apiFetch(`/events/${deleteTarget.id}`, { method: "DELETE" });
          reload();
        }}
      />
    </>
  );
}
