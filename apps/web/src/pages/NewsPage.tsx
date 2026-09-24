import { useState } from "react";
import type { NewsAuthorsResponse, NewsItem, TeamMember } from "@scl/shared";
import { useAuth } from "../auth/AuthContext";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { NewsCard } from "../components/NewsCard";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { NewsFormModal } from "../components/NewsFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { LinkItemsModal } from "../components/LinkItemsModal";
import { useT } from "../i18n/LocaleContext";

export function NewsPage() {
  const t = useT();
  const { user } = useAuth();
  const { data: news, loading, error, reload } = useApiResource<NewsItem[]>("/news");
  const { data: team } = useApiResource<TeamMember[]>("/team");

  const [formModal, setFormModal] = useState<{ open: boolean; item: NewsItem | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<NewsItem | null>(null);
  const [authorsTarget, setAuthorsTarget] = useState<{ item: NewsItem; ids: string[] } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const policy = usePolicy();
  const isManager = policy.isManager; // lab managers and admins may change any author link
  const canEdit = Boolean(user); // any logged-in lab member can add/edit news items
  // The team profile linked to the logged-in account, if any. A non-admin can
  // only add/remove *this* member as an author (the server enforces the same rule).
  const ownMember = user ? (team?.find((m) => m.isOwn) ?? null) : null;
  const canManageAuthors = isManager || Boolean(ownMember);

  async function openManageAuthors(item: NewsItem) {
    setActionError(null);
    try {
      const { teamMemberIds } = await apiFetch<NewsAuthorsResponse>(`/news/${item.id}/authors`);
      setAuthorsTarget({ item, ids: teamMemberIds });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("news.errorAuthors"));
    }
  }

  const memberItems = (team ?? []).map((m) => ({ id: m.id, label: `${m.name} — ${m.role}` }));
  const lockedMemberIds = isManager ? [] : (team ?? []).filter((m) => m.id !== ownMember?.id).map((m) => m.id);

  return (
    <>
      <PageHeader eyebrow={t("nav.news")} title={t("news.pageTitle")} description={t("news.pageDescription")} />

      <div className="container">
        {canEdit && (
          <AdminBar
            text={
              <>
                {policy.isManager ? policy.roleLabel : t("common.loggedIn")}: {t("news.addOrEditSuffix")}
                {canManageAuthors ? t("news.andManageWhoInvolved") : ""}. {policy.canDeleteContent ? "" : t("research.onlyManagersDelete")}
              </>
            }
            actionLabel={`+ ${t("news.addNew")}`}
            onAction={() => {
              setActionError(null);
              setFormModal({ open: true, item: null });
            }}
          />
        )}

        {actionError && <ErrorState message={actionError} />}
        {loading && !news && <LoadingState label={t("news.loading")} />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {news && news.length === 0 && <EmptyState title={t("news.empty")}>{t("news.emptyHint")}</EmptyState>}

        {news && news.length > 0 && <h2 className="sr-only">{t("news.headingSr")}</h2>}
        {news && news.length > 0 && (
          <div className="grid">
            {news.map((item) => (
              <NewsCard
                key={item.id}
                item={item}
                canEdit={canEdit}
                canDelete={policy.canDeleteContent}
                onEdit={() => {
                  setActionError(null);
                  setFormModal({ open: true, item });
                }}
                onDelete={() => {
                  setActionError(null);
                  setDeleteTarget(item);
                }}
                onManageAuthors={canManageAuthors ? () => openManageAuthors(item) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <NewsFormModal
        open={formModal.open}
        title={formModal.item ? t("news.editTitle") : t("news.newTitle")}
        initial={formModal.item}
        canLinkSelf={Boolean(ownMember)}
        canSetVisibility={policy.canChangeVisibility}
        onClose={() => setFormModal({ open: false, item: null })}
        onSubmit={async (fields, linkSelf) => {
          if (formModal.item) {
            await apiFetch(`/news/${formModal.item.id}`, { method: "PUT", body: JSON.stringify(fields) });
          } else {
            await apiFetch("/news", {
              method: "POST",
              body: JSON.stringify(linkSelf && ownMember ? { ...fields, teamMemberIds: [ownMember.id] } : fields),
            });
          }
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("news.deleteTitle")}
        message={deleteTarget ? t("news.deleteConfirm", { title: deleteTarget.title }) : ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await apiFetch(`/news/${deleteTarget.id}`, { method: "DELETE" });
          reload();
        }}
      />

      <LinkItemsModal
        open={authorsTarget !== null}
        title={t("news.manageAuthors")}
        description={isManager ? t("news.manageAuthorsHelpManager") : t("news.manageAuthorsHelpMember")}
        items={memberItems}
        selectedIds={authorsTarget?.ids ?? []}
        disabledIds={lockedMemberIds}
        onClose={() => setAuthorsTarget(null)}
        onSubmit={async (ids) => {
          if (!authorsTarget) return;
          await apiFetch(`/news/${authorsTarget.item.id}/authors`, {
            method: "PUT",
            body: JSON.stringify({ teamMemberIds: ids }),
          });
          reload();
        }}
      />
    </>
  );
}
