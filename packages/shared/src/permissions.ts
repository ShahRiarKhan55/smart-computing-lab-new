import type { Role } from "./schemas/enums.js";

/**
 * The authorization policy: WHO may do WHAT. Pure functions of the acting account
 * (or null for a guest), shared by the Express API (which enforces them) and the
 * React UI (which only uses them to decide which controls to show).
 *
 * The API is the security boundary. The UI copies of these checks are cosmetic:
 * a user who bypasses the UI still meets the same functions on the server.
 *
 * Roles:  ADMIN > LAB_MANAGER > MEMBER > (guest = null)
 *   MEMBER       any logged-in account: sees LAB_ONLY, edits their own profile,
 *                creates/edits publications, news and research areas.
 *   LAB_MANAGER  content management: visibility, deletion, projects, groups,
 *                other people's profiles. No account or role management.
 *   ADMIN        everything, including accounts and roles.
 *
 * Every function fails closed: an unknown role grants nothing beyond "is logged in".
 */
export interface Actor {
  id: string;
  role: Role;
}
export type MaybeActor = Actor | null | undefined;

export const isMember = (a: MaybeActor): a is Actor => Boolean(a); // any logged-in account
export const isAdmin = (a: MaybeActor): boolean => a?.role === "ADMIN";
export const isLabManager = (a: MaybeActor): boolean => a?.role === "LAB_MANAGER";
/** ADMIN or LAB_MANAGER. */
export const isManager = (a: MaybeActor): boolean => isAdmin(a) || isLabManager(a);

// ---- accounts (ADMIN only) ------------------------------------------------
export const canManageUsers = isAdmin; // list / create / delete accounts, change roles

/**
 * Why `actor` may not change `targetId`'s role, or null if they may. Only admins
 * manage roles, so a lab manager can neither grant ADMIN nor promote themselves;
 * nobody may change their own role (this keeps at least one admin).
 */
export function roleChangeError(actor: MaybeActor, targetId: string): string | null {
  if (!canManageUsers(actor)) return "Only admins can change roles.";
  if (actor!.id === targetId) return "You can't change your own role.";
  return null;
}

// ---- visibility -----------------------------------------------------------
export const canViewLabOnly = isMember;
export const canChangeVisibility = isManager;

// ---- curated content: publications, news, research areas -------------------
/** Create and edit (reference behaviour: any logged-in lab member). */
export const canEditContent = isMember;
/** Delete. */
export const canDeleteContent = isManager;
/** Broader management, e.g. sort order and category on team profiles. */
export const canManageContent = isManager;
/** Forum moderation (used by a later phase; defined here so the matrix lives in one place). */
export const canModerate = isManager;

// ---- team profiles ----------------------------------------------------------
export const canEditOwnProfile = (a: MaybeActor, profileUserId: string | null | undefined): boolean =>
  Boolean(a && profileUserId && profileUserId === a.id);
export const canEditOtherProfile = isManager;
export const canEditProfile = (a: MaybeActor, profileUserId: string | null | undefined): boolean =>
  canEditOwnProfile(a, profileUserId) || canEditOtherProfile(a);
/**
 * Same rule as `canEditProfile`, for callers that only hold the server's `isOwn` flag
 * (the browser never receives the account id). Cosmetic in the UI; the API re-checks
 * with `canEditProfile`.
 */
export const canEditProfileView = (a: MaybeActor, isOwn: boolean | null | undefined): boolean =>
  Boolean(a && isOwn) || canEditOtherProfile(a);
export const canCreateTeamMember = isManager;
/** Deleting a person's profile and history is destructive and account-adjacent: admin only. */
export const canDeleteTeamMember = isAdmin;
/** Category and sort order on a team profile. */
export const canManageTeamPlacement = isManager;

// ---- research projects & groups --------------------------------------------
export const canCreateProject = isManager;
/** `isLead`: the actor is a LEAD member of this project. */
export const canEditProject = (a: MaybeActor, isLead: boolean): boolean => isManager(a) || (isMember(a) && isLead);
/** Slug, sort order, group assignment and visibility: managers only, even for a project lead. */
export const canManageProjectSettings = isManager;
export const canDeleteProject = canDeleteContent;

export const canCreateGroup = isManager;
export const canEditGroup = (a: MaybeActor, isLead: boolean): boolean => isManager(a) || (isMember(a) && isLead);
export const canManageGroupSettings = isManager;
export const canDeleteGroup = canDeleteContent;

// ---- forum (Phase 11) ------------------------------------------------------
// Visibility lives on the CATEGORY only (posts/comments inherit it); moderation
// (pin/lock/hide/move) is `canModerate` above, the same function the matrix already
// reserved for this. Ownership rules mirror `canEditProject`/`canEditGroup`: the
// author of a post/comment, or a manager.
export const canManageForumCategories = isManager; // create / edit / delete categories
export const canCreateForumTopic = isMember;
export const canCommentForum = isMember;
export const canReactForum = isMember;
export const canMentionInForum = isMember;
// `isAuthor`: the actor wrote this post/comment (from the server's authorId check, never the
// client). Editing TEXT is author-only — a manager moderates (hides/locks/pins/deletes/moves via
// `canModerate`) rather than silently rewriting someone's words. Deleting is the author, or a
// manager, matching the reference "delete arbitrary content" moderation capability.
export const canEditForumPost = (a: MaybeActor, isAuthor: boolean): boolean => isMember(a) && isAuthor;
export const canDeleteForumPost = (a: MaybeActor, isAuthor: boolean): boolean => isManager(a) || (isMember(a) && isAuthor);
export const canEditForumComment = canEditForumPost;
export const canDeleteForumComment = canDeleteForumPost;

// ---- private messaging + notifications (Phase 12) --------------------------
// Any logged-in account may start/use a conversation or read their own notifications; this only
// gates the UI (nav links, the profile "Message" button). The real rules — sender is always the
// session, only a participant may read a conversation, a user cannot message themselves, nobody
// (not even an admin) may read/modify another account's messages or notifications — are
// enforced server-side by conversation/notification membership, not by role. See
// docs/architecture/phase12-messaging-notifications.md.
export const canMessage = isMember;
export const canViewNotifications = isMember;

// ---- files + gallery (Phase 13) --------------------------------------------
// `canUploadFile` gates the generic, reusable file-upload building block (POST /api/files) —
// any signed-in account, the same baseline every other content-creation permission below starts
// from. Gallery items are OWNED content (like a forum post), not open like publications/news:
// any member may create one, but editing/deleting is the owner or a manager, never just any
// member. `isOwner` comes from the server's own lookup (the file's ownerId === the acting
// account), never from the client. See docs/architecture/phase13-files-and-gallery.md.
export const canUploadFile = isMember;
export const canCreateGalleryItem = isMember;
export const canEditGalleryItem = (a: MaybeActor, isOwner: boolean): boolean => isManager(a) || (isMember(a) && isOwner);
export const canDeleteGalleryItem = canEditGalleryItem;
