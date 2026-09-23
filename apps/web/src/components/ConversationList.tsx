import type { ConversationSummary, PaginationMeta } from "@scl/shared";
import { ConversationListItem } from "./ConversationListItem";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { useT } from "../i18n/LocaleContext";

interface ConversationListProps {
  conversations: ConversationSummary[];
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
}

/** The current user's conversations, most recently active first (Phase 12 §12). */
export function ConversationList({ conversations, pagination, onPageChange }: ConversationListProps) {
  const t = useT();
  if (pagination.total === 0) {
    return <EmptyState title={t("messages.empty")}>{t("messages.visitProfileHint")}</EmptyState>;
  }

  return (
    <>
      <ul className="conversation-list">
        {conversations.map((c) => (
          <ConversationListItem key={c.id} conversation={c} />
        ))}
      </ul>
      {pagination.totalPages > 1 && (
        <nav className="search-pager" aria-label={t("messages.conversationPagesAria")}>
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
