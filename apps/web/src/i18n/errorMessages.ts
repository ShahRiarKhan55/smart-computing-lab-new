import type { TranslationKey } from "@scl/shared";
import { ApiError } from "../lib/api";

/**
 * A stable, enumerable subset of the server's known English error strings (lib/validate.ts's
 * defaults, requireAuth/requireCan's 401/403 bodies, and the login route), mapped to a
 * translation key. This is deliberately NOT string-matching arbitrary server text: it is an
 * allow-list of the small set of fixed messages the API is documented to send for these cases
 * (see docs/architecture/phase14-localization.md, "API error contract").
 *
 * Anything not in this table — most zod validation messages ("Title is required.", "End date
 * can't be before the start date.", …) — is shown exactly as the server sent it, in English, in
 * both locales. Phase 14 does not invent Japanese translations for that open-ended set of
 * messages, and does not machine-translate them; the smallest clean change here is a fixed
 * allow-list for the handful of generic, high-frequency cases, not a rewrite of the API's error
 * contract or of every schema in packages/shared.
 */
const KNOWN_MESSAGES: Record<string, TranslationKey> = {
  "Not found": "error.notFound",
  Unauthorized: "error.unauthorized",
  Forbidden: "error.forbidden",
  Conflict: "error.conflict",
  "Bad request": "error.badRequest",
  "Nothing to update.": "error.nothingToUpdate",
  "Request body must be a JSON object.": "error.requestBodyInvalid",
  "Incorrect email or password.": "auth.invalidCredentials",
};

type Translator = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * The localized message for a caught error, for the same
 * `err instanceof ApiError ? err.message : "Something went wrong."` catch blocks used throughout
 * the app. A `TypeError` (fetch's own failure mode for a network/CORS error, before any response
 * exists) becomes the localized "can't reach the server" message; a known server message is
 * translated via the allow-list above; anything else — including every validation message not in
 * that allow-list — is shown exactly as received.
 */
export function apiErrorMessage(err: unknown, t: Translator): string {
  if (err instanceof ApiError) {
    return KNOWN_MESSAGES[err.message] ? t(KNOWN_MESSAGES[err.message]) : err.message || t("error.somethingWentWrong");
  }
  if (err instanceof TypeError) return t("error.network");
  return t("error.somethingWentWrong");
}
