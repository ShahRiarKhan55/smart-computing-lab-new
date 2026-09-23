import type { ConversationSummary, PaginationMeta } from "@scl/shared";
import { ConversationListItem } from "./ConversationListItem";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";

interface ConversationListProps {
  conversations: ConversationSummary[];
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
}

/** The current user's conversations, most recently active first (Phase 12 §12). */
export function ConversationList({ conversations, pagination, onPageChange }: ConversationListProps) {
  if (pagination.total === 0) {
    return (
      <EmptyState title="No conversations yet.">
        Visit a researcher's profile and choose "Message" to start one.
      </EmptyState>
    );
  }

  return (
    <>
      <ul className="conversation-list">
        {conversations.map((c) => (
          <ConversationListItem key={c.id} conversation={c} />
        ))}
      </ul>
      {pagination.totalPages > 1 && (
        <nav className="search-pager" aria-label="Conversation pages">
          {pagination.page > 1 ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onPageChange(pagination.page - 1)}>
              <Icon name="arrow-left" size={14} /> Previous
            </button>
          ) : (
            <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
              <Icon name="arrow-left" size={14} /> Previous
            </span>
          )}
          <span className="search-pager__pos">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          {pagination.page < pagination.totalPages ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onPageChange(pagination.page + 1)}>
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
  );
}
