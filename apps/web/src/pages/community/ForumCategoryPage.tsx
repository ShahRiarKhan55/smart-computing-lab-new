import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { ForumCategory, ForumTopicDetail, ForumTopicListResponse, ProjectSummary, TeamMember } from "@scl/shared";
import { usePolicy } from "../../auth/usePolicy";
import { useApiResource } from "../../hooks/useApiResource";
import { apiFetch, ApiError } from "../../lib/api";
import { PageHeader } from "../../components/PageHeader";
import { AdminBar } from "../../components/AdminBar";
import { LoadingState } from "../../components/LoadingState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { ForumTopicList } from "../../components/ForumTopicList";
import { ForumComposer } from "../../components/ForumComposer";
import { ForumCategoryFormModal } from "../../components/ForumCategoryFormModal";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal";
import { VisibilityBadge } from "../../components/VisibilityField";

/** /community/forum/category/:slug — one category's topics, paginated (?page=). */
export function ForumCategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = /^\d{1,5}$/.test(params.get("page") ?? "") ? Number(params.get("page")) : 1;
  const policy = usePolicy();

  const { data: category, loading, error, status, reload } = useApiResource<ForumCategory>(`/forum/categories/${slug}`);
  // Runs independently of the category fetch above: the endpoint resolves the same slug (and the
  // same visibility) itself, returning an empty page for an unknown/hidden category.
  const { data: topicsRes, loading: topicsLoading, reload: reloadTopics } = useApiResource<ForumTopicListResponse>(`/forum/posts?category=${slug}&page=${page}&limit=20`);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [people, setPeople] = useState<TeamMember[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !category) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Community" }, { label: "Forum", to: "/community/forum" }, { label: "Loading…" }]} title="Loading…" />
        <div className="container">
          <LoadingState label="Loading category…" variant="text" />
        </div>
      </>
    );
  }
  if (status === 404 || (!category && error)) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Community" }, { label: "Forum", to: "/community/forum" }, { label: "Not found" }]} title="Category not found" />
        <div className="container">
          <ErrorState message={status === 404 ? "This category could not be found." : (error ?? "Could not load this category.")} onRetry={status === 404 ? undefined : reload} />
          <Link to="/community/forum" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> All categories
          </Link>
        </div>
      </>
    );
  }
  if (!category) return null;

  async function openComposer() {
    setActionError(null);
    try {
      if (!projects) setProjects(await apiFetch<ProjectSummary[]>("/projects"));
      if (!people) setPeople(await apiFetch<TeamMember[]>("/team"));
      setComposerOpen(true);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not load the form.");
    }
  }

  const totalPages = topicsRes?.pagination.totalPages ?? 0;
  const goToPage = (p: number) => setParams(p > 1 ? { page: String(p) } : {});

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Community" }, { label: "Forum", to: "/community/forum" }, { label: category.name }]}
        title={category.name}
        description={category.description}
      />

      <div className="container">
        {(policy.canCreateForumTopic || category.canManage) && (
          <AdminBar
            text={category.canManage ? "Manage this category, or start a new topic." : "Start a discussion in this category."}
            actions={
              <>
                {policy.canCreateForumTopic && !category.isLocked && (
                  <button className="btn btn--primary btn--sm" type="button" onClick={openComposer}>
                    + New topic
                  </button>
                )}
                {category.canManage && (
                  <>
                    <button className="btn btn--secondary btn--sm" type="button" onClick={() => setEditOpen(true)}>
                      Edit category
                    </button>
                    <button className="btn btn--danger btn--sm" type="button" onClick={() => setDeleteOpen(true)}>
                      Delete
                    </button>
                  </>
                )}
              </>
            }
          />
        )}
        {actionError && <ErrorState message={actionError} />}

        <div className="detail-meta">
          <VisibilityBadge visibility={category.visibility} />
          {category.isLocked && (
            <span className="badge badge--warn badge--upper">
              <Icon name="lock" size={11} /> Locked — no new topics
            </span>
          )}
        </div>

        {topicsLoading && !topicsRes ? (
          <LoadingState label="Loading topics…" variant="text" />
        ) : (
          <>
            <ForumTopicList topics={topicsRes?.topics ?? []} showCategory={false} emptyTitle="No topics in this category yet." />
            {totalPages > 1 && (
              <nav className="search-pager" aria-label="Topic pages">
                {page > 1 ? (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => goToPage(page - 1)}>
                    <Icon name="arrow-left" size={14} /> Previous
                  </button>
                ) : (
                  <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
                    <Icon name="arrow-left" size={14} /> Previous
                  </span>
                )}
                <span className="search-pager__pos">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => goToPage(page + 1)}>
                    Next <Icon name="arrow-right" size={14} />
                  </button>
                ) : (
                  <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
                    Next <Icon name="arrow-right" size={14} />
                  </span>
                )}
              </nav>
            )}
          </>
        )}
      </div>

      <ForumComposer
        open={composerOpen}
        mode="create"
        categories={[category]}
        defaultCategoryId={category.id}
        projects={(projects ?? []).map((p) => ({ id: p.id, title: p.title }))}
        people={(people ?? []).map((p) => ({ id: p.id, name: p.name }))}
        onClose={() => setComposerOpen(false)}
        onSubmit={async (fields) => {
          const created = await apiFetch<ForumTopicDetail>("/forum/posts", { method: "POST", body: JSON.stringify(fields) });
          navigate(`/community/forum/topic/${created.id}`);
        }}
      />

      <ForumCategoryFormModal
        open={editOpen}
        title="Edit category"
        initial={category}
        onClose={() => setEditOpen(false)}
        onSubmit={async (fields) => {
          await apiFetch(`/forum/categories/${category.id}`, { method: "PUT", body: JSON.stringify(fields) });
          reload();
          reloadTopics();
        }}
      />

      <ConfirmDeleteModal
        open={deleteOpen}
        title="Delete category"
        message={`Delete "${category.name}"? This only works while it holds no topics.`}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await apiFetch(`/forum/categories/${category.id}`, { method: "DELETE" });
          navigate("/community/forum");
        }}
      />
    </>
  );
}
