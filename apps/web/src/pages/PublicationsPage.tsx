import { useMemo, useState } from "react";
import type { Publication, PublicationAuthorsResponse, TeamMember } from "@scl/shared";
import { useAuth } from "../auth/AuthContext";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { PublicationItem } from "../components/PublicationItem";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { PublicationFormModal } from "../components/PublicationFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { LinkItemsModal } from "../components/LinkItemsModal";
import { useT } from "../i18n/LocaleContext";

type YearFilter = "all" | number;

export function PublicationsPage() {
  const t = useT();
  const { user } = useAuth();
  const { data: pubs, loading, error, reload } = useApiResource<Publication[]>("/publications");
  const { data: team } = useApiResource<TeamMember[]>("/team");
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");

  const [formModal, setFormModal] = useState<{ open: boolean; pub: Publication | null }>({ open: false, pub: null });
  const [deleteTarget, setDeleteTarget] = useState<Publication | null>(null);
  const [authorsTarget, setAuthorsTarget] = useState<{ pub: Publication; ids: string[] } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const policy = usePolicy();
  const isManager = policy.isManager; // lab managers and admins may change any author link
  const canEdit = Boolean(user); // any logged-in lab member can add/edit publications
  // The team profile linked to the logged-in account, if any. A non-admin can
  // only add/remove *this* member as an author (the server enforces the same rule).
  const ownMember = user ? (team?.find((m) => m.isOwn) ?? null) : null;
  const canManageAuthors = isManager || Boolean(ownMember);

  const years = useMemo(
    () => [...new Set((pubs ?? []).map((p) => p.year))].sort((a, b) => b - a),
    [pubs],
  );

  // If the selected year no longer has any publications (e.g. the last one was
  // deleted or moved to another year), fall back to showing everything.
  const activeFilter: YearFilter = yearFilter !== "all" && !years.includes(yearFilter) ? "all" : yearFilter;

  const filtered = useMemo(() => {
    if (!pubs) return [];
    return activeFilter === "all" ? pubs : pubs.filter((p) => p.year === activeFilter);
  }, [pubs, activeFilter]);

  // The list is grouped under year headings (the API already sends newest first).
  const byYear = useMemo(() => {
    const groups = new Map<number, Publication[]>();
    for (const p of filtered) groups.set(p.year, [...(groups.get(p.year) ?? []), p]);
    return [...groups.entries()];
  }, [filtered]);

  async function openManageAuthors(pub: Publication) {
    setActionError(null);
    try {
      const { teamMemberIds } = await apiFetch<PublicationAuthorsResponse>(`/publications/${pub.id}/authors`);
      setAuthorsTarget({ pub, ids: teamMemberIds });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("publications.errorAuthors"));
    }
  }

  const memberItems = (team ?? []).map((m) => ({ id: m.id, label: `${m.name} — ${m.role}` }));
  const lockedMemberIds = isManager ? [] : (team ?? []).filter((m) => m.id !== ownMember?.id).map((m) => m.id);

  return (
    <>
      <PageHeader eyebrow={t("nav.research")} title={t("publications.pageTitle")} description={t("publications.pageDescription")} />

      <div className="container">
        {canEdit && (
          <AdminBar
            text={
              <>
                {policy.isManager ? policy.roleLabel : "Logged in"}: add or edit publications
                {canManageAuthors ? " and manage their authors" : ""}. {policy.canDeleteContent ? "" : "(Only lab managers and admins can delete.)"}
              </>
            }
            actionLabel="+ Add publication"
            onAction={() => {
              setActionError(null);
              setFormModal({ open: true, pub: null });
            }}
          />
        )}

        {actionError && <ErrorState message={actionError} />}
        {loading && !pubs && <LoadingState label={t("publications.loading")} variant="list" />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {pubs && pubs.length === 0 && <EmptyState title={t("publications.empty")}>Papers, proceedings and preprints will be listed here.</EmptyState>}

        {pubs && pubs.length > 0 && (
          <>
            <div className="filters">
              <div className="chips" role="group" aria-label="Filter publications by year">
                <button className={`chip${activeFilter === "all" ? " active" : ""}`} aria-pressed={activeFilter === "all"} onClick={() => setYearFilter("all")} type="button">
                  All years
                </button>
                {years.map((y) => (
                  <button key={y} className={`chip${activeFilter === y ? " active" : ""}`} aria-pressed={activeFilter === y} onClick={() => setYearFilter(y)} type="button">
                    {y}
                  </button>
                ))}
              </div>
              <p className="filters__count" role="status">
                Showing {filtered.length} of {pubs.length} publications
              </p>
            </div>

            {byYear.map(([year, items]) => (
              <section key={year} aria-labelledby={`pubs-${year}`}>
                <h2 className="year-heading" id={`pubs-${year}`}>
                  {year} <small>{items.length} {items.length === 1 ? "publication" : "publications"}</small>
                </h2>
                <div className="pub-list">
                  {items.map((p) => (
                    <PublicationItem
                      key={p.id}
                      publication={p}
                      canEdit={canEdit}
                      canDelete={policy.canDeleteContent}
                      onEdit={() => {
                        setActionError(null);
                        setFormModal({ open: true, pub: p });
                      }}
                      onDelete={() => {
                        setActionError(null);
                        setDeleteTarget(p);
                      }}
                      onManageAuthors={canManageAuthors ? () => openManageAuthors(p) : undefined}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      <PublicationFormModal
        open={formModal.open}
        title={formModal.pub ? t("publications.editTitle") : t("publications.newTitle")}
        initial={formModal.pub}
        canLinkSelf={Boolean(ownMember)}
        canSetVisibility={policy.canChangeVisibility}
        onClose={() => setFormModal({ open: false, pub: null })}
        onSubmit={async (fields, linkSelf) => {
          if (formModal.pub) {
            await apiFetch(`/publications/${formModal.pub.id}`, { method: "PUT", body: JSON.stringify(fields) });
          } else {
            await apiFetch("/publications", {
              method: "POST",
              body: JSON.stringify(linkSelf && ownMember ? { ...fields, teamMemberIds: [ownMember.id] } : fields),
            });
          }
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("publications.deleteTitle")}
        message={deleteTarget ? t("publications.deleteConfirm", { title: deleteTarget.title }) : ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await apiFetch(`/publications/${deleteTarget.id}`, { method: "DELETE" });
          reload();
        }}
      />

      <LinkItemsModal
        open={authorsTarget !== null}
        title={t("publications.manageAuthors")}
        description={isManager ? t("publications.manageAuthorsHelpManager") : t("publications.manageAuthorsHelpMember")}
        items={memberItems}
        selectedIds={authorsTarget?.ids ?? []}
        disabledIds={lockedMemberIds}
        onClose={() => setAuthorsTarget(null)}
        onSubmit={async (ids) => {
          if (!authorsTarget) return;
          await apiFetch(`/publications/${authorsTarget.pub.id}/authors`, {
            method: "PUT",
            body: JSON.stringify({ teamMemberIds: ids }),
          });
          reload();
        }}
      />
    </>
  );
}
