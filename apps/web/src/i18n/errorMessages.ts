import { DOI_INVALID_MESSAGE, P27_MESSAGES, KNOWLEDGE_CATEGORIES, ORCID_INVALID_MESSAGE, RESEARCHGATE_INVALID_MESSAGE, RESOURCE_TYPES, SCHOLAR_INVALID_MESSAGE, type TranslationKey } from "@scl/shared";
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
  [DOI_INVALID_MESSAGE]: "publications.err.doiInvalid",
  [SCHOLAR_INVALID_MESSAGE]: "profile.err.scholarInvalid",
  [RESEARCHGATE_INVALID_MESSAGE]: "profile.err.researchGateInvalid",
  [ORCID_INVALID_MESSAGE]: "profile.err.orcidInvalid",
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
  // Knowledge base (Phase 22): the fixed messages the knowledge API and schemas produce.
  "Body is required.": "knowledge.err.bodyRequired",
  "Body must be at most 20000 characters.": "knowledge.err.bodyMax",
  [`Category must be one of: ${KNOWLEDGE_CATEGORIES.join(", ")}.`]: "knowledge.err.categoryInvalid",
  "Japanese body must be at most 20000 characters.": "knowledge.err.jaBodyMax",
  "Research area not found.": "knowledge.err.areaNotFound",
  "Group not found.": "knowledge.err.groupNotFound",
  "Researcher not found.": "knowledge.err.researcherNotFound",
  "Only lab managers and admins can filter by visibility.": "knowledge.err.visibilityFilterForbidden",
  // Lab resources (Phase 23): the fixed messages the resources API and schemas produce.
  "Name is required.": "resource.err.nameRequired",
  "Name must be at most 200 characters.": "resource.err.nameMax",
  "Environment notes must be at most 5000 characters.": "resource.err.environmentMax",
  [`Type must be one of: ${RESOURCE_TYPES.join(", ")}.`]: "resource.err.typeInvalid",
  "Document not found.": "resource.err.documentNotFound",
  "Publication not found.": "resource.err.publicationNotFound",
  "Event not found.": "resource.err.eventNotFound",
  "Japanese name must be at most 200 characters.": "resource.err.jaNameMax",
  "Japanese environment must be at most 5000 characters.": "resource.err.jaEnvironmentMax",
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
  // Researcher onboarding invitations: the fixed messages the researcher themselves can see on
  // the public /invite/:token acceptance page.
  "This invitation link is invalid.": "invite.err.invalidLink",
  "This invitation has already been used. Please log in instead.": "invite.err.alreadyUsed",
  "This invitation has been revoked. Ask your administrator for a new one.": "invite.err.revoked",
  "This invitation has expired. Ask your administrator for a new one.": "invite.err.expired",
  "This invitation is no longer valid.": "invite.err.noLongerValid",
  "Too many requests. Please wait a few minutes and try again.": "error.tooManyRequests",
  // Self-service password change.
  "Current password is incorrect.": "profile.password.err.incorrect",
  "Too many attempts. Please wait a few minutes and try again.": "error.tooManyAttempts",
  // Phase 27: the fixed messages of the alumni, profile-photo, publication-import and deploy-guard paths.
  [P27_MESSAGES.alumniNoAccount]: "p27.err.alumniNoAccount",
  [P27_MESSAGES.alumniUnlinkFirst]: "p27.err.alumniUnlinkFirst",
  [P27_MESSAGES.photoType]: "p27.err.photoType",
  [P27_MESSAGES.photoDamaged]: "p27.err.photoDamaged",
  [P27_MESSAGES.photoNoFile]: "p27.err.photoNoFile",
  [P27_MESSAGES.importAlreadyReviewed]: "p27.err.importAlreadyReviewed",
  [P27_MESSAGES.importSyncRunning]: "p27.err.importSyncRunning",
  [P27_MESSAGES.importAuthorsRequired]: "p27.err.importAuthorsRequired",
  [P27_MESSAGES.importVenueRequired]: "p27.err.importVenueRequired",
  [P27_MESSAGES.importAuthorMissing]: "p27.err.importAuthorMissing",
  [P27_MESSAGES.importDuplicateDoi]: "p27.err.importDuplicateDoi",
  [P27_MESSAGES.doiLookupLimit]: "p27.err.doiLookupLimit",
  [P27_MESSAGES.doiLookupNotFound]: "p27.err.doiLookupNotFound",
  [P27_MESSAGES.doiLookupUnavailable]: "p27.err.doiLookupUnavailable",
  [P27_MESSAGES.invitationProfileGone]: "p27.err.invitationProfileGone",
  [P27_MESSAGES.schemaBehind]: "p27.err.schemaBehind",
};

/** Fixed sentences that embed a number (so they cannot be exact-match keys): matched by shape, number passed to the translation. */
const KNOWN_PATTERNS: { re: RegExp; key: TranslationKey }[] = [
  { re: /^That photo is too large in pixels \(max (\d+) x \d+\)\.$/, key: "p27.err.photoPixels" },
  { re: /^File is too large \(max ([\d.]+) MB for a profile photo\)\.$/, key: "p27.err.photoSize" },
];

/** The localized text for a known server/schema message, else the message itself (the same rule as `apiErrorMessage`). */
export function knownMessage(message: string, t: Translator): string {
  if (KNOWN_MESSAGES[message]) return t(KNOWN_MESSAGES[message]);
  for (const { re, key } of KNOWN_PATTERNS) {
    const m = re.exec(message);
    if (m) return t(key, { max: m[1] });
  }
  return message;
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
  // A stable server code wins over message matching (the deploy-order guard answers 503 DB_SCHEMA_BEHIND).
  if (err instanceof ApiError && err.code === "DB_SCHEMA_BEHIND") return t("p27.err.schemaBehind");
  if (err instanceof ApiError) return knownMessage(err.message, t) || t("error.somethingWentWrong");
  if (err instanceof TypeError) return t("error.network");
  return t("error.somethingWentWrong");
}
