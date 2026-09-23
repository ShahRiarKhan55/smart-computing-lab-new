import { Link } from "react-router-dom";
import type { ConversationSummary } from "@scl/shared";
import { Avatar } from "./Avatar";
import { formatDateTime } from "../lib/format";

/** One row in the conversation list: the other participant, a preview of the latest message,
 *  when, and whether it's unread. Never the full message history (Phase 12 §12/§47). */
export function ConversationListItem({ conversation }: { conversation: ConversationSummary }) {
  const { other } = conversation;
  return (
    <li>
      <Link to={`/messages/${conversation.id}`} className={`conversation-item${conversation.unread ? " conversation-item--unread" : ""}`}>
        <Avatar size="md" initials={other.initials} photoUrl={other.photoUrl || undefined} />
        <div className="conversation-item__body">
          <div className="conversation-item__top">
            <span className="conversation-item__name">{other.name}</span>
            {conversation.lastMessageAt && <span className="conversation-item__time">{formatDateTime(conversation.lastMessageAt)}</span>}
          </div>
          <p className="conversation-item__preview">{conversation.lastMessagePreview || "No messages yet"}</p>
        </div>
        {conversation.unread && (
          <span className="conversation-item__badge" aria-label={`${conversation.unreadCount} unread ${conversation.unreadCount === 1 ? "message" : "messages"}`}>
            {conversation.unreadCount}
          </span>
        )}
      </Link>
    </li>
  );
}
