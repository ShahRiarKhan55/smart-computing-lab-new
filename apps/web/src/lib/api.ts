import { currentStoredLocale } from "../i18n/LocaleContext";

export class ApiError extends Error {
  status: number;
  /** Stable machine code from the server (e.g. "STORAGE_UNAVAILABLE"), when it sent one. */
  code?: string;
  /** The raw server message (English, or whatever the server sent) — kept for logging/debugging.
   * UI code should localize via `apiErrorMessage()` (i18n/errorMessages.ts) rather than reading this directly. */
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Thin fetch wrapper for talking to the Express API. Requests are same-origin
 * in dev (Vite proxies /api to the backend) and in production (the backend
 * serves the built frontend), so no CORS/credentials dance is needed.
 *
 * Every request carries `X-Locale` (Phase 14): the visitor's chosen UI language, read directly
 * from storage rather than a hook so this plain function needs no React context. The server only
 * ever uses it to pick which language's text to return (falling back to English) — it never
 * affects what is visible, so it cannot be used to bypass a permission or visibility check.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Locale": currentStoredLocale(), ...options.headers },
    ...options,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data?.error || "Request failed", res.status, typeof data?.code === "string" ? data.code : undefined);
  }

  return data as T;
}

/**
 * Multipart upload (Phase 13). Deliberately does NOT set a Content-Type header — the browser
 * sets `multipart/form-data; boundary=...` itself from the FormData body, which a manual header
 * would break.
 */
export async function apiUpload<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-Locale": currentStoredLocale() },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error || "Upload failed", res.status, typeof data?.code === "string" ? data.code : undefined);
  }
  return data as T;
}
