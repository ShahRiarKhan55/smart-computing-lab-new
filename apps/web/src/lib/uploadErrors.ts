import type { TranslationKey } from "@scl/shared";
import { ApiError } from "./api";
import { apiErrorMessage } from "../i18n/errorMessages";

type Translator = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * The message for a failed upload. Unlike a generic API error, an upload can fail for reasons the
 * server answers with a classified status (storage not configured/unavailable) or that the hosting
 * platform answers itself with a non-JSON body (413 payload too large) — all of those get a specific,
 * localized sentence instead of "Internal server error" / "Upload failed".
 */
export function uploadErrorMessage(err: unknown, t: Translator, maxLabel: string): string {
  if (err instanceof ApiError) {
    if (err.code === "STORAGE_NOT_CONFIGURED") return t("upload.storageNotConfigured");
    if (err.status === 503) return t("upload.storageUnavailable");
    if (err.status === 413) return t("gallery.fileTooLargeMax", { max: maxLabel });
    if (err.status >= 500) return t("upload.serverError", { status: err.status });
  }
  return apiErrorMessage(err, t);
}
