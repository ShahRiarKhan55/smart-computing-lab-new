import type { Message, PaginationMeta } from "@scl/shared";
import { MessageBubble } from "./MessageBubble";
import { EmptyState } from "./EmptyState";

interface MessageListProps {
  messages: Message[];
  pagination: PaginationMeta;
  onEdit: (id: string, body: string) => Promise<void>;
  onRequestDelete: (id: string) => void;
  onLoadOlder: () => void;
}

/** Chronological message history (oldest first) with a "load older messages" affordance instead
 *  of ever fetching the whole thread at once (Phase 12 §13/§46). */
export function MessageList({ messages, pagination, onEdit, onRequestDelete, onLoadOlder }: MessageListProps) {
  if (messages.length === 0 && pagination.page === 1) {
    return <EmptyState title="No messages yet." compact>Say hello — messages appear here once you start the conversation.</EmptyState>;
  }

  return (
    <>
      {pagination.page < pagination.totalPages && (
        <div className="message-list__load-older">
          <button type="button" className="btn btn--secondary btn--sm" onClick={onLoadOlder}>
            Load older messages
          </button>
        </div>
      )}
      <ul className="message-list">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} onEdit={(body) => onEdit(m.id, body)} onRequestDelete={() => onRequestDelete(m.id)} />
        ))}
      </ul>
    </>
  );
}
