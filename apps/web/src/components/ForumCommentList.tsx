import type { ForumComment as ForumCommentType, ForumReactionKind, PaginationMeta } from "@scl/shared";
import { ForumComment } from "./ForumComment";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { useT } from "../i18n/LocaleContext";

interface ForumCommentListProps {
  comments: ForumCommentType[];
  pagination: PaginationMeta;
  canReact: boolean;
  onReact: (commentId: string, kind: ForumReactionKind, active: boolean) => Promise<void>;
  onEdit: (commentId: string, body: string) => Promise<void>;
  onRequestDelete: (commentId: string) => void;
  onPageChange: (page: number) => void;
}

/** Flat comment list + simple pager, reusing the same .search-pager pattern as global search. */
export function ForumCommentList({ comments, pagination, canReact, onReact, onEdit, onRequestDelete, onPageChange }: ForumCommentListProps) {
  const t = useT();
  if (pagination.total === 0) return <EmptyState title={t("forum.emptyComments")} compact />;

  return (
    <>
      <ol className="comment-list">
        {comments.map((c) => (
          <ForumComment
            key={c.id}
            comment={c}
            canReact={canReact}
            onReact={(kind, active) => onReact(c.id, kind, active)}
            onEdit={(body) => onEdit(c.id, body)}
            onRequestDelete={() => onRequestDelete(c.id)}
          />
        ))}
      </ol>
      {pagination.totalPages > 1 && (
        <nav className="search-pager" aria-label={t("forum.commentPagesAria")}>
          {pagination.page > 1 ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onPageChange(pagination.page - 1)}>
              <Icon name="arrow-left" size={14} /> {t("common.previous")}
            </button>
          ) : (
            <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
              <Icon name="arrow-left" size={14} /> {t("common.previous")}
            </span>
          )}
          <span className="search-pager__pos">{t("common.pageOf", { page: pagination.page, total: pagination.totalPages })}</span>
          {pagination.page < pagination.totalPages ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onPageChange(pagination.page + 1)}>
              {t("common.next")} <Icon name="arrow-right" size={14} />
            </button>
          ) : (
            <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
              {t("common.next")} <Icon name="arrow-right" size={14} />
            </span>
          )}
        </nav>
      )}
    </>
  );
}
