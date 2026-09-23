import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../lib/api";

interface UseApiResourceResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
  reload: () => void;
}

/**
 * Fetches `path` on mount and exposes loading/error/data state, so pages
 * don't each hand-roll the same fetch/try-catch boilerplate. `status`
 * exposes the failed request's HTTP status (e.g. 404) so callers can render
 * a distinct not-found state instead of a generic error banner.
 */
export function useApiResource<T>(path: string): UseApiResourceResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStatus(null);

    apiFetch<T>(path)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Something went wrong.");
          setStatus(err instanceof ApiError ? err.status : null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, version]);

  return { data, loading, error, status, reload };
}
