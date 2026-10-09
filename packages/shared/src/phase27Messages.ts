/**
 * The fixed English messages the Phase 27 API sends. The server throws these exact strings and the web app's
 * `errorMessages` allow-list maps the same constants to translation keys, so a Japanese visitor sees Japanese and the
 * two sides cannot drift apart.
 */
export const P27_MESSAGES = {
  alumniNoAccount: "Alumni profiles can't have a login account.",
  alumniUnlinkFirst: "Alumni profiles can't have a login account. Unlink the login account first.",
  photoType: "Profile photos must be a JPEG, PNG or WEBP image.",
  photoDamaged: "That image file looks damaged or incomplete. Please choose a different photo.",
  photoNoFile: 'No photo was uploaded (expected multipart field "file").',
  importAlreadyReviewed: "This item has already been reviewed.",
  importSyncRunning: "A publication sync is already running. Please try again in a few minutes.",
  importAuthorsRequired: "Authors are required: please enter them before approving.",
  importVenueRequired: "Venue is required: please enter it before approving.",
  importAuthorMissing: "One of the selected authors does not exist.",
  importDuplicateDoi: "A publication with this DOI already exists, so this item was marked as a duplicate.",
  doiLookupLimit: "Too many DOI lookups. Please wait a few minutes.",
  doiLookupNotFound: "No record was found for that DOI. You can still enter the details by hand.",
  doiLookupUnavailable: "The DOI service could not be reached. You can still enter the details by hand.",
  invitationProfileGone: "The team profile for this invitation is no longer available. Contact your administrator.",
  schemaBehind: "The database has not been updated for this version of the site yet. Please try again later.",
} as const;
