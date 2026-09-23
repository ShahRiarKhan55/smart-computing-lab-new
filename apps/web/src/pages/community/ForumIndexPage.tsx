import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ForumCategory, ForumTopicDetail, ForumTopicListResponse, ProjectSummary, TeamMember } from "@scl/shared";
import { usePolicy } from "../../auth/usePolicy";
import { useApiResource } from "../../hooks/useApiResource";
import { apiFetch, ApiError } from "../../lib/api";
import { PageHeader } from "../../components/PageHeader";
import { AdminBar } from "../../components/AdminBar";
import { LoadingState } from "../../components/LoadingState";
import { ErrorState } from "../../components/ErrorState";
import { EmptyState } from "../../components/EmptyState";
import { SectionHeader } from "../../components/SectionHeader";
import { ForumCategoryCard } from "../../components/ForumCategoryCard";
import { ForumTopicList } from "../../components/ForumTopicList";
import { ForumComposer } from "../../components/ForumComposer";
import { ForumCategoryFormModal } from "../../components/ForumCategoryFormModal";
import { useT } from "../../i18n/LocaleContext";

/** /community/forum — categories (from the database, never hard-coded) + latest activity. */
export function ForumIndexPage() {
  const t = useT();
  const policy = usePolicy();
  const navigate = useNavigate();
  const { data: categories, loading, error, reload } = useApiResource<ForumCategory[]>("/forum/categories");
  const { data: latest } = useApiResource<ForumTopicListResponse>("/forum/posts?limit=8");
  const [composerOpen, setComposerOpen] = useState(false);
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [people, setPeople] = useState<TeamMember[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function openComposer() {
    setActionError(null);
    try {
      if (!projects) setProjects(await apiFetch<ProjectSummary[]>("/projects"));
      if (!people) setPeople(await apiFetch<TeamMember[]>("/team"));
      setComposerOpen(true);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.couldNotLoadForm"));
    }
  }

  return (
    <>
      <PageHeader eyebrow={t("nav.community")} title={t("forum.pageTitle")} description={t("forum.pageDescription")} />

      <div className="container">
        {(policy.canCreateForumTopic || policy.canManageForumCategories) && (
          <AdminBar
            text={policy.canManageForumCategories ? t("forum.manageOrNewTopic") : t("forum.startDiscussion")}
            actions={
              <>
                {policy.canCreateForumTopic && (
                  <button className="btn btn--primary btn--sm" type="button" onClick={openComposer}>
                    + {t("forum.newTopic")}
                  </button>
                )}
                {policy.canManageForumCategories && (
                  <button className="btn btn--secondary btn--sm" type="button" onClick={() => setCategoryFormOpen(true)}>
                    + {t("forum.newCategory")}
                  </button>
                )}
              </>
            }
          />
        )}
        {actionError && <ErrorState message={actionError} />}

        {loading && !categories && <LoadingState label={t("forum.loading")} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {categories && (
          <>
            <section aria-labelledby="forum-categories">
              <SectionHeader id="forum-categories" title={t("forum.categoriesHeading")} />
              {categories.length === 0 ? (
                <EmptyState title={policy.user ? t("forum.emptyCategories") : t("forum.emptyCategoriesGuest")}>
                  {policy.canManageForumCategories ? t("forum.createFirstAbove") : t("forum.checkBackOrLogin")}
                </EmptyState>
              ) : (
                <div className="grid">
                  {categories.map((c) => (
                    <ForumCategoryCard key={c.id} category={c} />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="forum-latest">
              <SectionHeader id="forum-latest" title={t("forum.latestActivity")} />
              <ForumTopicList topics={latest?.topics ?? []} emptyTitle={t("forum.emptyTopics")} />
            </section>
          </>
        )}
      </div>

      <ForumComposer
        open={composerOpen}
        mode="create"
        categories={categories ?? []}
        projects={(projects ?? []).map((p) => ({ id: p.id, title: p.title }))}
        people={(people ?? []).map((p) => ({ id: p.id, name: p.name }))}
        onClose={() => setComposerOpen(false)}
        onSubmit={async (fields) => {
          const created = await apiFetch<ForumTopicDetail>("/forum/posts", { method: "POST", body: JSON.stringify(fields) });
          navigate(`/community/forum/topic/${created.id}`);
        }}
      />

      <ForumCategoryFormModal
        open={categoryFormOpen}
        title={t("forum.newCategory")}
        onClose={() => setCategoryFormOpen(false)}
        onSubmit={async (fields) => {
          await apiFetch("/forum/categories", { method: "POST", body: JSON.stringify(fields) });
          reload();
        }}
      />
    </>
  );
}
