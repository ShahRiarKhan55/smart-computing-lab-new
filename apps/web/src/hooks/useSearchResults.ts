import { useCallback, useEffect, useState } from "react";
import type { SearchFilter, SearchResponse } from "@scl/shared";
import { apiFetch, ApiError } from "../lib/api";

/** One answer, tagged with the exact request it answers (`sig`) and the query text (`q`). */
interface Answer {
  sig: string;
  q: string;
  data: SearchResponse | null;
  error: string | null;
}

/** Validation errors (400) are written for people; anything else gets a generic message. */
function friendlyError(err: unknown): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return err.message;
  return "Search is unavailable right now. Please try again in a moment.";
}

/**
 * Runs the search the URL describes. `q` empty = idle: the API is not called. A newer request
 * cancels the older one, so a slow answer can never overwrite a fast one.
 *
 * Everything the page shows is DERIVED from the latest answer and the current request, so an answer
 * to an old query can never be shown under a new one. While the same query moves to another page or
 * type, its previous results stay (with `loading` set) so the page does not collapse and jump.
 */
export function useSearchResults(q: string, type: SearchFilter, page: number) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const sig = `${q}|${type}|${page}|${version}`;

  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ q });
    if (type !== "all") params.set("type", type);
    if (page > 1) params.set("page", String(page));
    apiFetch<SearchResponse>(`/search?${params.toString()}`, { signal: controller.signal })
      .then((data) => setAnswer({ sig, q, data, error: null }))
      .catch((err) => {
        if (!controller.signal.aborted) setAnswer({ sig, q, data: null, error: friendlyError(err) });
      });
    return () => controller.abort();
  }, [q, type, page, version, sig]);

  const current = answer !== null && answer.sig === sig;
  return {
    data: answer !== null && answer.q === q ? answer.data : null,
    error: current ? answer.error : null,
    loading: q !== "" && !current,
    reload,
  };
}
