import { useState } from "react";
import type { ProjectSummary, ResearchArea } from "@scl/shared";
import { useAuth } from "../auth/AuthContext";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { ResearchCard } from "../components/ResearchCard";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { ResearchFormModal } from "../components/ResearchFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { useT } from "../i18n/LocaleContext";

export function ResearchPage() {
  const t = useT();
  const { user } = useAuth();
  const { data: areas, loading, error, reload } = useApiResource<ResearchArea[]>("/research");
  // Projects already say which areas they belong to; that is the relationship shown on each card.
  const { data: projects } = useApiResource<ProjectSummary[]>("/projects");

  const [formModal, setFormModal] = useState<{ open: boolean; area: ResearchArea | null }>({ open: false, area: null });
  const [deleteTarget, setDeleteTarget] = useState<ResearchArea | null>(null);

  const policy = usePolicy();
  const canEdit = Boolean(user); // any logged-in lab member can add/edit research areas

  return (
    <>
      <PageHeader eyebrow={t("nav.research")} title={t("research.pageTitle")} description={t("research.pageDescription")} />

      <div className="container">
        {canEdit && (
          <AdminBar
            text={
              <>
                {policy.isManager ? policy.roleLabel : "Logged in"}: add or edit research areas.{" "}
                {policy.canDeleteContent ? "" : "(Only lab managers and admins can delete.)"}
              </>
            }
            actionLabel="+ Add research area"
            onAction={() => setFormModal({ open: true, area: null })}
          />
        )}

        {loading && !areas && <LoadingState label={t("research.loading")} />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {areas && areas.length === 0 && <EmptyState title={t("research.empty")}>Areas the lab works on will be listed here.</EmptyState>}

        {areas && areas.length > 0 && <h2 className="sr-only">All research areas</h2>}
        {areas && areas.length > 0 && (
          <div className="grid">
            {areas.map((area) => (
              <ResearchCard
                key={area.id}
                area={area}
                canEdit={canEdit}
                canDelete={policy.canDeleteContent}
                onEdit={() => setFormModal({ open: true, area })}
                onDelete={() => setDeleteTarget(area)}
                projects={(projects ?? []).filter((p) => p.areas.some((a) => a.id === area.id)).map((p) => ({ id: p.id, title: p.title }))}
              />
            ))}
          </div>
        )}
      </div>

      <ResearchFormModal
        open={formModal.open}
        title={formModal.area ? t("research.editTitle") : t("research.newTitle")}
        initial={formModal.area}
        canSetVisibility={policy.canChangeVisibility}
        onClose={() => setFormModal({ open: false, area: null })}
        onSubmit={async (fields) => {
          if (formModal.area) {
            await apiFetch(`/research/${formModal.area.id}`, { method: "PUT", body: JSON.stringify(fields) });
          } else {
            await apiFetch("/research", { method: "POST", body: JSON.stringify(fields) });
          }
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("research.deleteTitle")}
        message={deleteTarget ? t("research.deleteMessage", { title: deleteTarget.title }) : ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await apiFetch(`/research/${deleteTarget.id}`, { method: "DELETE" });
          reload();
        }}
      />
    </>
  );
}
