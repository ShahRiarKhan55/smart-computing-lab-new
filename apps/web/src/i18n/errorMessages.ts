import { ALUMNI_MESSAGES, DUPLICATE_MESSAGES, INVITATION_DUPLICATE_MESSAGE, KNOWLEDGE_CATEGORIES, RESEARCH_LINK_MESSAGES, RESOURCE_TYPES, type TranslationKey } from "@scl/shared";
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
  // Alumni (Phase 3B): the fixed messages of the alumni rules (ALUMNI_MESSAGES in @scl/shared).
  [ALUMNI_MESSAGES.noAccount]: "error.alumniNoAccount",
  [ALUMNI_MESSAGES.hasAccount]: "error.alumniHasAccount",
  [ALUMNI_MESSAGES.adminOnly]: "error.alumniAdminOnly",
  [ALUMNI_MESSAGES.publicationField]: "error.alumniPublicationField",
  [ALUMNI_MESSAGES.alumniOnlyPublication]: "error.alumniOnlyPublication",
  [ALUMNI_MESSAGES.publicationConflict]: "error.publicationConflict",
  // Duplicate warnings (shared/duplicates.ts): the fixed message of each duplicate kind.
  [DUPLICATE_MESSAGES["team-name"]]: "error.duplicateTeamName",
  [DUPLICATE_MESSAGES["publication-doi"]]: "error.duplicatePublicationDoi",
  [DUPLICATE_MESSAGES["publication-title-year"]]: "error.duplicatePublicationTitleYear",
  [DUPLICATE_MESSAGES["news-title-date"]]: "error.duplicateNewsTitleDate",
  [DUPLICATE_MESSAGES["research-title"]]: "error.duplicateResearchTitle",
  [INVITATION_DUPLICATE_MESSAGE]: "error.duplicateInvitation",
  // Research profile links (Phase 3C): the fixed messages of the three validators (RESEARCH_LINK_MESSAGES in @scl/shared).
  [RESEARCH_LINK_MESSAGES.googleScholar]: "error.researchLinkGoogleScholar",
  [RESEARCH_LINK_MESSAGES.researchGate]: "error.researchLinkResearchGate",
  [RESEARCH_LINK_MESSAGES.orcid]: "error.researchLinkOrcid",
  [RESEARCH_LINK_MESSAGES.tooLong]: "error.researchLinkTooLong",
  "Request body must be a JSON object.": "error.requestBodyInvalid",
  // Google account linking (Phase 2.2).
  "A Google account is already connected.": "error.googleAlreadyConnected",
  "No Google account is connected.": "error.googleNotConnected",
  "Request must be JSON.": "error.requestMustBeJson",
  "Google sign-in is not available.": "error.googleUnavailable",
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
  // Transient database lock contention (503 + Retry-After): lib/dbErrors.ts SERVICE_BUSY_MESSAGE.
  "The service is busy. Please try again in a moment.": "error.serviceBusy",
  // Self-service password change.
  "Current password is incorrect.": "profile.password.err.incorrect",
  // Profile photo upload (Phase 3A): the fixed messages the upload route, the size/type checks and the sanitizer can send. The
  // numbers mirror PROFILE_PHOTO_LIMITS and the 5 MB image cap in the server. Any OTHER sanitizer message (one of ~60 structural
  // details) is replaced by profile.photo.err.invalid in PhotoUploader.
  "The image is too small (at least 16 x 16 pixels).": "profile.photo.err.tooSmall",
  "The image is too large (at most 6000 pixels on a side).": "profile.photo.err.tooLarge",
  "The image has too many pixels (at most 24 megapixels).": "profile.photo.err.tooManyPixels",
  "File is too large (max 5.0 MB for this file type).": "profile.photo.err.size",
  "Unsupported or unrecognised file type. Allowed: JPEG, PNG, WEBP, GIF images and PDF documents.": "profile.photo.err.type",
  "Only image files (JPEG, PNG, WEBP, GIF) are accepted here.": "profile.photo.err.type",
  "Your profile changed while the photo was uploading. Please try again.": "profile.photo.err.conflict",
  "No team profile is linked to your account yet. Ask the admin to link one.": "profile.noLinkedProfile",
  "Animated images are not supported for profile photos. Please upload a still image.": "profile.photo.err.animated",
  "This photo's rotation information is damaged or ambiguous, so it cannot be used safely. Please re-save the photo (or take a screenshot of it) and upload that.": "profile.photo.err.orientation",
  "Too many attempts. Please wait a few minutes and try again.": "error.tooManyAttempts",
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
