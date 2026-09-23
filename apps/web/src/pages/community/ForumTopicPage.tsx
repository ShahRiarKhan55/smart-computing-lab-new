import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { ForumCategory, ForumReactionKind, ForumTopicDetail, ProjectSummary, TeamMember } from "@scl/shared";
import { usePolicy } from "../../auth/usePolicy";
import { useApiResource } from "../../hooks/useApiResource";
import { apiFetch, ApiError } from "../../lib/api";
import { PageHeader } from "../../components/PageHeader";
import { AdminBar } from "../../components/AdminBar";
import { LoadingState } from "../../components/LoadingState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { ForumBody } from "../../components/ForumBody";
import { ForumReactionBar } from "../../components/ForumReactionBar";
import { ForumContextBadge } from "../../components/ForumContextBadge";
import { ForumCommentList } from "../../components/ForumCommentList";
import { ForumCommentComposer } from "../../components/ForumCommentComposer";
import { ForumComposer } from "../../components/ForumComposer";
import { ForumModerationControls } from "../../components/ForumModerationControls";
import { ForumMoveTopicModal } from "../../components/ForumMoveTopicModal";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal";
import { formatDateTime } from "../../lib/format";
import { useLocale } from "../../i18n/LocaleContext";

/** /community/forum/topic/:id — the original post, reactions, and a flat comment thread. */
export function ForumTopicPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
  const { locale, t } = useLocale();
  const [params, setParams] = useSearchParams();
  const commentsPage = /^\d{1,5}$/.test(params.get("page") ?? "") ? Number(params.get("page")) : 1;

  const { data: topic, loading, error, status, reload } = useApiResource<ForumTopicDetail>(`/forum/posts/${id}?page=${commentsPage}&limit=30`);

  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteTopicOpen, setDeleteTopicOpen] = useState(false);
  const [deleteCommentId, setDeleteCommentId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [people, setPeople] = useState<TeamMember[] | null>(null);
  const [categories, setCategories] = useState<ForumCategory[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && (!topic || topic.id !== id)) {
    return (
      <>
        <PageHeader crumbs={[{ label: t("nav.community") }, { label: t("nav.forum"), to: "/community/forum" }, { label: t("common.loading") }]} title={t("common.loading")} />
        <div className="container">
          <LoadingState label={t("forum.loadingTopic")} variant="text" />
        </div>
      </>
    );
  }
  if (status === 404 || (!topic && error)) {
    return (
      <>
        <PageHeader
          crumbs={[{ label: t("nav.community") }, { label: t("nav.forum"), to: "/community/forum" }, { label: t("common.notFoundCrumb") }]}
          title={t("forum.topicNotFoundTitle")}
        />
        <div className="container">
          <ErrorState message={status === 404 ? t("forum.topicNotFoundMsg") : (error ?? t("forum.couldNotLoadTopic"))} onRetry={status === 404 ? undefined : reload} />
          <Link to="/community/forum" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> {t("nav.forum")}
          </Link>
        </div>
      </>
    );
  }
  if (!topic) return null;

  async function ensureLists() {
    setActionError(null);
    try {
      if (!projects) setProjects(await apiFetch<ProjectSummary[]>("/projects"));
      if (!people) setPeople(await apiFetch<TeamMember[]>("/team"));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.couldNotLoadForm"));
    }
  }

  async function ensureCategories() {
    setActionError(null);
    try {
      if (!categories) setCategories(await apiFetch<ForumCategory[]>("/forum/categories"));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("forum.couldNotLoadCategories"));
    }
  }

  async function moderate(action: "pin" | "unpin" | "lock" | "unlock" | "hide" | "unhide") {
    setActionError(null);
    try {
      await apiFetch(`/forum/posts/${topic!.id}/${action}`, { method: "POST" });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  async function reactToPost(kind: ForumReactionKind, active: boolean) {
    await apiFetch(`/forum/posts/${topic!.id}/reactions${active ? `/${kind}` : ""}`, { method: active ? "DELETE" : "POST", body: active ? undefined : JSON.stringify({ kind }) });
    reload();
  }

  async function reactToComment(commentId: string, kind: ForumReactionKind, active: boolean) {
    await apiFetch(`/forum/comments/${commentId}/reactions${active ? `/${kind}` : ""}`, { method: active ? "DELETE" : "POST", body: active ? undefined : JSON.stringify({ kind }) });
    reload();
  }

  const totalReactions = Object.values(topic.reactions.counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: t("nav.community") },
          { label: t("nav.forum"), to: "/community/forum" },
          { label: topic.category.name, to: `/community/forum/category/${topic.category.slug}` },
          { label: topic.title },
        ]}
        title={topic.title}
      />

      <div className="container">
        {(topic.canEdit || topic.canDelete || topic.canModerate) && (
          <AdminBar
            text={topic.canModerate ? t("forum.moderateThisTopic") : t("forum.editOrDeleteOwn")}
            actions={
              <>
                {topic.canEdit && (
                  <button className="btn btn--secondary btn--sm" type="button" onClick={() => ensureLists().then(() => setEditOpen(true))}>
                    {t("common.edit")}
                  </button>
                )}
                <ForumModerationControls
                  topic={topic}
                  onTogglePin={() => moderate(topic.pinned ? "unpin" : "pin")}
                  onToggleLock={() => moderate(topic.locked ? "unlock" : "lock")}
                  onToggleHide={() => moderate(topic.status === "HIDDEN" ? "unhide" : "hide")}
                  onMove={() => ensureCategories().then(() => setMoveOpen(true))}
                  onDelete={() => setDeleteTopicOpen(true)}
                />
                {topic.canDelete && !topic.canModerate && (
                  <button className="btn btn--danger btn--sm" type="button" onClick={() => setDeleteTopicOpen(true)}>
                    {t("common.delete")}
                  </button>
                )}
              </>
            }
          />
        )}
        {actionError && <ErrorState message={actionError} />}

        <div className="detail-meta">
          <ForumContextBadge pinned={topic.pinned} locked={topic.locked} status={topic.status} />
          {topic.project && (
            <span className="detail-meta__item">
              <Icon name="folder" size={14} /> {t("forum.projectLabel")}{" "}
              <Link to={`/projects/${topic.project.id}`} className="link">
                {topic.project.title}
              </Link>
            </span>
          )}
        </div>

        <p className="topic-row__meta">
          {topic.author.teamMemberId ? (
            <Link to={`/team/${topic.author.teamMemberId}`} className="link-inline">
              {topic.author.name}
            </Link>
          ) : (
            topic.author.name
          )}
          {" · "}
          {formatDateTime(topic.createdAt, locale)}
          {topic.editedAt && ` · ${t("forum.editedAt", { date: formatDateTime(topic.editedAt, locale) })}`}
        </p>

        <ForumBody text={topic.body} />

        <p className="text-sm text-muted">
          {t(totalReactions === 1 ? "forum.reactionCountOne" : "forum.reactionCountOther", { count: totalReactions })} ·{" "}
          {t(topic.commentCount === 1 ? "forum.commentCountOne" : "forum.commentCountOther", { count: topic.commentCount })}
        </p>
        <ForumReactionBar reactions={topic.reactions} canReact={policy.canReactForum} onToggle={reactToPost} />

        <section aria-labelledby="topic-comments" className="detail-section">
          <h2 id="topic-comments" className="section-header__title">
            {t("forum.commentsHeading", { count: topic.commentCount })}
          </h2>
          <ForumCommentList
            comments={topic.comments}
            pagination={topic.commentsPagination}
            canReact={policy.canReactForum}
            onReact={reactToComment}
            onEdit={async (commentId, body) => {
              await apiFetch(`/forum/comments/${commentId}`, { method: "PUT", body: JSON.stringify({ body }) });
              reload();
            }}
            onRequestDelete={setDeleteCommentId}
            onPageChange={(p) => setParams(p > 1 ? { page: String(p) } : {})}
          />

          {topic.locked ? (
            <p className="forum-note forum-note--locked">
              <Icon name="lock" size={14} /> {t("forum.topicLockedNote")}
            </p>
          ) : policy.canCommentForum ? (
            <ForumCommentComposer
              people={(people ?? []).map((p) => ({ id: p.id, name: p.name }))}
              onSubmit={async (body) => {
                await apiFetch(`/forum/posts/${topic!.id}/comments`, { method: "POST", body: JSON.stringify({ body }) });
                reload();
                if (!people) ensureLists();
              }}
            />
          ) : (
            <p className="forum-note">
              <Link to="/login">{t("nav.login")}</Link> {t("forum.toJoinDiscussion")}
            </p>
          )}
        </section>
      </div>

      <ForumComposer
        open={editOpen}
        mode="edit"
        categories={[]}
        projects={(projects ?? []).map((p) => ({ id: p.id, title: p.title }))}
        people={(people ?? []).map((p) => ({ id: p.id, name: p.name }))}
        initial={topic}
        onClose={() => setEditOpen(false)}
        onSubmit={async (fields) => {
          await apiFetch(`/forum/posts/${topic.id}`, { method: "PUT", body: JSON.stringify({ title: fields.title, body: fields.body, projectId: fields.projectId }) });
          reload();
        }}
      />

      <ForumMoveTopicModal
        open={moveOpen}
        categories={categories ?? []}
        currentCategoryId={topic.category.id}
        onClose={() => setMoveOpen(false)}
        onConfirm={async (categoryId) => {
          await apiFetch(`/forum/posts/${topic.id}`, { method: "PUT", body: JSON.stringify({ categoryId }) });
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleteTopicOpen}
        title={t("forum.deleteTopicTitle")}
        message={t("forum.deleteTopicMessage", { title: topic.title })}
        onClose={() => setDeleteTopicOpen(false)}
        onConfirm={async () => {
          await apiFetch(`/forum/posts/${topic.id}`, { method: "DELETE" });
          navigate(`/community/forum/category/${topic.category.slug}`);
        }}
      />

      <ConfirmDeleteModal
        open={deleteCommentId !== null}
        title={t("forum.deleteCommentTitle")}
        message={t("forum.deleteCommentMessage")}
        onClose={() => setDeleteCommentId(null)}
        onConfirm={async () => {
          await apiFetch(`/forum/comments/${deleteCommentId}`, { method: "DELETE" });
          reload();
        }}
      />
    </>
  );
}
