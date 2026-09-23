import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ConversationDetail, Message, PaginationMeta } from "@scl/shared";
import { apiFetch, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { Avatar } from "../components/Avatar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { Icon } from "../components/Icon";
import { MessageList } from "../components/MessageList";
import { MessageComposer } from "../components/MessageComposer";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";

const MESSAGES_LIMIT = 30;

/**
 * /messages/:id — one conversation's history + composer. Only a participant ever reaches this
 * data: a non-participant (or a nonexistent id) gets the same 404 from the API (Phase 12 §11), so
 * this page cannot distinguish "not yours" from "does not exist" and shows one not-found state.
 */
export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStatus(null);

    apiFetch<ConversationDetail>(`/messages/conversations/${id}?page=1&limit=${MESSAGES_LIMIT}`)
      .then((data) => {
        if (cancelled) return;
        setConversation(data);
        setMessages(data.messages);
        setPagination(data.messagesPagination);
        // Opening the conversation marks it read (Phase 12 §18); best-effort, never blocks the view.
        apiFetch(`/messages/conversations/${id}/read`, { method: "PATCH" }).catch(() => {});
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
        setStatus(err instanceof ApiError ? err.status : null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function loadOlder() {
    if (!pagination || pagination.page >= pagination.totalPages) return;
    setActionError(null);
    try {
      const data = await apiFetch<ConversationDetail>(`/messages/conversations/${id}?page=${pagination.page + 1}&limit=${MESSAGES_LIMIT}`);
      setMessages((prev) => [...data.messages, ...prev]);
      setPagination(data.messagesPagination);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not load older messages.");
    }
  }

  async function sendMessage(body: string) {
    const message = await apiFetch<Message>(`/messages/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
    setMessages((prev) => [...prev, message]);
    setPagination((p) => (p ? { ...p, total: p.total + 1 } : p));
  }

  async function editMessage(messageId: string, body: string) {
    const updated = await apiFetch<Message>(`/messages/messages/${messageId}`, { method: "PUT", body: JSON.stringify({ body }) });
    setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
  }

  async function deleteMessage() {
    if (!deleteId) return;
    const updated = await apiFetch<Message>(`/messages/messages/${deleteId}`, { method: "DELETE" });
    setMessages((prev) => prev.map((m) => (m.id === deleteId ? updated : m)));
  }

  if (loading && !conversation) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Messages", to: "/messages" }, { label: "Loading…" }]} title="Loading…" />
        <div className="container container--narrow">
          <LoadingState label="Loading conversation…" variant="list" />
        </div>
      </>
    );
  }

  if (status === 404 || (!conversation && error)) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Messages", to: "/messages" }, { label: "Not found" }]} title="Conversation not found" />
        <div className="container container--narrow">
          <ErrorState message={status === 404 ? "This conversation could not be found." : (error ?? "Could not load this conversation.")} />
          <Link to="/messages" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> Messages
          </Link>
        </div>
      </>
    );
  }

  if (!conversation || !pagination) return null;

  return (
    <>
      <PageHeader crumbs={[{ label: "Messages", to: "/messages" }, { label: conversation.other.name }]} title={conversation.other.name} />
      <div className="container container--narrow">
        <div className="conversation-header">
          <Avatar size="md" initials={conversation.other.initials} photoUrl={conversation.other.photoUrl || undefined} to={conversation.other.teamMemberId ? `/team/${conversation.other.teamMemberId}` : undefined} name={conversation.other.name} />
          {conversation.other.teamMemberId ? (
            <Link to={`/team/${conversation.other.teamMemberId}`} className="conversation-header__name">
              {conversation.other.name}
            </Link>
          ) : (
            <span className="conversation-header__name">{conversation.other.name}</span>
          )}
        </div>
        {actionError && <ErrorState message={actionError} />}
        <MessageList messages={messages} pagination={pagination} onEdit={editMessage} onRequestDelete={setDeleteId} onLoadOlder={loadOlder} />
        <MessageComposer onSubmit={sendMessage} />
      </div>

      <ConfirmDeleteModal
        open={deleteId !== null}
        title="Delete message"
        message="Delete this message? This cannot be undone."
        onClose={() => setDeleteId(null)}
        onConfirm={async () => {
          await deleteMessage();
          setDeleteId(null);
        }}
      />
    </>
  );
}
