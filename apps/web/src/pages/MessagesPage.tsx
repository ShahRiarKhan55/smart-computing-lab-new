import { useSearchParams } from "react-router-dom";
import type { ConversationListResponse } from "@scl/shared";
import { useApiResource } from "../hooks/useApiResource";
import { PageHeader } from "../components/PageHeader";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { ConversationList } from "../components/ConversationList";

/** /messages — the current user's own conversations, and nothing else (Phase 12 §11/§12). */
export function MessagesPage() {
  const [params, setParams] = useSearchParams();
  const page = /^\d{1,5}$/.test(params.get("page") ?? "") ? Number(params.get("page")) : 1;

  const { data, loading, error, reload } = useApiResource<ConversationListResponse>(`/messages/conversations?page=${page}&limit=20`);

  return (
    <>
      <PageHeader eyebrow="Account" title="Messages" description="Private conversations with other lab members." />
      <div className="container container--narrow">
        {loading && !data ? (
          <LoadingState label="Loading conversations…" variant="list" />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          data && <ConversationList conversations={data.conversations} pagination={data.pagination} onPageChange={(p) => setParams(p > 1 ? { page: String(p) } : {})} />
        )}
      </div>
    </>
  );
}
