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
  // Events (Phase 16): the fixed validation/permission messages the events API and the shared
  // event schema can produce, so the form and the API errors read the same in both locales.
  "Only lab managers and admins can change visibility.": "error.visibilityForbidden",
  "Title is required.": "events.err.titleRequired",
  "Title must be at most 200 characters.": "events.err.titleMax",
  "Description must be at most 5000 characters.": "events.err.descriptionMax",
  "Location must be at most 200 characters.": "events.err.locationMax",
  "Link must be a valid URL starting with http:// or https://.": "events.err.urlInvalid",
  "Start is required.": "events.err.startRequired",
  "Start must be a valid date and time.": "events.err.startInvalid",
  "End must be a valid date and time.": "events.err.endInvalid",
  "End can't be before the start.": "events.err.endBeforeStart",
  "Event type must be one of SEMINAR, MEETING, DEADLINE, SOCIAL or OTHER.": "events.err.kindInvalid",
  "Japanese title must be at most 200 characters.": "events.err.jaTitleMax",
  "Japanese description must be at most 5000 characters.": "events.err.jaDescriptionMax",
  "Only lab managers and admins can link an event to a project.": "events.err.projectLinkForbidden",
  "Project not found.": "events.err.projectNotFound",
  // Admin / CMS (Phase 17): account link/unlink.
  "That account is already linked to a team profile. Unlink it first.": "adm.err.alreadyLinked",
  "That account isn't linked to a team profile.": "adm.err.notLinked",
  "Selected team member does not exist.": "adm.err.memberMissing",
  "That team member already has a linked account.": "adm.err.memberTaken",
  // Research collaboration workspace (Phase 21): single-researcher membership writes.
  "That researcher is already a member.": "workspace.err.alreadyMember",
  "That researcher is not a member.": "workspace.err.notMember",
  "That researcher already has this role.": "workspace.err.alreadyRole",
  "One or more team members do not exist.": "workspace.err.memberMissing",
};

/** The localized text for a known server/schema message, else the message itself (the same rule as `apiErrorMessage`). */
export function knownMessage(message: string, t: Translator): string {
  return KNOWN_MESSAGES[message] ? t(KNOWN_MESSAGES[message]) : message;
}

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
  if (err instanceof ApiError) return knownMessage(err.message, t) || t("error.somethingWentWrong");
  if (err instanceof TypeError) return t("error.network");
  return t("error.somethingWentWrong");
}
